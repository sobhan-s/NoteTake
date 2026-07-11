# Implementation Plan — AB-1005: Notes Pagination, Sorting & Tag Filtering

Source spec: `openspec/changes/AB-1005-notes-filtering-sorting/specs/notes/spec.md`
Scope: **BACKEND** (`AB-1002..AB-1009`). No frontend, no migration (models exist since AB-1001).

---

## 1. Layered File Map (routers → controllers → services → repositories → shared)

| Layer            | File                                                            | Change                                                                                                         |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| shared/constants | `packages/shared/src/constants/app-limits.constant.ts`          | add `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`                                                                       |
| shared/constants | `packages/shared/src/constants/api-paths.constant.ts`           | add `API_PATHS.NOTES.TRASH`                                                                                    |
| shared/constants | `packages/shared/src/constants/validation-messages.constant.ts` | add 5 new messages                                                                                             |
| shared/schemas   | `packages/shared/src/schemas/note.schema.ts`                    | add `listNotesSchema`, `listTrashSchema`                                                                       |
| shared/types     | `packages/shared/src/types/note.type.ts`                        | add `ListNotesQuery`, `ListTrashQuery`, `PaginatedNotesResponseDto`                                            |
| repository       | `apps/api/src/repositories/note.repository.ts`                  | add `listActiveNotesForUser`, `countActiveNotesForUser`, `listTrashedNotesForUser`, `countTrashedNotesForUser` |
| service          | `apps/api/src/services/note.service.ts`                         | add `listNotes`, `listTrash`                                                                                   |
| controller       | `apps/api/src/controllers/note.controller.ts`                   | add `list`, `listTrash`                                                                                        |
| router           | `apps/api/src/routers/note.router.ts`                           | add `GET /` and `GET /trash` (registered **before** `GET /:id`)                                                |

No barrel changes needed — `schemas/index.ts`, `types/index.ts` already `export *` the touched files.

---

## 2. Shared Package (`packages/shared`)

### `app-limits.constant.ts`

```ts
PAGE_SIZE_DEFAULT: 20,
PAGE_SIZE_MAX: 100,
```

### `api-paths.constant.ts`

```ts
NOTES: {
  ROOT: "/notes",
  TRASH: "/trash",
  RESTORE: "/restore",
  PERMANENT: "/permanent",
},
```

### `validation-messages.constant.ts`

```ts
NOTE_PAGE_INVALID: "Page must be a positive integer",
NOTE_LIMIT_INVALID: `Limit must be between 1 and ${APP_LIMITS.PAGE_SIZE_MAX}`,
NOTE_SORT_FIELD_INVALID: "Sort must be one of: createdAt, updatedAt, title",
NOTE_TAG_MODE_INVALID: "Tag mode must be ALL or ANY",
NOTE_TAG_IDS_INVALID: "Each tagIds entry must be a valid UUID",
```

### `note.schema.ts` — append `listNotesSchema` / `listTrashSchema` exactly as finalized in spec.md §"Shared List Contracts" (already reviewed and approved verbatim — no changes from spec).

### `note.type.ts` — append:

```ts
export type ListNotesQuery = z.infer<typeof listNotesSchema>;
export type ListTrashQuery = z.infer<typeof listTrashSchema>;

export type PaginatedNotesResponseDto = {
  notes: NoteResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
```

---

## 3. Repository Layer (`note.repository.ts`)

Key design decision — **tagMode filter via Prisma relation filters, not raw SQL**:

- `Note.noteTags: NoteTag[]` is the actual relation name (confirmed in `schema.prisma`), not `tags`.
- `tagMode=ANY` → single relation filter: `noteTags: { some: { tagId: { in: tagIds } } }`.
- `tagMode=ALL` → **must NOT use Prisma's `every`** (`every` is vacuously true for notes with zero tags and only asserts "all related rows match", not "all requested ids are present" — wrong semantics for "must have every listed tag"). Instead, AND one `some` filter per tagId:
  ```ts
  {
    AND: tagIds.map((tagId) => ({ noteTags: { some: { tagId } } }));
  }
  ```

```ts
type ListActiveNotesParams = {
  userId: string;
  page: number;
  limit: number;
  sort: "createdAt" | "updatedAt" | "title";
  order: "asc" | "desc";
  tagIds?: string[];
  tagMode: "ALL" | "ANY";
};

function buildTagFilter(
  tagIds: string[] | undefined,
  tagMode: "ALL" | "ANY",
): Prisma.NoteWhereInput {
  if (!tagIds || tagIds.length === 0) return {};
  return tagMode === "ALL"
    ? { AND: tagIds.map((tagId) => ({ noteTags: { some: { tagId } } })) }
    : { noteTags: { some: { tagId: { in: tagIds } } } };
}

export function listActiveNotesForUser(
  params: ListActiveNotesParams,
  db: Db = prisma,
): Promise<Note[]> {
  const { userId, page, limit, sort, order, tagIds, tagMode } = params;
  return db.note.findMany({
    where: { userId, deletedAt: null, ...buildTagFilter(tagIds, tagMode) },
    orderBy: [{ [sort]: order }, { createdAt: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  });
}

export function countActiveNotesForUser(
  params: Pick<ListActiveNotesParams, "userId" | "tagIds" | "tagMode">,
  db: Db = prisma,
): Promise<number> {
  const { userId, tagIds, tagMode } = params;
  return db.note.count({
    where: { userId, deletedAt: null, ...buildTagFilter(tagIds, tagMode) },
  });
}

export function listTrashedNotesForUser(
  params: { userId: string; page: number; limit: number; stage1Cutoff: Date },
  db: Db = prisma,
): Promise<Note[]> {
  const { userId, page, limit, stage1Cutoff } = params;
  return db.note.findMany({
    where: { userId, deletedAt: { not: null, gte: stage1Cutoff } },
    orderBy: { deletedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export function countTrashedNotesForUser(
  params: { userId: string; stage1Cutoff: Date },
  db: Db = prisma,
): Promise<number> {
  return db.note.count({
    where: { userId, deletedAt: { not: null, gte: params.stage1Cutoff } },
  });
}
```

`orderBy: [{ [sort]: order }, { createdAt: "desc" }]` — when `sort === "createdAt"`, Prisma allows the same field twice in the array (primary direction wins, the duplicate tiebreaker is a no-op), so no special-casing needed.

`stage1Cutoff` is computed once in the service (`new Date(Date.now() - APP_LIMITS.TRASH_STAGE_1_DAYS * 86400000)`), reusing the exact arithmetic already established by `isWithinStage1()` in `note.service.ts` — repository stays a pure query layer with no date math of its own.

---

## 4. Service Layer (`note.service.ts`)

```ts
function toPagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

export async function listNotes(
  userId: string,
  query: ListNotesQuery,
): Promise<PaginatedNotesResponseDto> {
  const tagIds = query.tagIds ? query.tagIds.split(",") : undefined;
  const params = {
    userId,
    page: query.page,
    limit: query.limit,
    sort: query.sort,
    order: query.order,
    tagIds,
    tagMode: query.tagMode,
  };
  const [notes, total] = await Promise.all([
    noteRepository.listActiveNotesForUser(params),
    noteRepository.countActiveNotesForUser(params),
  ]);
  return {
    notes: notes.map(toNoteResponseDto),
    pagination: toPagination(query.page, query.limit, total),
  };
}

export async function listTrash(
  userId: string,
  query: ListTrashQuery,
): Promise<PaginatedNotesResponseDto> {
  const stage1Cutoff = new Date(
    Date.now() - APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000,
  );
  const params = { userId, page: query.page, limit: query.limit, stage1Cutoff };
  const [notes, total] = await Promise.all([
    noteRepository.listTrashedNotesForUser(params),
    noteRepository.countTrashedNotesForUser(params),
  ]);
  return {
    notes: notes.map(toNoteResponseDto),
    pagination: toPagination(query.page, query.limit, total),
  };
}
```

Reuses the existing `toNoteResponseDto` mapper unchanged (Resolved Decision #5 — no new summary DTO).

---

## 5. Controller Layer (`note.controller.ts`)

```ts
export async function list(req: Request, res: Response): Promise<void> {
  const query = listNotesSchema.parse(req.query);
  const data = await noteService.listNotes(req.user!.userId, query);
  res.status(200).json({ success: true, data });
}

export async function listTrash(req: Request, res: Response): Promise<void> {
  const query = listTrashSchema.parse(req.query);
  const data = await noteService.listTrash(req.user!.userId, query);
  res.status(200).json({ success: true, data });
}
```

Both import `listNotesSchema`/`listTrashSchema` from `@shared/core/schemas` alongside the existing imports — zero Zod definitions in the controller itself, consistent with existing `create`/`update`/`permanentDelete` controllers.

---

## 6. Router Layer (`note.router.ts`)

```ts
router.get(API_PATHS.NOTES.TRASH, noteController.listTrash); // MUST precede "/:id"
router.get("/", noteController.list);
router.get("/:id", noteController.getById);
...
```

Registration order (top to bottom): `GET /trash` → `GET /` → `GET /:id` → rest unchanged. This is Resolved Decision #6 from the spec — without this order Express would match `trash` as an `:id` param.

---

## 7. Cross-Cutting Compliance Checklist

- **SSOT (Rule 11 / FRS-8.5)**: every numeric bound (`page≥1`, `limit 1–100`, default `20`) is a named `APP_LIMITS` export; zero literals in `apps/api`. `apps/web` is untouched this ticket (AB-1011 consumes these later).
- **Layering**: controllers only `schema.parse` + one service call + response wrap; services hold zero HTTP context and zero SQL; repositories hold zero business logic (date-cutoff math stays in the service, matching the existing `isWithinStage1` precedent).
- **Response wrapper**: both new endpoints return `{ success: true, data: PaginatedNotesResponseDto }`; validation failures fall through to the existing global Zod-error handler → `{ success: false, error: { code: "VALIDATION_ERROR", ... } }` (no new error-handling code needed, `VALIDATION_ERROR` already exists in `API_ERROR_CODES`).
- **Auth/token handling**: unaffected — both routes sit behind the router's existing `router.use(requireAuth)`; `req.user!.userId` scopes every query. No token storage/rotation logic touched.
- **Soft delete (FRS-2.2)**: `/notes` filters `deletedAt: null`; `/trash` filters `deletedAt: { not: null, gte: stage1Cutoff }` — Stage 2 rows are excluded by the query itself, not just the restore endpoint, per spec Resolved Decision context. No physical `DELETE`, no mutation at all (these are pure reads).
- **DB/test isolation (FRS-0.3.3)**: no schema/migration change (models exist since AB-1001) — `prisma migrate dev` is **not** required for this ticket. New tests run against `notes_app_test` per existing suite convention; no new `TRUNCATE` usage introduced.

---

## 8. Test Plan (for `/tasks` → `test-writer`)

Derived from FRS-2.3.1–2.3.6 text (not AC bullets), per project convention:

- `apps/api/src/repositories/note.repository.test.ts` (extend): `buildTagFilter` ALL vs ANY semantics incl. zero-tag/foreign-tag cases, orderBy tiebreaker behavior, stage-1 cutoff boundary query.
- `apps/api/src/services/note.service.test.ts` (extend): pagination math (`totalPages` rounding, `total=0` edge), tagIds CSV parsing, cutoff date computed once and reused consistently with `isWithinStage1`.
- `apps/api/src/controllers/note.controller.test.ts` or Supertest contract suite: full 400/200 matrix from spec's Error Scenarios table, all 6 sort field/direction combos, `/trash` silently ignoring foreign params, route-order regression test (`GET /notes/trash` must not 404 as an invalid-UUID `:id`).
- Cross-user and Stage-2-exclusion cases verified via direct DB-state setup (insert rows with a backdated `deletedAt`), not solely through the restore endpoint.

---

## 9. Quality Gate Commands (run after implementation, before `/review`)

```
pnpm turbo run build
pnpm turbo run lint -- --max-warnings 0
pnpm turbo run typecheck
pnpm turbo run test -- --coverage
```

All four must be green, ≥80% coverage on new code, before `/tasks` is marked complete or `/pr` is invoked.

---

## 10. Out of Scope (carried from spec, unchanged)

No `q`/full-text search, no tag CRUD, no frontend, no changes to existing CRUD/restore/permanent-delete endpoints, no migration.
