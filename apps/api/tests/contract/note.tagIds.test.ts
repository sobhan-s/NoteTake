import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  createTagDirect,
  ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-3.1, FRS-3.4, SDS §4.1] tagIds ownership verification & full-replace semantics on notes create/update", () => {
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

  it("[FRS-3.4] POST /api/v1/notes SHALL reject with 403 TAG_NOT_FOUND when tagIds includes an id that does not belong to the caller, and SHALL persist no Note row at all", async () => {
    const owner = await createAuthedUser("post-tag-owner@example.com");
    const stranger = await createAuthedUser("post-tag-stranger@example.com");
    const strangersTag = await createTagDirect(stranger.userId, "Stranger Tag");

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "Should not persist",
        body: "body",
        tagIds: [strangersTag.id],
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  it("[FRS-3.4] POST /api/v1/notes SHALL reject with 403 TAG_NOT_FOUND when tagIds includes an id that does not exist at all", async () => {
    const owner = await createAuthedUser("post-tag-nonexistent@example.com");
    const nonExistentTagId = "00000000-0000-4000-8000-000000000000";

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "Should not persist either",
        body: "body",
        tagIds: [nonExistentTagId],
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  it("[FRS-3.1] POST /api/v1/notes SHALL return 201 with `tags` populated in the same response body when tagIds references tags owned by the caller (no separate round trip)", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "post-tag-success@example.com",
    );
    const tagA = await createTagDirect(userId, "Work");
    const tagB = await createTagDirect(userId, "Ideas");

    const res = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        title: "Tagged on create",
        body: "body",
        tagIds: [tagA.id, tagB.id],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const tagIdsInResponse = (
      res.body.data.tags as { id: string; name: string; color: string }[]
    ).map((t) => t.id);
    expect(tagIdsInResponse.sort()).toEqual([tagA.id, tagB.id].sort());
    const workTag = (
      res.body.data.tags as { id: string; name: string; color: string }[]
    ).find((t) => t.id === tagA.id);
    expect(workTag).toMatchObject({ id: tagA.id, name: "Work" });
  });

  it("[FRS-3.4] PATCH /api/v1/notes/:id SHALL reject with 403 TAG_NOT_FOUND when tagIds includes a foreign tag id, and SHALL leave the note's title/body unmodified (no partial update persisted)", async () => {
    const owner = await createAuthedUser("patch-tag-owner@example.com");
    const stranger = await createAuthedUser("patch-tag-stranger@example.com");
    const strangersTag = await createTagDirect(
      stranger.userId,
      "Stranger Tag 2",
    );
    const note = await createNoteDirect(owner.userId, {
      title: "Untouched Title",
      body: "Untouched Body",
    });

    const patchRes = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "Hijacked Title",
        body: "Hijacked Body",
        tagIds: [strangersTag.id],
      });

    expect(patchRes.status).toBe(403);
    expect(patchRes.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);

    const getRes = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.title).toBe("Untouched Title");
    expect(getRes.body.data.body).toBe("Untouched Body");
    expect(getRes.body.data.tags).toEqual([]);
  });

  it("[SDS §4.1] PATCH /api/v1/notes/:id SHALL fully replace the note's tag set: attaching set A then a different set B via a second update SHALL leave only B's tags visible on a follow-up GET", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "full-replace@example.com",
    );
    const tagA = await createTagDirect(userId, "Set A Tag");
    const tagB = await createTagDirect(userId, "Set B Tag");
    const note = await createNoteDirect(userId, { title: "Replace Me" });

    const firstUpdate = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ tagIds: [tagA.id] });
    expect(firstUpdate.status).toBe(200);
    expect(
      (firstUpdate.body.data.tags as { id: string }[]).map((t) => t.id),
    ).toEqual([tagA.id]);

    const secondUpdate = await request(app)
      .patch(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ tagIds: [tagB.id] });
    expect(secondUpdate.status).toBe(200);
    expect(
      (secondUpdate.body.data.tags as { id: string }[]).map((t) => t.id),
    ).toEqual([tagB.id]);

    const getRes = await request(app)
      .get(ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    const finalTagIds = (getRes.body.data.tags as { id: string }[]).map(
      (t) => t.id,
    );
    expect(finalTagIds).toEqual([tagB.id]);

    const remainingJoinRows = await prisma.noteTag.findMany({
      where: { noteId: note.id },
    });
    expect(remainingJoinRows).toHaveLength(1);
    expect(remainingJoinRows[0]?.tagId).toBe(tagB.id);
    const tagAJoinRow = await prisma.noteTag.findUnique({
      where: { noteId_tagId: { noteId: note.id, tagId: tagA.id } },
    });
    expect(tagAJoinRow).toBeNull();
  });

  it("[FRS-6.1] PATCH /api/v1/notes/:id with only tagIds (title and body both omitted) SHALL create zero new NoteVersion rows", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "tag-only-no-version@example.com",
    );
    const createRes = await request(app)
      .post(ROUTES.NOTES_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Version Baseline Note", body: "v1 body" });
    const noteId = createRes.body.data.id as string;
    const tag = await createTagDirect(userId, "Solo Tag");

    const versionsBefore = await prisma.noteVersion.findMany({
      where: { noteId },
    });
    expect(versionsBefore).toHaveLength(1);

    const res = await request(app)
      .patch(ROUTES.noteById(noteId))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ tagIds: [tag.id] });

    expect(res.status).toBe(200);
    expect((res.body.data.tags as { id: string }[]).map((t) => t.id)).toEqual([
      tag.id,
    ]);

    const versionsAfter = await prisma.noteVersion.findMany({
      where: { noteId },
    });
    expect(versionsAfter).toHaveLength(1);
    expect(versionsAfter[0]?.id).toBe(versionsBefore[0]?.id);
  });
});
