import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import { AppError } from "../../src/errors/app-error.js";

vi.mock("../../src/repositories/note.repository.js", () => ({
  findActiveNoteByIdForUser: vi.fn(),
}));

vi.mock("../../src/repositories/share.repository.js", () => ({
  findActiveShareLinkForNote: vi.fn(),
  createShareLink: vi.fn(),
  revokeShareLinkById: vi.fn(),
  revokeActiveShareLinksForNote: vi.fn(),
  consumePublicShareView: vi.fn(),
}));

import * as noteRepository from "../../src/repositories/note.repository.js";
import * as shareRepository from "../../src/repositories/share.repository.js";
import * as shareService from "../../src/services/share.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const LINK_ID = "33333333-3333-4333-8333-333333333333";

function buildOwnedNote(): unknown {
  return { id: NOTE_ID, userId: USER_ID, shareLinks: [] };
}

function buildShareLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LINK_ID,
    noteId: NOTE_ID,
    token: "existing-token-abc123",
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    viewCount: 5,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

function p2002Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

describe("share.service.getOrCreateShareLink — createShareLinkWithRetry P2002 retry path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(shareRepository.findActiveShareLinkForNote).mockResolvedValue(
      null,
    );
  });

  it("[Resolved Decision #7] SHALL retry and succeed when the first createShareLink call rejects with P2002 and the second resolves", async () => {
    const created = buildShareLink({ token: "fresh-token-xyz" });
    vi.mocked(shareRepository.createShareLink)
      .mockRejectedValueOnce(p2002Error())
      .mockResolvedValueOnce(created as never);

    const result = await shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
      expiresInDays: 7,
    });

    expect(result.created).toBe(true);
    expect(result.dto.token).toBe("fresh-token-xyz");
    expect(shareRepository.createShareLink).toHaveBeenCalledTimes(2);
  });

  it("[Resolved Decision #7] SHALL generate a freshly random token for each retry attempt (the two createShareLink calls SHALL NOT receive the same token)", async () => {
    const created = buildShareLink();
    vi.mocked(shareRepository.createShareLink)
      .mockRejectedValueOnce(p2002Error())
      .mockResolvedValueOnce(created as never);

    await shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
      expiresInDays: 7,
    });

    const calls = vi.mocked(shareRepository.createShareLink).mock.calls;
    expect(calls).toHaveLength(2);
    const firstToken = (calls[0]?.[0] as { token: string }).token;
    const secondToken = (calls[1]?.[0] as { token: string }).token;
    expect(firstToken).toMatch(/^[0-9a-f]{64}$/);
    expect(secondToken).toMatch(/^[0-9a-f]{64}$/);
    expect(firstToken).not.toBe(secondToken);
  });

  it("[Resolved Decision #7] SHALL exhaust retries and rethrow the P2002 error after exactly 3 total attempts all rejecting with P2002", async () => {
    const finalError = p2002Error();
    vi.mocked(shareRepository.createShareLink)
      .mockRejectedValueOnce(p2002Error())
      .mockRejectedValueOnce(p2002Error())
      .mockRejectedValueOnce(finalError);

    await expect(
      shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
        expiresInDays: 7,
      }),
    ).rejects.toBe(finalError);
    expect(shareRepository.createShareLink).toHaveBeenCalledTimes(3);
  });

  it("[Resolved Decision #7] SHALL NOT retry and SHALL immediately rethrow a non-P2002 error on the very first attempt", async () => {
    const genericError = new Error("connection reset");
    vi.mocked(shareRepository.createShareLink).mockRejectedValueOnce(
      genericError,
    );

    await expect(
      shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
        expiresInDays: 7,
      }),
    ).rejects.toBe(genericError);
    expect(shareRepository.createShareLink).toHaveBeenCalledTimes(1);
  });
});

describe("share.service.getOrCreateShareLink — get-or-create branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
  });

  it("[Resolved Decision #1] SHALL return { created: false } with the existing link's exact token/expiresAt/viewCount, and SHALL NOT call createShareLink, even when expiresInDays differs from the existing link's expiry", async () => {
    const existing = buildShareLink({
      token: "existing-token-abc123",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      viewCount: 5,
    });
    vi.mocked(shareRepository.findActiveShareLinkForNote).mockResolvedValue(
      existing as never,
    );

    const result = await shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
      expiresInDays: 30,
    });

    expect(result).toEqual({
      created: false,
      dto: {
        noteId: NOTE_ID,
        token: "existing-token-abc123",
        expiresAt: "2026-08-01T00:00:00.000Z",
        viewCount: 5,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(shareRepository.createShareLink).not.toHaveBeenCalled();
  });

  it("[Resolved Decision #1] SHALL return { created: true } and call createShareLink with expiresAt computed as now + input.expiresInDays days, when findActiveShareLinkForNote resolves null", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2026-07-12T00:00:00.000Z");
    vi.setSystemTime(fixedNow);

    try {
      vi.mocked(shareRepository.findActiveShareLinkForNote).mockResolvedValue(
        null,
      );
      const created = buildShareLink({
        expiresAt: new Date(fixedNow.getTime() + 10 * 24 * 60 * 60 * 1000),
      });
      vi.mocked(shareRepository.createShareLink).mockResolvedValue(
        created as never,
      );

      const result = await shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
        expiresInDays: 10,
      });

      expect(result.created).toBe(true);
      const expectedExpiresAt = new Date(
        fixedNow.getTime() + 10 * 24 * 60 * 60 * 1000,
      );
      expect(shareRepository.createShareLink).toHaveBeenCalledWith(
        expect.objectContaining({
          noteId: NOTE_ID,
          expiresAt: expectedExpiresAt,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("share.service — assertOwnedActiveNote 404 framing across owner-facing functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);
  });

  it("[Resolved Decision #8] getOrCreateShareLink SHALL reject with 404 NOTE_NOT_FOUND (never SHARE_LINK_NOT_FOUND) and SHALL NOT call any shareRepository function", async () => {
    await expect(
      shareService.getOrCreateShareLink(USER_ID, NOTE_ID, {
        expiresInDays: 7,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(shareRepository.findActiveShareLinkForNote).not.toHaveBeenCalled();
    expect(shareRepository.createShareLink).not.toHaveBeenCalled();
  });

  it("[Resolved Decision #8] getActiveShareLink SHALL reject with 404 NOTE_NOT_FOUND (never SHARE_LINK_NOT_FOUND) and SHALL NOT call any shareRepository function", async () => {
    await expect(
      shareService.getActiveShareLink(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(shareRepository.findActiveShareLinkForNote).not.toHaveBeenCalled();
  });

  it("[Resolved Decision #8] revokeShareLink SHALL reject with 404 NOTE_NOT_FOUND (never SHARE_LINK_NOT_FOUND) and SHALL NOT call any shareRepository function", async () => {
    await expect(
      shareService.revokeShareLink(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(shareRepository.findActiveShareLinkForNote).not.toHaveBeenCalled();
    expect(shareRepository.revokeShareLinkById).not.toHaveBeenCalled();
  });
});

describe("share.service.getActiveShareLink — no active share link on an owned/active note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(shareRepository.findActiveShareLinkForNote).mockResolvedValue(
      null,
    );
  });

  it("[FRS-5.3] SHALL reject with 404 SHARE_LINK_NOT_FOUND when the note is owned/active but no active share link exists", async () => {
    await expect(
      shareService.getActiveShareLink(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.SHARE_LINK_NOT_FOUND,
    });
  });
});

describe("share.service.revokeShareLink — no active share link on an owned/active note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(shareRepository.findActiveShareLinkForNote).mockResolvedValue(
      null,
    );
  });

  it("[FRS-5.4] SHALL reject with 404 SHARE_LINK_NOT_FOUND and SHALL NOT call revokeShareLinkById when no active share link exists", async () => {
    await expect(
      shareService.revokeShareLink(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.SHARE_LINK_NOT_FOUND,
    });
    expect(shareRepository.revokeShareLinkById).not.toHaveBeenCalled();
  });
});

describe("share.service.getPublicNoteByToken — unauthenticated public read path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-5.5, FRS-5.6] SHALL reject with 404 SHARE_LINK_UNAVAILABLE (single generic path) when consumePublicShareView resolves null", async () => {
    vi.mocked(shareRepository.consumePublicShareView).mockResolvedValue(null);

    await expect(
      shareService.getPublicNoteByToken("some-token"),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.SHARE_LINK_UNAVAILABLE,
    });
  });

  it("[FRS-5.5, FRS-5.6] SHALL reject as an AppError instance when consumePublicShareView resolves null", async () => {
    vi.mocked(shareRepository.consumePublicShareView).mockResolvedValue(null);

    await expect(
      shareService.getPublicNoteByToken("some-token"),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("[FRS-5.5] SHALL return exactly { title, body, updatedAt } (no viewCount, no id, no noteId) when a row resolves", async () => {
    vi.mocked(shareRepository.consumePublicShareView).mockResolvedValue({
      view_count: 12,
      expires_at: new Date("2026-08-01T00:00:00.000Z"),
      note_id: NOTE_ID,
      title: "Public Title",
      body: "Public Body",
      updated_at: new Date("2026-07-10T00:00:00.000Z"),
    });

    const result = await shareService.getPublicNoteByToken("some-token");

    expect(Object.keys(result).sort()).toEqual(
      ["body", "title", "updatedAt"].sort(),
    );
    expect(result).toEqual({
      title: "Public Title",
      body: "Public Body",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });
  });
});
