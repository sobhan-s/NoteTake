import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { APP_LIMITS } from "@shared/core/constants";
import { purgeOldVersions } from "../../src/repositories/note-version.repository.js";
import {
  createAuthedUser,
  createNoteDirect,
  daysAgo,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

/** Directly seeds a `NoteVersion` row at an explicit `createdAt` (bypassing the
 * service layer entirely) so `purgeOldVersions` fixtures can be placed precisely
 * around the `APP_LIMITS.VERSION_RETENTION_DAYS` boundary. */
async function createVersionDirect(
  noteId: string,
  createdAt: Date,
  overrides: { titleSnapshot?: string; bodySnapshot?: string } = {},
): Promise<{ id: string; createdAt: Date }> {
  return prisma.noteVersion.create({
    data: {
      noteId,
      titleSnapshot: overrides.titleSnapshot ?? "Snapshot Title",
      bodySnapshot: overrides.bodySnapshot ?? "Snapshot Body",
      createdAt,
    },
  });
}

function retentionCutoff(): Date {
  return daysAgo(APP_LIMITS.VERSION_RETENTION_DAYS);
}

describe("[FRS-6.5] note-version.repository.purgeOldVersions — 90-day retention purge, exempting each note's latest row", () => {
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

  it("[FRS-6.5] SHALL delete the 4 oldest of 5 versions all older than 90 days, retaining exactly the single newest row (DISTINCT ON note_id)", async () => {
    const { userId } = await createAuthedUser(
      "purge-versions-basic@example.com",
    );
    const note = await createNoteDirect(userId);

    await createVersionDirect(note.id, daysAgo(100));
    await createVersionDirect(note.id, daysAgo(95));
    await createVersionDirect(note.id, daysAgo(93));
    await createVersionDirect(note.id, daysAgo(91));
    const newest = await createVersionDirect(
      note.id,
      daysAgo(90, 60 * 60 * 1000),
    );

    const deletedCount = await purgeOldVersions(retentionCutoff());

    expect(deletedCount).toBe(4);
    const remaining = await prisma.noteVersion.findMany({
      where: { noteId: note.id },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(newest.id);
  });

  it("[FRS-6.5, FRS-8a.4] SHALL delete zero rows on a second consecutive run with no new versions created in between (idempotent)", async () => {
    const { userId } = await createAuthedUser(
      "purge-versions-idempotent@example.com",
    );
    const note = await createNoteDirect(userId);
    await createVersionDirect(note.id, daysAgo(100));
    await createVersionDirect(note.id, daysAgo(95));
    const latest = await createVersionDirect(note.id, daysAgo(91));

    const cutoff = retentionCutoff();
    const firstPassDeleted = await purgeOldVersions(cutoff);
    const secondPassDeleted = await purgeOldVersions(cutoff);

    expect(firstPassDeleted).toBeGreaterThan(0);
    expect(secondPassDeleted).toBe(0);
    const remaining = await prisma.noteVersion.findMany({
      where: { noteId: note.id },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(latest.id);
  });

  it("[FRS-6.5] SHALL never purge a note's sole version even though it is 200 days old — the exempt-the-latest rule, not an absolute age cutoff, decides what's safe to keep", async () => {
    const { userId } = await createAuthedUser(
      "purge-versions-sole-old@example.com",
    );
    const note = await createNoteDirect(userId);
    const onlyVersion = await createVersionDirect(note.id, daysAgo(200));

    const deletedCount = await purgeOldVersions(retentionCutoff());

    expect(deletedCount).toBe(0);
    const row = await prisma.noteVersion.findUnique({
      where: { id: onlyVersion.id },
    });
    expect(row).not.toBeNull();
  });

  it("[FRS-6.5] SHALL NOT purge versions that are within the retention window, even alongside an older sibling", async () => {
    const { userId } = await createAuthedUser(
      "purge-versions-mixed-fresh@example.com",
    );
    const note = await createNoteDirect(userId);
    const stale = await createVersionDirect(note.id, daysAgo(100));
    const fresh = await createVersionDirect(note.id, daysAgo(1));

    const deletedCount = await purgeOldVersions(retentionCutoff());

    expect(deletedCount).toBe(1);
    const staleRow = await prisma.noteVersion.findUnique({
      where: { id: stale.id },
    });
    const freshRow = await prisma.noteVersion.findUnique({
      where: { id: fresh.id },
    });
    expect(staleRow).toBeNull();
    expect(freshRow).not.toBeNull();
  });
});
