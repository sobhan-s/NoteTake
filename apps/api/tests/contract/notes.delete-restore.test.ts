import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  daysAgo,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.2.1] DELETE /api/v1/notes/:id (soft delete)", () => {
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

  it("[FRS-2.2.1] SHALL set `deletedAt` (not perform a physical delete) and return 200, with the row still directly queryable in the database", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "soft-delete@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .delete(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deletedAt).not.toBeNull();

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("[FRS-2.2.3, Resolved Decision #2] SHALL make the note return 404 NOTE_NOT_FOUND via GET immediately after the soft delete", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "soft-delete-invisible@example.com",
    );
    const note = await createNoteDirect(userId);

    const deleteRes = await request(app)
      .delete(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) when soft-deleting another user's note, and SHALL NOT modify it", async () => {
    const owner = await createAuthedUser("delete-owner-b@example.com");
    const attacker = await createAuthedUser("delete-attacker-b@example.com");
    const note = await createNoteDirect(owner.userId);

    const res = await request(app)
      .delete(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.deletedAt).toBeNull();
  });
});

describe("[FRS-2.2.2, FRS-2.2.5] POST /api/v1/notes/:id/restore", () => {
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

  it("[FRS-2.2.2] SHALL restore (clear `deletedAt`) and return 200 for a note trashed 1 day ago (well within the 30-day Stage-1 window)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-1day@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .post(ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).toBeNull();

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("[FRS-2.2.2] SHALL restore and return 200 for a note trashed exactly 29 days, 23 hours, 59 minutes ago (1 minute inside the 30-day boundary)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-boundary-inside@example.com",
    );
    const trashedAt = new Date(
      Date.now() - (30 * 24 * 60 * 60 * 1000 - 60 * 1000),
    );
    const note = await createNoteDirect(userId, { deletedAt: trashedAt });

    const res = await request(app)
      .post(ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).toBeNull();
  });

  it("[FRS-2.2.5, FRS-2.2.6] SHALL return 404 NOTE_NOT_FOUND for a note trashed exactly 30 days and 1 minute ago (1 minute outside the 30-day boundary, Stage 2)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-boundary-outside@example.com",
    );
    const trashedAt = new Date(
      Date.now() - (30 * 24 * 60 * 60 * 1000 + 60 * 1000),
    );
    const note = await createNoteDirect(userId, { deletedAt: trashedAt });

    const res = await request(app)
      .post(ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("[Resolved Decision #4] SHALL return 404 NOTE_NOT_FOUND when restoring a note that was never trashed", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "restore-never-trashed@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) when restoring another user's trashed note", async () => {
    const owner = await createAuthedUser("restore-owner-b@example.com");
    const attacker = await createAuthedUser("restore-attacker-b@example.com");
    const note = await createNoteDirect(owner.userId, {
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .post(ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND when restoring a nonexistent note id", async () => {
    const { accessToken } = await createAuthedUser(
      "restore-nonexistent@example.com",
    );

    const res = await request(app)
      .post(ROUTES.restore("22222222-2222-4222-8222-222222222222"))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("restore-noauth@example.com");
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app).post(ROUTES.restore(note.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
