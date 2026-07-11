import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { runNotesPurgePass } from "../../src/jobs/cleanup.job.js";
import {
  createAuthedUser,
  createNoteDirect,
  daysAgo,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

describe("[FRS-2.2.6, FRS-2.2.7, FRS-8a] cleanup.job — runNotesPurgePass (Stage-2 permanent purge)", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
      throw new Error(
        "FATAL SAFETY BREAK: Truncation attempted outside notes_app_test instance!",
      );
    }
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("[FRS-2.2.6] SHALL NOT purge a note trashed exactly `now - (60 days - 1 second)` (1 second inside the Stage-2 window)", async () => {
    const { userId } = await createAuthedUser("purge-inside@example.com");
    const survivor = await createNoteDirect(userId, {
      deletedAt: new Date(Date.now() - (SIXTY_DAYS_MS - 1000)),
    });

    await runNotesPurgePass();

    const row = await prisma.note.findUnique({ where: { id: survivor.id } });
    expect(row).not.toBeNull();
  });

  it("[FRS-2.2.7] SHALL permanently delete a note trashed exactly `now - (60 days + 1 second)` (1 second past the Stage-2 window)", async () => {
    const { userId } = await createAuthedUser("purge-outside@example.com");
    const purgeable = await createNoteDirect(userId, {
      deletedAt: new Date(Date.now() - (SIXTY_DAYS_MS + 1000)),
    });

    await runNotesPurgePass();

    const row = await prisma.note.findUnique({ where: { id: purgeable.id } });
    expect(row).toBeNull();
  });

  it("[FRS-8a.2] SHALL cascade-delete related NoteTag, NoteVersion, and ShareLink rows (onDelete: Cascade) when the parent note is purged", async () => {
    const { userId } = await createAuthedUser("purge-cascade@example.com");
    const purgeable = await createNoteDirect(userId, {
      deletedAt: daysAgo(70),
    });

    const tag = await prisma.tag.create({
      data: { userId, name: "cascade-tag" },
    });
    await prisma.noteTag.create({
      data: { noteId: purgeable.id, tagId: tag.id },
    });
    await prisma.noteVersion.create({
      data: {
        noteId: purgeable.id,
        titleSnapshot: "Snapshot Title",
        bodySnapshot: "Snapshot Body",
      },
    });
    await prisma.shareLink.create({
      data: {
        noteId: purgeable.id,
        token: "cascade-test-token-0123456789abcdef",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await runNotesPurgePass();

    const noteRow = await prisma.note.findUnique({
      where: { id: purgeable.id },
    });
    expect(noteRow).toBeNull();
    const noteTagCount = await prisma.noteTag.count({
      where: { noteId: purgeable.id },
    });
    const noteVersionCount = await prisma.noteVersion.count({
      where: { noteId: purgeable.id },
    });
    const shareLinkCount = await prisma.shareLink.count({
      where: { noteId: purgeable.id },
    });
    expect(noteTagCount).toBe(0);
    expect(noteVersionCount).toBe(0);
    expect(shareLinkCount).toBe(0);
    // The Tag row itself belongs to the user, not the note, and is not cascaded.
    const tagRow = await prisma.tag.findUnique({ where: { id: tag.id } });
    expect(tagRow).not.toBeNull();
  });

  it("[FRS-8a.4] SHALL be safe to invoke twice back-to-back with no error and no double-processing", async () => {
    const { userId } = await createAuthedUser("purge-idempotent@example.com");
    const survivor = await createNoteDirect(userId, {
      deletedAt: daysAgo(1),
    });
    const purgeable = await createNoteDirect(userId, {
      deletedAt: daysAgo(70),
    });

    await expect(runNotesPurgePass()).resolves.toBeUndefined();
    await expect(runNotesPurgePass()).resolves.toBeUndefined();

    const survivorRow = await prisma.note.findUnique({
      where: { id: survivor.id },
    });
    const purgeableRow = await prisma.note.findUnique({
      where: { id: purgeable.id },
    });
    expect(survivorRow).not.toBeNull();
    expect(purgeableRow).toBeNull();
  });
});
