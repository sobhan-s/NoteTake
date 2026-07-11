import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Tag } from "@prisma/client";
import { createTagSchema, updateTagSchema } from "@shared/core/schemas";
import {
  API_ERROR_CODES,
  APP_LIMITS,
  VALIDATION_MESSAGES,
} from "@shared/core/constants";
import { AppError } from "../../src/errors/app-error.js";

vi.mock("../../src/repositories/tag.repository.js", () => ({
  createTag: vi.fn(),
  findTagByIdForUser: vi.fn(),
  findTagByNameForUser: vi.fn(),
  listTagsForUser: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

import * as tagRepository from "../../src/repositories/tag.repository.js";
import type { TagWithNoteCount } from "../../src/repositories/tag.repository.js";
import * as tagService from "../../src/services/tag.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const TAG_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TAG_ID = "44444444-4444-4444-8444-444444444444";

function buildTag(
  overrides: Partial<Tag> & { noteCount?: number } = {},
): TagWithNoteCount {
  const { noteCount, ...tagOverrides } = overrides;
  return {
    id: TAG_ID,
    userId: USER_ID,
    name: "Work",
    color: APP_LIMITS.TAG_DEFAULT_COLOR,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...tagOverrides,
    _count: { noteTags: noteCount ?? 0 },
  } as unknown as TagWithNoteCount;
}

function buildP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

describe("[FRS-3.1, FRS-3.4] tag.schema — createTagSchema/updateTagSchema pre-service Zod boundary", () => {
  it("[FRS-3.1] createTagSchema SHALL accept a valid name with an explicit color", () => {
    const res = createTagSchema.safeParse({ name: "DevOps", color: "#3B82F6" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ name: "DevOps", color: "#3B82F6" });
    }
  });

  it("[Resolved Decision #3] createTagSchema SHALL default `color` to APP_LIMITS.TAG_DEFAULT_COLOR when omitted", () => {
    const res = createTagSchema.safeParse({ name: "Ideas" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.color).toBe(APP_LIMITS.TAG_DEFAULT_COLOR);
    }
  });

  it("[FRS-3.1] createTagSchema SHALL reject an empty-string name", () => {
    const res = createTagSchema.safeParse({ name: "" });
    expect(res.success).toBe(false);
  });

  it("[FRS-3.1] createTagSchema SHALL reject a whitespace-only name after trim", () => {
    const res = createTagSchema.safeParse({ name: "   " });
    expect(res.success).toBe(false);
  });

  it("[Resolved Decision #2] createTagSchema SHALL accept a name of exactly APP_LIMITS.TAG_NAME_MAX_CHARS characters", () => {
    const res = createTagSchema.safeParse({
      name: "A".repeat(APP_LIMITS.TAG_NAME_MAX_CHARS),
    });
    expect(res.success).toBe(true);
  });

  it("[Resolved Decision #2] createTagSchema SHALL reject a name of APP_LIMITS.TAG_NAME_MAX_CHARS + 1 characters", () => {
    const res = createTagSchema.safeParse({
      name: "A".repeat(APP_LIMITS.TAG_NAME_MAX_CHARS + 1),
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const nameIssue = res.error.issues.find((i) => i.path.includes("name"));
      expect(nameIssue?.message).toContain(
        String(APP_LIMITS.TAG_NAME_MAX_CHARS),
      );
    }
  });

  it.each([
    ["blue", "no leading # and not hex at all"],
    ["#fff", "3-digit hex (too short)"],
    ["#abcde", "5-digit hex (odd length)"],
    ["aabbcc", "missing leading #"],
    ["#abcdefa", "7-digit hex (between the two valid lengths)"],
  ])(
    "[FRS-3.1] createTagSchema SHALL reject malformed color %s (%s)",
    (color) => {
      const res = createTagSchema.safeParse({ name: "Work", color });
      expect(res.success).toBe(false);
      if (!res.success) {
        const colorIssue = res.error.issues.find((i) =>
          i.path.includes("color"),
        );
        expect(colorIssue).toBeDefined();
      }
    },
  );

  it("[FRS-3.1] updateTagSchema SHALL reject an empty `{}` body with TAG_UPDATE_EMPTY, never reaching the service layer", () => {
    const res = updateTagSchema.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe(
        VALIDATION_MESSAGES.TAG_UPDATE_EMPTY,
      );
    }
  });

  it.each([
    [{ name: "Personal" }],
    [{ color: "#EF4444" }],
    [{ name: "Personal", color: "#EF4444" }],
  ])(
    "[FRS-3.1] updateTagSchema SHALL accept a non-empty partial body %j",
    (body) => {
      const res = updateTagSchema.safeParse(body);
      expect(res.success).toBe(true);
    },
  );
});

describe("[FRS-3.1, FRS-3.4] tag.service.createTag — duplicate detection & P2002 race-safety fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-3.1] SHALL call findTagByNameForUser before createTag, and on no duplicate SHALL create scoped to userId returning noteCount from _count.noteTags", async () => {
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(null);
    vi.mocked(tagRepository.createTag).mockResolvedValue(
      buildTag({ name: "DevOps", color: "#3B82F6", noteCount: 0 }),
    );

    const result = await tagService.createTag(USER_ID, {
      name: "DevOps",
      color: "#3B82F6",
    });

    expect(tagRepository.findTagByNameForUser).toHaveBeenCalledWith(
      "DevOps",
      USER_ID,
    );
    expect(tagRepository.createTag).toHaveBeenCalledWith({
      userId: USER_ID,
      name: "DevOps",
      color: "#3B82F6",
    });
    expect(result).toEqual({
      id: TAG_ID,
      name: "DevOps",
      color: "#3B82F6",
      noteCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("[FRS-3.4] SHALL reject 409 TAG_NAME_CONFLICT via the pre-insert duplicate check without ever calling repository createTag", async () => {
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(
      buildTag({ name: "Work" }),
    );

    await expect(
      tagService.createTag(USER_ID, { name: "WORK", color: "#3B82F6" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: API_ERROR_CODES.TAG_NAME_CONFLICT,
    });
    expect(tagRepository.createTag).not.toHaveBeenCalled();
  });

  it("[FRS-3.4] SHALL translate a P2002 unique-constraint violation from repository createTag into 409 TAG_NAME_CONFLICT even when the pre-insert check found no duplicate (race-safety fallback)", async () => {
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(null);
    vi.mocked(tagRepository.createTag).mockRejectedValue(buildP2002());

    await expect(
      tagService.createTag(USER_ID, { name: "Work", color: "#3B82F6" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: API_ERROR_CODES.TAG_NAME_CONFLICT,
    });
  });

  it("[SDS §4.1] SHALL rethrow a non-P2002 error from repository createTag unchanged, not as a 409", async () => {
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(null);
    const boom = new Error("connection lost");
    vi.mocked(tagRepository.createTag).mockRejectedValue(boom);

    await expect(
      tagService.createTag(USER_ID, { name: "Work", color: "#3B82F6" }),
    ).rejects.toBe(boom);
  });
});

describe("[FRS-3.2] tag.service.listTags — repository pass-through & DTO mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-3.2] SHALL call listTagsForUser(userId) and map each row's _count.noteTags to a top-level noteCount field", async () => {
    vi.mocked(tagRepository.listTagsForUser).mockResolvedValue([
      buildTag({ id: TAG_ID, name: "apple", noteCount: 2 }),
      buildTag({ id: OTHER_TAG_ID, name: "Zeta", noteCount: 0 }),
    ]);

    const result = await tagService.listTags(USER_ID);

    expect(tagRepository.listTagsForUser).toHaveBeenCalledWith(USER_ID);
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0]).toMatchObject({ name: "apple", noteCount: 2 });
    expect(result.tags[1]).toMatchObject({ name: "Zeta", noteCount: 0 });
  });

  it("[FRS-3.1] SHALL return `{ tags: [] }`, not an error, when the repository resolves an empty array", async () => {
    vi.mocked(tagRepository.listTagsForUser).mockResolvedValue([]);

    const result = await tagService.listTags(USER_ID);

    expect(result).toEqual({ tags: [] });
  });
});

describe("[FRS-3.1, FRS-3.4] tag.service.updateTag — ownership guard & self-rename exclusion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-3.4] SHALL call findTagByIdForUser(tagId, userId) first, rejecting 404 TAG_NOT_FOUND when it resolves null, and SHALL NOT call findTagByNameForUser or repository updateTag", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(null);

    await expect(
      tagService.updateTag(USER_ID, TAG_ID, { name: "Personal" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.TAG_NOT_FOUND,
    });
    expect(tagRepository.findTagByIdForUser).toHaveBeenCalledWith(
      TAG_ID,
      USER_ID,
    );
    expect(tagRepository.findTagByNameForUser).not.toHaveBeenCalled();
    expect(tagRepository.updateTag).not.toHaveBeenCalled();
  });

  it("[FRS-3.1] SHALL NOT perform any duplicate-name lookup at all on a color-only update (input.name undefined)", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(
      buildTag({ name: "Work", color: "#6B7280" }),
    );
    vi.mocked(tagRepository.updateTag).mockResolvedValue(
      buildTag({ name: "Work", color: "#EF4444" }),
    );

    await tagService.updateTag(USER_ID, TAG_ID, { color: "#EF4444" });

    expect(tagRepository.findTagByNameForUser).not.toHaveBeenCalled();
    expect(tagRepository.updateTag).toHaveBeenCalledWith(TAG_ID, {
      name: undefined,
      color: "#EF4444",
    });
  });

  it("[FRS-3.4] SHALL reject 409 TAG_NAME_CONFLICT when the rename collides with a *different* tag (conflicting.id !== tagId) owned by the same user, never calling repository updateTag", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(
      buildTag({ id: TAG_ID, name: "Personal" }),
    );
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(
      buildTag({ id: OTHER_TAG_ID, name: "Work" }),
    );

    await expect(
      tagService.updateTag(USER_ID, TAG_ID, { name: "WORK" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: API_ERROR_CODES.TAG_NAME_CONFLICT,
    });
    expect(tagRepository.updateTag).not.toHaveBeenCalled();
  });

  it("[Resolved Decision #7] SHALL NOT treat renaming a tag to its own current name/case-variant as a conflict, and SHALL proceed to call repository updateTag", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(
      buildTag({ id: TAG_ID, name: "Work" }),
    );
    // The Citext-native lookup for "work" resolves the exact same row (its own id).
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(
      buildTag({ id: TAG_ID, name: "Work" }),
    );
    vi.mocked(tagRepository.updateTag).mockResolvedValue(
      buildTag({ id: TAG_ID, name: "work" }),
    );

    const result = await tagService.updateTag(USER_ID, TAG_ID, {
      name: "work",
    });

    expect(tagRepository.updateTag).toHaveBeenCalledWith(TAG_ID, {
      name: "work",
      color: undefined,
    });
    expect(result.name).toBe("work");
  });

  it("[FRS-3.4] SHALL translate a P2002 unique-constraint violation from repository updateTag into 409 TAG_NAME_CONFLICT (race-safety fallback)", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(
      buildTag({ id: TAG_ID, name: "Personal" }),
    );
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(null);
    vi.mocked(tagRepository.updateTag).mockRejectedValue(buildP2002());

    await expect(
      tagService.updateTag(USER_ID, TAG_ID, { name: "Work" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: API_ERROR_CODES.TAG_NAME_CONFLICT,
    });
  });

  it("[SDS §4.1] SHALL rethrow a non-P2002 error from repository updateTag unchanged, not as a 409", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(
      buildTag({ id: TAG_ID, name: "Personal" }),
    );
    vi.mocked(tagRepository.findTagByNameForUser).mockResolvedValue(null);
    const boom = new Error("connection lost");
    vi.mocked(tagRepository.updateTag).mockRejectedValue(boom);

    await expect(
      tagService.updateTag(USER_ID, TAG_ID, { name: "Work" }),
    ).rejects.toBe(boom);
  });
});

describe("[FRS-3.3, FRS-3.4] tag.service.deleteTag — ownership guard, no explicit join cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-3.4] SHALL call findTagByIdForUser(tagId, userId) before repository deleteTag, rejecting 404 TAG_NOT_FOUND for a cross-user/nonexistent tag, and SHALL NOT call deleteTag", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(null);

    await expect(tagService.deleteTag(USER_ID, TAG_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.TAG_NOT_FOUND,
    });
    expect(tagRepository.deleteTag).not.toHaveBeenCalled();
  });

  it("[FRS-3.3] SHALL call repository deleteTag(tagId) exactly once after confirming ownership, and return { id: tagId } with no explicit NoteTag cleanup call", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(
      buildTag({ id: TAG_ID, userId: USER_ID }),
    );
    vi.mocked(tagRepository.deleteTag).mockResolvedValue(
      buildTag({ id: TAG_ID, userId: USER_ID }) as unknown as Tag,
    );

    const result = await tagService.deleteTag(USER_ID, TAG_ID);

    expect(tagRepository.deleteTag).toHaveBeenCalledWith(TAG_ID);
    expect(tagRepository.deleteTag).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: TAG_ID });
  });

  it("[SDS §4.1] deleteTag SHALL call findTagByIdForUser strictly before deleteTag, never the reverse order", async () => {
    const callOrder: string[] = [];
    vi.mocked(tagRepository.findTagByIdForUser).mockImplementation(async () => {
      callOrder.push("find");
      return buildTag({ id: TAG_ID, userId: USER_ID });
    });
    vi.mocked(tagRepository.deleteTag).mockImplementation(async () => {
      callOrder.push("delete");
      return buildTag({ id: TAG_ID, userId: USER_ID }) as unknown as Tag;
    });

    await tagService.deleteTag(USER_ID, TAG_ID);

    expect(callOrder).toEqual(["find", "delete"]);
  });
});

describe("[Sanity] AppError plumbing used by tag.service", () => {
  it("notFound()/nameConflict() helpers SHALL always surface as AppError instances", async () => {
    vi.mocked(tagRepository.findTagByIdForUser).mockResolvedValue(null);

    await expect(
      tagService.updateTag(OTHER_USER_ID, TAG_ID, { name: "X" }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
