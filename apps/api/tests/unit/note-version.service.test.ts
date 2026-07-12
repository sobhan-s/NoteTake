import { describe, it, expect, vi, beforeEach } from "vitest";
import { API_ERROR_CODES } from "@shared/core/constants";

vi.mock("../../src/repositories/note.repository.js", () => ({
  findActiveNoteByIdForUser: vi.fn(),
  updateNoteContent: vi.fn(),
}));

vi.mock("../../src/repositories/note-version.repository.js", () => ({
  listVersionsForNote: vi.fn(),
  findVersionByIdForNote: vi.fn(),
  createVersion: vi.fn(),
}));

vi.mock("../../src/lib/prisma-client.js", () => ({
  prisma: { $transaction: vi.fn((cb) => cb({})) },
}));

import * as noteRepository from "../../src/repositories/note.repository.js";
import * as noteVersionRepository from "../../src/repositories/note-version.repository.js";
import { prisma } from "../../src/lib/prisma-client.js";
import * as noteVersionService from "../../src/services/note-version.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

function buildOwnedNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    userId: USER_ID,
    title: "Current Title",
    body: "Current Body",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    shareLinks: [],
    noteTags: [],
    ...overrides,
  };
}

function buildVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    noteId: NOTE_ID,
    titleSnapshot: "Snapshot Title",
    bodySnapshot: "Snapshot Body",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("[FRS-6.2] note-version.service.listVersions — ownership guard and reverse-chronological mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-6, Error Scenarios] SHALL reject with 404 NOTE_NOT_FOUND (never 403) and SHALL NOT query versions when the note doesn't resolve as owned/active (cross-user or nonexistent)", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      null as never,
    );

    await expect(
      noteVersionService.listVersions(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteVersionRepository.listVersionsForNote).not.toHaveBeenCalled();
  });

  it("[FRS-6, Error Scenarios] SHALL reject with 404 NOTE_NOT_FOUND when the note is owned but currently trashed (deletedAt set)", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      null as never,
    );

    await expect(
      noteVersionService.listVersions(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.findActiveNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
  });

  it("[FRS-6.2] SHALL map listVersionsForNote's rows to { id, titleSnapshot, createdAt } summaries, preserving repository-provided ordering", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(noteVersionRepository.listVersionsForNote).mockResolvedValue([
      buildVersion({
        id: "v2",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
      buildVersion({
        id: "v1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ] as never);

    const result = await noteVersionService.listVersions(USER_ID, NOTE_ID);

    expect(result.versions.map((v) => v.id)).toEqual(["v2", "v1"]);
    expect(result.versions[0]).toEqual({
      id: "v2",
      titleSnapshot: "Snapshot Title",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(noteVersionRepository.listVersionsForNote).toHaveBeenCalledWith(
      NOTE_ID,
    );
  });
});

describe("[FRS-6.3] note-version.service.getVersion — ownership guard and version-scope guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-6, Error Scenarios] SHALL reject with 404 NOTE_NOT_FOUND before ever querying the version, when the note isn't owned/active", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      null as never,
    );

    await expect(
      noteVersionService.getVersion(USER_ID, NOTE_ID, VERSION_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteVersionRepository.findVersionByIdForNote).not.toHaveBeenCalled();
  });

  it("[FRS-6, Error Scenarios] SHALL reject with 404 VERSION_NOT_FOUND when the versionId doesn't resolve scoped to the note (nonexistent, cross-note, or purged)", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(noteVersionRepository.findVersionByIdForNote).mockResolvedValue(
      null as never,
    );

    await expect(
      noteVersionService.getVersion(USER_ID, NOTE_ID, VERSION_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.VERSION_NOT_FOUND,
    });
    expect(noteVersionRepository.findVersionByIdForNote).toHaveBeenCalledWith(
      NOTE_ID,
      VERSION_ID,
    );
  });

  it("[FRS-6.3] SHALL return the full { id, noteId, titleSnapshot, bodySnapshot, createdAt } DTO when the version resolves scoped to the owned note", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(noteVersionRepository.findVersionByIdForNote).mockResolvedValue(
      buildVersion() as never,
    );

    const result = await noteVersionService.getVersion(
      USER_ID,
      NOTE_ID,
      VERSION_ID,
    );

    expect(result).toEqual({
      id: VERSION_ID,
      noteId: NOTE_ID,
      titleSnapshot: "Snapshot Title",
      bodySnapshot: "Snapshot Body",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("[FRS-6.4] note-version.service.restoreVersion — ownership guard, version-scope guard, non-destructive append", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb) => cb({}));
  });

  it("[FRS-6, Error Scenarios] SHALL reject with 404 NOTE_NOT_FOUND and open no transaction when restoring on a since-trashed or cross-user note", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      null as never,
    );

    await expect(
      noteVersionService.restoreVersion(USER_ID, NOTE_ID, VERSION_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(noteRepository.updateNoteContent).not.toHaveBeenCalled();
    expect(noteVersionRepository.createVersion).not.toHaveBeenCalled();
  });

  it("[FRS-6, Error Scenarios] SHALL reject with 404 VERSION_NOT_FOUND and open no transaction when the versionId belongs to a different note", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    vi.mocked(noteVersionRepository.findVersionByIdForNote).mockResolvedValue(
      null as never,
    );

    await expect(
      noteVersionService.restoreVersion(USER_ID, NOTE_ID, VERSION_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.VERSION_NOT_FOUND,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("[FRS-6.4] SHALL copy the resolved version's titleSnapshot/bodySnapshot onto the live Note and append a brand-new NoteVersion row inside a single transaction", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildOwnedNote() as never,
    );
    const oldVersion = buildVersion({
      titleSnapshot: "Old Title",
      bodySnapshot: "Old Body",
    });
    vi.mocked(noteVersionRepository.findVersionByIdForNote).mockResolvedValue(
      oldVersion as never,
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildOwnedNote({ title: "Old Title", body: "Old Body" }) as never,
    );

    const result = await noteVersionService.restoreVersion(
      USER_ID,
      NOTE_ID,
      VERSION_ID,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(noteRepository.updateNoteContent).toHaveBeenCalledWith(
      NOTE_ID,
      { title: "Old Title", body: "Old Body" },
      expect.anything(),
    );
    expect(noteVersionRepository.createVersion).toHaveBeenCalledWith(
      { noteId: NOTE_ID, titleSnapshot: "Old Title", bodySnapshot: "Old Body" },
      expect.anything(),
    );
    expect(result.title).toBe("Old Title");
    expect(result.body).toBe("Old Body");
  });
});
