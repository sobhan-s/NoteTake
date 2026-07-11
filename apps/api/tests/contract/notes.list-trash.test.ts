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
import { resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.2.2, FRS-2.3.6] GET /api/v1/notes/trash", () => {
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

  it("[FRS-2.2.2, FRS-2.3.6] SHALL return only Stage-1 trashed notes, ordered strictly deletedAt desc, with the same pagination envelope as the active list", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "trash-order@example.com",
    );
    const oldest = await createNoteDirect(userId, {
      title: "Oldest Trashed",
      deletedAt: daysAgo(10),
    });
    const middle = await createNoteDirect(userId, {
      title: "Middle Trashed",
      deletedAt: daysAgo(5),
    });
    const newest = await createNoteDirect(userId, {
      title: "Newest Trashed",
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .get(ROUTES.TRASH)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([newest.id, middle.id, oldest.id]);
    expect(res.body.data.pagination).toEqual({
      page: 1,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      total: 3,
      totalPages: 1,
    });
  });

  it("[FRS-2.3.6] SHALL exclude a note trashed exactly 30 days and 1 second in the past (Stage 2) from both results and total, verified via a direct DB-state fixture", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "trash-boundary-outside@example.com",
    );
    const stage2Note = await createNoteDirect(userId, {
      title: "Just Past Boundary",
      deletedAt: daysAgo(APP_LIMITS.TRASH_STAGE_1_DAYS, 1000),
    });
    const stage1Note = await createNoteDirect(userId, {
      title: "Just Inside Boundary",
      deletedAt: daysAgo(APP_LIMITS.TRASH_STAGE_1_DAYS - 1, 0),
    });

    const res = await request(app)
      .get(ROUTES.TRASH)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([stage1Note.id]);
    expect(ids).not.toContain(stage2Note.id);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it("[FRS-2.3.6] SHALL include a note trashed exactly 1 second before the 30-day boundary (still Stage 1)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "trash-boundary-inside@example.com",
    );
    const stage1Note = await createNoteDirect(userId, {
      title: "One Second Inside",
      deletedAt: daysAgo(APP_LIMITS.TRASH_STAGE_1_DAYS, -1000),
    });

    const res = await request(app)
      .get(ROUTES.TRASH)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([stage1Note.id]);
  });

  it.each([
    ["page", "0"],
    ["page", "-1"],
    ["limit", "0"],
    ["limit", "101"],
  ])(
    "[FRS-2.3.6] SHALL validate %s=%s with the identical bounds as /notes, rejecting with 400 VALIDATION_ERROR",
    async (field, value) => {
      const { accessToken } = await createAuthedUser(
        `trash-bounds-${field}-${value}@example.com`,
      );

      const res = await request(app)
        .get(`${ROUTES.TRASH}?${field}=${value}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    },
  );

  it("[FRS-2.3.6, Resolved Decision #7] SHALL silently ignore unsupported sort/tagIds/tagMode params and still return 200 OK", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "trash-unsupported-params@example.com",
    );
    const note = await createNoteDirect(userId, {
      title: "Trashed Note",
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .get(
        `${ROUTES.TRASH}?sort=title&tagIds=11111111-1111-4111-8111-111111111111&tagMode=ANY`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([note.id]);
  });

  it("[FRS-2.3.6] SHALL never include active (deletedAt IS NULL) notes in the trash list's results or count, regardless of page/limit", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "trash-exclude-active@example.com",
    );
    await createNoteDirect(userId, { title: "Active Note" });
    const trashed = await createNoteDirect(userId, {
      title: "Trashed Note",
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .get(`${ROUTES.TRASH}?page=1&limit=50`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(1);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([trashed.id]);
  });

  it("[FRS-8.1] SHALL exclude another user's trashed notes from results and count", async () => {
    const owner = await createAuthedUser("trash-owner@example.com");
    const other = await createAuthedUser("trash-other@example.com");
    await createNoteDirect(other.userId, {
      title: "Other User Trashed",
      deletedAt: daysAgo(1),
    });
    const ownTrashed = await createNoteDirect(owner.userId, {
      title: "Owner Trashed",
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .get(ROUTES.TRASH)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(1);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([ownTrashed.id]);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const res = await request(app).get(ROUTES.TRASH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
