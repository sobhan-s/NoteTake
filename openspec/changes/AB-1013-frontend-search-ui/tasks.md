# Sequenced Tasks for AB-1013-frontend-search-ui

Change: `openspec/changes/AB-1013-frontend-search-ui/` · Scope: `FRONTEND` only (`AB-1010..AB-1015` range).
Zero backend/`packages/shared` schema changes — `AB-1007`'s `search.router.ts → search.controller.ts →
search.service.ts → note.repository.ts` stack is consumed unchanged. Layering for this ticket follows
`apps/web`'s `store/ → api/ → hooks/ → components/ → pages/` chain (no backend layers touched).

## Phase 1: Foundation & Shared Tier (`@shared/core`)

- [x] `packages/shared/src/constants/ui-copy.constant.ts`: Add `EMPTY_SEARCH_RESULTS: "No notes matching query — try different keywords or search sentinels"` to the existing `UI_COPY` object (Tier 1 constant, `Rule 11`) (`[FRS-8.5]`).
- [x] Confirm **no** changes to `packages/shared/src/schemas/search.schema.ts`, `src/types/search.type.ts`, `src/constants/api-paths.constant.ts`, `src/constants/app-limits.constant.ts` — `searchNotesSchema`/`SearchNotesQuery`/`SearchResultResponseDto`/`PaginatedSearchResponseDto`/`API_PATHS.SEARCH.ROOT`/`APP_LIMITS.PAGE_SIZE_*` are consumed exactly as they exist today; zero duplication (`Rule 11, FRS-8.5`) (`[FRS-4.1, FRS-4.3]`).
- [x] `apps/web/src/constants/ui.constant.ts`: Add `export const SEARCH_DEBOUNCE_MS = 300;` (Tier 3, frontend-only constant, Decision D5) (`[FRS-8.5]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/web` — `api/ → hooks/ → components/ → pages/`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop. No `store/` layer changes — query/page state is local `useState` in `SearchPage`, mirroring `NotesPage`'s `filters` pattern.)_

- [x] `apps/web/src/hooks/useDebounce.ts` (NEW): Implement generic `useDebounce<T>(value: T, delayMs: number): T` via `useState` + `useEffect`/`setTimeout`/`clearTimeout`. Zero dependency on `useNoteAutosave`'s autosave-specific debounce logic (`[FRS-8.4]`).
- [x] `apps/web/src/api/search.api.ts` (NEW): Implement `searchNotes(params: Partial<SearchNotesQuery>): Promise<PaginatedSearchResponseDto>` calling `httpClient.get(API_PATHS.SEARCH.ROOT, { params })`, unwrapping `response.data.data`, mirroring `notes.api.ts`'s `listNotes` shape exactly. Sends only `{ q, page, limit }` — `tagIds`/`tagMode` never populated (Decision D1) (`[FRS-4.1, FRS-4.4, FRS-4.5]`).
- [x] `apps/web/src/hooks/useSearchNotes.ts` (NEW): Implement TanStack Query hook, `queryKey: ["search", "list", params]`, `queryFn: () => searchNotes(params)`, `enabled: (params.q ?? "").trim().length > 0` — client-side guard against sending an empty/whitespace query (Decision D6) (`[FRS-4.1, FRS-8.4]`).
- [x] `apps/web/src/components/search/SnippetHighlight.tsx` (NEW): Implement `SnippetHighlightProps { snippet: string }`; split on `/(\[\[\[MARK\]\]\]|\[\[\[MARK_END\]\]\])/g`, render matched segments inside `<mark className="bg-amber-200 text-amber-950 font-semibold px-1 rounded">`, plain text otherwise. Zero `dangerouslySetInnerHTML`, zero raw HTML rendering (`[FRS-4.2, FRS-4.2.1, FRS-7.3]`).
- [x] `apps/web/src/components/search/SearchResultRow.tsx` (NEW): Implement `SearchResultRowProps { result: SearchResultResponseDto }`; `onClick` navigates to `/notes/${result.id}`; renders `title`, `<SnippetHighlight snippet={result.snippet} />`, formatted `updatedAt` (reuse `NoteCard.tsx`'s existing date-format util — confirm exact import at implementation time, do not introduce a second formatter) (`[FRS-4.2, FRS-7.3]`).
- [x] `apps/web/src/components/search/SearchResultsList.tsx` (NEW): Implement `SearchResultsListProps { hasQuery, isLoading, results, pagination?, onPageChange }`; branching order mirrors `NotesList.tsx`: `!hasQuery` → neutral prompt `EmptyState` ("Start typing to search your notes", no action) → `isLoading` → skeleton rows (`<Skeleton className="h-20 w-full rounded-lg" />`, local `SKELETON_ROW_COUNT` constant) → `results.length === 0` → `EmptyState` with `UI_COPY.EMPTY_SEARCH_RESULTS`, no `action` prop → else `results.map(SearchResultRow)` + `PaginationControl` when `pagination.total > 0` (`[FRS-4.3, FRS-7.3, FRS-8.4]`).
- [x] `apps/web/src/components/search/SearchInput.tsx` (NEW): Implement `SearchInputProps { value: string; onChange: (value: string) => void }`; plain controlled `shadcn/ui` `<Input>`, `aria-label="Search notes"`, autofocus. Debouncing lives in the parent `SearchPage`, not this component (`[FRS-7.5]`).
- [x] `apps/web/src/components/layout/SidebarNav.tsx` (MODIFIED): Change `SidebarNavProps` to `{ activeTab?: NotesTab; onTabChange?: (tab: NotesTab) => void }`; add `useLocation()`; add a third "Search" button (`lucide-react` `Search` icon) with `onClick={() => navigate("/search")}`, active when `location.pathname === "/search"`; change existing "Active Notes"/"Trash" buttons' active-state to `location.pathname === "/notes" && activeTab === "active"`/`"trash"` and `onClick` to `() => { navigate("/notes"); onTabChange?.("active"|"trash"); }` (Decision D4). Confirm `NotesPage`'s existing call sites need zero changes (`[FRS-7.3, FRS-7.5]`, MODIFIED Requirement: SidebarNav active-state resolution).
- [x] `apps/web/src/pages/SearchPage.tsx` (NEW): Implement local `query`/`page` `useState`; `debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)`; reset `page` to `1` on every raw keystroke; `params = { q: debouncedQuery.trim(), page, limit: APP_LIMITS.PAGE_SIZE_DEFAULT }`; `useSearchNotes(params)`; `useMinLoadingTime`; identical responsive shell to `NotesPage` (persistent `SidebarNav` + mobile `Sheet` via `useUiStore`), `SidebarNav` rendered without `activeTab`/`onTabChange`; `searchQuery.isError ? <ErrorFallback onRetry={...} /> : <SearchResultsList ... />` (`[FRS-4.1, FRS-4.3, FRS-7.3, FRS-7.5, FRS-8.4]`).
- [x] `apps/web/src/App.tsx` (MODIFIED): Add `<Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />` alongside the existing `/notes`/`/notes/:id` protected routes, before the catch-all `*` redirect (`[FRS-7.5]`, ADDED Requirement: Search route requires authentication).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

_(Tests derived solely from numbered `FRS-x.y.z` requirement text and this spec's Scenarios — never from AC bullet wording. All frontend unit tests use Vitest + Testing Library with mocked `httpClient`; zero real DB connection, per the `tests/unit/` convention established in `AB-1011`.)_

- [x] `apps/web/tests/unit/hooks/useDebounce.test.ts`: returns initial value immediately; only updates after `delayMs` (fake timers); resets timer on rapid value changes (`[FRS-8.4]`).
- [x] `apps/web/tests/unit/hooks/useSearchNotes.test.ts`: `enabled: false` (no `queryFn` invocation) for `""`/whitespace `q`; fires with trimmed `q`/`page`/`limit` for a real query; query key includes params (`[FRS-4.1, FRS-8.4]`).
- [x] `apps/web/tests/unit/components/search/SnippetHighlight.test.tsx`: wraps sentinel-marked segment in `<mark>`; renders plain text with zero sentinels unchanged; asserts no `dangerouslySetInnerHTML` present; malicious `<script>` content in snippet renders as literal text, not executed markup (`[FRS-4.2.1]`).
- [x] `apps/web/tests/unit/components/search/SearchResultsList.test.tsx`: `hasQuery=false` → prompt state, zero network call; `isLoading` → skeleton rows; `results=[]` with query → `EMPTY_SEARCH_RESULTS` empty state with no action button; non-empty → rows + `PaginationControl` only when `pagination.total > 0` (`[FRS-4.3, FRS-7.3, FRS-8.4]`).
- [x] `apps/web/tests/unit/components/search/SearchResultRow.test.tsx`: clicking a row navigates to `/notes/:id` (`[FRS-7.3]`).
- [x] `apps/web/tests/unit/components/layout/SidebarNav.test.tsx`: Search button active only on `/search`; Active/Trash buttons navigate to `/notes` then call `onTabChange`; renders with `activeTab`/`onTabChange` omitted (standalone usage) without throwing (`[FRS-7.3, FRS-7.5]`).
- [x] `apps/web/tests/unit/pages/SearchPage.test.tsx`: debounced keystroke → single fresh request with `page` reset to `1`; page-change → new request, same query, no client-side re-slice of prior results; request failure → `ErrorFallback` with working retry, no stale results underneath; unauthenticated render redirects via existing `ProtectedRoute` (smoke-level only) (`[FRS-4.1, FRS-4.3, FRS-8.4]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — 100% green, ≥80% coverage on all new files (`src/hooks/useDebounce.ts`, `src/api/search.api.ts`, `src/hooks/useSearchNotes.ts`, `src/components/search/*`, `src/pages/SearchPage.tsx`) and the modified branches in `src/components/layout/SidebarNav.tsx`.

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta (`openspec/changes/AB-1013-frontend-search-ui/specs/notes/spec.md`).
- [x] Run `/review AB-1013-frontend-search-ui` (`reviewer` agent checks: zero `apps/api`/schema changes, `SnippetHighlight` has zero `dangerouslySetInnerHTML`, `SidebarNav` active-state/optional-prop correctness, no client-side re-filter/re-sort of fetched pages, no hardcoded `/api/v1/search` string, 3-tier constants respected, out-of-scope boundary — D1/D2/tag chips/recent-history — not silently implemented).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1013-frontend-search-ui` (where `openspec archive` takes place).

## Out-of-Scope Boundary (binding — do not implement while executing the tasks above)

Tag-filter combo UI (Decision D1), global `Ctrl`/`Cmd`+`K` shortcut (Decision D2), fuzzy/typo-tolerant
or cross-user search, in-editor deep-link/scroll-to-match on result click, recent-searches history,
tag/share/trash-status chips on result rows. Flag to the user if any task above appears to require
expanding into one of these.
