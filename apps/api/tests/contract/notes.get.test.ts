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
import { resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.1.2] GET /api/v1/notes/:id", () => {
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

  it("[FRS-2.1.1, FRS-2.1.4] SHALL return 200 with the note's own shape for an active note owned by the caller, exposing no `userId` field", async () => {
    const { userId, accessToken } = await createAuthedUser("owner@example.com");
    const note = await createNoteDirect(userId, {
      title: "Owned Note",
      body: "Owned body",
    });

    const res = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: note.id,
      title: "Owned Note",
      body: "Owned body",
      deletedAt: null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      hasActiveShareLink: false,
      tags: [],
    });
    expect(res.body.data).not.toHaveProperty("userId");
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) when the note belongs to a different user", async () => {
    const owner = await createAuthedUser("get-owner-b@example.com");
    const attacker = await createAuthedUser("get-attacker-b@example.com");
    const note = await createNoteDirect(owner.userId);

    const res = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND for a syntactically-valid but nonexistent note id", async () => {
    const { accessToken } = await createAuthedUser("nonexistent@example.com");

    const res = await request(app)
      .get(ROUTES.noteById("11111111-1111-4111-8111-111111111111"))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.2.3, Resolved Decision #2] SHALL return 404 NOTE_NOT_FOUND for a note currently in Stage-1 trash (deletedAt 1 day ago)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "stage1-get@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.2.6, Resolved Decision #2] SHALL return 404 NOTE_NOT_FOUND for a note currently in Stage-2 trash (deletedAt 45 days ago)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "stage2-get@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(45) });

    const res = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("get-noauth@example.com");
    const note = await createNoteDirect(userId);

    const res = await request(app).get(ROUTES.noteById(note.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
