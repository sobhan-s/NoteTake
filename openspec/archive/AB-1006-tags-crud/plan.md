# Implementation Plan — AB-1006: Tags CRUD, Live Note Count & Fly Tags

Domain: `tags` (BACKEND scope, `AB-1002..AB-1009`). Source: `openspec/changes/AB-1006-tags-crud/specs/tags/spec.md`.

## 0. Scope Recap

Four endpoints only — `POST/GET /api/v1/tags`, `PATCH/DELETE /api/v1/tags/:id`. `Tag`/`NoteTag`
Prisma models and `tags_color_hex_check` already exist (`AB-1001`) — **zero migration** in this
ticket. `tagIds` attachment on notes is done (`AB-1004`/`AB-1005`) — this ticket never touches
`note.schema.ts`, `note.repository.ts`, or the notes endpoints.

## 1. packages/shared (`@shared/core`) — single source of truth

All four layers in `apps/api` import exclusively from here; nothing below is re-declared downstream.

### 1.1 `src/constants/app-limits.constant.ts`

Add to the existing `as const` object (do not touch other keys):

```ts
TAG_NAME_MAX_CHARS: 50,
TAG_DEFAULT_COLOR: "#6B7280",
```

### 1.2 `src/constants/api-paths.constant.ts`

Add sibling key to `AUTH`/`NOTES`:

```ts
TAGS: {
  ROOT: "/tags",
},
```

### 1.3 `src/constants/api-error-codes.constant.ts`

Add:

```ts
TAG_NOT_FOUND: "TAG_NOT_FOUND",
TAG_NAME_CONFLICT: "TAG_NAME_CONFLICT",
```

### 1.4 `src/constants/validation-messages.constant.ts`

Add (mirrors `NOTE_*` message style, references `APP_LIMITS.TAG_NAME_MAX_CHARS` the same way
`NOTE_TITLE_TOO_LONG` references `NOTE_TITLE_MAX_CHARS`):

```ts
TAG_NAME_REQUIRED: "Tag name is required",
TAG_NAME_TOO_LONG: `Tag name must be ${APP_LIMITS.TAG_NAME_MAX_CHARS} characters or fewer`,
TAG_COLOR_INVALID: "Color must be a valid hex code (e.g. #6B7280)",
TAG_UPDATE_EMPTY: "At least one of name or color must be provided",
TAG_NAME_CONFLICT: "A tag with this name already exists",
```

### 1.5 `src/schemas/tag.schema.ts` (new file)

```ts
import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

const tagColorSchema = z
  .string()
  .regex(
    /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/,
    VALIDATION_MESSAGES.TAG_COLOR_INVALID,
  );

export const createTagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.TAG_NAME_REQUIRED)
    .max(APP_LIMITS.TAG_NAME_MAX_CHARS, VALIDATION_MESSAGES.TAG_NAME_TOO_LONG),
  color: tagColorSchema.default(APP_LIMITS.TAG_DEFAULT_COLOR),
});

export const updateTagSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, VALIDATION_MESSAGES.TAG_NAME_REQUIRED)
      .max(APP_LIMITS.TAG_NAME_MAX_CHARS, VALIDATION_MESSAGES.TAG_NAME_TOO_LONG)
      .optional(),
    color: tagColorSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.color !== undefined, {
    message: VALIDATION_MESSAGES.TAG_UPDATE_EMPTY,
  });
```

Register in `src/schemas/index.ts`: `export * from "./tag.schema";`

### 1.6 `src/types/tag.type.ts` (new file)

```ts
import type { z } from "zod";
import type { createTagSchema, updateTagSchema } from "../schemas/tag.schema";

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export type TagResponseDto = {
  id: string;
  name: string;
  color: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TagListResponseDto = {
  tags: TagResponseDto[];
};
```

Register in `src/types/index.ts`: `export * from "./tag.type";`

## 2. apps/api — four-layer implementation

File paths mirror the `note.*` precedent exactly (`apps/api/CLAUDE.md` naming table).

### 2.1 `src/repositories/tag.repository.ts` (new file)

Prisma calls only, `db: Db = prisma` composability param per existing pattern. `noteCount` is
computed with `_count: { select: { noteTags: { where: { note: { deletedAt: null } } } } }` — a
single Prisma relation-count query, no raw SQL needed (confirmed Prisma supports filtered relation
counts on `_count.select`).

```ts
import type { Prisma, Tag } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "tag">;
type TagWithNoteCount = Tag & { _count: { noteTags: number } };

const withActiveNoteCount = {
  _count: { select: { noteTags: { where: { note: { deletedAt: null } } } } },
} satisfies Prisma.TagInclude;

export function createTag(
  data: { userId: string; name: string; color: string },
  db: Db = prisma,
): Promise<TagWithNoteCount> {
  return db.tag.create({ data, include: withActiveNoteCount });
}

export function findTagByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<Tag | null> {
  return db.tag.findFirst({ where: { id, userId } });
}

export function findTagByNameForUser(
  name: string,
  userId: string,
  db: Db = prisma,
): Promise<Tag | null> {
  return db.tag.findFirst({ where: { userId, name } });
}

export function listTagsForUser(
  userId: string,
  db: Db = prisma,
): Promise<TagWithNoteCount[]> {
  return db.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: withActiveNoteCount,
  });
}

export function updateTag(
  id: string,
  data: { name?: string; color?: string },
  db: Db = prisma,
): Promise<TagWithNoteCount> {
  return db.tag.update({ where: { id }, data, include: withActiveNoteCount });
}

export function deleteTag(id: string, db: Db = prisma): Promise<Tag> {
  return db.tag.delete({ where: { id } });
}
```

- `deleteTag` relies on the existing `NoteTag.tagId` FK `onDelete: Cascade` (already in schema) to
  detach join rows — no explicit `noteTag.deleteMany` needed, confirmed against
  `apps/api/prisma/schema.prisma:124` (`tag Tag @relation(..., onDelete: Cascade)`).
- Citext equality (`where: { userId, name }`) performs case-insensitive comparison natively —
  **no `.toLowerCase()` or `mode: 'insensitive'`** anywhere (`apps/api/CLAUDE.md` PostgreSQL rule).

### 2.2 `src/services/tag.service.ts` (new file)

Ownership/IDOR checks + conflict checks + DTO mapping. `notFound()`/`toTagResponseDto()` mirror
`note.service.ts`'s `notFound()`/`toNoteResponseDto()` helpers exactly.

```ts
import type { Tag } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import type {
  CreateTagInput,
  TagResponseDto,
  UpdateTagInput,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import * as tagRepository from "../repositories/tag.repository.js";

function notFound(): never {
  throw new AppError(404, API_ERROR_CODES.TAG_NOT_FOUND, "Tag not found");
}

function nameConflict(): never {
  throw new AppError(
    409,
    API_ERROR_CODES.TAG_NAME_CONFLICT,
    "A tag with this name already exists",
  );
}

function toTagResponseDto(
  tag: Tag & { _count: { noteTags: number } },
): TagResponseDto {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    noteCount: tag._count.noteTags,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

export async function createTag(
  userId: string,
  input: CreateTagInput,
): Promise<TagResponseDto> {
  const existing = await tagRepository.findTagByNameForUser(input.name, userId);
  if (existing) nameConflict();
  const tag = await tagRepository.createTag({
    userId,
    name: input.name,
    color: input.color,
  });
  return toTagResponseDto(tag);
}

export async function listTags(
  userId: string,
): Promise<{ tags: TagResponseDto[] }> {
  const tags = await tagRepository.listTagsForUser(userId);
  return { tags: tags.map(toTagResponseDto) };
}

export async function updateTag(
  userId: string,
  tagId: string,
  input: UpdateTagInput,
): Promise<TagResponseDto> {
  const existing = await tagRepository.findTagByIdForUser(tagId, userId);
  if (!existing) notFound();

  if (input.name !== undefined) {
    const conflicting = await tagRepository.findTagByNameForUser(
      input.name,
      userId,
    );
    if (conflicting && conflicting.id !== tagId) nameConflict();
  }

  const updated = await tagRepository.updateTag(tagId, {
    name: input.name,
    color: input.color,
  });
  return toTagResponseDto(updated);
}

export async function deleteTag(
  userId: string,
  tagId: string,
): Promise<{ id: string }> {
  const existing = await tagRepository.findTagByIdForUser(tagId, userId);
  if (!existing) notFound();
  await tagRepository.deleteTag(tagId);
  return { id: tagId };
}
```

- Resolved Decision #7 (self-name-exempt on rename) is implemented by the `conflicting.id !== tagId`
  guard — renaming to the tag's own current name (or a case-variant, since `findTagByNameForUser`
  uses `Citext` equality) finds itself, `conflicting.id === tagId`, no conflict thrown.
- `createTag`'s existing-name check + insert is not wrapped in a DB transaction: the
  `@@unique([userId, name])` constraint is the actual race-safety backstop. A genuine concurrent
  race would surface as a Prisma `P2002` unique-violation on `createTag`'s `db.tag.create` — **not
  handled in this ticket's happy-path service code**; the spec's Resolved Decision #1 explicitly
  frames a concurrent-create race as "the correct, rare-path signal," so translating a raw `P2002`
  into `409 TAG_NAME_CONFLICT` is deferred to `error.middleware.ts` on the existing Prisma-error
  branch (verify during `/implement` that a generic `P2002` handler already exists there; if not,
  add a narrow `if (err.code === 'P2002') throw nameConflict()` catch around `tagRepository.createTag`
  in the service instead of touching the shared middleware).

### 2.3 `src/controllers/tag.controller.ts` (new file)

Thin adapters, identical shape to `note.controller.ts`.

```ts
import type { Request, Response } from "express";
import { createTagSchema, updateTagSchema } from "@shared/core/schemas";
import * as tagService from "../services/tag.service.js";

export async function create(req: Request, res: Response): Promise<void> {
  const input = createTagSchema.parse(req.body);
  const data = await tagService.createTag(req.user!.userId, input);
  res.status(201).json({ success: true, data });
}

export async function list(req: Request, res: Response): Promise<void> {
  const data = await tagService.listTags(req.user!.userId);
  res.status(200).json({ success: true, data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = updateTagSchema.parse(req.body);
  const data = await tagService.updateTag(
    req.user!.userId,
    req.params.id as string,
    input,
  );
  res.status(200).json({ success: true, data });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const data = await tagService.deleteTag(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}
```

### 2.4 `src/routers/tag.router.ts` (new file)

```ts
import { Router, type Router as RouterType } from "express";
import * as tagController from "../controllers/tag.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";

const router: RouterType = Router();

router.use(requireAuth);

router.post("/", tagController.create);
router.get("/", tagController.list);
router.patch("/:id", tagController.update);
router.delete("/:id", tagController.remove);

export default router;
```

### 2.5 `src/routers/index.ts` (edit)

Add one import + one mount line, same pattern as `noteRouter`:

```ts
import tagRouter from "./tag.router.js";
// ...
router.use(API_PATHS.BASE + API_PATHS.TAGS.ROOT, tagRouter);
```

## 3. Response Shape Confirmation

- `POST /api/v1/tags` → `201 { success: true, data: TagResponseDto }`
- `GET /api/v1/tags` → `200 { success: true, data: { tags: TagResponseDto[] } }`
- `PATCH /api/v1/tags/:id` → `200 { success: true, data: TagResponseDto }`
- `DELETE /api/v1/tags/:id` → `200 { success: true, data: { id: string } }`
- All failures flow through the existing `error.middleware.ts` (`AppError` → `{ success: false,
error: { code, message } }`) — no changes needed there except the `P2002` fallback noted in §2.2
  if it doesn't already exist generically.

## 4. Standing Cross-Cutting Checks (confirmed, no action needed)

- **Auth tokens**: unaffected by this ticket — `requireAuth` middleware reused as-is; access tokens
  stay in `useAuthStore` memory, refresh stays in `HttpOnly` cookie (`FRS-1.3.5`). No token code
  touched.
- **Soft delete**: this ticket never sets/reads `deletedAt` on `Tag` (tags have no soft-delete
  concept — delete is a hard `DELETE`, per spec's explicit "permanently remove" wording, `FRS-3.3`).
  `deletedAt` is only read on the **note** side, inside the `noteCount` relation-count filter.
- **Citext/GIN**: no new migration; existing `Tag.name @db.Citext` and `tags_color_hex_check`
  columns/constraints are reused unchanged.
- **`packages/shared` zero-duplication**: confirmed no existing `tag.schema.ts`/`tag.type.ts` files
  anywhere in the repo — this is greenfield, no risk of colliding with prior work.

## 5. Test Plan (executed by `test-writer` at `/implement` time, derived from FRS-3.x text — not this list)

- Unit (Vitest): `tag.service.ts` — create/list/update/delete happy paths, ownership 404s, name
  conflict 409s (including self-exempt rename), empty-update-body rejection.
- Contract (Supertest, isolated `notes_app_test`): full HTTP round trip per endpoint including the
  exact status codes and `API_ERROR_CODES` from the Error Scenarios table in `spec.md`; `noteCount`
  correctness across tag/untag/trash/restore sequences (exercises the already-existing `tagIds` note
  update path from `AB-1004` purely as test setup, never as production code under test here).
- Coverage target: ≥80% on all new files in §2 and §1 per `CLAUDE.md §6` Definition of Done.

## 6. Quality Gate Commands (run in this order before `/pr`)

1. `pnpm turbo run build` → 0 errors (confirms `tsup` bundles `packages/shared`'s new `tag.schema.ts`/
   `tag.type.ts` cleanly).
2. `pnpm turbo run lint` → `--max-warnings 0`.
3. `pnpm turbo run typecheck` → `tsc --noEmit`, 0 errors.
4. `pnpm turbo run test -- --coverage` → all green against `notes_app_test`, ≥80% coverage on new
   code.

## 7. File Manifest (new files only; edits are single-line barrel/router additions noted above)

```
packages/shared/src/schemas/tag.schema.ts        (new)
packages/shared/src/types/tag.type.ts            (new)
apps/api/src/repositories/tag.repository.ts      (new)
apps/api/src/services/tag.service.ts             (new)
apps/api/src/controllers/tag.controller.ts       (new)
apps/api/src/routers/tag.router.ts               (new)
```

Edits: `app-limits.constant.ts`, `api-paths.constant.ts`, `api-error-codes.constant.ts`,
`validation-messages.constant.ts`, `schemas/index.ts`, `types/index.ts`, `routers/index.ts`.

---

Awaiting explicit `APPROVED` before `/tasks AB-1006-tags-crud`.
