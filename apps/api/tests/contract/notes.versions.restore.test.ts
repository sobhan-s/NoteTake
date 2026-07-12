import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, API_PATHS } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  daysAgo,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const versionsRoute = (noteId: string): string =>
  `${ROUTES.noteById(noteId)}${API_PATHS.NOTES.VERSIONS}`;
const versionRoute = (noteId: string, versionId: string): string =>
  `${versionsRoute(noteId)}/${versionId}`;
const restoreVersionRoute = (noteId: string, versionId: string): string =>
  `${versionRoute(noteId, versionId)}${API_PATHS.NOTES.RESTORE}`;

describe("[FRS-6.4] POST /api/v1/notes/:id/versions/:versionId/restore", () => {
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

  it("[FRS-6.4] SHALL overwrite the live Note with the restored snapshot's title/body, append a new top-of-history NoteVersion, and leave all prior versions (including the one just restored) untouched and independently queryable", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-normal@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Current Title",
      body: "Current Body",
    });
    const v1 = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "V1 Title",
        bodySnapshot: "V1 Body",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const v2 = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "V2 Title",
        bodySnapshot: "V2 Body",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const v3 = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Current Title",
        bodySnapshot: "Current Body",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });

    const res = await request(app)
      .post(restoreVersionRoute(note.id, v1.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("V1 Title");
    expect(res.body.data.body).toBe("V1 Body");

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.title).toBe("V1 Title");
    expect(row?.body).toBe("V1 Body");

    const versions = await prisma.noteVersion.findMany({
      where: { noteId: note.id },
      orderBy: { createdAt: "desc" },
    });
    expect(versions).toHaveLength(4);
    expect(versions[0]?.titleSnapshot).toBe("V1 Title");
    expect(versions[0]?.bodySnapshot).toBe("V1 Body");
    expect(versions[0]?.id).not.toBe(v1.id);
    const priorIds = versions
      .slice(1)
      .map((v) => v.id)
      .sort();
    expect(priorIds).toEqual([v1.id, v2.id, v3.id].sort());
  });

  it("[FRS-6.4, FRS-6.1] SHALL append a new version even when the note's most recent snapshot was created only 10 seconds ago — restore bypasses the autosave throttle unconditionally", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-throttle-bypass@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Latest Title",
      body: "Latest Body",
    });
    const older = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Older Title",
        bodySnapshot: "Older Body",
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Latest Title",
        bodySnapshot: "Latest Body",
        createdAt: new Date(Date.now() - 10_000),
      },
    });

    const res = await request(app)
      .post(restoreVersionRoute(note.id, older.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const versionCount = await prisma.noteVersion.count({
      where: { noteId: note.id },
    });
    expect(versionCount).toBe(3);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND and modify nothing when restoring on a note that has since been soft-deleted", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-trashed@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Trashed Title",
      body: "Trashed Body",
      deletedAt: daysAgo(1),
    });
    const version = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Old Snapshot",
        bodySnapshot: "Old Body",
      },
    });

    const res = await request(app)
      .post(restoreVersionRoute(note.id, version.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.title).toBe("Trashed Title");
    expect(row?.body).toBe("Trashed Body");
    const versionCount = await prisma.noteVersion.count({
      where: { noteId: note.id },
    });
    expect(versionCount).toBe(1);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND (never 403) and modify nothing when the note belongs to a different user", async () => {
    const owner = await createAuthedUser("restore-owner@example.com");
    const attacker = await createAuthedUser("restore-attacker@example.com");
    const note = await createNoteDirect(owner.userId, {
      title: "Owner Title",
      body: "Owner Body",
    });
    const version = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Owner Title",
        bodySnapshot: "Owner Body",
      },
    });

    const res = await request(app)
      .post(restoreVersionRoute(note.id, version.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.title).toBe("Owner Title");
    const versionCount = await prisma.noteVersion.count({
      where: { noteId: note.id },
    });
    expect(versionCount).toBe(1);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 VERSION_NOT_FOUND and modify nothing when the versionId belongs to a different note", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-cross-note@example.com",
    );
    const noteA = await createNoteDirect(userId, {
      title: "Note A Title",
      body: "Note A Body",
    });
    const noteB = await createNoteDirect(userId, {
      title: "Note B Title",
      body: "Note B Body",
    });
    const versionOfB = await prisma.noteVersion.create({
      data: {
        noteId: noteB.id,
        titleSnapshot: "B Snapshot",
        bodySnapshot: "B Body",
      },
    });

    const res = await request(app)
      .post(restoreVersionRoute(noteA.id, versionOfB.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VERSION_NOT_FOUND);
    const row = await prisma.note.findUnique({ where: { id: noteA.id } });
    expect(row?.title).toBe("Note A Title");
    expect(row?.body).toBe("Note A Body");
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("restore-noauth@example.com");
    const note = await createNoteDirect(userId);
    const version = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Snapshot Title",
        bodySnapshot: "Snapshot Body",
      },
    });

    const res = await request(app).post(
      restoreVersionRoute(note.id, version.id),
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
