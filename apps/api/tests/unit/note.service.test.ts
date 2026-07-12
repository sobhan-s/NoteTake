import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Note, NoteVersion } from "@prisma/client";
import {
  API_ERROR_CODES,
  APP_LIMITS,
  VALIDATION_MESSAGES,
} from "@shared/core/constants";
import { AppError } from "../../src/errors/app-error.js";

vi.mock("../../src/repositories/note.repository.js", () => ({
  createNote: vi.fn(),
  findActiveNoteByIdForUser: vi.fn(),
  findTrashedNoteByIdForUser: vi.fn(),
  updateNoteContent: vi.fn(),
  softDeleteNote: vi.fn(),
  restoreNote: vi.fn(),
  permanentlyDeleteNote: vi.fn(),
  purgeStage2Notes: vi.fn(),
  listActiveNotesForUser: vi.fn(),
  countActiveNotesForUser: vi.fn(),
  listTrashedNotesForUser: vi.fn(),
  countTrashedNotesForUser: vi.fn(),
}));

vi.mock("../../src/repositories/share.repository.js", () => ({
  revokeActiveShareLinksForNote: vi.fn(),
}));

vi.mock("../../src/repositories/note-version.repository.js", () => ({
  createVersion: vi.fn(),
  findLatestVersionForNote: vi.fn(),
}));

vi.mock("../../src/repositories/tag.repository.js", () => ({
  findTagsByIdsForUser: vi.fn(),
}));

vi.mock("../../src/lib/prisma-client.js", () => ({
  prisma: { $transaction: vi.fn((cb) => cb({})) },
}));

import * as noteRepository from "../../src/repositories/note.repository.js";
import * as shareRepository from "../../src/repositories/share.repository.js";
import * as noteVersionRepository from "../../src/repositories/note-version.repository.js";
import * as tagRepository from "../../src/repositories/tag.repository.js";
import { prisma } from "../../src/lib/prisma-client.js";
import * as noteService from "../../src/services/note.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const TAG_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAG_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type NoteWithRelations = Note & {
  shareLinks: { id: string }[];
  noteTags: { tag: { id: string; name: string; color: string } }[];
};

function buildNote(
  overrides: Partial<Note> & {
    shareLinks?: { id: string }[];
    noteTags?: { tag: { id: string; name: string; color: string } }[];
  } = {},
): NoteWithRelations {
  const { shareLinks = [], noteTags = [], ...noteOverrides } = overrides;
  return {
    id: NOTE_ID,
    userId: USER_ID,
    title: "Fixture Title",
    body: "Fixture Body",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...noteOverrides,
    shareLinks,
    noteTags,
  } as unknown as NoteWithRelations;
}

function buildLatestVersion(overrides: Partial<NoteVersion> = {}): NoteVersion {
  return {
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    noteId: NOTE_ID,
    titleSnapshot: "Prior Snapshot Title",
    bodySnapshot: "Prior Snapshot Body",
    createdAt: new Date(),
    ...overrides,
  } as unknown as NoteVersion;
}

describe("[FRS-2.2.2, FRS-2.2.5] note.service — Stage-1 boundary classification (isWithinStage1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-2.2.2] SHALL treat a note trashed exactly `now - (30 days - 1 second)` as still within Stage 1 and restore it", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS - 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );
    vi.mocked(noteRepository.restoreNote).mockResolvedValue(
      buildNote({ deletedAt: null }),
    );

    const result = await noteService.restoreNote(USER_ID, NOTE_ID);

    expect(result.deletedAt).toBeNull();
    expect(noteRepository.restoreNote).toHaveBeenCalledWith(NOTE_ID);
  });

  it("[FRS-2.2.5, FRS-2.2.6] SHALL treat a note trashed exactly `now - (30 days + 1 second)` as Stage 2 (outside the restorable window) and reject restore with 404 NOTE_NOT_FOUND", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS + 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );

    await expect(
      noteService.restoreNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.restoreNote).not.toHaveBeenCalled();
  });

  it("[FRS-2.2.5, FRS-2.2.8] SHALL apply the identical Stage-1 boundary to permanentDeleteNote: `30 days - 1 second` succeeds", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS - 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );
    vi.mocked(noteRepository.permanentlyDeleteNote).mockResolvedValue(
      trashedNote,
    );

    const result = await noteService.permanentDeleteNote(USER_ID, NOTE_ID);

    expect(result).toEqual({ id: NOTE_ID });
    expect(noteRepository.permanentlyDeleteNote).toHaveBeenCalledWith(NOTE_ID);
  });

  it("[FRS-2.2.5, FRS-2.2.8] SHALL apply the identical Stage-1 boundary to permanentDeleteNote: `30 days + 1 second` rejects with 404 NOTE_NOT_FOUND", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS + 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );

    await expect(
      noteService.permanentDeleteNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.permanentlyDeleteNote).not.toHaveBeenCalled();
  });

  it("[Resolved Decision #4] SHALL reject restore with 404 NOTE_NOT_FOUND when the repository finds no trashed row at all (never trashed / cross-user)", async () => {
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      null,
    );

    await expect(
      noteService.restoreNote(USER_ID, NOTE_ID),
    ).rejects.toBeInstanceOf(AppError);
    expect(noteRepository.restoreNote).not.toHaveBeenCalled();
  });
});

describe("[SDS §4.1] note.service — find-then-act repository call sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-2.2.2] restoreNote SHALL call findTrashedNoteByIdForUser(id, userId) before restoreNote(id), never the reverse order", async () => {
    const callOrder: string[] = [];
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockImplementation(
      async () => {
        callOrder.push("find");
        return buildNote({ deletedAt: new Date(Date.now() - 1000) });
      },
    );
    vi.mocked(noteRepository.restoreNote).mockImplementation(async () => {
      callOrder.push("restore");
      return buildNote({ deletedAt: null });
    });

    await noteService.restoreNote(USER_ID, NOTE_ID);

    expect(callOrder).toEqual(["find", "restore"]);
    expect(noteRepository.findTrashedNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
    expect(noteRepository.findTrashedNoteByIdForUser).toHaveBeenCalledTimes(1);
    expect(noteRepository.restoreNote).toHaveBeenCalledTimes(1);
  });

  it("[FRS-2.2.8] permanentDeleteNote SHALL call findTrashedNoteByIdForUser(id, userId) before permanentlyDeleteNote(id), never the reverse order", async () => {
    const callOrder: string[] = [];
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockImplementation(
      async () => {
        callOrder.push("find");
        return buildNote({ deletedAt: new Date(Date.now() - 1000) });
      },
    );
    vi.mocked(noteRepository.permanentlyDeleteNote).mockImplementation(
      async () => {
        callOrder.push("delete");
        return buildNote();
      },
    );

    await noteService.permanentDeleteNote(USER_ID, NOTE_ID);

    expect(callOrder).toEqual(["find", "delete"]);
    expect(noteRepository.findTrashedNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
    expect(noteRepository.permanentlyDeleteNote).toHaveBeenCalledWith(NOTE_ID);
  });

  it("[FRS-2.1.2] getNoteById SHALL call findActiveNoteByIdForUser(id, userId) scoped to the caller, and reject 404 NOTE_NOT_FOUND when it resolves null", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.getNoteById(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.findActiveNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
  });

  it("[Resolved Decision #2] updateNote SHALL call findActiveNoteByIdForUser before updateNoteContent, and SHALL NOT call updateNoteContent when the note is not found active", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.updateNote(USER_ID, NOTE_ID, { title: "New Title" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.updateNoteContent).not.toHaveBeenCalled();
  });

  it("[FRS-2.1.3] updateNote SHALL pass through only the provided title/body fields to updateNoteContent", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "New Title" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, { title: "New Title" });

    expect(noteRepository.updateNoteContent).toHaveBeenCalledWith(
      NOTE_ID,
      {
        title: "New Title",
        body: undefined,
      },
      expect.anything(),
    );
  });

  it("[FRS-2.2.1] softDeleteNote SHALL call findActiveNoteByIdForUser before softDeleteNote(id), and SHALL NOT soft-delete when not found active", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.softDeleteNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.softDeleteNote).not.toHaveBeenCalled();
  });
});

describe("[FRS-2.3.1] note.service.listNotes — pagination math (toPagination)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.listActiveNotesForUser).mockResolvedValue([]);
  });

  it("[FRS-2.3.1] SHALL compute totalPages as 0 (never NaN/Infinity) when total is 0", async () => {
    vi.mocked(noteRepository.countActiveNotesForUser).mockResolvedValue(0);

    const result = await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagMode: "ALL",
    });

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("[FRS-2.3.1] SHALL compute totalPages via exact division when total is an exact multiple of limit", async () => {
    vi.mocked(noteRepository.countActiveNotesForUser).mockResolvedValue(40);

    const result = await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagMode: "ALL",
    });

    expect(result.pagination.totalPages).toBe(2);
  });

  it("[FRS-2.3.1] SHALL round totalPages up (ceil) when total is one more than an exact multiple of limit", async () => {
    vi.mocked(noteRepository.countActiveNotesForUser).mockResolvedValue(41);

    const result = await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagMode: "ALL",
    });

    expect(result.pagination.totalPages).toBe(3);
  });

  it("[FRS-2.3.1] SHALL echo back the requested page/limit in the pagination envelope regardless of result-set size", async () => {
    vi.mocked(noteRepository.countActiveNotesForUser).mockResolvedValue(5);

    const result = await noteService.listNotes(USER_ID, {
      page: 3,
      limit: 7,
      sort: "updatedAt",
      order: "desc",
      tagMode: "ALL",
    });

    expect(result.pagination.page).toBe(3);
    expect(result.pagination.limit).toBe(7);
  });
});

describe("[FRS-2.3.3] note.service.listNotes — tagIds CSV-to-array parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.listActiveNotesForUser).mockResolvedValue([]);
    vi.mocked(noteRepository.countActiveNotesForUser).mockResolvedValue(0);
  });

  it("[FRS-2.3.3] SHALL split a comma-separated tagIds string into an array before calling the repository", async () => {
    const tagA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tagB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagIds: `${tagA},${tagB}`,
      tagMode: "ALL",
    });

    expect(noteRepository.listActiveNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: [tagA, tagB], tagMode: "ALL" }),
    );
    expect(noteRepository.countActiveNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: [tagA, tagB], tagMode: "ALL" }),
    );
  });

  it("[FRS-2.3.3] SHALL pass tagIds as undefined to the repository when the query omits it entirely", async () => {
    await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagMode: "ALL",
    });

    expect(noteRepository.listActiveNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: undefined }),
    );
  });

  it("[FRS-2.3.3] SHALL pass a single tagId as a one-element array (no split artifact) when tagIds has no comma", async () => {
    const tagA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagIds: tagA,
      tagMode: "ANY",
    });

    expect(noteRepository.listActiveNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: [tagA], tagMode: "ANY" }),
    );
  });
});

describe("[FRS-2.2.2, FRS-2.3.6] note.service.listTrash — stage1Cutoff arithmetic consistency with isWithinStage1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.listTrashedNotesForUser).mockResolvedValue([]);
    vi.mocked(noteRepository.countTrashedNotesForUser).mockResolvedValue(0);
  });

  it("[FRS-2.2.2, FRS-2.3.6] SHALL compute stage1Cutoff as now - APP_LIMITS.TRASH_STAGE_1_DAYS days, identical to the isWithinStage1 boundary formula", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2026-07-11T12:00:00.000Z");
    vi.setSystemTime(fixedNow);

    try {
      await noteService.listTrash(USER_ID, { page: 1, limit: 20 });
    } finally {
      vi.useRealTimers();
    }

    const expectedCutoff = new Date(
      fixedNow.getTime() - APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000,
    );

    expect(noteRepository.listTrashedNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ stage1Cutoff: expectedCutoff }),
    );
    expect(noteRepository.countTrashedNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ stage1Cutoff: expectedCutoff }),
    );
  });

  it("[FRS-2.2.2, FRS-2.3.6] SHALL pass the identical stage1Cutoff Date value to both the list and count repository calls in the same invocation", async () => {
    let listCutoff: Date | undefined;
    let countCutoff: Date | undefined;
    vi.mocked(noteRepository.listTrashedNotesForUser).mockImplementation(
      async (params) => {
        listCutoff = params.stage1Cutoff;
        return [];
      },
    );
    vi.mocked(noteRepository.countTrashedNotesForUser).mockImplementation(
      async (params) => {
        countCutoff = params.stage1Cutoff;
        return 0;
      },
    );

    await noteService.listTrash(USER_ID, { page: 1, limit: 20 });

    expect(listCutoff).toBeInstanceOf(Date);
    expect(listCutoff?.getTime()).toBe(countCutoff?.getTime());
  });

  it("[FRS-2.3.6] SHALL echo back requested page/limit in the trash pagination envelope", async () => {
    vi.mocked(noteRepository.countTrashedNotesForUser).mockResolvedValue(25);

    const result = await noteService.listTrash(USER_ID, {
      page: 2,
      limit: 10,
    });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });
});

describe("[FRS-7.2] note.service — Share Status Visible on the Note DTO (hasActiveShareLink mapping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-7.2] getNoteById SHALL map hasActiveShareLink: true when the resolved note's shareLinks array is non-empty", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ shareLinks: [{ id: "share-1" }] }),
    );

    const result = await noteService.getNoteById(USER_ID, NOTE_ID);

    expect(result.hasActiveShareLink).toBe(true);
  });

  it("[FRS-7.2] getNoteById SHALL map hasActiveShareLink: false when the resolved note's shareLinks array is empty", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ shareLinks: [] }),
    );

    const result = await noteService.getNoteById(USER_ID, NOTE_ID);

    expect(result.hasActiveShareLink).toBe(false);
  });

  it("[FRS-7.2] updateNote SHALL reflect hasActiveShareLink based on the updated note's shareLinks, not the pre-update existing lookup", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ shareLinks: [] }),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "New Title", shareLinks: [{ id: "share-2" }] }),
    );

    const result = await noteService.updateNote(USER_ID, NOTE_ID, {
      title: "New Title",
    });

    expect(result.hasActiveShareLink).toBe(true);
  });

  it("[FRS-7.2] updateNote SHALL map hasActiveShareLink: false when the updated note's shareLinks array is empty even though the pre-update note had one", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ shareLinks: [{ id: "share-3" }] }),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "New Title", shareLinks: [] }),
    );

    const result = await noteService.updateNote(USER_ID, NOTE_ID, {
      title: "New Title",
    });

    expect(result.hasActiveShareLink).toBe(false);
  });

  it("[FRS-7.2] listNotes SHALL map hasActiveShareLink independently per-note across a mixed list", async () => {
    vi.mocked(noteRepository.listActiveNotesForUser).mockResolvedValue([
      buildNote({ id: "note-a", shareLinks: [{ id: "share-a" }] }),
      buildNote({ id: "note-b", shareLinks: [] }),
    ]);
    vi.mocked(noteRepository.countActiveNotesForUser).mockResolvedValue(2);

    const result = await noteService.listNotes(USER_ID, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
      tagMode: "ALL",
    });

    expect(result.notes[0]?.hasActiveShareLink).toBe(true);
    expect(result.notes[1]?.hasActiveShareLink).toBe(false);
  });

  it("[FRS-7.2] listTrash SHALL map hasActiveShareLink independently per-note across a mixed list", async () => {
    vi.mocked(noteRepository.listTrashedNotesForUser).mockResolvedValue([
      buildNote({ id: "note-c", shareLinks: [] }),
      buildNote({ id: "note-d", shareLinks: [{ id: "share-d" }] }),
    ]);
    vi.mocked(noteRepository.countTrashedNotesForUser).mockResolvedValue(2);

    const result = await noteService.listTrash(USER_ID, {
      page: 1,
      limit: 20,
    });

    expect(result.notes[0]?.hasActiveShareLink).toBe(false);
    expect(result.notes[1]?.hasActiveShareLink).toBe(true);
  });

  it("[FRS-7.2, Resolved Decision #4] createNote SHALL always return hasActiveShareLink: false for a freshly created note without a repository round trip for share links", async () => {
    const createdNote = buildNote({
      title: "Brand New",
      body: "Body",
      shareLinks: [],
      noteTags: [],
    });
    vi.mocked(noteRepository.createNote).mockResolvedValue(createdNote);

    const result = await noteService.createNote(USER_ID, {
      title: "Brand New",
      body: "Body",
    });

    expect(noteRepository.createNote).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        title: "Brand New",
        body: "Body",
      },
      expect.anything(),
    );
    expect(result.hasActiveShareLink).toBe(false);
  });
});

describe("[Resolved Decision #3, FRS-2.2.4] note.service.softDeleteNote — transactional share-link revocation on trash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb) => cb({}));
  });

  it("[Resolved Decision #3] softDeleteNote SHALL call both noteRepository.softDeleteNote and shareRepository.revokeActiveShareLinksForNote inside the transaction", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ shareLinks: [{ id: "share-x" }] }),
    );
    vi.mocked(noteRepository.softDeleteNote).mockResolvedValue(
      buildNote({ deletedAt: new Date(), shareLinks: [] }),
    );
    vi.mocked(shareRepository.revokeActiveShareLinksForNote).mockResolvedValue({
      count: 1,
    });

    const result = await noteService.softDeleteNote(USER_ID, NOTE_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(noteRepository.softDeleteNote).toHaveBeenCalledWith(
      NOTE_ID,
      expect.anything(),
    );
    expect(shareRepository.revokeActiveShareLinksForNote).toHaveBeenCalledWith(
      NOTE_ID,
      expect.anything(),
    );
    expect(result.deletedAt).not.toBeNull();
  });

  it("[Resolved Decision #3] softDeleteNote SHALL still succeed and return the expected DTO when the note has no active share link to revoke", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ shareLinks: [] }),
    );
    vi.mocked(noteRepository.softDeleteNote).mockResolvedValue(
      buildNote({ deletedAt: new Date(), shareLinks: [] }),
    );
    vi.mocked(shareRepository.revokeActiveShareLinksForNote).mockResolvedValue({
      count: 0,
    });

    await expect(
      noteService.softDeleteNote(USER_ID, NOTE_ID),
    ).resolves.toMatchObject({ hasActiveShareLink: false });
    expect(shareRepository.revokeActiveShareLinksForNote).toHaveBeenCalledWith(
      NOTE_ID,
      expect.anything(),
    );
  });

  it("[FRS-2.2.1] softDeleteNote SHALL call findActiveNoteByIdForUser before entering the transaction, and SHALL NOT open a transaction when the note is not found active", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.softDeleteNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(noteRepository.softDeleteNote).not.toHaveBeenCalled();
    expect(
      shareRepository.revokeActiveShareLinksForNote,
    ).not.toHaveBeenCalled();
  });
});

describe("[FRS-6.1] note.service.updateNote — shouldSnapshot throttle-decision branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb) => cb({}));
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
  });

  it("[FRS-6.1] SHALL insert a new NoteVersion when isExplicitSave is true, bypassing the throttle window entirely without ever inspecting the latest snapshot's age", async () => {
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ body: "Explicit body" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, {
      body: "Explicit body",
      isExplicitSave: true,
    });

    expect(
      noteVersionRepository.findLatestVersionForNote,
    ).not.toHaveBeenCalled();
    expect(noteVersionRepository.createVersion).toHaveBeenCalledTimes(1);
    expect(noteVersionRepository.createVersion).toHaveBeenCalledWith(
      {
        noteId: NOTE_ID,
        titleSnapshot: "Fixture Title",
        bodySnapshot: "Explicit body",
      },
      expect.anything(),
    );
  });

  it("[FRS-6.1] SHALL skip creating a NoteVersion when isExplicitSave is false and only 2 minutes have elapsed since the latest snapshot", async () => {
    vi.mocked(noteVersionRepository.findLatestVersionForNote).mockResolvedValue(
      buildLatestVersion({ createdAt: new Date(Date.now() - 2 * 60 * 1000) }),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ body: "Autosave body" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, {
      body: "Autosave body",
      isExplicitSave: false,
    });

    expect(noteVersionRepository.createVersion).not.toHaveBeenCalled();
  });

  it("[FRS-6.1] SHALL skip creating a NoteVersion at exactly APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES minutes minus 1 second since the latest snapshot", async () => {
    const throttleMs = APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES * 60 * 1000;
    vi.mocked(noteVersionRepository.findLatestVersionForNote).mockResolvedValue(
      buildLatestVersion({
        createdAt: new Date(Date.now() - (throttleMs - 1000)),
      }),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(buildNote());

    await noteService.updateNote(USER_ID, NOTE_ID, {
      title: "Boundary minus",
    });

    expect(noteVersionRepository.createVersion).not.toHaveBeenCalled();
  });

  it("[FRS-6.1] SHALL create a new NoteVersion at exactly APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES minutes plus 1 second since the latest snapshot", async () => {
    const throttleMs = APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES * 60 * 1000;
    vi.mocked(noteVersionRepository.findLatestVersionForNote).mockResolvedValue(
      buildLatestVersion({
        createdAt: new Date(Date.now() - (throttleMs + 1000)),
      }),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "Boundary plus" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, {
      title: "Boundary plus",
    });

    expect(noteVersionRepository.createVersion).toHaveBeenCalledTimes(1);
    expect(noteVersionRepository.createVersion).toHaveBeenCalledWith(
      {
        noteId: NOTE_ID,
        titleSnapshot: "Boundary plus",
        bodySnapshot: "Fixture Body",
      },
      expect.anything(),
    );
  });

  it("[FRS-6.1] SHALL default isExplicitSave to false and follow the autosave throttle lookup path when the field is omitted from the update input entirely", async () => {
    vi.mocked(noteVersionRepository.findLatestVersionForNote).mockResolvedValue(
      buildLatestVersion({ createdAt: new Date(Date.now() - 2 * 60 * 1000) }),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "Omitted flag" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, { title: "Omitted flag" });

    expect(
      noteVersionRepository.findLatestVersionForNote,
    ).toHaveBeenCalledTimes(1);
    expect(noteVersionRepository.createVersion).not.toHaveBeenCalled();
  });

  it("[FRS-6.1] SHALL always create a NoteVersion when no prior version exists for the note, regardless of isExplicitSave", async () => {
    vi.mocked(noteVersionRepository.findLatestVersionForNote).mockResolvedValue(
      null,
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "First ever snapshot" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, {
      title: "First ever snapshot",
    });

    expect(noteVersionRepository.createVersion).toHaveBeenCalledTimes(1);
  });
});

describe("[FRS-3.1, FRS-3.4, SDS §4.1] note.service — verifyTagOwnership guard on createNote/updateNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb) => cb({}));
  });

  it("[FRS-3.1] createNote SHALL NOT call findTagsByIdsForUser at all when input.tagIds is omitted, and SHALL still create the note", async () => {
    vi.mocked(noteRepository.createNote).mockResolvedValue(
      buildNote({ title: "No Tags Note" }),
    );

    await noteService.createNote(USER_ID, {
      title: "No Tags Note",
      body: "Body",
    });

    expect(tagRepository.findTagsByIdsForUser).not.toHaveBeenCalled();
    expect(noteRepository.createNote).toHaveBeenCalledTimes(1);
  });

  it("[FRS-3.1] createNote SHALL call findTagsByIdsForUser(tagIds, userId) and proceed to create the note when every supplied tagId resolves to a tag owned by the caller", async () => {
    vi.mocked(tagRepository.findTagsByIdsForUser).mockResolvedValue([
      { id: TAG_A_ID } as never,
      { id: TAG_B_ID } as never,
    ]);
    vi.mocked(noteRepository.createNote).mockResolvedValue(
      buildNote({ title: "Tagged Note" }),
    );

    await noteService.createNote(USER_ID, {
      title: "Tagged Note",
      body: "Body",
      tagIds: [TAG_A_ID, TAG_B_ID],
    });

    expect(tagRepository.findTagsByIdsForUser).toHaveBeenCalledWith(
      [TAG_A_ID, TAG_B_ID],
      USER_ID,
      expect.anything(),
    );
    expect(noteRepository.createNote).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        title: "Tagged Note",
        body: "Body",
        tagIds: [TAG_A_ID, TAG_B_ID],
      },
      expect.anything(),
    );
  });

  it("[FRS-3.4] createNote SHALL reject with 403 TAG_NOT_FOUND and SHALL NOT call repository createNote when findTagsByIdsForUser resolves fewer tags than requested (unauthorized or non-existent tagId)", async () => {
    vi.mocked(tagRepository.findTagsByIdsForUser).mockResolvedValue([
      { id: TAG_A_ID } as never,
    ]);

    await expect(
      noteService.createNote(USER_ID, {
        title: "Rejected Note",
        body: "Body",
        tagIds: [TAG_A_ID, TAG_B_ID],
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: API_ERROR_CODES.TAG_NOT_FOUND,
      message: VALIDATION_MESSAGES.NOTE_TAG_ATTACH_FORBIDDEN,
    });
    expect(noteRepository.createNote).not.toHaveBeenCalled();
  });

  it("[SDS §4.1] createNote SHALL call findTagsByIdsForUser strictly before noteRepository.createNote, never the reverse order", async () => {
    const callOrder: string[] = [];
    vi.mocked(tagRepository.findTagsByIdsForUser).mockImplementation(
      async () => {
        callOrder.push("verifyTagOwnership");
        return [{ id: TAG_A_ID } as never];
      },
    );
    vi.mocked(noteRepository.createNote).mockImplementation(async () => {
      callOrder.push("createNote");
      return buildNote();
    });

    await noteService.createNote(USER_ID, {
      title: "Order Note",
      body: "Body",
      tagIds: [TAG_A_ID],
    });

    expect(callOrder).toEqual(["verifyTagOwnership", "createNote"]);
  });

  it("[FRS-3.1] updateNote SHALL NOT call findTagsByIdsForUser when input.tagIds is omitted from a title/body-only update", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "Renamed" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, { title: "Renamed" });

    expect(tagRepository.findTagsByIdsForUser).not.toHaveBeenCalled();
  });

  it("[FRS-3.4] updateNote SHALL reject with 403 TAG_NOT_FOUND and SHALL NOT call updateNoteContent (no partial title/body persistence) when a supplied tagId does not belong to the caller", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
    vi.mocked(tagRepository.findTagsByIdsForUser).mockResolvedValue([]);

    await expect(
      noteService.updateNote(USER_ID, NOTE_ID, {
        title: "Should not persist",
        tagIds: [TAG_A_ID],
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: API_ERROR_CODES.TAG_NOT_FOUND,
    });
    expect(noteRepository.updateNoteContent).not.toHaveBeenCalled();
  });

  it("[SDS §4.1] updateNote SHALL call findTagsByIdsForUser strictly before noteRepository.updateNoteContent, never the reverse order", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
    const callOrder: string[] = [];
    vi.mocked(tagRepository.findTagsByIdsForUser).mockImplementation(
      async () => {
        callOrder.push("verifyTagOwnership");
        return [{ id: TAG_A_ID } as never, { id: TAG_B_ID } as never];
      },
    );
    vi.mocked(noteRepository.updateNoteContent).mockImplementation(async () => {
      callOrder.push("updateNoteContent");
      return buildNote();
    });

    await noteService.updateNote(USER_ID, NOTE_ID, {
      tagIds: [TAG_A_ID, TAG_B_ID],
    });

    expect(callOrder).toEqual(["verifyTagOwnership", "updateNoteContent"]);
  });

  it("[FRS-3.1] updateNote SHALL accept a tagIds-only payload (title and body both undefined) and forward tagIds to updateNoteContent unchanged", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
    vi.mocked(tagRepository.findTagsByIdsForUser).mockResolvedValue([
      { id: TAG_A_ID } as never,
    ]);
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({
        noteTags: [{ tag: { id: TAG_A_ID, name: "Work", color: "#6B7280" } }],
      }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, { tagIds: [TAG_A_ID] });

    expect(noteRepository.updateNoteContent).toHaveBeenCalledWith(
      NOTE_ID,
      { title: undefined, body: undefined, tagIds: [TAG_A_ID] },
      expect.anything(),
    );
  });
});

describe("[FRS-3.1] note.service.toNoteResponseDto — tags mapping from joined noteTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-3.1] getNoteById SHALL map each joined noteTags row's nested tag to a flat { id, name, color } entry on the DTO's tags array", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({
        noteTags: [
          { tag: { id: TAG_A_ID, name: "Work", color: "#3B82F6" } },
          { tag: { id: TAG_B_ID, name: "Ideas", color: "#EF4444" } },
        ],
      }),
    );

    const result = await noteService.getNoteById(USER_ID, NOTE_ID);

    expect(result.tags).toEqual([
      { id: TAG_A_ID, name: "Work", color: "#3B82F6" },
      { id: TAG_B_ID, name: "Ideas", color: "#EF4444" },
    ]);
  });

  it("[FRS-3.1] getNoteById SHALL map to an empty tags array when the note has no NoteTag join rows", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote({ noteTags: [] }),
    );

    const result = await noteService.getNoteById(USER_ID, NOTE_ID);

    expect(result.tags).toEqual([]);
  });
});
