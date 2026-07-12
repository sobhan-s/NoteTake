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

describe("[FRS-6.2] GET /api/v1/notes/:id/versions", () => {
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

  it("[FRS-6.2] SHALL return every version for the note ordered newest-createdAt-first, with timestamps", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-ordering@example.com",
    );
    const note = await createNoteDirect(userId);
    const oldest = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Oldest",
        bodySnapshot: "b1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const middle = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Middle",
        bodySnapshot: "b2",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const newest = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Newest",
        bodySnapshot: "b3",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });

    const res = await request(app)
      .get(versionsRoute(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.versions.map((v: { id: string }) => v.id)).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);
    expect(res.body.data.versions[0]).toEqual({
      id: newest.id,
      titleSnapshot: "Newest",
      createdAt: newest.createdAt.toISOString(),
    });
  });

  it("[FRS-6.2] SHALL return exactly one version — the initial creation snapshot — for a brand-new note with no updates yet", async () => {
    const { accessToken } = await createAuthedUser("list-single@example.com");
    const createRes = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Brand New", body: "Initial body" });

    const res = await request(app)
      .get(versionsRoute(createRes.body.data.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.versions).toHaveLength(1);
    expect(res.body.data.versions[0].titleSnapshot).toBe("Brand New");
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND (never 403) when requesting another user's note history", async () => {
    const owner = await createAuthedUser("list-owner@example.com");
    const attacker = await createAuthedUser("list-attacker@example.com");
    const note = await createNoteDirect(owner.userId);

    const res = await request(app)
      .get(versionsRoute(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND when requesting version history for a nonexistent note id", async () => {
    const { accessToken } = await createAuthedUser(
      "list-nonexistent@example.com",
    );

    const res = await request(app)
      .get(versionsRoute("11111111-1111-4111-8111-111111111111"))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND when requesting history for the caller's own note currently in Stage-1 trash", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-trashed-stage1@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .get(versionsRoute(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND when requesting history for the caller's own note currently in Stage-2 trash", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-trashed-stage2@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(45) });

    const res = await request(app)
      .get(versionsRoute(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("list-noauth@example.com");
    const note = await createNoteDirect(userId);

    const res = await request(app).get(versionsRoute(note.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
