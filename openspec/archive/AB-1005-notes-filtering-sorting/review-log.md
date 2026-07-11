# Review Log — AB-1005-notes-filtering-sorting

## Reviewer Audit (Phase 4 — FRS/SDS Compliance)

**VERDICT: PASSED — full spec/FRS/SDS compliance verified** (one documented/approved WARN noted below as an outstanding doc-sync action item, not a compliance failure).

| Category          | Count |
| ----------------- | ----- |
| ✅ PASSED / OK    | 34    |
| ❌ MISSING / FAIL | 0     |
| ⚠️ DRIFTED / WARN | 1     |
| 🔒 SECURITY       | 0     |
| 📋 FRS GAP        | 0     |

### 1. Spec Scenario Coverage (`specs/notes/spec.md`)

- ✅ PASSED: Shared List Contracts scenario → `packages/shared/src/schemas/note.schema.ts`, `packages/shared/src/types/note.type.ts` → all fields import `APP_LIMITS`/`VALIDATION_MESSAGES`, zero duplication.
- ✅ PASSED: Default pagination page 1/limit 20, `updatedAt desc` → `note.repository.ts` (`orderBy:[{[sort]:order},{createdAt:"desc"}]`, default via schema) → test `notes.list.test.ts`.
- ✅ PASSED: Explicit `page=2&limit=100` honored.
- ✅ PASSED: `page<1`/`limit` outside 1–100 rejected, field+range named.
- ✅ PASSED: All 6 sort field/direction combos.
- ✅ PASSED: Invalid `sort` rejected naming 3 valid fields.
- ✅ PASSED: Stable tiebreaker across repeated/paginated calls.
- ✅ PASSED: `tagMode=ALL` (default+explicit) AND semantics → `note.repository.ts` `buildTagFilter`.
- ✅ PASSED: `tagMode=ANY`.
- ✅ PASSED: Invalid `tagMode` rejected naming ALL/ANY.
- ✅ PASSED: `tagIds` non-UUID token rejected, incl. mixed valid/invalid.
- ✅ PASSED: Foreign/nonexistent `tagId` → 200 with zero matches, no leak.
- ✅ PASSED: Trashed notes (Stage 1 & 2) excluded under any filter.
- ✅ PASSED: Cross-user notes excluded.
- ✅ PASSED: Trash — Stage-1-only, `deletedAt desc`.
- ✅ PASSED: 30-day boundary excluded (30d+1s) / included (30d−1s).
- ✅ PASSED: Trash page/limit same bounds as `/notes`.
- ✅ PASSED: Unsupported params silently ignored on `/trash`.
- ✅ PASSED: Active notes never in trash list.
- ✅ PASSED: Route-order regression (trash never mis-routed to `getById`) → `note.router.ts` (`GET /trash` before `GET /:id`).

### 2. FRS Requirement Coverage

- ✅ COVERED: FRS-2.3.1, FRS-2.3.2, FRS-2.3.3, FRS-2.3.4, FRS-2.3.6, FRS-8.1, FRS-8.4, FRS-8.5.
- ✅ COVERED (deferred, in-scope decision): FRS-2.3.5 (search `q` + tag-filter combinability) — explicitly out of scope for AB-1005 per spec.md Resolved Decision #2 / Out-of-Scope section; deferred to AB-1007. Not a gap for this ticket.

### 3. SDS Contract Adherence

- ✅ MATCHES: `GET /api/v1/notes` and `GET /api/v1/notes/trash` route rows (SDS §7).
- ⚠️ DRIFTED (documented/approved): SDS §5.1's `filterNotesSchema` code sample shows tag filtering by comma-separated tag **name** tokens and a `q` field. Implementation instead filters by `tagIds` (UUID array) with no `q` field — explicitly documented and approved as Resolved Decision #1/#2 in `spec.md`, which states `SDS.md` should be updated in a follow-up doc-sync. **Action item:** doc-sync `docs/SDS.md` §5.1 to match the shipped `tagIds` contract before it goes further stale (tracked here, non-blocking for this ticket).
- ✅ MATCHES: Error codes — reuses existing `VALIDATION_ERROR`/`UNAUTHORIZED`; zero new error codes added.
- ✅ NO LAYER VIOLATION: controller does `schema.parse` + one service call + response wrap only; service has zero HTTP/SQL; repository is pure Prisma query layer (date-cutoff math stays in service).
- ✅ NO SHARED TYPE DUPLICATION: schemas/types/constants live solely in `packages/shared`.
- ✅ NO `any` usage. ✅ NO PHYSICAL DELETE introduced.

### 4. Out-of-Scope Violations

- ✅ PASSED: No `q`/full-text-search field added. No Tag CRUD endpoints added (test helpers are Prisma-direct fixtures only). No frontend changes. No new Prisma migration. No changes to existing CRUD/restore/permanent-delete endpoints.

### 5. Security Concerns

- ✅ PASSED: No token/auth code touched; both new routes sit behind existing `requireAuth`, verified by 401 tests.
- ✅ PASSED: Ownership/IDOR — foreign/nonexistent `tagId` degrades to empty match set (200), not a 403/404 leak, per spec Resolved Decision #1.
- ✅ PASSED: No sensitive fields in response; no `dangerouslySetInnerHTML`/sentinel surface in this ticket.

### 6. Test Coverage Gaps

- ✅ TESTED: All FRS-2.3.1–2.3.6 scenarios incl. boundaries, unit-level pagination math, CSV parsing, cutoff-arithmetic consistency.
- ✅ Test isolation: every new contract suite re-verifies `notes_app_test` guard before truncation.
- ✅ Traceability spot-check: test names decomposed/reworded from FRS requirement text, not copy-pasted AC bullets.
- Full run: 25 test files / 181 tests passed, 0 failures; `apps/api` overall coverage 96.98% stmts (note.repository.ts/note.controller.ts/note.router.ts 100%, note.service.ts 97.56%).

### Outstanding action item (non-blocking)

`docs/SDS.md` §5.1's `filterNotesSchema` code sample still shows the superseded `tags`(name-string)/`q` design. Per `spec.md`'s Resolved Decision #1, this needs a follow-up doc-sync commit to `docs/SDS.md` to match the shipped `tagIds`-based contract — recommend tracking before/at merge.

**VERDICT: PASSED — full spec/FRS/SDS compliance verified.**

---

## Reviewer Audit Re-run (`/review AB-1005-notes-filtering-sorting`)

Independent re-verification against the 7-category NoteApp Compliance Checks table, performed directly against the working-tree diff (`git diff HEAD`, 11 tracked files + 4 new untracked contract-test files) and the four gate commands.

### 1. Shared Source of Truth (`Rule 11, FRS-8.5, SDS §1.1`)

- ✅ PASSED: `packages/shared/src/schemas/note.schema.ts` — `listNotesSchema`/`listTrashSchema` are the sole definitions; `apps/api/src/controllers/note.controller.ts:2-5` imports them from `@shared/core/schemas`, zero re-declaration.
- ✅ PASSED: `APP_LIMITS.PAGE_SIZE_DEFAULT`/`PAGE_SIZE_MAX` (`app-limits.constant.ts:14-15`), `API_PATHS.NOTES.TRASH` (`api-paths.constant.ts:17`), all five new `VALIDATION_MESSAGES` keys — every numeric/string literal in the schema traces to a named Tier-1 export, no bare `20`/`100`/`"/trash"` in `apps/api`.
- ✅ PASSED: `PaginatedNotesResponseDto`/`ListNotesQuery`/`ListTrashQuery` (`packages/shared/src/types/note.type.ts:11-12,24-27`) are the only DTOs; `note.service.ts` imports them, no shadow type in `apps/api`.

### 2. Backend Layer Isolation (`Rule 11, SDS §1.1, FRS-8.6`)

- ✅ PASSED: `note.controller.ts::list`/`listTrash` (lines 63-73) do exactly `schema.parse(req.query)` + one service call + `{ success: true, data }` wrap. Zero SQL/Prisma/Zod-definition in controller or router.
- ✅ PASSED: `note.router.ts` — pure route wiring behind `requireAuth`; `GET /trash` (line 11) registered before `GET /:id` (line 13), matching spec.md Resolved Decision #6 — verified live by `notes.list-route-order.test.ts` (200, never 404).
- ✅ PASSED: `note.service.ts::listNotes`/`listTrash` contain zero HTTP/Prisma references; `note.repository.ts::buildTagFilter`/`listActiveNotesForUser`/`countActiveNotesForUser`/`listTrashedNotesForUser`/`countTrashedNotesForUser` are pure Prisma-only, each accepting `db: Db = prisma` per the repository DI convention.
- ✅ PASSED: All routes remain namespaced under `/api/v1` (unchanged base).

### 3. Token Exfiltration & Memory (`Rule 11, FRS-1.3.5, SDS §3.1`)

- ✅ N/A — this ticket touches zero auth/token code. `requireAuth` middleware (pre-existing, untouched) is reused as-is; new 401 tests confirm the guard is still wired, not that its internals changed.

### 4. XSS Security & Sentinels (`FRS-4.2.1, SDS §4.3`)

- ✅ N/A — no `ts_headline`/search-snippet surface in this ticket (full-text search is out of scope, deferred to AB-1007 per spec.md).

### 5. Soft-Delete Lifecycle (`FRS-2.2, SDS §2.1, SDS §5.3`)

- ✅ PASSED: No `deleteMany`/physical delete introduced. `listActiveNotesForUser`/`countActiveNotesForUser` enforce `deletedAt: null`; `listTrashedNotesForUser`/`countTrashedNotesForUser` enforce `deletedAt: { not: null, gte: stage1Cutoff }` — Stage-2-and-older rows excluded by the query itself, not just the restore path, satisfying FRS-2.3.6's "query itself enforces the window" requirement.
- ✅ PASSED: `stage1Cutoff` arithmetic (`note.service.ts` `listTrash`) uses the identical `TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000` formula as the pre-existing `isWithinStage1` (line 29-33) — cross-checked by unit test `note.service.test.ts:368-389` and boundary contract tests (`daysAgo(30, 1000)` excluded / `daysAgo(29, 0)` and `daysAgo(30, -1000)` included).

### 6. Test Isolation & Derivation (`FRS-0.3.2, FRS-0.3.3, SDS §1.5`)

- ✅ PASSED: All 4 new contract suites and the extended unit suite gate on `process.env.DATABASE_URL?.includes("notes_app_test")` before `resetTestDatabase()`; live `apps/api/.env.test` confirms `DATABASE_URL` points at `notes_app_test`.
- ✅ PASSED: Test names/assertions are derived from FRS-x.y.z requirement text (e.g. "SHALL exclude a note trashed exactly 30 days and 1 second in the past") — not reworded AC bullets. Spot-checked against `spec.md` scenarios; no 1:1 AC-line copies found.
- ✅ PASSED (live run): `pnpm --filter apps/api test -- --coverage` → **25 test files / 181 tests passed, 0 failures.** Coverage 96.98% stmts / 93.68% branch / 98.97% funcs overall; `note.controller.ts` 100%, `note.repository.ts` 100%, `note.service.ts` 97.56% stmts / 100% funcs — all ≥80% gate on new code.
- ✅ PASSED (live run): `pnpm turbo run lint` → 0 warnings/errors across all 4 packages. `pnpm turbo run typecheck` → 0 errors (full cache hit, no stale diagnostics). `pnpm turbo run build` → all 4 packages built clean.

### 7. Frontend UX Compliance (`docs/ux.md, FRS §7, FRS-8.4`)

- ✅ N/A — this ticket is backend-only (`apps/api` + `packages/shared`); no `apps/web` files touched. Frontend notes-list/filter UI is explicitly out of scope, deferred to AB-1011 per spec.md.

### Findings

- ❌ MISSING: none.
- ⚠️ DRIFTED: none new — reconfirms the single pre-existing, documented/approved drift (SDS §5.1 `filterNotesSchema` code sample vs. shipped `tagIds` contract; see action item above). Non-blocking, tracked.
- 🔒 SECURITY: none.
- 📋 FRS GAP: none — FRS-2.3.1–2.3.6, FRS-8.1, FRS-8.4, FRS-8.5 all covered; FRS-2.3.5 correctly deferred to AB-1007 per spec.md's binding Out-of-Scope section.

**Note on `fix-bundles.md`:** per `AGENTS.md` §13 ("fix-bundles are not used at all"), no `fix-bundles.md` file was created for this change — this is a deliberate deviation from the generic `/review` skill template, following the project's explicit, higher-precedence instruction.

**VERDICT: PASSED — 100% FRS/SDS compliance reconfirmed via independent diff audit + live lint/typecheck/build/test gates. No regressions found.**
