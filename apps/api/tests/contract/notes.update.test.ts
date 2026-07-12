import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  daysAgo,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.1.3] PATCH /api/v1/notes/:id", () => {
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

  it("[FRS-2.1.3] SHALL update only `title` when only `title` is supplied, leaving `body` unchanged, and return 200", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "title-only-update@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Original Title",
      body: "Original Body",
    });

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Updated Title" });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Updated Title");
    expect(res.body.data.body).toBe("Original Body");
  });

  it("[FRS-2.1.3] SHALL update only `body` when only `body` is supplied, leaving `title` unchanged, and return 200", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "body-only-update@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Stable Title",
      body: "Original Body",
    });

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ body: "Updated Body" });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Stable Title");
    expect(res.body.data.body).toBe("Updated Body");
  });

  it("[FRS-2.1.3, updateNoteSchema .refine] SHALL return 400 VALIDATION_ERROR when neither `title` nor `body` is present in the request body", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "empty-patch@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  it("[FRS-2.1.5] SHALL return 400 VALIDATION_ERROR naming `title` when updating with an empty/whitespace-only title", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "whitespace-update@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("title"),
      ),
    ).toBe(true);
  });

  it("[FRS-2.1.6] SHALL return 400 VALIDATION_ERROR naming `title` when the update title exceeds APP_LIMITS.NOTE_TITLE_MAX_CHARS", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "title-over-update@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "A".repeat(APP_LIMITS.NOTE_TITLE_MAX_CHARS + 1) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("title"),
      ),
    ).toBe(true);
  });

  it("[FRS-2.1.6] SHALL return 400 VALIDATION_ERROR naming `body` when the update body exceeds APP_LIMITS.NOTE_BODY_MAX_CHARS", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "body-over-update@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ body: "b".repeat(APP_LIMITS.NOTE_BODY_MAX_CHARS + 1) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("body"),
      ),
    ).toBe(true);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) when updating another user's note, and SHALL NOT modify it", async () => {
    const owner = await createAuthedUser("update-owner-b@example.com");
    const attacker = await createAuthedUser("update-attacker-b@example.com");
    const note = await createNoteDirect(owner.userId, { title: "Untouched" });

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({ title: "Hijacked" });

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.title).toBe("Untouched");
  });

  it("[Resolved Decision #2] SHALL return 404 NOTE_NOT_FOUND when updating a note currently in Stage-1 trash — the caller must restore first", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "stage1-update@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Trashed",
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Should not apply" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row?.title).toBe("Trashed");
  });

  it("[Resolved Decision #2] SHALL return 404 NOTE_NOT_FOUND when updating a note currently in Stage-2 trash", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "stage2-update@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(45) });

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Should not apply" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.1.4] SHALL advance `updatedAt` to a strictly later timestamp after a successful update", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "updated-at-update@example.com",
    );
    const note = await createNoteDirect(userId);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Bumped" });

    expect(res.status).toBe(200);
    const newUpdatedAtMs = new Date(
      res.body.data.updatedAt as string,
    ).getTime();
    expect(newUpdatedAtMs).toBeGreaterThan(note.updatedAt.getTime());
  });
});
