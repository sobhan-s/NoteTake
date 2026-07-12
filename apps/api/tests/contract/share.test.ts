import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  createShareLinkDirect,
  daysAgo,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const HEX_64_RE = /^[0-9a-f]{64}$/;
const MS_TOLERANCE = 5000;

describe("POST /api/v1/notes/:id/share", () => {
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

  it("[FRS-5.1] SHALL create a new share link and return 201 with a 64-hex-char token, viewCount 0, and expiresAt ~7 days out when expiresInDays is omitted", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-create-default@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.noteId).toBe(note.id);
    expect(res.body.data.token).toMatch(HEX_64_RE);
    expect(res.body.data.viewCount).toBe(0);

    const expiresAt = new Date(res.body.data.expiresAt).getTime();
    const expected = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(MS_TOLERANCE);

    const count = await prisma.shareLink.count({
      where: { noteId: note.id },
    });
    expect(count).toBe(1);
  });

  it("[FRS-5.1] SHALL honor a custom expiresInDays and set expiresAt to approximately now + N days", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-create-custom-expiry@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: 15 });

    expect(res.status).toBe(201);
    const expiresAt = new Date(res.body.data.expiresAt).getTime();
    const expected = Date.now() + 15 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(MS_TOLERANCE);
  });

  it("[FRS-5.2] SHALL reject expiresInDays of 0 (below the 1-day minimum) with 400 VALIDATION_ERROR and create no row", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-expiry-zero@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[FRS-5.2] SHALL reject expiresInDays of 31 (above the 30-day maximum) with 400 VALIDATION_ERROR and create no row", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-expiry-too-high@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: 31 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[FRS-5.2] SHALL reject a negative expiresInDays with 400 VALIDATION_ERROR and create no row", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-expiry-negative@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[FRS-5.2] SHALL reject a non-integer expiresInDays (2.5) with 400 VALIDATION_ERROR and create no row", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-expiry-non-integer@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: 2.5 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[Resolved Decision #1] SHALL return 200 with the unchanged existing link (same token/expiresAt/viewCount) on a re-POST, ignoring a different expiresInDays and never rotating", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-idempotent@example.com",
    );
    const note = await createNoteDirect(userId);

    const firstRes = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: 5 });
    expect(firstRes.status).toBe(201);

    const secondRes = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ expiresInDays: 20 });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.token).toBe(firstRes.body.data.token);
    expect(secondRes.body.data.expiresAt).toBe(firstRes.body.data.expiresAt);
    expect(secondRes.body.data.viewCount).toBe(firstRes.body.data.viewCount);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(1);
  });

  it("[FRS-2.2.4, Resolved Decision #3] SHALL return 404 NOTE_NOT_FOUND when attempting to share a trashed note, and SHALL NOT create a row", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-trashed@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) when a different user attempts to share a note they do not own", async () => {
    const owner = await createAuthedUser("share-owner-a@example.com");
    const attacker = await createAuthedUser("share-attacker-a@example.com");
    const note = await createNoteDirect(owner.userId);

    const res = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND when sharing a nonexistent note id", async () => {
    const { accessToken } = await createAuthedUser(
      "share-nonexistent@example.com",
    );

    const res = await request(app)
      .post(ROUTES.share("33333333-3333-4333-8333-333333333333"))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("share-noauth-post@example.com");
    const note = await createNoteDirect(userId);

    const res = await request(app).post(ROUTES.share(note.id)).send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});

describe("[Resolved Decision #2] GET /api/v1/notes/:id/share", () => {
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

  it("[Resolved Decision #2] SHALL return 200 with the active link's noteId/token/expiresAt/viewCount/createdAt when one exists", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-get-active@example.com",
    );
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id, { viewCount: 3 });

    const res = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.noteId).toBe(note.id);
    expect(res.body.data.token).toBe(link.token);
    expect(res.body.data.viewCount).toBe(3);
    expect(new Date(res.body.data.expiresAt).getTime()).toBe(
      link.expiresAt.getTime(),
    );
  });

  it("[Resolved Decision #2] SHALL return 404 SHARE_LINK_NOT_FOUND when no share link was ever created for the note", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-get-none@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_NOT_FOUND);
  });

  it("[FRS-5.3] SHALL return 404 SHARE_LINK_NOT_FOUND when only a revoked link exists on record", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-get-revoked@example.com",
    );
    const note = await createNoteDirect(userId);
    await createShareLinkDirect(note.id, { revokedAt: new Date() });

    const res = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_NOT_FOUND);
  });

  it("[FRS-5.1] SHALL return 404 SHARE_LINK_NOT_FOUND when only an expired link exists on record", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-get-expired@example.com",
    );
    const note = await createNoteDirect(userId);
    await createShareLinkDirect(note.id, {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_NOT_FOUND);
  });

  it("[FRS-2.2.4, Resolved Decision #3] SHALL return 404 NOTE_NOT_FOUND when fetching the share link of a trashed note, even if an active-looking link row exists", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-get-trashed@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });
    await createShareLinkDirect(note.id);

    const res = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403, never leaking link existence) when a different user fetches the share link", async () => {
    const owner = await createAuthedUser("share-get-owner-a@example.com");
    const attacker = await createAuthedUser("share-get-attacker-a@example.com");
    const note = await createNoteDirect(owner.userId);
    await createShareLinkDirect(note.id);

    const res = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser("share-noauth-get@example.com");
    const note = await createNoteDirect(userId);

    const res = await request(app).get(ROUTES.share(note.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});

describe("[FRS-5.3] DELETE /api/v1/notes/:id/share", () => {
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

  it("[FRS-5.3] SHALL revoke an active link, return 200 with { noteId }, persist a non-null revokedAt, and make a follow-up GET return 404 SHARE_LINK_NOT_FOUND immediately", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-revoke-active@example.com",
    );
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id);

    const deleteRes = await request(app)
      .delete(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.noteId).toBe(note.id);

    const row = await prisma.shareLink.findUnique({ where: { id: link.id } });
    expect(row?.revokedAt).not.toBeNull();

    const getRes = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_NOT_FOUND);
  });

  it("[FRS-5.3] SHALL return 404 SHARE_LINK_NOT_FOUND when there is no active link to revoke, mutating no row", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-revoke-none@example.com",
    );
    const note = await createNoteDirect(userId);

    const res = await request(app)
      .delete(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_NOT_FOUND);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("[FRS-2.2.4, Resolved Decision #3] SHALL return 404 NOTE_NOT_FOUND when revoking the share link of a trashed note, never mutating the existing link", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-revoke-trashed@example.com",
    );
    const note = await createNoteDirect(userId, { deletedAt: daysAgo(1) });
    const link = await createShareLinkDirect(note.id);

    const res = await request(app)
      .delete(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.shareLink.findUnique({ where: { id: link.id } });
    expect(row?.revokedAt).toBeNull();
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND (never 403) when a different user attempts to revoke the share link", async () => {
    const owner = await createAuthedUser("share-revoke-owner-a@example.com");
    const attacker = await createAuthedUser(
      "share-revoke-attacker-a@example.com",
    );
    const note = await createNoteDirect(owner.userId);
    const link = await createShareLinkDirect(note.id);

    const res = await request(app)
      .delete(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);

    const row = await prisma.shareLink.findUnique({ where: { id: link.id } });
    expect(row?.revokedAt).toBeNull();
  });

  it("[FRS-2.1.2] SHALL return 404 NOTE_NOT_FOUND when revoking the share link of a nonexistent note id", async () => {
    const { accessToken } = await createAuthedUser(
      "share-revoke-nonexistent@example.com",
    );

    const res = await request(app)
      .delete(ROUTES.share("44444444-4444-4444-8444-444444444444"))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.NOTE_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const { userId } = await createAuthedUser(
      "share-noauth-delete@example.com",
    );
    const note = await createNoteDirect(userId);
    await createShareLinkDirect(note.id);

    const res = await request(app).delete(ROUTES.share(note.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});

describe("[Resolved Decision #3, FRS-2.2.4] Restoring a note does not resurrect its revoked share link", () => {
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

  it("[Resolved Decision #3] SHALL leave the share link revoked after restore — GET .../share still 404s, and a fresh POST is required to re-share", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "share-restore-no-resurrect@example.com",
    );
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id);

    const trashRes = await request(app)
      .delete(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);
    expect(trashRes.status).toBe(200);

    const revokedRow = await prisma.shareLink.findUnique({
      where: { id: link.id },
    });
    expect(revokedRow?.revokedAt).not.toBeNull();

    const restoreRes = await request(app)
      .post(ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${accessToken}`);
    expect(restoreRes.status).toBe(200);

    const stillRevokedRow = await prisma.shareLink.findUnique({
      where: { id: link.id },
    });
    expect(stillRevokedRow?.revokedAt).not.toBeNull();

    const getAfterRestore = await request(app)
      .get(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getAfterRestore.status).toBe(404);
    expect(getAfterRestore.body.error.code).toBe(
      API_ERROR_CODES.SHARE_LINK_NOT_FOUND,
    );

    const freshPostRes = await request(app)
      .post(ROUTES.share(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(freshPostRes.status).toBe(201);
    expect(freshPostRes.body.data.token).not.toBe(link.token);

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(2);
  });
});
