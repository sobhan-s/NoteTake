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

describe("[FRS-2.2.8] DELETE /api/v1/notes/:id/permanent", () => {
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

  it("[FRS-2.2.8] SHALL return 200 and physically remove the row when the note is within Stage 1 and `{ confirm: true }` is sent", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "permanent-happy@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .delete(ROUTES.permanent(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ confirm: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(note.id);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).toBeNull();
  });

  it("[FRS-2.2.8, permanentDeleteSchema] SHALL return 400 VALIDATION_ERROR (ZodError shape) and NOT delete the row when `confirm` is omitted", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "permanent-omitted@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .delete(ROUTES.permanent(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(res.body.error.message).toBe("Validation failed");
    const details = res.body.error.details as Array<{
      path: string[];
      code: string;
    }>;
    expect(Array.isArray(details)).toBe(true);
    const confirmIssue = details.find((issue) =>
      issue.path.includes("confirm"),
    );
    expect(confirmIssue).toBeDefined();
    expect(confirmIssue?.code).toBe("invalid_literal");

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).not.toBeNull();
  });

  it("[FRS-2.2.8, permanentDeleteSchema] SHALL return 400 VALIDATION_ERROR naming `confirm` and NOT delete the row when `confirm` is `false`", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "permanent-false@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .delete(ROUTES.permanent(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ confirm: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{ path: string[] }>;
    expect(details.some((issue) => issue.path.includes("confirm"))).toBe(true);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).not.toBeNull();
  });

  it("[FRS-2.2.5, Resolved Decision] SHALL return 404 NOTE_NOT_FOUND (and NOT delete) when the note is already Stage 2 (>30 days trashed)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "permanent-stage2@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(45) });

    const res = await request(app)
      .delete(ROUTES.permanent(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ confirm: true });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).not.toBeNull();
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) and NOT delete when permanently deleting another user's trashed note", async () => {
    const owner = await createAuthedUser("permanent-owner-b@example.com");
    const attacker = await createAuthedUser("permanent-attacker-b@example.com");
    const note = await createNoteDirect(owner.userId, {
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .delete(ROUTES.permanent(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({ confirm: true });

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).not.toBeNull();
  });

  it("[Resolved Decision #4 parity] SHALL return 404 NOTE_NOT_FOUND (and NOT delete) when the note was never trashed (permanent-delete requires the Stage-1 window)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "permanent-never-trashed@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .delete(ROUTES.permanent(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ confirm: true });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row).not.toBeNull();
  });
});
