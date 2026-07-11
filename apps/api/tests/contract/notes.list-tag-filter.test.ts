import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  attachTagDirect,
  createAuthedUser,
  createNoteDirect,
  createTagDirect,
  ROUTES,
} from "../helpers/notes.js";
import { resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.3.3] GET /api/v1/notes — tagIds/tagMode filtering", () => {
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

  it("[FRS-2.3.3] SHALL, under tagMode=ALL (explicit), return only notes bearing every one of the listed tagIds", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "tag-mode-all-explicit@example.com",
    );
    const tagWork = await createTagDirect(userId, "Work");
    const tagUrgent = await createTagDirect(userId, "Urgent");
    const noteBoth = await createNoteDirect(userId, { title: "Both Tags" });
    await attachTagDirect(noteBoth.id, tagWork.id);
    await attachTagDirect(noteBoth.id, tagUrgent.id);
    const noteWorkOnly = await createNoteDirect(userId, { title: "Work Only" });
    await attachTagDirect(noteWorkOnly.id, tagWork.id);

    const res = await request(app)
      .get(
        `${ROUTES.NOTES_ROOT}?tagIds=${tagWork.id},${tagUrgent.id}&tagMode=ALL`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([noteBoth.id]);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it("[FRS-2.3.3, Resolved Decision] SHALL default to tagMode=ALL when tagMode is omitted, behaving identically to an explicit ALL", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "tag-mode-omitted@example.com",
    );
    const tagWork = await createTagDirect(userId, "Work");
    const tagUrgent = await createTagDirect(userId, "Urgent");
    const noteBoth = await createNoteDirect(userId, { title: "Both Tags" });
    await attachTagDirect(noteBoth.id, tagWork.id);
    await attachTagDirect(noteBoth.id, tagUrgent.id);
    const noteWorkOnly = await createNoteDirect(userId, { title: "Work Only" });
    await attachTagDirect(noteWorkOnly.id, tagWork.id);

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?tagIds=${tagWork.id},${tagUrgent.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([noteBoth.id]);
  });

  it("[FRS-2.3.3] SHALL, under tagMode=ANY, return notes bearing at least one of the listed tagIds", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "tag-mode-any@example.com",
    );
    const tagWork = await createTagDirect(userId, "Work");
    const tagUrgent = await createTagDirect(userId, "Urgent");
    const tagPersonal = await createTagDirect(userId, "Personal");
    const noteWork = await createNoteDirect(userId, { title: "Work Note" });
    await attachTagDirect(noteWork.id, tagWork.id);
    const noteUrgent = await createNoteDirect(userId, {
      title: "Urgent Note",
    });
    await attachTagDirect(noteUrgent.id, tagUrgent.id);
    const notePersonal = await createNoteDirect(userId, {
      title: "Personal Note",
    });
    await attachTagDirect(notePersonal.id, tagPersonal.id);

    const res = await request(app)
      .get(
        `${ROUTES.NOTES_ROOT}?tagIds=${tagWork.id},${tagUrgent.id}&tagMode=ANY`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids.sort()).toEqual([noteUrgent.id, noteWork.id].sort());
    expect(res.body.data.pagination.total).toBe(2);
  });

  it("[FRS-2.3.3] SHALL reject an invalid tagMode value with 400 VALIDATION_ERROR naming ALL/ANY", async () => {
    const { accessToken } = await createAuthedUser(
      "tag-mode-invalid@example.com",
    );

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?tagMode=SOME`)
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

  it("[FRS-2.3.3] SHALL reject a tagIds token that fails UUID format with 400 VALIDATION_ERROR naming tagIds, and execute no query", async () => {
    const { accessToken } = await createAuthedUser(
      "tag-ids-non-uuid@example.com",
    );

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?tagIds=not-a-uuid`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{
      path: string[];
      message: string;
    }>;
    const issue = details.find((d) => d.path.includes("tagIds"));
    expect(issue).toBeDefined();
  });

  it("[FRS-2.3.3] SHALL reject tagIds when only one comma-separated token is malformed, even if the sibling tokens are valid UUIDs", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "tag-ids-mixed@example.com",
    );
    const tag = await createTagDirect(userId, "Work");

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?tagIds=${tag.id},not-a-uuid`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  it("[FRS-2.3.3, Resolved Decision #1] SHALL return 200 OK with zero matches (not an error) when a well-formed tagId belongs to another user's tag", async () => {
    const owner = await createAuthedUser("tag-foreign-owner@example.com");
    const other = await createAuthedUser("tag-foreign-other@example.com");
    const otherTag = await createTagDirect(other.userId, "OtherUserTag");
    await createNoteDirect(owner.userId, { title: "Owner Note" });

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?tagIds=${otherTag.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toHaveLength(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it("[FRS-2.3.3, Resolved Decision #1] SHALL return 200 OK with zero matches (not an error) when a well-formed tagId matches no Tag row at all", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "tag-nonexistent@example.com",
    );
    await createNoteDirect(userId, { title: "Owner Note" });
    const nonexistentTagId = "99999999-9999-4999-8999-999999999999";

    const res = await request(app)
      .get(`${ROUTES.NOTES_ROOT}?tagIds=${nonexistentTagId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toHaveLength(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it("[FRS-2.3.3, Resolved Decision #1] SHALL narrow tagMode=ANY to only the matching criterion's notes when one tagId token is foreign/nonexistent and the other is valid", async () => {
    const owner = await createAuthedUser("tag-any-partial-owner@example.com");
    const other = await createAuthedUser("tag-any-partial-other@example.com");
    const ownTag = await createTagDirect(owner.userId, "Own");
    const foreignTag = await createTagDirect(other.userId, "Foreign");
    const ownNote = await createNoteDirect(owner.userId, {
      title: "Own Tagged Note",
    });
    await attachTagDirect(ownNote.id, ownTag.id);

    const res = await request(app)
      .get(
        `${ROUTES.NOTES_ROOT}?tagIds=${ownTag.id},${foreignTag.id}&tagMode=ANY`,
      )
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([ownNote.id]);
  });
});
