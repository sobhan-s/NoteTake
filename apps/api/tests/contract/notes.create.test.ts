import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import { app, createAuthedUser, ROUTES } from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.1.1, FRS-2.1.4] POST /api/v1/notes", () => {
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

  it("[FRS-2.1.1] SHALL create a note with the given title/body, return 201, and persist a row with the exact same values scoped to the caller's userId", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "creator@example.com",
    );

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "My First Note", body: "<p>Hello world</p>" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("My First Note");
    expect(res.body.data.body).toBe("<p>Hello world</p>");
    expect(res.body.data).not.toHaveProperty("userId");

    const row = await prisma.note.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(userId);
    expect(row?.title).toBe("My First Note");
    expect(row?.body).toBe("<p>Hello world</p>");
  });

  it("[FRS-2.1.5] SHALL reject an empty title with 400 VALIDATION_ERROR naming `title`, and create no row", async () => {
    const { accessToken } = await createAuthedUser("empty-title@example.com");

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "", body: "valid body" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("title"),
      ),
    ).toBe(true);

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  it("[FRS-2.1.5] SHALL reject a whitespace-only title with 400 VALIDATION_ERROR naming `title`", async () => {
    const { accessToken } = await createAuthedUser(
      "whitespace-title@example.com",
    );

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "   ", body: "valid body" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("title"),
      ),
    ).toBe(true);
  });

  it("[FRS-2.1.6] SHALL accept a title of exactly APP_LIMITS.NOTE_TITLE_MAX_CHARS characters", async () => {
    const { accessToken } = await createAuthedUser("title-max@example.com");
    const title = "A".repeat(APP_LIMITS.NOTE_TITLE_MAX_CHARS);

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title, body: "valid body" });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe(title);
    expect(res.body.data.title).toHaveLength(APP_LIMITS.NOTE_TITLE_MAX_CHARS);
  });

  it("[FRS-2.1.6] SHALL reject a title of APP_LIMITS.NOTE_TITLE_MAX_CHARS + 1 characters with 400 VALIDATION_ERROR naming `title` and the limit", async () => {
    const { accessToken } = await createAuthedUser("title-over@example.com");
    const title = "A".repeat(APP_LIMITS.NOTE_TITLE_MAX_CHARS + 1);

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title, body: "valid body" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{
      path: string[];
      message: string;
    }>;
    const titleIssue = details.find((issue) => issue.path.includes("title"));
    expect(titleIssue).toBeDefined();
    expect(titleIssue?.message).toContain(
      String(APP_LIMITS.NOTE_TITLE_MAX_CHARS),
    );

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  it("[FRS-2.1.6] SHALL accept a body of exactly APP_LIMITS.NOTE_BODY_MAX_CHARS characters", async () => {
    const { accessToken } = await createAuthedUser("body-max@example.com");
    const body = "b".repeat(APP_LIMITS.NOTE_BODY_MAX_CHARS);

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Big body note", body });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toHaveLength(APP_LIMITS.NOTE_BODY_MAX_CHARS);
  });

  it("[FRS-2.1.6] SHALL reject a body of APP_LIMITS.NOTE_BODY_MAX_CHARS + 1 characters with 400 VALIDATION_ERROR naming `body` and the limit", async () => {
    const { accessToken } = await createAuthedUser("body-over@example.com");
    const body = "b".repeat(APP_LIMITS.NOTE_BODY_MAX_CHARS + 1);

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Over-limit body note", body });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{
      path: string[];
      message: string;
    }>;
    const bodyIssue = details.find((issue) => issue.path.includes("body"));
    expect(bodyIssue).toBeDefined();
    expect(bodyIssue?.message).toContain(
      String(APP_LIMITS.NOTE_BODY_MAX_CHARS),
    );

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  it("[spec.md schemas/note.schema.ts] SHALL accept an empty (zero-length) body since createNoteSchema enforces no minimum on `body`", async () => {
    const { accessToken } = await createAuthedUser("empty-body@example.com");

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Title only note", body: "" });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe("");
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED and create no row when no Authorization header is present", async () => {
    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .send({ title: "Should not persist", body: "body" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  it("[FRS-2.1.4, FRS-8.2] SHALL return `createdAt`/`updatedAt` as valid UTC ISO-8601 strings, equal to each other on creation", async () => {
    const { accessToken } = await createAuthedUser("timestamps@example.com");

    const before = Date.now();
    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Timestamp note", body: "body" });
    const after = Date.now();

    expect(res.status).toBe(201);
    const { createdAt, updatedAt } = res.body.data as {
      createdAt: string;
      updatedAt: string;
    };
    expect(typeof createdAt).toBe("string");
    expect(typeof updatedAt).toBe("string");
    expect(createdAt).toMatch(/Z$/);
    expect(updatedAt).toMatch(/Z$/);

    const createdMs = new Date(createdAt).getTime();
    const updatedMs = new Date(updatedAt).getTime();
    expect(Number.isNaN(createdMs)).toBe(false);
    expect(Number.isNaN(updatedMs)).toBe(false);
    expect(createdMs).toBeGreaterThanOrEqual(before - 1000);
    expect(createdMs).toBeLessThanOrEqual(after + 1000);
    expect(createdMs).toBe(updatedMs);
  });

  it("[FRS-6.1, SDS route table] SHALL create exactly one NoteVersion row whose titleSnapshot/bodySnapshot match the created title/body", async () => {
    const { accessToken } = await createAuthedUser(
      "version-on-create@example.com",
    );

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Versioned Note", body: "<p>Initial content</p>" });

    expect(res.status).toBe(201);
    const versions = await prisma.noteVersion.findMany({
      where: { noteId: res.body.data.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.titleSnapshot).toBe("Versioned Note");
    expect(versions[0]?.bodySnapshot).toBe("<p>Initial content</p>");
  });
});
