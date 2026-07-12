import { describe, it, expect, vi } from "vitest";
import {
  findActiveNoteByIdForUser,
  findTrashedNoteByIdForUser,
  updateNoteContent,
  softDeleteNote,
  restoreNote,
  listActiveNotesForUser,
  listTrashedNotesForUser,
} from "../../src/repositories/note.repository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";

type FakeDb = {
  note: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function fakeDb(returnValue: unknown = null): FakeDb {
  return {
    note: {
      findFirst: vi.fn().mockResolvedValue(returnValue),
      findMany: vi.fn().mockResolvedValue(returnValue),
      update: vi.fn().mockResolvedValue(returnValue),
    },
  };
}

/** Asserts the exact ACTIVE_SHARE_LINK_INCLUDE shape, tolerating the `gt` Date
 * being constructed at call time (within a generous 2s window of now). */
function expectActiveShareLinkInclude(include: unknown): void {
  const shareLinks = (include as { shareLinks?: Record<string, unknown> })
    ?.shareLinks;
  expect(shareLinks).toBeDefined();

  const where = shareLinks!.where as {
    revokedAt: unknown;
    expiresAt: { gt: Date };
  };
  expect(where.revokedAt).toBeNull();
  expect(where.expiresAt.gt).toBeInstanceOf(Date);
  expect(Math.abs(where.expiresAt.gt.getTime() - Date.now())).toBeLessThan(
    2000,
  );

  expect(shareLinks!.select).toEqual({ id: true });
  expect(shareLinks!.take).toBe(1);
}

describe("[FRS-7.2] note.repository — ACTIVE_SHARE_LINK_INCLUDE applied to findFirst-based single-row reads", () => {
  it("[FRS-7.2] findActiveNoteByIdForUser SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row", async () => {
    const db = fakeDb({ id: NOTE_ID, shareLinks: [] });

    await findActiveNoteByIdForUser(NOTE_ID, USER_ID, db);

    expect(db.note.findFirst).toHaveBeenCalledTimes(1);
    const callArgs = db.note.findFirst.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);
  });

  it("[FRS-7.2] findTrashedNoteByIdForUser SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row", async () => {
    const db = fakeDb({ id: NOTE_ID, shareLinks: [] });

    await findTrashedNoteByIdForUser(NOTE_ID, USER_ID, db);

    expect(db.note.findFirst).toHaveBeenCalledTimes(1);
    const callArgs = db.note.findFirst.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);
  });

  it("[FRS-7.2] findActiveNoteByIdForUser SHALL return the resolved fixture unmodified, preserving a non-empty shareLinks array as-is (pass-through, not re-filtering)", async () => {
    const fixture = {
      id: NOTE_ID,
      shareLinks: [{ id: "link-1" }],
    };
    const db = fakeDb(fixture);

    const result = await findActiveNoteByIdForUser(NOTE_ID, USER_ID, db);

    expect(result).toBe(fixture);
    expect(result?.shareLinks).toEqual([{ id: "link-1" }]);
  });
});

describe("[FRS-7.2] note.repository — ACTIVE_SHARE_LINK_INCLUDE applied to update-based mutations", () => {
  it("[FRS-7.2] updateNoteContent SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row", async () => {
    const db = fakeDb({ id: NOTE_ID, shareLinks: [] });

    await updateNoteContent(NOTE_ID, { title: "New Title" }, db);

    expect(db.note.update).toHaveBeenCalledTimes(1);
    const callArgs = db.note.update.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);
  });

  it("[FRS-7.2] softDeleteNote SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row", async () => {
    const db = fakeDb({ id: NOTE_ID, shareLinks: [] });

    await softDeleteNote(NOTE_ID, db);

    expect(db.note.update).toHaveBeenCalledTimes(1);
    const callArgs = db.note.update.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);
  });

  it("[FRS-7.2] restoreNote SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row", async () => {
    const db = fakeDb({ id: NOTE_ID, shareLinks: [] });

    await restoreNote(NOTE_ID, db);

    expect(db.note.update).toHaveBeenCalledTimes(1);
    const callArgs = db.note.update.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);
  });
});

describe("[FRS-7.2] note.repository — ACTIVE_SHARE_LINK_INCLUDE applied to findMany-based list reads", () => {
  it("[FRS-7.2] listActiveNotesForUser SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row, alongside the existing where/skip/take args", async () => {
    const db = fakeDb([{ id: NOTE_ID, shareLinks: [] }]);

    await listActiveNotesForUser(
      {
        userId: USER_ID,
        page: 1,
        limit: 20,
        sort: "createdAt",
        order: "desc",
        tagMode: "ALL",
      },
      db,
    );

    expect(db.note.findMany).toHaveBeenCalledTimes(1);
    const callArgs = db.note.findMany.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);

    expect(callArgs.where).toMatchObject({ userId: USER_ID, deletedAt: null });
    expect(callArgs.skip).toBe(0);
    expect(callArgs.take).toBe(20);
  });

  it("[FRS-7.2] listTrashedNotesForUser SHALL include shareLinks filtered to revokedAt: null and expiresAt: { gt: now }, selecting only id, limited to 1 row, alongside the existing where/skip/take args", async () => {
    const db = fakeDb([{ id: NOTE_ID, shareLinks: [] }]);
    const stage1Cutoff = new Date("2026-06-12T00:00:00.000Z");

    await listTrashedNotesForUser(
      { userId: USER_ID, page: 2, limit: 10, stage1Cutoff },
      db,
    );

    expect(db.note.findMany).toHaveBeenCalledTimes(1);
    const callArgs = db.note.findMany.mock.calls[0][0];
    expectActiveShareLinkInclude(callArgs.include);

    expect(callArgs.where).toMatchObject({
      userId: USER_ID,
      deletedAt: { not: null, gte: stage1Cutoff },
    });
    expect(callArgs.skip).toBe(10);
    expect(callArgs.take).toBe(10);
  });
});

describe("[FRS-7.2] note.repository — ACTIVE_SHARE_LINK_INCLUDE filtering intent is consistently wired across every call site", () => {
  it("[FRS-7.2] every one of the 7 share-link-aware repository functions SHALL pass an identical { revokedAt: null, expiresAt: { gt: <Date> } } filter shape (excludes revoked and expired links from the returned array)", async () => {
    const db = fakeDb({ id: NOTE_ID, shareLinks: [] });
    const listDb = fakeDb([{ id: NOTE_ID, shareLinks: [] }]);

    await findActiveNoteByIdForUser(NOTE_ID, USER_ID, db);
    await findTrashedNoteByIdForUser(NOTE_ID, USER_ID, db);
    await updateNoteContent(NOTE_ID, { title: "T" }, db);
    await softDeleteNote(NOTE_ID, db);
    await restoreNote(NOTE_ID, db);
    await listActiveNotesForUser(
      {
        userId: USER_ID,
        page: 1,
        limit: 20,
        sort: "createdAt",
        order: "desc",
        tagMode: "ALL",
      },
      listDb,
    );
    await listTrashedNotesForUser(
      { userId: USER_ID, page: 1, limit: 20, stage1Cutoff: new Date() },
      listDb,
    );

    const findFirstIncludes = db.note.findFirst.mock.calls.map(
      (call) => call[0].include,
    );
    const updateIncludes = db.note.update.mock.calls.map(
      (call) => call[0].include,
    );
    const findManyIncludes = listDb.note.findMany.mock.calls.map(
      (call) => call[0].include,
    );

    const allIncludes = [
      ...findFirstIncludes,
      ...updateIncludes,
      ...findManyIncludes,
    ];

    expect(allIncludes).toHaveLength(7);
    for (const include of allIncludes) {
      expectActiveShareLinkInclude(include);
    }
  });
});
