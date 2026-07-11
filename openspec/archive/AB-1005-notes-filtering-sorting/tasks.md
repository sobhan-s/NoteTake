# Sequenced Tasks for AB-1005-notes-filtering-sorting

Source: `specs/notes/spec.md` + `plan.md` (both already approved). Scope: **BACKEND** only — no `apps/web`, no migration (`Note`/`Tag`/`NoteTag` exist since AB-1001).

## Phase 1: Foundation & Shared Tier (`@shared/core`)

- [x] `packages/shared/src/constants/app-limits.constant.ts`: add `PAGE_SIZE_DEFAULT: 20` and `PAGE_SIZE_MAX: 100` (`[Rule 11, FRS-2.3.1]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: add `API_PATHS.NOTES.TRASH: "/trash"` (`[Rule 11, FRS-2.3.6]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: add `NOTE_PAGE_INVALID`, `NOTE_LIMIT_INVALID`, `NOTE_SORT_FIELD_INVALID`, `NOTE_TAG_MODE_INVALID`, `NOTE_TAG_IDS_INVALID` (`[FRS-2.3.1, FRS-2.3.2, FRS-2.3.3]`).
- [x] `packages/shared/src/schemas/note.schema.ts`: add `listNotesSchema` and `listTrashSchema` exactly as finalized in `spec.md` §"Shared List Contracts" (`[Rule 11, FRS-2.3.1–2.3.6]`).
- [x] `packages/shared/src/types/note.type.ts`: add `ListNotesQuery`, `ListTrashQuery` (`z.infer`) and `PaginatedNotesResponseDto` (`[Rule 11, FRS-8.5]`). No barrel edits needed — `schemas/index.ts`/`types/index.ts` already `export *` these files.
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/api`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop)_

- [x] `apps/api/src/repositories/note.repository.ts`: add private `buildTagFilter(tagIds, tagMode)` — `tagMode=ANY` → `noteTags: { some: { tagId: { in: tagIds } } }`; `tagMode=ALL` → `{ AND: tagIds.map(tagId => ({ noteTags: { some: { tagId } } })) }` (never Prisma `every` — vacuously true for zero-tag notes) (`[FRS-2.3.3]`).
- [x] `apps/api/src/repositories/note.repository.ts`: add `listActiveNotesForUser`/`countActiveNotesForUser` — `where: { userId, deletedAt: null, ...buildTagFilter(...) }`, `orderBy: [{ [sort]: order }, { createdAt: "desc" }]`, `skip`/`take` from `page`/`limit`, both accepting `db: Db = prisma` per existing pattern (`[FRS-2.3.1, FRS-2.3.2, FRS-2.3.4, FRS-8.1]`).
- [x] `apps/api/src/repositories/note.repository.ts`: add `listTrashedNotesForUser`/`countTrashedNotesForUser` — `where: { userId, deletedAt: { not: null, gte: stage1Cutoff } }`, `orderBy: { deletedAt: "desc" }` (`[FRS-2.2.2, FRS-2.3.6]`). Zero SQL/business logic beyond the query itself — repositories stay pure query layer, no date math.
- [x] `apps/api/src/services/note.service.ts`: add `toPagination(page, limit, total)` helper (`totalPages: Math.ceil(total / limit) || 0`) (`[FRS-2.3.1]`).
- [x] `apps/api/src/services/note.service.ts`: add `listNotes(userId, query)` — split `tagIds` CSV to array, call repository pair via `Promise.all`, map through existing `toNoteResponseDto`, return `PaginatedNotesResponseDto` (`[FRS-2.3.1–2.3.5, FRS-8.1]`). Zero HTTP context.
- [x] `apps/api/src/services/note.service.ts`: add `listTrash(userId, query)` — compute `stage1Cutoff = new Date(Date.now() - APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000)` (same arithmetic as existing `isWithinStage1()`), call repository pair, return `PaginatedNotesResponseDto` (`[FRS-2.2.2, FRS-2.3.6]`).
- [x] `apps/api/src/controllers/note.controller.ts`: add `list(req, res)` — `listNotesSchema.parse(req.query)` (imported from `@shared/core/schemas`), call `noteService.listNotes`, respond `{ success: true, data }`. Zero SQL, zero `z.object()` definitions in this file (`[SDS §1.1, FRS-2.3.1]`).
- [x] `apps/api/src/controllers/note.controller.ts`: add `listTrash(req, res)` — `listTrashSchema.parse(req.query)`, call `noteService.listTrash`, respond `{ success: true, data }` (`[SDS §1.1, FRS-2.3.6]`).
- [x] `apps/api/src/routers/note.router.ts`: register `router.get(API_PATHS.NOTES.TRASH, noteController.listTrash)` and `router.get("/", noteController.list)` **both before** the existing `router.get("/:id", ...)` — exact order `GET /trash` → `GET /` → `GET /:id` → rest unchanged (`[FRS-2.3.6]`, Resolved Decision #6). Both remain behind the router's existing `router.use(requireAuth)` — no auth/token logic touched (`[FRS-1.3.5]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

- [x] `apps/api/tests/helpers/notes.ts`: add `createTagDirect(userId, name?)` and `attachTagDirect(noteId, tagId)` Prisma-direct fixture helpers (bypassing HTTP — `Tag`/`NoteTag` create endpoints belong to AB-1006 and are not yet shipped) so tag-filter tests can construct exact `NoteTag` join rows (`[FRS-2.3.3]`).
- [x] `apps/api/tests/unit/note.service.test.ts` (extend): pagination math (`totalPages` rounding at exact page boundaries, `total=0` edge), `tagIds` CSV-to-array parsing, `stage1Cutoff` computed once and consistent with `isWithinStage1` — repository calls mocked per existing `vi.mock("../../src/repositories/note.repository.js", ...)` pattern (`[FRS-2.3.1, FRS-2.3.6]`).
- [x] `apps/api/tests/contract/notes.list.test.ts` (new, `notes_app_test` via `resetTestDatabase()`): default page-1/limit-20/`updatedAt desc` ordering; explicit `page=2&limit=100` honored; `page=0`/`page=-1`/`limit=0`/`limit=101` → `400 VALIDATION_ERROR` naming field+range; all 6 `sort`×`order` combinations; invalid `sort` → `400` naming the 3 valid fields; tied-primary-sort rows stable via `createdAt desc` tiebreaker across adjacent pages (`[FRS-2.3.1, FRS-2.3.2, FRS-2.3.4]`).
- [x] `apps/api/tests/contract/notes.list-tag-filter.test.ts` (new): `tagMode=ALL` (default, omitted) requires every listed `tagId`; `tagMode=ANY` requires at least one; invalid `tagMode` → `400` naming `ALL`/`ANY`; non-UUID `tagIds` token → `400` naming `tagIds`; a well-formed but foreign/nonexistent `tagId` → `200 OK` with zero matches for that criterion, not an error (`[FRS-2.3.3]`).
- [x] `apps/api/tests/contract/notes.list.test.ts` or a dedicated isolation test (extend/new): trashed notes (Stage 1 or Stage 2) never appear in `/notes` results/count under any filter combo; another user's notes never appear regardless of sort/filter — scoped to `WHERE userId = :callerId` (`[FRS-2.2.3, FRS-8.1]`).
- [x] `apps/api/tests/contract/notes.list-trash.test.ts` (new): only Stage-1 trashed notes returned ordered strictly `deletedAt desc`; a note at exactly 30 days + 1 second past `deletedAt` is excluded (verified via direct DB-state fixture, not the restore path); `page`/`limit` validated with identical bounds as `/notes`; unsupported `sort`/`tagIds`/`tagMode` params silently ignored (`200 OK`, not errors); active notes never appear in trash results/count (`[FRS-2.2.2, FRS-2.3.6]`).
- [x] `apps/api/tests/contract/notes.list-route-order.test.ts` (new, regression): `GET /api/v1/notes/trash` must return the trash list, never a `404` from `getById` misrouting on the literal segment `trash` (`[FRS-2.3.6]`, Resolved Decision #6).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — 100% green against `notes_app_test`, ≥80% coverage on new code.

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta (`specs/notes/spec.md`).
- [ ] Run `/review AB-1005-notes-filtering-sorting` (`reviewer` agent checks `@shared/core` SSOT compliance, zero SQL/Zod in controllers, `deletedAt`/Stage-1/Stage-2 correctness, cross-user isolation, route-order regression, FRS-2.3.1–2.3.6 traceability).
- [ ] Confirm `openspec/changes/AB-1005-notes-filtering-sorting/review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1005-notes-filtering-sorting` (where `openspec archive` takes place).

---

**Wait for explicit user `APPROVED` confirmation before `/implement` begins.**
