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

describe("[FRS-2.3.1, FRS-2.3.2, FRS-2.3.4] GET /api/v1/notes", () => {
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

  it("[FRS-2.3.1] SHALL default to page 1 / limit 20, sorted updatedAt desc, when no query params are supplied", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-default@example.com",
    );
    for (let i = 0; i < 3; i += 1) {
      await createNoteDirect(userId, { title: `Note ${i}` });
    }

    const res = await request(app)
      .get(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pagination).toEqual({
      page: 1,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      total: 3,
      totalPages: 1,
    });
    expect(res.body.data.notes).toHaveLength(3);
    const updatedAts = (
      res.body.data.notes as Array<{ updatedAt: string }>
    ).map((n) => n.updatedAt);
    const sorted = [...updatedAts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(updatedAts).toEqual(sorted);
  });

  it("[FRS-2.3.1] SHALL honor explicit page=2&limit=100 and reject nothing", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-explicit-bounds@example.com",
    );
    for (let i = 0; i < 5; i += 1) {
      await createNoteDirect(userId, { title: `Note ${i}` });
    }

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?page=2&limit=100`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toEqual({
      page: 2,
      limit: 100,
      total: 5,
      totalPages: 1,
    });
    expect(res.body.data.notes).toHaveLength(0);
  });

  it.each([
    ["page", "0"],
    ["page", "-1"],
    ["limit", "0"],
    ["limit", "101"],
  ])(
    "[FRS-2.3.1] SHALL reject %s=%s with 400 VALIDATION_ERROR naming the offending field and its valid range",
    async (field, value) => {
      const { accessToken } = await createAuthedUser(
        `list-bounds-${field}-${value}@example.com`,
      );

      const res = await request(app)
        .get(`${ROUTES.NOTES_ROOT}?${field}=${value}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      const issue = details.find((d) => d.path.includes(field));
      expect(issue).toBeDefined();
      if (field === "limit") {
        expect(issue?.message).toContain(String(APP_LIMITS.PAGE_SIZE_MAX));
      }
    },
  );

  it.each([
    ["createdAt", "asc"],
    ["createdAt", "desc"],
    ["updatedAt", "asc"],
    ["updatedAt", "desc"],
    ["title", "asc"],
    ["title", "desc"],
  ])(
    "[FRS-2.3.2] SHALL order exclusively by sort=%s&order=%s",
    async (sort, order) => {
      const { userId, accessToken } = await createAuthedUser(
        `list-sort-${sort}-${order}@example.com`,
      );
      const titles = ["Bravo", "Alpha", "Charlie"];
      for (const title of titles) {
        await createNoteDirect(userId, { title });
        await new Promise((r) => setTimeout(r, 10));
      }

      const res = await request(app)
        .get(`${ROUTES.NOTES_ROOT}?sort=${sort}&order=${order}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const notes = res.body.data.notes as Array<{
        title: string;
        createdAt: string;
        updatedAt: string;
      }>;
      expect(notes).toHaveLength(3);
      const values = notes.map(
        (n) => n[sort as "title" | "createdAt" | "updatedAt"],
      );
      const sortedAsc = [...values].sort();
      const expected = order === "asc" ? sortedAsc : [...sortedAsc].reverse();
      expect(values).toEqual(expected);
    },
  );

  it("[FRS-2.3.2] SHALL reject an invalid sort value with 400 VALIDATION_ERROR naming the three valid fields", async () => {
    const { accessToken } = await createAuthedUser(
      "list-invalid-sort@example.com",
    );

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?sort=notAField`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{
      path: string[];
      message: string;
    }>;
    const issue = details.find((d) => d.path.includes("sort"));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("createdAt");
    expect(issue?.message).toContain("updatedAt");
    expect(issue?.message).toContain("title");
  });

  it("[FRS-2.3.4] SHALL apply a stable createdAt desc tiebreaker for notes tied on the primary sort field (identical title), consistent across repeated calls", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-tiebreaker@example.com",
    );
    const created: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const note = await createNoteDirect(userId, { title: "Same Title" });
      created.push(note.id);
      await new Promise((r) => setTimeout(r, 10));
    }

    const first = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?sort=title&order=asc`)
      .set("Authorization", `Bearer ${accessToken}`);
    const second = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?sort=title&order=asc`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const idsFirst = (first.body.data.notes as Array<{ id: string }>).map(
      (n) => n.id,
    );
    const idsSecond = (second.body.data.notes as Array<{ id: string }>).map(
      (n) => n.id,
    );
    // Every row shares the same title, so the only ordering signal is the
    // createdAt desc tiebreaker — most-recently-created first.
    expect(idsFirst).toEqual([...created].reverse());
    expect(idsSecond).toEqual(idsFirst);
  });

  it("[FRS-2.3.4] SHALL never skip or duplicate a tied row across adjacent pages", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-tiebreaker-pages@example.com",
    );
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const note = await createNoteDirect(userId, { title: "Tied Title" });
      created.push(note.id);
      await new Promise((r) => setTimeout(r, 10));
    }

    const page1 = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?sort=title&order=asc&page=1&limit=3`)
      .set("Authorization", `Bearer ${accessToken}`);
    const page2 = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?sort=title&order=asc&page=2&limit=3`)
      .set("Authorization", `Bearer ${accessToken}`);

    const idsPage1 = (page1.body.data.notes as Array<{ id: string }>).map(
      (n) => n.id,
    );
    const idsPage2 = (page2.body.data.notes as Array<{ id: string }>).map(
      (n) => n.id,
    );
    const combined = [...idsPage1, ...idsPage2];
    expect(combined).toEqual([...created].reverse());
    expect(new Set(combined).size).toBe(created.length);
  });

  it("[FRS-2.2.3, FRS-8.1] SHALL exclude trashed notes (Stage 1 or Stage 2) from every result page and from total/totalPages under any filter combo", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-exclude-trash@example.com",
    );
    const active = await createNoteDirect(userId, { title: "Active Note" });
    await createNoteDirect(userId, {
      title: "Stage1 Trashed",
      deletedAt: daysAgo(1),
    });
    await createNoteDirect(userId, {
      title: "Stage2 Trashed",
      deletedAt: daysAgo(45),
    });

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?sort=title&order=asc`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(1);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([active.id]);
  });

  it("[FRS-8.1] SHALL exclude another user's notes from results and count regardless of sort/filter, scoped strictly to the caller's own userId", async () => {
    const owner = await createAuthedUser("list-owner@example.com");
    const other = await createAuthedUser("list-other@example.com");
    await createNoteDirect(other.userId, { title: "Other User Note" });
    const ownNote = await createNoteDirect(owner.userId, {
      title: "Owner Note",
    });

    const res = await request(app)
      .get(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(1);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([ownNote.id]);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const res = await request(app).get(ROUTES.NOTES_ROOT);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
