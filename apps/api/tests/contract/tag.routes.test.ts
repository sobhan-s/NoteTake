import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, API_PATHS, APP_LIMITS } from "@shared/core/constants";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  createTagDirect,
  attachTagDirect,
  daysAgo,
  ROUTES as NOTE_ROUTES,
} from "../helpers/notes.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const TAGS_ROOT = `${API_PATHS.BASE}${API_PATHS.TAGS.ROOT}`;
const tagById = (id: string): string => `${TAGS_ROOT}/${id}`;

describe("[FRS-3.1] POST /api/v1/tags — Create Tag (Fly Tag Creation)", () => {
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

  it("[FRS-3.1] SHALL create a tag scoped to the caller with an explicit color, returning 201 { id, name, color, noteCount: 0, createdAt, updatedAt }", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "create-explicit-color@example.com",
    );

    const res = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "DevOps", color: "#3B82F6" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: "DevOps",
      color: "#3B82F6",
      noteCount: 0,
    });
    expect(res.body.data).not.toHaveProperty("userId");
    expect(res.body.data.createdAt).toMatch(/Z$/);
    expect(res.body.data.updatedAt).toMatch(/Z$/);

    const row = await prisma.tag.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row?.userId).toBe(userId);
    expect(row?.name).toBe("DevOps");
    expect(row?.color).toBe("#3B82F6");
  });

  it("[Resolved Decision #3] SHALL default `color` to APP_LIMITS.TAG_DEFAULT_COLOR when the field is omitted", async () => {
    const { accessToken } = await createAuthedUser(
      "create-default-color@example.com",
    );

    const res = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Ideas" });

    expect(res.status).toBe(201);
    expect(res.body.data.color).toBe(APP_LIMITS.TAG_DEFAULT_COLOR);
  });

  it("[FRS-3.1] SHALL reject an empty-string name with 400 VALIDATION_ERROR naming `name`, creating no row", async () => {
    const { accessToken } = await createAuthedUser(
      "create-empty-name@example.com",
    );

    const res = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("name"),
      ),
    ).toBe(true);
    expect(await prisma.tag.count()).toBe(0);
  });

  it("[FRS-3.1] SHALL reject a whitespace-only name with 400 VALIDATION_ERROR naming `name`", async () => {
    const { accessToken } = await createAuthedUser(
      "create-whitespace-name@example.com",
    );

    const res = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("name"),
      ),
    ).toBe(true);
  });

  it("[Resolved Decision #2] SHALL accept a name of exactly APP_LIMITS.TAG_NAME_MAX_CHARS characters", async () => {
    const { accessToken } = await createAuthedUser(
      "create-name-max@example.com",
    );
    const name = "A".repeat(APP_LIMITS.TAG_NAME_MAX_CHARS);

    const res = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toHaveLength(APP_LIMITS.TAG_NAME_MAX_CHARS);
  });

  it("[Resolved Decision #2] SHALL reject a name of APP_LIMITS.TAG_NAME_MAX_CHARS + 1 characters with 400 VALIDATION_ERROR naming `name` and the limit", async () => {
    const { accessToken } = await createAuthedUser(
      "create-name-over@example.com",
    );
    const name = "A".repeat(APP_LIMITS.TAG_NAME_MAX_CHARS + 1);

    const res = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{
      path: string[];
      message: string;
    }>;
    const issue = details.find((d) => d.path.includes("name"));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(String(APP_LIMITS.TAG_NAME_MAX_CHARS));
    expect(await prisma.tag.count()).toBe(0);
  });

  it.each([["blue"], ["#fff"], ["#abcde"], ["aabbcc"], ["#abcdefa"]])(
    "[FRS-3.1] SHALL reject malformed color %s with 400 VALIDATION_ERROR naming `color`",
    async (color) => {
      const { accessToken } = await createAuthedUser(
        `create-bad-color-${Buffer.from(color).toString("hex")}@example.com`,
      );

      const res = await request(app)
        .post(TAGS_ROOT)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Work", color });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
      expect(
        (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
          issue.path.includes("color"),
        ),
      ).toBe(true);
    },
  );

  it.each([["WORK"], ["work"]])(
    '[FRS-3.4] SHALL reject %s as a duplicate of the caller\'s own existing tag "Work" with 409 TAG_NAME_CONFLICT, creating no new row',
    async (duplicateName) => {
      const { accessToken } = await createAuthedUser(
        `create-duplicate-${duplicateName}@example.com`,
      );
      await request(app)
        .post(TAGS_ROOT)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Work" })
        .expect(201);

      const res = await request(app)
        .post(TAGS_ROOT)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: duplicateName });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NAME_CONFLICT);
      expect(await prisma.tag.count()).toBe(1);
    },
  );

  it("[Resolved Decision #1] SHALL leave the caller's existing tag completely untouched after a rejected duplicate-name POST", async () => {
    const { accessToken } = await createAuthedUser(
      "create-duplicate-untouched@example.com",
    );
    const original = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Work", color: "#111111" })
      .expect(201);

    await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "WORK", color: "#222222" })
      .expect(409);

    const row = await prisma.tag.findUnique({
      where: { id: original.body.data.id },
    });
    expect(row?.name).toBe("Work");
    expect(row?.color).toBe("#111111");
  });

  it("[FRS-3.4] SHALL allow the same tag name across two different users, both succeeding with 201", async () => {
    const userA = await createAuthedUser("create-same-name-a@example.com");
    const userB = await createAuthedUser("create-same-name-b@example.com");

    const resA = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .send({ name: "Work" });
    const resB = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${userB.accessToken}`)
      .send({ name: "Work" });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.data.id).not.toBe(resB.body.data.id);
    expect(await prisma.tag.count()).toBe(2);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED and create no row when no Authorization header is present", async () => {
    const res = await request(app)
      .post(TAGS_ROOT)
      .send({ name: "Should not persist" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
    expect(await prisma.tag.count()).toBe(0);
  });
});

describe("[FRS-3.2] GET /api/v1/tags — List Tags With Live Note Counts", () => {
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

  it("[Resolved Decision #4] SHALL return the caller's own tags ordered alphabetically, case-insensitively", async () => {
    const { accessToken } = await createAuthedUser("list-order@example.com");
    for (const name of ["Zeta", "apple", "Mango"]) {
      await request(app)
        .post(TAGS_ROOT)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name })
        .expect(201);
    }

    const res = await request(app)
      .get(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const names = (res.body.data.tags as Array<{ name: string }>).map(
      (t) => t.name,
    );
    expect(names).toEqual(["apple", "Mango", "Zeta"]);
  });

  it("[FRS-3.1] SHALL return `{ tags: [] }`, not an error, when the caller has never created a tag", async () => {
    const { accessToken } = await createAuthedUser("list-empty@example.com");

    const res = await request(app)
      .get(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ tags: [] });
  });

  it("[FRS-8.1] SHALL exclude another user's tags entirely from the caller's list", async () => {
    const owner = await createAuthedUser("list-owner@example.com");
    const other = await createAuthedUser("list-other@example.com");
    await createTagDirect(other.userId, "Other User Tag");
    const ownTag = await createTagDirect(owner.userId, "Owner Tag");

    const res = await request(app)
      .get(TAGS_ROOT)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data.tags as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual([ownTag.id]);
  });

  it("[FRS-3.2] SHALL compute noteCount excluding a note currently in Trash (Stage 1 or Stage 2), counting only active notes", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-notecount-excludes-trash@example.com",
    );
    const tag = await createTagDirect(userId, "Project");
    const activeOne = await createNoteDirect(userId, { title: "Active One" });
    const activeTwo = await createNoteDirect(userId, { title: "Active Two" });
    const trashed = await createNoteDirect(userId, {
      title: "Trashed",
      deletedAt: daysAgo(1),
    });
    await attachTagDirect(activeOne.id, tag.id);
    await attachTagDirect(activeTwo.id, tag.id);
    await attachTagDirect(trashed.id, tag.id);

    const res = await request(app)
      .get(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const found = (
      res.body.data.tags as Array<{ id: string; noteCount: number }>
    ).find((t) => t.id === tag.id);
    expect(found?.noteCount).toBe(2);
  });

  it("[FRS-3.2] SHALL reflect noteCount live across the tag -> trash -> restore -> untag lifecycle with no caching lag", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "list-notecount-lifecycle@example.com",
    );
    const tagRes = await request(app)
      .post(TAGS_ROOT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Lifecycle" });
    const tagId = tagRes.body.data.id as string;
    const note = await createNoteDirect(userId, { title: "Lifecycle Note" });

    async function getNoteCount(): Promise<number> {
      const listRes = await request(app)
        .get(TAGS_ROOT)
        .set("Authorization", `Bearer ${accessToken}`);
      const found = (
        listRes.body.data.tags as Array<{ id: string; noteCount: number }>
      ).find((t) => t.id === tagId);
      return found?.noteCount ?? -1;
    }

    // 1. Tag the note -> count 1
    await attachTagDirect(note.id, tagId);
    expect(await getNoteCount()).toBe(1);

    // 2. Trash it (real soft-delete endpoint) -> count 0
    await request(app)
      .delete(NOTE_ROUTES.noteById(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(await getNoteCount()).toBe(0);

    // 3. Restore it (real restore endpoint) -> count 1
    await request(app)
      .post(NOTE_ROUTES.restore(note.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(await getNoteCount()).toBe(1);

    // 4. Untag it -> count 0
    await prisma.noteTag.delete({
      where: { noteId_tagId: { noteId: note.id, tagId } },
    });
    expect(await getNoteCount()).toBe(0);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const res = await request(app).get(TAGS_ROOT);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});

describe("[FRS-3.1, FRS-3.4] PATCH /api/v1/tags/:id — Rename / Recolor Tag", () => {
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

  it("[FRS-3.1] SHALL rename only, returning 200 with the new name and unchanged color", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-rename-only@example.com",
    );
    const tag = await createTagDirect(userId, "Work");

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Personal" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Personal");
    expect(res.body.data.color).toBe(tag.color);
  });

  it("[FRS-3.1] SHALL recolor only, returning 200 with the new color and unchanged name", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-recolor-only@example.com",
    );
    const tag = await createTagDirect(userId, "Work");

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ color: "#EF4444" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Work");
    expect(res.body.data.color).toBe("#EF4444");
  });

  it("[FRS-3.1] SHALL update both name and color atomically in one 200 response", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-both@example.com",
    );
    const tag = await createTagDirect(userId, "Work");

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Personal", color: "#EF4444" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Personal");
    expect(res.body.data.color).toBe("#EF4444");
  });

  it("[FRS-3.1] SHALL reject an empty `{}` body with 400 VALIDATION_ERROR (TAG_UPDATE_EMPTY), issuing no update query", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-empty-body@example.com",
    );
    const tag = await createTagDirect(userId, "Work");

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);

    const row = await prisma.tag.findUnique({ where: { id: tag.id } });
    expect(row?.updatedAt.getTime()).toBe(tag.updatedAt.getTime());
  });

  it("[FRS-3.4] SHALL reject renaming to a name owned by a different tag of the same user with 409 TAG_NAME_CONFLICT, leaving the target tag unchanged", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-rename-conflict@example.com",
    );
    await createTagDirect(userId, "Work");
    const personal = await createTagDirect(userId, "Personal");

    const res = await request(app)
      .patch(tagById(personal.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "WORK" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NAME_CONFLICT);

    const row = await prisma.tag.findUnique({ where: { id: personal.id } });
    expect(row?.name).toBe("Personal");
  });

  it.each([["work"], ["Work"]])(
    '[Resolved Decision #7] SHALL succeed (200) renaming a tag to its own current name/case-variant "%s", since the uniqueness check excludes the tag\'s own id',
    async (newName) => {
      const { userId, accessToken } = await createAuthedUser(
        `patch-self-rename-${newName}@example.com`,
      );
      const tag = await createTagDirect(userId, "Work");

      const res = await request(app)
        .patch(tagById(tag.id))
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: newName });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe(newName);
    },
  );

  it("[FRS-3.4] SHALL return 404 TAG_NOT_FOUND (never 403) when PATCHing a tag id owned by a different user, leaving it untouched", async () => {
    const owner = await createAuthedUser("patch-cross-user-owner@example.com");
    const attacker = await createAuthedUser(
      "patch-cross-user-attacker@example.com",
    );
    const tag = await createTagDirect(owner.userId, "Secret");

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({ name: "Hijacked" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);

    const row = await prisma.tag.findUnique({ where: { id: tag.id } });
    expect(row?.name).toBe("Secret");
  });

  it("[FRS-3.4] SHALL return 404 TAG_NOT_FOUND when PATCHing a well-formed UUID matching no Tag row at all", async () => {
    const { accessToken } = await createAuthedUser(
      "patch-nonexistent@example.com",
    );

    const res = await request(app)
      .patch(tagById("00000000-0000-4000-8000-000000000000"))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);
  });

  it("[FRS-3.1] SHALL reject a malformed color on update with 400 VALIDATION_ERROR naming `color`, identical to create", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-bad-color@example.com",
    );
    const tag = await createTagDirect(userId, "Work");

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ color: "not-a-color" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      (res.body.error.details as Array<{ path: string[] }>).some((issue) =>
        issue.path.includes("color"),
      ),
    ).toBe(true);
  });

  it("[Resolved Decision #2] SHALL reject a name of APP_LIMITS.TAG_NAME_MAX_CHARS + 1 characters on update with 400 VALIDATION_ERROR naming `name` and the limit", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "patch-name-over@example.com",
    );
    const tag = await createTagDirect(userId, "Work");
    const name = "A".repeat(APP_LIMITS.TAG_NAME_MAX_CHARS + 1);

    const res = await request(app)
      .patch(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    const details = res.body.error.details as Array<{
      path: string[];
      message: string;
    }>;
    const issue = details.find((d) => d.path.includes("name"));
    expect(issue?.message).toContain(String(APP_LIMITS.TAG_NAME_MAX_CHARS));
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const res = await request(app)
      .patch(tagById("00000000-0000-4000-8000-000000000000"))
      .send({ name: "Nope" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});

describe("[FRS-3.3, FRS-3.4] DELETE /api/v1/tags/:id — Delete Tag (Detach Without Deleting Notes)", () => {
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

  it("[FRS-3.3] SHALL detach the tag from every attached note (cascading the NoteTag join rows) while leaving each note's title/body/other tags/deletedAt/timestamps completely unchanged", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "delete-detach-intact@example.com",
    );
    const tagToDelete = await createTagDirect(userId, "ToDelete");
    const survivingTag = await createTagDirect(userId, "Survives");
    const note = await createNoteDirect(userId, {
      title: "Untouched Title",
      body: "Untouched body content.",
    });
    await attachTagDirect(note.id, tagToDelete.id);
    await attachTagDirect(note.id, survivingTag.id);
    const beforeNote = await prisma.note.findUniqueOrThrow({
      where: { id: note.id },
    });

    const res = await request(app)
      .delete(tagById(tagToDelete.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: tagToDelete.id });

    const remainingJoins = await prisma.noteTag.findMany({
      where: { noteId: note.id },
    });
    expect(remainingJoins.map((j) => j.tagId)).toEqual([survivingTag.id]);

    const afterNote = await prisma.note.findUniqueOrThrow({
      where: { id: note.id },
    });
    expect(afterNote.title).toBe(beforeNote.title);
    expect(afterNote.body).toBe(beforeNote.body);
    expect(afterNote.deletedAt).toBe(beforeNote.deletedAt);
    expect(afterNote.createdAt.getTime()).toBe(beforeNote.createdAt.getTime());
    expect(afterNote.updatedAt.getTime()).toBe(beforeNote.updatedAt.getTime());

    const tagRow = await prisma.tag.findUnique({
      where: { id: tagToDelete.id },
    });
    expect(tagRow).toBeNull();
  });

  it("[FRS-3.3] SHALL still succeed detaching a tag attached to a note currently in Trash (Stage 1 or Stage 2), irrespective of trash state", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "delete-attached-to-trashed@example.com",
    );
    const tag = await createTagDirect(userId, "Trashed Tag");
    const stage1Note = await createNoteDirect(userId, {
      title: "Stage1",
      deletedAt: daysAgo(1),
    });
    const stage2Note = await createNoteDirect(userId, {
      title: "Stage2",
      deletedAt: daysAgo(45),
    });
    await attachTagDirect(stage1Note.id, tag.id);
    await attachTagDirect(stage2Note.id, tag.id);

    const res = await request(app)
      .delete(tagById(tag.id))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const remainingJoins = await prisma.noteTag.findMany({
      where: { tagId: tag.id },
    });
    expect(remainingJoins).toHaveLength(0);
  });

  it("[FRS-3.4] SHALL return 404 TAG_NOT_FOUND (never 403) when deleting another user's tag, leaving it and its attachments untouched", async () => {
    const owner = await createAuthedUser("delete-cross-user-owner@example.com");
    const attacker = await createAuthedUser(
      "delete-cross-user-attacker@example.com",
    );
    const tag = await createTagDirect(owner.userId, "Secret");
    const note = await createNoteDirect(owner.userId, { title: "Owner Note" });
    await attachTagDirect(note.id, tag.id);

    const res = await request(app)
      .delete(tagById(tag.id))
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);

    const tagRow = await prisma.tag.findUnique({ where: { id: tag.id } });
    expect(tagRow).not.toBeNull();
    const joinRow = await prisma.noteTag.findUnique({
      where: { noteId_tagId: { noteId: note.id, tagId: tag.id } },
    });
    expect(joinRow).not.toBeNull();
  });

  it("[FRS-3.4] SHALL return 404 TAG_NOT_FOUND when deleting a well-formed UUID matching no Tag row at all", async () => {
    const { accessToken } = await createAuthedUser(
      "delete-nonexistent@example.com",
    );

    const res = await request(app)
      .delete(tagById("00000000-0000-4000-8000-000000000000"))
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(API_ERROR_CODES.TAG_NOT_FOUND);
  });

  it("[FRS-8.6] SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const res = await request(app).delete(
      tagById("00000000-0000-4000-8000-000000000000"),
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
