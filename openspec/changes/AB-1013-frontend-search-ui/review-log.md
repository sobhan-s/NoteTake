# Review Log — AB-1013-frontend-search-ui

Sole tracking log for gaps, architectural drift, and action items on this change (`fix-bundles` not used).

## Implementation Summary

Phase 1 (Foundation) and Phase 2 (Core Implementation) complete per `tasks.md`:

- `packages/shared/src/constants/ui-copy.constant.ts` — added `EMPTY_SEARCH_RESULTS`.
- `apps/web/src/constants/ui.constant.ts` — added `SEARCH_DEBOUNCE_MS = 300`.
- `apps/web/src/hooks/useDebounce.ts` (NEW)
- `apps/web/src/api/search.api.ts` (NEW)
- `apps/web/src/hooks/useSearchNotes.ts` (NEW)
- `apps/web/src/components/search/SnippetHighlight.tsx` (NEW)
- `apps/web/src/components/search/SearchResultRow.tsx` (NEW)
- `apps/web/src/components/search/SearchResultsList.tsx` (NEW)
- `apps/web/src/components/search/SearchInput.tsx` (NEW)
- `apps/web/src/components/layout/SidebarNav.tsx` (MODIFIED — optional props, route-aware active state, Search button)
- `apps/web/src/components/notes/NoteCard.tsx` (MODIFIED — exported `formatUpdatedAt` so `SearchResultRow` can reuse it without introducing a second formatter; deviation from plan's file list, approved by user)
- `apps/web/src/pages/SearchPage.tsx` (NEW)
- `apps/web/src/App.tsx` (MODIFIED — added `/search` protected route)

Phase 1 & 2 checkpoint: `pnpm turbo run build` / `lint --max-warnings 0` / `typecheck` — all green.

## Phase 3 — test-writer

7 new test files added under `apps/web/tests/unit/{hooks,components/search,components/layout,pages}/`.
`pnpm --filter @apps/web test -- --coverage` → 100% pass (143 tests, 31 files). Coverage 100% on all new
files except `search.api.ts` (0%, thin axios wrapper, mocked at module boundary everywhere — matches
existing `notes.api.ts`/`auth.api.ts` convention) and `SearchPage.tsx` (94.11% stmts — untested branch is
the mobile `Sheet onOpenChange` toggle plumbing, mirrors the same untested pattern in the pre-existing
`NotesPage.test.tsx`).

## Phase 4 — reviewer audit

**Mandatory NoteApp Checklist (10 items):**

1. ✅ PASSED — `packages/shared` untouched except `ui-copy.constant.ts` (`EMPTY_SEARCH_RESULTS` addition); `search.schema.ts`/`search.type.ts`/`api-paths.constant.ts`/`app-limits.constant.ts` confirmed byte-identical to pre-ticket contract.
2. ✅ PASSED — no hand-rolled Zod schemas in `apps/web`; `search.api.ts`/`useSearchNotes.ts` import types from `@shared/core/types` only.
3. ✅ PASSED — `SnippetHighlight.tsx` uses plain string `.split()` + React nodes only; zero `dangerouslySetInnerHTML` (grep-confirmed zero matches in `apps/web/src`).
4. ✅ PASSED — N/A, `httpClient` untouched, no token-storage changes.
5. ✅ PASSED — N/A, search UI is read-only.
6. ✅ PASSED — `SEARCH_DEBOUNCE_MS = 300` is the sole reference point (`ui.constant.ts`, imported in `SearchPage.tsx`); `API_PATHS.SEARCH.ROOT` used, no literal `/search`/`/api/v1/search` string anywhere.
7. ✅ PASSED — zero `.filter()`/`.sort()`/`.slice()` on fetched results; every param change produces a new `['search','list',params]` query key.
8. ✅ PASSED — `SidebarNav.tsx` matches Decision D4 exactly (optional props, `useLocation()`-based active state, navigate-then-callback ordering).
9. ✅ PASSED — none of D1/D2/fuzzy/cross-user/deep-link/recent-history/status-chips implemented (grep-confirmed zero `tagIds`/`tagMode` references in new search files).
10. ✅ PASSED — `SearchResultsList.tsx` branching order matches spec exactly (`!hasQuery` → `isLoading` → `results.length===0` → rows+pagination gated on `pagination.total > 0`).

**Spec Scenario Coverage:** all 12 ADDED/MODIFIED Requirement scenarios in `specs/notes/spec.md` traced to a passing test. One non-blocking note: ⚠️ WARN — `SearchPage.test.tsx` lacks a dedicated smoke test for the persistent-sidebar-vs-mobile-Sheet responsive shell (implementation itself correctly mirrors `NotesPage.tsx`'s shell per SDS §4.5; `NotesPage.test.tsx` has an equivalent smoke test, `SearchPage.test.tsx` does not). Not a functional or compliance defect.

**SDS Contract Adherence:** ✅ `GET /api/v1/search` consumed via `API_PATHS.SEARCH.ROOT`, no hardcoded path. ✅ `SnippetHighlight.tsx` regex/className exactly matches `docs/SDS.md` §4.3 spec.

**Security:** 🔒 none found.

**Result:** 0 ❌ MISSING, 0 🔒 SECURITY, 1 ⚠️ WARN (test-coverage nicety only). Ticket clears Phase 4 review.
