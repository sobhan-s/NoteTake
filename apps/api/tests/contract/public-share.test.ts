import crypto from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  createShareLinkDirect,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-5.4, FRS-5.5, FRS-5.6, FRS-2.2.4] GET /api/v1/public/share/:token", () => {
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

  it("[FRS-5.4] SHALL return 200 with EXACTLY {title, body, updatedAt} matching the note and SHALL increment viewCount by 1", async () => {
    const { userId } = await createAuthedUser("share-valid-owner@example.com");
    const note = await createNoteDirect(userId, {
      title: "Roadmap for Q3",
      body: "<p>Detailed roadmap content.</p>",
    });
    const link = await createShareLinkDirect(note.id);

    const res = await request(app).get(ROUTES.publicShare(link.token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual([
      "body",
      "title",
      "updatedAt",
    ]);
    expect(res.body.data.title).toBe(note.title);
    expect(res.body.data.body).toBe(note.body);
    expect(res.body.data.updatedAt).toBe(note.updatedAt.toISOString());

    const updatedLink = await prisma.shareLink.findUnique({
      where: { id: link.id },
    });
    expect(updatedLink?.viewCount).toBe(1);
  });

  it("[FRS-5.4] SHALL increment viewCount once per sequential visit with no dedup, reaching exactly 5 after 5 identical sequential requests", async () => {
    const { userId } = await createAuthedUser(
      "share-repeat-visits@example.com",
    );
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id);

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get(ROUTES.publicShare(link.token));
      expect(res.status).toBe(200);
    }

    const updatedLink = await prisma.shareLink.findUnique({
      where: { id: link.id },
    });
    expect(updatedLink?.viewCount).toBe(5);
  });

  it("[FRS-5.4] SHALL atomically increment viewCount with no lost updates under 10 concurrent requests, reaching exactly 10", async () => {
    const { userId } = await createAuthedUser(
      "share-concurrent-visits@example.com",
    );
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).get(ROUTES.publicShare(link.token)),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const updatedLink = await prisma.shareLink.findUnique({
      where: { id: link.id },
    });
    expect(updatedLink?.viewCount).toBe(10);
  });

  it("[FRS-5.6] SHALL return 404 SHARE_LINK_UNAVAILABLE for a link whose expiresAt is in the past", async () => {
    const { userId } = await createAuthedUser("share-expired@example.com");
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id, {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get(ROUTES.publicShare(link.token));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_UNAVAILABLE);
  });

  it("[FRS-5.6] SHALL return a byte-identical 404 SHARE_LINK_UNAVAILABLE body shape for a revoked link as for an expired one", async () => {
    const { userId } = await createAuthedUser("share-revoked@example.com");
    const note = await createNoteDirect(userId);

    const expiredLink = await createShareLinkDirect(note.id, {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const revokedLink = await createShareLinkDirect(note.id, {
      revokedAt: new Date(),
    });

    const expiredRes = await request(app).get(
      ROUTES.publicShare(expiredLink.token),
    );
    const revokedRes = await request(app).get(
      ROUTES.publicShare(revokedLink.token),
    );

    expect(expiredRes.status).toBe(404);
    expect(revokedRes.status).toBe(404);
    expect(expiredRes.body.success).toBe(false);
    expect(revokedRes.body.success).toBe(false);
    expect(revokedRes.body.error.code).toBe(
      API_ERROR_CODES.SHARE_LINK_UNAVAILABLE,
    );
    expect(Object.keys(revokedRes.body.error).sort()).toEqual(
      Object.keys(expiredRes.body.error).sort(),
    );
  });

  it("[FRS-2.2.4] SHALL return 404 SHARE_LINK_UNAVAILABLE when the parent note is directly trashed while the link itself remains active and unrevoked", async () => {
    const { userId } = await createAuthedUser("share-trashed-note@example.com");
    const note = await createNoteDirect(userId);
    const link = await createShareLinkDirect(note.id);

    await prisma.note.update({
      where: { id: note.id },
      data: { deletedAt: new Date() },
    });

    const persistedLink = await prisma.shareLink.findUnique({
      where: { id: link.id },
    });
    expect(persistedLink?.revokedAt).toBeNull();

    const res = await request(app).get(ROUTES.publicShare(link.token));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_UNAVAILABLE);
  });

  it("[FRS-5.6] SHALL return 404 SHARE_LINK_UNAVAILABLE for a token that matches no ShareLink row at all", async () => {
    const nonexistentToken = crypto.randomBytes(32).toString("hex");

    const res = await request(app).get(ROUTES.publicShare(nonexistentToken));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.SHARE_LINK_UNAVAILABLE);
  });

  it("[FRS-5.5] SHALL expose no note id or owner id anywhere in the successful public response payload", async () => {
    const { userId } = await createAuthedUser(
      "share-no-leak-owner@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "No Leak Title",
      body: "No leak body content.",
    });
    const link = await createShareLinkDirect(note.id);

    const res = await request(app).get(ROUTES.publicShare(link.token));

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toContain(note.id);
    expect(serialized).not.toContain(userId);
  });
});
