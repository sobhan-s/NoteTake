import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, API_PATHS } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const versionsRoute = (noteId: string): string =>
  `${ROUTES.noteById(noteId)}${API_PATHS.NOTES.VERSIONS}`;
const versionRoute = (noteId: string, versionId: string): string =>
  `${versionsRoute(noteId)}/${versionId}`;

describe("[FRS-6.3] GET /api/v1/notes/:id/versions/:versionId", () => {
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

  it("[FRS-6.3] SHALL return the full titleSnapshot/bodySnapshot/createdAt of an existing version belonging to the caller's own active note", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "get-version@example.com",
    );
    const note = await createNoteDirect(userId);
    const version = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Snapshot Title",
        bodySnapshot: "Snapshot Body",
      },
    });

    const res = await request(app)
      .get(versionRoute(note.id, version.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: version.id,
      noteId: note.id,
      titleSnapshot: "Snapshot Title",
      bodySnapshot: "Snapshot Body",
      createdAt: version.createdAt.toISOString(),
    });
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 VERSION_NOT_FOUND when the versionId exists but belongs to a different note", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "get-cross-note@example.com",
    );
    const noteA = await createNoteDirect(userId, { title: "Note A" });
    const noteB = await createNoteDirect(userId, { title: "Note B" });
    const versionOfB = await prisma.noteVersion.create({
      data: {
        noteId: noteB.id,
        titleSnapshot: "B Snapshot",
        bodySnapshot: "B Body",
      },
    });

    const res = await request(app)
      .get(versionRoute(noteA.id, versionOfB.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VERSION_NOT_FOUND);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 VERSION_NOT_FOUND for a syntactically-valid but nonexistent versionId (identical outcome to a purged version)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "get-nonexistent@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .get(versionRoute(note.id, "00000000-0000-4000-8000-000000000000"))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VERSION_NOT_FOUND);
  });

  it("[FRS-6, Error Scenarios] SHALL return 404 NOTE_NOT_FOUND (never VERSION_NOT_FOUND, never 403) when the note itself belongs to a different user", async () => {
    const owner = await createAuthedUser("get-owner@example.com");
    const attacker = await createAuthedUser("get-attacker@example.com");
    const note = await createNoteDirect(owner.userId);
    const version = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Owner Snapshot",
        bodySnapshot: "Owner Body",
      },
    });

    const res = await request(app)
      .get(versionRoute(note.id, version.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("get-noauth@example.com");
    const note = await createNoteDirect(userId);
    const version = await prisma.noteVersion.create({
      data: {
        noteId: note.id,
        titleSnapshot: "Snapshot Title",
        bodySnapshot: "Snapshot Body",
      },
    });

    const res = await request(app).get(versionRoute(note.id, version.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
