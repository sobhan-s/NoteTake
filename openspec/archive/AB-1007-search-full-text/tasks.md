# Sequenced Tasks for AB-1007-search-full-text

Scope: **BACKEND** (`AB-1002..AB-1009`). No frontend, no Prisma migration — `search_vector`/`GIN`/
trigger already exist since `AB-1001`. Source: `plan.md`, `specs/search/spec.md`.

## Phase 1: Foundation & Shared Tier (`@shared/core`)

_All DTOs, Zod schemas, and numeric constants for this ticket live exclusively in `packages/shared`
(Rule 11, FRS-8.5) — zero duplication or hardcoded literals in `apps/api`._

- [x] `packages/shared/src/constants/api-paths.constant.ts`: add `SEARCH: { ROOT: "/search" }` to
      `API_PATHS` (`[FRS-8.6]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: add
      `SEARCH_QUERY_REQUIRED: "Search query is required"` to `VALIDATION_MESSAGES` (`page`/`limit`/
      `tagIds`/`tagMode` reuse `NOTE_PAGE_INVALID`/`NOTE_LIMIT_INVALID`/`NOTE_TAG_IDS_INVALID`/
      `NOTE_TAG_MODE_INVALID` verbatim — no new copy) (`[FRS-8.5]`).
- [x] `packages/shared/src/schemas/search.schema.ts` (new): define `searchNotesSchema` exactly per
      `plan.md` §2 (`q` trimmed/required, `page`/`limit` coerced against `APP_LIMITS.PAGE_SIZE_MAX`/
      `PAGE_SIZE_DEFAULT`, `tagIds` CSV-of-UUID `.refine`, `tagMode` enum `ALL`/`ANY` default `ALL`)
      (`[FRS-4.3, FRS-2.3.5]`).
- [x] `packages/shared/src/schemas/index.ts`: add `export * from "./search.schema"` (`[Rule 11]`).
- [x] `packages/shared/src/types/search.type.ts` (new): define `SearchNotesQuery`,
      `SearchResultResponseDto` (`id`, `title`, `snippet`, `updatedAt`), `PaginatedSearchResponseDto`
      (`results`, `pagination: { page, limit, total, totalPages }`) (`[FRS-4.3, FRS-8.5]`).
- [x] `packages/shared/src/types/index.ts`: add `export * from "./search.type"` (`[Rule 11]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0`
      → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/api`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop.
Controllers strictly `schema.parse` + one service call + `{ success, data }` wrap — zero SQL, zero Zod
definitions (SDS §1.1). Search is a pure read endpoint; no `deletedAt` mutation occurs, but every query
excludes `deleted_at IS NOT NULL` rows (Stage 1 + Stage 2) per FRS-2.2. Auth stays behind
`requireAuth`/`req.user!.userId` — no token storage/rotation logic touched, tokens remain purely in
`useAuthStore` memory per FRS-1.3.5.)_

- [x] `apps/api/src/repositories/note.repository.ts`: add private `buildSearchTagFilterSql(tagIds,
    tagMode, placeholderIndex)` helper generating the `NOT EXISTS(...NOT EXISTS...)` (ALL) /
      `EXISTS(...= ANY($n))` (ANY) SQL fragments, parameterized by a single `uuid[]` array — never
      string-interpolating `tagIds` values (`[FRS-2.3.5]`).
- [x] `apps/api/src/repositories/note.repository.ts`: add `searchNotesForUser(params, db =
    prisma)` — raw `$queryRawUnsafe` SELECT scoped to `user_id = $1 AND deleted_at IS NULL AND
    search_vector @@ plainto_tsquery('english', $2)`, `ts_headline` snippet with
      `[[[MARK]]]`/`[[[MARK_END]]]` sentinels, `ORDER BY ts_rank(...) DESC, updated_at DESC`, `LIMIT
    $3 OFFSET $4`, optional tag clause at placeholder `5` (`[FRS-4.1, FRS-4.2, FRS-4.5, FRS-4.4]`).
- [x] `apps/api/src/repositories/note.repository.ts`: add `countSearchNotesForUser(params, db =
    prisma)` — matching `COUNT(*)` query, same predicates, tag clause at placeholder `3`
      (`[FRS-4.3, FRS-2.2.3]`).
- [x] `apps/api/src/services/search.service.ts` (new): implement `searchNotes(userId, query)` —
      split `tagIds` CSV to array, `Promise.all([searchNotesForUser, countSearchNotesForUser])`, map
      `updated_at` → `updatedAt` ISO string, local private `toPagination` helper (no cross-service
      import, matches `note.service.ts` precedent) (`[FRS-4.3, FRS-4.5]`).
- [x] `apps/api/src/controllers/search.controller.ts` (new): implement `search(req, res)` —
      `searchNotesSchema.parse(req.query)` → `searchService.searchNotes(req.user!.userId, query)` →
      `res.status(200).json({ success: true, data })`; zero SQL, zero Zod schema definitions in this
      file (`[SDS §1.1, FRS-8.6]`).
- [x] `apps/api/src/routers/search.router.ts` (new): `router.use(requireAuth)` +
      `router.get("/", searchController.search)` (`[FRS-8.6]`).
- [x] `apps/api/src/routers/index.ts`: mount `searchRouter` at `API_PATHS.BASE +
    API_PATHS.SEARCH.ROOT` → final route `GET /api/v1/search` (`[FRS-8.6]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0`
      → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — FRS-0.3.2, FRS-0.3.3)

_Tests derive solely from `FRS-4.1–4.5`, `FRS-4.2.1`, `FRS-2.3.5`, `FRS-2.2.3` requirement text and
`SDS.md` contracts — never from Acceptance Criteria bullet wording. Run only against isolated
`notes_app_test`; zero connections to `notes_app`/production; zero `sqlite::memory:`._

- [x] `apps/api/tests/contract/search.test.ts` (new): validation matrix — missing/empty/whitespace
      `q` (`400 VALIDATION_ERROR`), `page < 1`, `limit` `0`/`101` boundary and valid `2`/`100`,
      invalid `tagMode`, malformed `tagIds` UUID token (`[FRS-4.3, FRS-2.3.5]`).
- [x] `apps/api/tests/contract/search.test.ts`: special-character `q` (SQL metacharacters, `tsquery`
      operator syntax) returns `200 OK` with safe literal matching, never a crash or injection effect
      (`[FRS-4.2.1]`).
- [x] `apps/api/tests/contract/search.test.ts`: relevance/exclusion — own active notes ranked
      `ts_rank DESC, updated_at DESC`; cross-user notes never appear; Stage 1 **and** Stage 2 trashed
      notes (seed `deletedAt` inside and beyond the 30-day cutoff) excluded from results and count
      (`[FRS-4.4, FRS-4.5, FRS-2.2.3, FRS-8.1]`).
- [x] `apps/api/tests/contract/search.test.ts`: multi-word AND-semantics (`"meeting notes"` requires
      both terms), zero-match returns `200 OK` with `results: []`/`total: 0` (not `404`)
      (`[FRS-4.1, FRS-4.3]`).
- [x] `apps/api/tests/contract/search.test.ts`: snippet sentinel assertions — `[[[MARK]]]`/
      `[[[MARK_END]]]` present around matches, no `<b>`/`<mark>`/any HTML tag in the response body
      (`[FRS-4.2, FRS-4.2.1]`).
- [x] `apps/api/tests/contract/search.test.ts`: `tagIds`/`tagMode` combined with `q` — `ALL` requires
      every listed tag, `ANY` requires at least one, foreign/nonexistent `tagIds` narrows to zero
      matches without `403`/`404` (`[FRS-2.3.5]`).
- [x] `apps/api/tests/unit/search.repository.test.ts` (new, or extend
      `apps/api/tests/unit/note.repository.test.ts`): `buildSearchTagFilterSql` ALL vs ANY
      SQL-fragment shape and correct positional-placeholder index for both the search (`5`) and count
      (`3`) queries (`[FRS-2.3.5]`).
- [x] `apps/api/tests/unit/search.service.test.ts` (new): pagination math (`totalPages` rounding,
      `total = 0` edge), `tagIds` CSV-to-array parsing, row-to-DTO mapping (`updated_at` →
      `updatedAt` ISO string) (`[FRS-4.3]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — 100% green against
      `notes_app_test`, ≥80% coverage on new code.

## Phase 4: OpenSpec Compliance Audit (`/review` — archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta (`openspec/changes/AB-1007-search-full-text/specs/search/spec.md`).
- [x] Run `/review AB-1007-search-full-text` (`reviewer` agent checks `@shared/core` SSOT, controller
      layering, `deleted_at`/soft-delete exclusion, XSS-safe sentinel highlighting, cross-user/tag
      IDOR boundaries, DB/test isolation).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to
      `/pr AB-1007-search-full-text` (where `openspec archive` takes place).
