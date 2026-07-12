import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, API_PATHS, APP_LIMITS } from "@shared/core/constants";
import {
  app,
  attachTagDirect,
  createAuthedUser,
  createNoteDirect,
  createTagDirect,
  daysAgo,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const SEARCH_ROOT = `${API_PATHS.BASE}${API_PATHS.SEARCH.ROOT}`;

function searchUrl(
  params: Record<string, string | number | undefined>,
): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");
  return `${SEARCH_ROOT}?${qs}`;
}

describe("[FRS-4.1, FRS-4.2, FRS-4.3, FRS-4.4, FRS-4.5] GET /api/v1/search", () => {
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

  describe("Validation matrix", () => {
    it("[FRS-4.1] SHALL reject a request with `q` entirely omitted with 400 VALIDATION_ERROR naming q", async () => {
      const { accessToken } = await createAuthedUser(
        "search-missing-q@example.com",
      );

      const res = await request(app)
        .get(SEARCH_ROOT)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      const issue = details.find((d) => d.path.includes("q"));
      expect(issue).toBeDefined();
    });

    it("[FRS-4.1, Error Scenarios] SHALL reject an empty-string `q` with 400 VALIDATION_ERROR (not 'match everything')", async () => {
      const { accessToken } = await createAuthedUser(
        "search-empty-q@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      const issue = details.find((d) => d.path.includes("q"));
      expect(issue).toBeDefined();
    });

    it("[FRS-4.1, Error Scenarios] SHALL reject a whitespace-only `q` with 400 VALIDATION_ERROR (not 'match everything')", async () => {
      const { accessToken } = await createAuthedUser(
        "search-whitespace-q@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "   " }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      const issue = details.find((d) => d.path.includes("q"));
      expect(issue).toBeDefined();
    });

    it("[FRS-4.3, FRS-2.3.1] SHALL reject page=0 (below the minimum of 1) with 400 VALIDATION_ERROR naming page", async () => {
      const { accessToken } = await createAuthedUser(
        "search-page-zero@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "notes", page: 0 }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      expect(details.find((d) => d.path.includes("page"))).toBeDefined();
    });

    it("[FRS-4.3, FRS-2.3.1] SHALL reject limit=0 (below the minimum of 1) with 400 VALIDATION_ERROR naming limit", async () => {
      const { accessToken } = await createAuthedUser(
        "search-limit-zero@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "notes", limit: 0 }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      expect(details.find((d) => d.path.includes("limit"))).toBeDefined();
    });

    it("[FRS-4.3, FRS-2.3.1] SHALL reject limit=101 (one over APP_LIMITS.PAGE_SIZE_MAX) with 400 VALIDATION_ERROR naming limit and the max", async () => {
      const { accessToken } = await createAuthedUser(
        "search-limit-over-max@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "notes", limit: APP_LIMITS.PAGE_SIZE_MAX + 1 }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      const issue = details.find((d) => d.path.includes("limit"));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain(String(APP_LIMITS.PAGE_SIZE_MAX));
    });

    it("[FRS-4.3] SHALL accept the exact boundary page=2&limit=APP_LIMITS.PAGE_SIZE_MAX and echo it back in pagination", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-valid-bounds@example.com",
      );
      await createNoteDirect(userId, {
        title: "Boundary Note",
        body: "content about boundary testing",
      });

      const res = await request(app)
        .get(
          searchUrl({
            q: "boundary",
            page: 2,
            limit: APP_LIMITS.PAGE_SIZE_MAX,
          }),
        )
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.pagination.page).toBe(2);
      expect(res.body.data.pagination.limit).toBe(APP_LIMITS.PAGE_SIZE_MAX);
    });

    it("[FRS-2.3.3] SHALL reject an invalid tagMode value with 400 VALIDATION_ERROR naming ALL/ANY", async () => {
      const { accessToken } = await createAuthedUser(
        "search-invalid-tag-mode@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "notes", tagMode: "SOME" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      const issue = details.find((d) => d.path.includes("tagMode"));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("ALL");
      expect(issue?.message).toContain("ANY");
    });

    it("[FRS-2.3.3] SHALL reject a malformed tagIds UUID token with 400 VALIDATION_ERROR naming tagIds", async () => {
      const { accessToken } = await createAuthedUser(
        "search-malformed-tag-id@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "notes", tagIds: "not-a-uuid" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      const details = res.body.error.details as Array<{
        path: string[];
        message: string;
      }>;
      expect(details.find((d) => d.path.includes("tagIds"))).toBeDefined();
    });

    it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
      const res = await request(app).get(searchUrl({ q: "notes" }));

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
    });
  });

  describe("Special-character query safety (Error Scenarios, FRS §4)", () => {
    it.each(["' OR 1=1 --", "foo & bar", '"; DROP TABLE notes; --'])(
      "[Error Scenarios FRS §4] SHALL treat %j as a safe literal-phrase query, returning 200 OK (never crashing or executing raw SQL)",
      async (rawQuery) => {
        const { accessToken } = await createAuthedUser(
          `search-special-${Buffer.from(rawQuery).toString("hex").slice(0, 12)}@example.com`,
        );

        const res = await request(app)
          .get(searchUrl({ q: rawQuery }))
          .set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.results)).toBe(true);

        // Proves the `notes` table was never dropped/mutated by the raw query string —
        // a genuinely injected `DROP TABLE notes` would make this follow-up query throw.
        await expect(prisma.note.count()).resolves.toEqual(expect.any(Number));
      },
    );
  });

  describe("Relevance ranking and Stage-1/Stage-2 trash + cross-user exclusion", () => {
    it("[FRS-4.5] SHALL rank a title-weighted match above a body-only match even when the body-only note is more recently updated", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-relevance@example.com",
      );
      const titleMatch = await createNoteDirect(userId, {
        title: "Full Text Search Architecture Overview",
        body: "This document has unrelated filler content.",
      });
      await new Promise((r) => setTimeout(r, 20));
      const bodyMatch = await createNoteDirect(userId, {
        title: "Weekly Standup Log",
        body: "We briefly discussed the architecture during the call.",
      });
      // bodyMatch is strictly more recently created/updated than titleMatch.
      expect(bodyMatch.updatedAt.getTime()).toBeGreaterThan(
        titleMatch.updatedAt.getTime(),
      );

      const res = await request(app)
        .get(searchUrl({ q: "architecture" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([titleMatch.id, bodyMatch.id]);
    });

    it("[SDS §7, ts_rank DESC, updated_at DESC] SHALL break relevance ties by updatedAt desc", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-tiebreak@example.com",
      );
      const first = await createNoteDirect(userId, {
        title: "Roadmap Planning",
        body: "Quarterly roadmap planning notes for the team.",
      });
      await new Promise((r) => setTimeout(r, 20));
      const second = await createNoteDirect(userId, {
        title: "Roadmap Planning",
        body: "Quarterly roadmap planning notes for the team.",
      });

      const res = await request(app)
        .get(searchUrl({ q: "roadmap planning" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([second.id, first.id]);
    });

    it("[FRS-4.4, FRS-8.1] SHALL never return another user's matching note (absent, no 403/404 leak)", async () => {
      const owner = await createAuthedUser("search-cross-owner@example.com");
      const other = await createAuthedUser("search-cross-other@example.com");
      await createNoteDirect(other.userId, {
        title: "Confidential Merger Plans",
        body: "Secret cross-user note about a merger.",
      });
      const ownNote = await createNoteDirect(owner.userId, {
        title: "My Merger Notes",
        body: "Personal note about the merger topic.",
      });

      const res = await request(app)
        .get(searchUrl({ q: "merger" }))
        .set("Authorization", `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([ownNote.id]);
      expect(res.body.data.pagination.total).toBe(1);
    });

    it("[FRS-2.2.3, FRS-8.1] SHALL exclude a Stage-1 trashed note (deletedAt 1 day ago) from both results and pagination.total", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-stage1-exclude@example.com",
      );
      const active = await createNoteDirect(userId, {
        title: "Active Quantum Notes",
        body: "quantum computing details",
      });
      await createNoteDirect(userId, {
        title: "Trashed Quantum Notes",
        body: "quantum computing details",
        deletedAt: daysAgo(1),
      });

      const res = await request(app)
        .get(searchUrl({ q: "quantum" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([active.id]);
      expect(res.body.data.pagination.total).toBe(1);
    });

    it("[FRS-2.2.3, FRS-8.1] SHALL exclude a Stage-2 trashed note (deletedAt 45 days ago) from both results and pagination.total", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-stage2-exclude@example.com",
      );
      const active = await createNoteDirect(userId, {
        title: "Active Nebula Notes",
        body: "nebula formation details",
      });
      await createNoteDirect(userId, {
        title: "Long Trashed Nebula Notes",
        body: "nebula formation details",
        deletedAt: daysAgo(45),
      });

      const res = await request(app)
        .get(searchUrl({ q: "nebula" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([active.id]);
      expect(res.body.data.pagination.total).toBe(1);
    });

    it("[FRS-2.2.3, FRS-8.1] SHALL exclude both a Stage-1 and a Stage-2 trashed note simultaneously from the same search", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-both-stages-exclude@example.com",
      );
      const active = await createNoteDirect(userId, {
        title: "Active Comet Notes",
        body: "comet trajectory details",
      });
      await createNoteDirect(userId, {
        title: "Stage1 Comet Notes",
        body: "comet trajectory details",
        deletedAt: daysAgo(1),
      });
      await createNoteDirect(userId, {
        title: "Stage2 Comet Notes",
        body: "comet trajectory details",
        deletedAt: daysAgo(45),
      });

      const res = await request(app)
        .get(searchUrl({ q: "comet" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([active.id]);
      expect(res.body.data.pagination.total).toBe(1);
    });
  });

  describe("Multi-word AND semantics and zero-match handling", () => {
    it("[FRS-4.1] SHALL, for q='meeting notes', only match notes containing both words", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-and-semantics@example.com",
      );
      const both = await createNoteDirect(userId, {
        title: "Weekly Sync",
        body: "Let's schedule a meeting and write down the notes afterwards.",
      });
      await createNoteDirect(userId, {
        title: "Meeting Only",
        body: "We had a long meeting today with no other details.",
      });
      await createNoteDirect(userId, {
        title: "Notes Only",
        body: "Just some standalone notes with nothing else relevant.",
      });

      const res = await request(app)
        .get(searchUrl({ q: "meeting notes" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([both.id]);
      expect(res.body.data.pagination.total).toBe(1);
    });

    it("[Error Scenarios FRS §4] SHALL return 200 OK with results: [] and pagination.total: 0 for a query matching nothing (never 404)", async () => {
      const { accessToken } = await createAuthedUser(
        "search-zero-match@example.com",
      );

      const res = await request(app)
        .get(searchUrl({ q: "zzznonexistentqueryword" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
      expect(res.body.data.pagination.totalPages).toBe(0);
    });
  });

  describe("[FRS-4.2, FRS-4.2.1] Snippet sentinel highlighting (XSS-safe)", () => {
    it("SHALL surround matched terms with [[[MARK]]]/[[[MARK_END]]] sentinels and contain zero HTML tags", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-snippet-sentinel@example.com",
      );
      await createNoteDirect(userId, {
        title: "Quarterly Review",
        body: "The quarterly architecture review meeting notes are attached.",
      });

      const res = await request(app)
        .get(searchUrl({ q: "architecture" }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const results = res.body.data.results as Array<{ snippet: string }>;
      expect(results).toHaveLength(1);
      expect(results[0]?.snippet).toContain("[[[MARK]]]");
      expect(results[0]?.snippet).toContain("[[[MARK_END]]]");

      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toMatch(/<mark[ >]/i);
      expect(rawBody).not.toMatch(/<b>/i);
      expect(rawBody).not.toMatch(/<[a-z][\s\S]*>/i);
    });
  });

  describe("[FRS-2.3.5, FRS-2.3.3] tagIds/tagMode combined with q", () => {
    it("[FRS-2.3.3] SHALL, under tagMode=ALL, only return a query-matching note that bears every listed tagId", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-tag-all@example.com",
      );
      const tagWork = await createTagDirect(userId, "Work");
      const tagUrgent = await createTagDirect(userId, "Urgent");
      const bothTags = await createNoteDirect(userId, {
        title: "Project Kickoff",
        body: "project kickoff planning details",
      });
      await attachTagDirect(bothTags.id, tagWork.id);
      await attachTagDirect(bothTags.id, tagUrgent.id);
      const oneTag = await createNoteDirect(userId, {
        title: "Project Kickoff Two",
        body: "project kickoff planning details",
      });
      await attachTagDirect(oneTag.id, tagWork.id);

      const res = await request(app)
        .get(
          searchUrl({
            q: "kickoff",
            tagIds: `${tagWork.id},${tagUrgent.id}`,
            tagMode: "ALL",
          }),
        )
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(ids).toEqual([bothTags.id]);
    });

    it("[FRS-2.3.3] SHALL, under tagMode=ANY, return query-matching notes bearing at least one listed tagId", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-tag-any@example.com",
      );
      const tagWork = await createTagDirect(userId, "Work");
      const tagUrgent = await createTagDirect(userId, "Urgent");
      const workNote = await createNoteDirect(userId, {
        title: "Deploy Checklist Work",
        body: "deploy checklist details",
      });
      await attachTagDirect(workNote.id, tagWork.id);
      const urgentNote = await createNoteDirect(userId, {
        title: "Deploy Checklist Urgent",
        body: "deploy checklist details",
      });
      await attachTagDirect(urgentNote.id, tagUrgent.id);
      const untaggedNote = await createNoteDirect(userId, {
        title: "Deploy Checklist None",
        body: "deploy checklist details",
      });

      const res = await request(app)
        .get(
          searchUrl({
            q: "deploy checklist",
            tagIds: `${tagWork.id},${tagUrgent.id}`,
            tagMode: "ANY",
          }),
        )
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.results as Array<{ id: string }>)
        .map((r) => r.id)
        .sort();
      expect(ids).toEqual([urgentNote.id, workNote.id].sort());
      expect(ids).not.toContain(untaggedNote.id);
    });

    it("[Resolved Decision #1, mirrors FRS-2.3.3] SHALL narrow to zero results (200 OK, never 403/404) when a well-formed tagId is foreign to the caller", async () => {
      const owner = await createAuthedUser(
        "search-tag-foreign-owner@example.com",
      );
      const other = await createAuthedUser(
        "search-tag-foreign-other@example.com",
      );
      const foreignTag = await createTagDirect(other.userId, "Foreign");
      await createNoteDirect(owner.userId, {
        title: "Owner Budget Notes",
        body: "budget planning details",
      });

      const res = await request(app)
        .get(searchUrl({ q: "budget", tagIds: foreignTag.id, tagMode: "ANY" }))
        .set("Authorization", `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it("[Resolved Decision #1, mirrors FRS-2.3.3] SHALL narrow to zero results (200 OK, never 403/404) when a well-formed tagId matches no Tag row at all", async () => {
      const { userId, accessToken } = await createAuthedUser(
        "search-tag-nonexistent@example.com",
      );
      await createNoteDirect(userId, {
        title: "Owner Budget Notes",
        body: "budget planning details",
      });
      const nonexistentTagId = "99999999-9999-4999-8999-999999999999";

      const res = await request(app)
        .get(searchUrl({ q: "budget", tagIds: nonexistentTagId }))
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });
  });
});
