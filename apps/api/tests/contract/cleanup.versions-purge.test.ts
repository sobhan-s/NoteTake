import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { APP_LIMITS } from "@shared/core/constants";
import {
  runNotesPurgePass,
  runVersionsPurgePass,
} from "../../src/jobs/cleanup.job.js";
import {
  createAuthedUser,
  createNoteDirect,
  daysAgo,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-6.5, FRS-8a] cleanup.job — runVersionsPurgePass (90-day version-retention purge)", () => {
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

  it("[FRS-6.5] SHALL delete versions older than APP_LIMITS.VERSION_RETENTION_DAYS while exempting each note's single latest version, even though that latest version is also past the threshold", async () => {
    const { userId } = await createAuthedUser(
      "versions-purge-basic@example.com",
    );
    const note = await createNoteDirect(userId);
    const cutoffDays = APP_LIMITS.VERSION_RETENTION_DAYS;
    const stale1 = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "s1",
        bodySnapshot: "b1",
        createdAt: daysAgo(cutoffDays + 10),
      },
    });
    const stale2 = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "s2",
        bodySnapshot: "b2",
        createdAt: daysAgo(cutoffDays + 5),
      },
    });
    const latestStillOld = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "s3",
        bodySnapshot: "b3",
        createdAt: daysAgo(cutoffDays + 1),
      },
    });

    await runVersionsPurgePass();

    const remaining = await prisma.noteVersion.findMany({
      where: { noteId: note.id },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(latestStillOld.id);
    const deletedRows = await prisma.noteVersion.findMany({
      where: { id: { in: [stale1.id, stale2.id] } },
    });
    expect(deletedRows).toHaveLength(0);
  });

  it("[FRS-6.5] SHALL NOT purge a note's versions when all of them are within the retention window", async () => {
    const { userId } = await createAuthedUser(
      "versions-purge-fresh@example.com",
    );
    const note = await createNoteDirect(userId);
    await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "fresh1",
        bodySnapshot: "b1",
        createdAt: daysAgo(2),
      },
    });
    await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "fresh2",
        bodySnapshot: "b2",
        createdAt: daysAgo(1),
      },
    });

    await runVersionsPurgePass();

    const count = await prisma.noteVersion.count({
      where: { noteId: note.id },
    });
    expect(count).toBe(2);
  });

  it("[FRS-8a.3] SHALL purge stale versions and stale Stage-2 notes independently in the same cron tick, neither pass blocking the other", async () => {
    const { userId } = await createAuthedUser(
      "versions-purge-independent@example.com",
    );
    const stage2Note = await createNoteDirect(userId, {
      deletedAt: daysAgo(70),
    });
    const activeNote = await createNoteDirect(userId);
    const staleVersion = await prisma.noteVersion.create({
      data: {
        noteId: activeNote.id,
        titleSnapshot: "old",
        bodySnapshot: "old body",
        createdAt: daysAgo(APP_LIMITS.VERSION_RETENTION_DAYS + 5),
      },
    });
    const freshLatest = await prisma.noteVersion.create({
      data: {
        noteId: activeNote.id,
        titleSnapshot: "new",
        bodySnapshot: "new body",
        createdAt: daysAgo(1),
      },
    });

    await Promise.all([runNotesPurgePass(), runVersionsPurgePass()]);

    const noteRow = await prisma.note.findUnique({
      where: { id: stage2Note.id },
    });
    expect(noteRow).toBeNull();

    const versions = await prisma.noteVersion.findMany({
      where: { noteId: activeNote.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.id).toBe(freshLatest.id);
    const staleRow = await prisma.noteVersion.findUnique({
      where: { id: staleVersion.id },
    });
    expect(staleRow).toBeNull();
  });

  it("[FRS-8a.4] SHALL be safe to invoke twice back-to-back with no error and no double-processing", async () => {
    const { userId } = await createAuthedUser(
      "versions-purge-idempotent@example.com",
    );
    const note = await createNoteDirect(userId);
    const latest = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "only",
        bodySnapshot: "only body",
        createdAt: daysAgo(APP_LIMITS.VERSION_RETENTION_DAYS + 20),
      },
    });

    await expect(runVersionsPurgePass()).resolves.toBeUndefined();
    await expect(runVersionsPurgePass()).resolves.toBeUndefined();

    const row = await prisma.noteVersion.findUnique({
      where: { id: latest.id },
    });
    expect(row).not.toBeNull();
  });
});
