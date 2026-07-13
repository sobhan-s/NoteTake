# AB-1013 — Frontend: Search UI with Highlights

## Executive Summary

Ships the missing frontend surface for the full-text search capability the backend already
completed under `AB-1007`: `GET /api/v1/search` (`searchNotesSchema`, `SearchService.searchNotes`,
`ts_headline`-based sentinel snippets) exists end-to-end today with zero consuming UI. This ticket
adds a dedicated, protected `/search` route with a debounced query input, a results list rendering
visibly highlighted matches (`FRS-7.3`), server-side pagination, and the standard loading/empty/
error states already established by `AB-1011`'s notes list. No backend or `packages/shared` schema
changes are required for the query contract itself — `searchNotesSchema`/`PaginatedSearchResponseDto`
are consumed exactly as they already exist (confirmed against
`packages/shared/src/schemas/search.schema.ts` and `packages/shared/src/types/search.type.ts`).

## Objective

Deliver a search experience where every keystroke (after a debounce) reaches the server as a fresh,
ranked query — never a client-side re-filter of a previous page — with matched terms visibly
highlighted in the results list itself, not just present in the raw API payload, and full parity
with the rest of the app's loading/empty/error/responsive conventions.

## Target Requirements

- `FRS-4.1, FRS-4.4, FRS-4.5` — full-text search over the caller's own non-deleted notes, ranked by
  relevance; consumed as-is, no behavior change to the query itself.
- `FRS-4.2, FRS-4.2.1` — matched keywords highlighted in the rendered snippet using the
  `[[[MARK]]]`/`[[[MARK_END]]]` sentinels, split and rendered client-side, never
  `dangerouslySetInnerHTML`.
- `FRS-4.3` — identical pagination rules/params to the notes list (`page`, `limit`,
  `APP_LIMITS.PAGE_SIZE_DEFAULT`/`PAGE_SIZE_MAX`).
- `FRS-7.3` — search highlighting is visible in the frontend results list (the actual gap this
  ticket closes; the backend has always returned it).
- `FRS-7.5` — usable across all four breakpoint classes, matching `SDS §4.5`'s existing
  sidebar/content shell.
- `FRS-8.4` — every query-string change (after debounce) triggers a brand-new backend request;
  zero client-side re-sort/re-filter/re-slice of an already-fetched results page.
- `FRS-8.5` — zero hardcoded numeric/copy/path literals; new values sourced from
  `@shared/core`/`apps/web/src/constants` per the 3-tier governance.

## Architectural Mappings

- `SDS §4.3` — consumes `GET /api/v1/search?q=...` exactly as documented (`ts_headline` sentinel
  snippets); the frontend `SnippetHighlight.tsx` component named in that section is what this
  ticket actually builds (it did not exist before now).
- `SDS §4.5` — reuses the same responsive shell described for the editor (`>=1024px` persistent
  `260px` `<SidebarNav />`, `<1024px` slide-over `<Sheet />`), applied to the new `/search` page.
- `SDS §5.1` — `useSearchNotes` follows the same TanStack Query key-factory pattern as
  `useActiveNotes`/`useTrash` (`['search', { q, page, limit }]`), targeted invalidation N/A (search
  has no mutations).
- `docs/ux.md §1, §3, §9` — loading skeletons + `200ms` minimum display timer, the search-specific
  empty-state exception (no primary CTA button, exact copy quoted in `ux.md §3`), and a11y
  (labelled input, visible focus rings).
- `apps/web/CLAUDE.md` — `300ms` search-debounce rule (already documented there, previously
  unimplemented) and the `useDebounce` hook it names.
- `packages/shared/CLAUDE.md` — Zero Duplication Contract: no new/duplicated Zod schema; the
  existing `searchNotesSchema`/DTOs remain the single source of truth for this contract.

## Out of Scope

- **Tag-filter combo in the search UI.** `searchNotesSchema` and `SearchService.searchNotes` already
  accept/apply `tagIds`/`tagMode` end-to-end, but `FRS-4` documents search as text-only and lists
  tag-combo behavior as undocumented scope drift. This ticket's UI sends only `q`/`page`/`limit` —
  the existing backend tag-filter capability remains unexposed until a future ticket deliberately
  specs the combined UI (see Decision D1).
- **Global `Ctrl`/`Cmd`+`K` command-palette shortcut.** Mentioned in `docs/ux.md §9`'s Accessibility
  section but not required by any `AB-1013` Acceptance Criteria line; deferred to a later ticket
  (Decision D2). This ticket ships a discoverable sidebar nav entry instead.
- **Fuzzy/typo-tolerant search, cross-user search** — `FRS-4` Out of Scope, unchanged.
- **Deep-linking/scroll-to-match inside the note editor** when a result is clicked — clicking a
  result navigates to `/notes/:id` and opens the normal editor; no in-editor highlight/scroll
  behavior is introduced.
- **Recent-searches / search history** — not mentioned anywhere in `FRS`/`SDS`; not built.
- **Tag chips or share/trash status on result rows** — `SearchResultResponseDto` only has
  `id, title, snippet, updatedAt`; no additional round-trip is introduced to fetch tags for search
  rows.

## Decisions Log (resolved with user before drafting)

- **D1 — Text-only search UI.** Confirmed with user: keep this ticket strictly to what `FRS-4`
  documents (query box, highlighted results, pagination). The backend's existing `tagIds`/`tagMode`
  support on `GET /api/v1/search` stays present but unused by this ticket's frontend — no regression,
  just deferred UI.
- **D2 — No `Ctrl`/`Cmd`+`K` shortcut in this ticket.** Confirmed with user: out of scope for
  `AB-1013`; a plain sidebar nav entry is the only entry point this ticket builds.
- **D3 — Dedicated `/search` route (not an inline bar on `/notes`).** Confirmed with user: matches
  `docs/ux.md §6`'s protected-route list (`/notes/*, /tags/*, /search, /trash`), keeps the query
  string shareable/back-button-friendly, and keeps `NotesPage` untouched.
- **D4 — Sidebar nav entry added.** Confirmed with user: `SidebarNav` gains a third "Search" button
  next to "Active Notes"/"Trash". Since `SidebarNav` is rendered both inside `NotesPage` (tab-based)
  and now standalone on `SearchPage` (route-based), its active-state highlighting switches from the
  current `activeTab` prop alone to also checking `useLocation().pathname === "/search"` for the new
  button; the existing "Active Notes"/"Trash" buttons additionally call `navigate("/notes")` before
  invoking `onTabChange` so they work correctly when clicked from the `/search` page.
- **D5 — Debounce value: `300ms`.** Matches the existing (previously unenforced) rule in
  `apps/web/CLAUDE.md` ("Debounce search input keystrokes (300ms) before updating TanStack Query
  param (q)"); implemented as a new named constant rather than a magic number.
- **D6 — Empty (pre-query) state vs. zero-results state are visually distinct.** Before the user has
  typed anything, the page shows a neutral prompt ("Start typing to search your notes") with no
  network request fired at all (guards against `FRS-4`'s "empty query → rejected" error scenario by
  simply never sending one). Once a non-empty query returns zero rows, the dedicated
  `UI_COPY.EMPTY_SEARCH_RESULTS` empty state renders instead (`docs/ux.md §3` exception — no CTA
  button).

## Shared Package Additions (`packages/shared`)

- **MODIFIED** `src/constants/ui-copy.constant.ts`: `UI_COPY` gains
  `EMPTY_SEARCH_RESULTS: "No notes matching query — try different keywords or search sentinels"`
  (exact `docs/ux.md §3` wording).
- **NO** changes to `src/schemas/search.schema.ts`, `src/types/search.type.ts`,
  `src/constants/api-paths.constant.ts`, or `src/constants/app-limits.constant.ts` — the existing
  `searchNotesSchema`/`PaginatedSearchResponseDto`/`API_PATHS.SEARCH.ROOT`/`APP_LIMITS.PAGE_SIZE_*`
  are consumed unchanged.

## Backend Additions (`apps/api`)

- **NONE.** `AB-1007` already shipped `search.router.ts` → `search.controller.ts` →
  `search.service.ts` → `note.repository.ts` (`searchNotesForUser`/`countSearchNotesForUser`)
  complete, including the `ts_headline` sentinel snippet generation and owner/soft-delete
  filtering. This ticket is frontend-only.

## Frontend Additions (`apps/web`)

- **NEW** `src/constants/ui.constant.ts`: adds `SEARCH_DEBOUNCE_MS = 300` (Tier-3, frontend-only,
  per `AGENTS.md §5`, Decision D5).
- **NEW** `src/hooks/useDebounce.ts`: generic value-debouncing hook (first consumer of a
  general-purpose debounce utility; `useNoteAutosave`'s existing debounce logic is
  autosave-specific and is not refactored to share this hook in this ticket).
- **NEW** `src/api/search.api.ts`: `searchNotes(params: Partial<SearchNotesQuery>)` calling
  `GET /api/v1/search` via the existing `httpClient`, mirroring `notes.api.ts`'s shape.
- **NEW** `src/hooks/useSearchNotes.ts`: TanStack Query hook, `queryKey: ['search', 'list', params]`,
  `enabled: params.q.trim().length > 0` (client-side guard against ever sending an empty/whitespace
  query — Decision D6).
- **NEW** `src/pages/SearchPage.tsx`: the `/search` route page; reuses the same responsive
  sidebar/content shell as `NotesPage` (`SidebarNav` + mobile `Sheet`, per `SDS §4.5`).
- **NEW** `src/components/search/SearchInput.tsx`: controlled text input wired through
  `useDebounce`/`SEARCH_DEBOUNCE_MS`, resets result pagination to page `1` on every raw (undebounced)
  keystroke.
- **NEW** `src/components/search/SnippetHighlight.tsx`: splits a `snippet` string on
  `/(\[\[\[MARK\]\]\]|\[\[\[MARK_END\]\]\])/g` (`SDS §4.3`) and renders matched spans inside
  `<mark className="bg-amber-200 text-amber-950 font-semibold px-1 rounded">`; plain React nodes
  only, never `dangerouslySetInnerHTML` (`FRS-4.2.1`).
- **NEW** `src/components/search/SearchResultsList.tsx`: owns the loading-skeleton / pre-query-
  prompt / zero-results / results-grid branching (mirrors `NotesList.tsx`'s existing branching
  pattern) and renders `PaginationControl` when `pagination.total > 0`.
- **NEW** `src/components/search/SearchResultRow.tsx`: renders `title`, `<SnippetHighlight
snippet={snippet} />`, and formatted `updatedAt`; clicking navigates to `/notes/:id`.
- **MODIFIED** `src/components/layout/SidebarNav.tsx`: adds a third "Search" nav button
  (`lucide-react` `Search` icon) that calls `navigate("/search")`; active-state highlighting for all
  three buttons now also considers `useLocation().pathname` (Decision D4); the existing
  `onTabChange` prop becomes optional, called only from the "Active Notes"/"Trash" buttons which now
  also `navigate("/notes")` first.
- **MODIFIED** `src/App.tsx`: adds a new protected route, `<Route path="/search"
element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />`.

## ADDED Requirements

### Requirement: Search route requires authentication

The `/search` route SHALL require an active authenticated session, identical to other protected routes.

#### Scenario: Unauthenticated visitor navigates to /search

- **WHEN** an unauthenticated visitor navigates directly to `/search`
- **THEN** the existing `<ProtectedRoute>` SHALL redirect to `/login` unchanged — this ticket adds
  no new guard logic (`docs/ux.md §6`).

### Requirement: No request fires for an empty or whitespace-only query

The search page SHALL NOT call the search endpoint while the query is empty or whitespace-only.

#### Scenario: Landing on /search with no query typed yet

- **WHEN** the user lands on `/search` and has typed nothing (or only whitespace)
- **THEN** the frontend SHALL NOT call `GET /api/v1/search`
- **AND** SHALL render a neutral prompt state ("Start typing to search your notes") — distinct from
  both the loading skeleton and the zero-results empty state (Decision D6).

### Requirement: Debounced query triggers a fresh backend search request

Every change to the search query SHALL, after a 300ms debounce, issue a brand-new backend request rather than filtering existing results.

#### Scenario: User types a search query

- **WHEN** the user types into the search input and stops for `SEARCH_DEBOUNCE_MS` (`300ms`,
  Decision D5)
- **THEN** the frontend SHALL call `GET /api/v1/search` with the current trimmed query, resetting
  `page` to `1`
- **AND** SHALL NOT locally filter, sort, or slice any previously fetched results page (`FRS-8.4`).

### Requirement: Matched terms render visibly highlighted

Search results SHALL render highlighted matches in the UI, not just in the raw API response.

#### Scenario: Result snippet contains a sentinel-marked match

- **WHEN** a search result's `snippet` field contains `[[[MARK]]]...[[[MARK_END]]]` sentinels
- **THEN** `SnippetHighlight` SHALL split the string on those sentinels and render the matched
  portion inside a visibly styled `<mark>` element
- **AND** SHALL NOT use `dangerouslySetInnerHTML` or render any raw HTML tags from the response
  (`FRS-4.2.1`).

### Requirement: Zero-results state for a genuine non-empty query

A non-empty query that matches no notes SHALL render a dedicated empty state without a primary action button.

#### Scenario: Query returns zero matches

- **WHEN** a non-empty, non-whitespace query's response has `pagination.total === 0`
- **THEN** the frontend SHALL render an empty state using `UI_COPY.EMPTY_SEARCH_RESULTS`
- **AND** SHALL NOT render a primary CTA button (`docs/ux.md §3` search exception — the active input
  is already the recovery path).

### Requirement: Search pagination requests fresh backend pages

Changing the search results page SHALL always request the new page from the backend, never re-slice an in-memory results array.

#### Scenario: User changes search results page

- **WHEN** the user clicks a `PaginationControl` next/previous action on `/search`
- **THEN** the frontend SHALL call `GET /api/v1/search` with the new `page` value and the
  currently-active query
- **AND** SHALL NOT reuse or re-slice a previously fetched page's `results` array (`FRS-4.3,
FRS-8.4`).

### Requirement: Search loading state matches list-loading conventions

The search results area SHALL show skeleton placeholders while a query is in flight, held for a minimum display duration.

#### Scenario: Search request is in flight

- **WHEN** a debounced search request is in flight
- **THEN** the frontend SHALL render skeleton rows matching the final result row's height
- **AND** SHALL hold the loading state for at least `200ms` (`useMinLoadingTime`, `docs/ux.md §1`)
  even if the response completes faster.

### Requirement: Clicking a search result opens the note editor

Clicking any search result row SHALL navigate to that note's editor page.

#### Scenario: User clicks a search result

- **WHEN** the user clicks a `SearchResultRow`
- **THEN** the frontend SHALL navigate to `/notes/:id` using that result's `id`
- **AND** no in-editor scroll-to-match or highlight-carryover behavior is triggered (Out of Scope).

### Requirement: Search request failure shows a recoverable error state

A failed search request SHALL surface a page-level error state with an explicit retry action, never a blank or partially-rendered results area.

#### Scenario: Search request fails (network or 5xx)

- **WHEN** `GET /api/v1/search` fails (network error or `5xx`)
- **THEN** the frontend SHALL render `<ErrorFallback />` with a "Retry" action, matching the existing
  `NotesPage` error-handling pattern
- **AND** SHALL NOT render stale/partial results underneath the error state.

### Requirement: Sidebar Search nav entry

SidebarNav SHALL expose a discoverable Search entry point alongside Active Notes and Trash.

#### Scenario: User clicks the Search nav button

- **WHEN** the user clicks the new "Search" button in `SidebarNav` (from any page it is rendered on)
- **THEN** the frontend SHALL navigate to `/search` and focus the search input
- **AND** the button SHALL render in an active/highlighted state whenever `location.pathname ===
"/search"` (Decision D4).

### Requirement: Responsive search layout

The search page SHALL adapt its layout across breakpoints identically to the notes list/editor shell.

#### Scenario: Search page at each breakpoint

- **WHEN** the viewport is `>= 1024px`
- **THEN** `SearchPage` SHALL render the persistent `260px` `<SidebarNav />` alongside the search
  input/results column (`SDS §4.5`)
- **WHEN** the viewport is `< 1024px`
- **THEN** the sidebar SHALL collapse into the existing slide-over `<Sheet />` overlay, and the
  search input/results SHALL occupy 100% viewport width (`FRS-7.5`).

## MODIFIED Requirements

### Requirement: SidebarNav active-state resolution

SidebarNav SHALL resolve which nav button is active using both its activeTab prop and the current route location, to support being rendered from routes outside NotesPage.

#### Scenario: SidebarNav rendered from SearchPage

- **WHEN** `SidebarNav` is rendered standalone from `SearchPage` (no `NotesPage` tab context)
- **THEN** it SHALL highlight the "Search" button via `useLocation().pathname === "/search"`
  rather than relying solely on the `activeTab` prop
- **AND** clicking "Active Notes" or "Trash" from this context SHALL first `navigate("/notes")`
  before invoking `onTabChange` (now optional), so navigation away from `/search` works correctly.

## Error Scenarios

- Client never sends `GET /api/v1/search` with an empty/whitespace `q` (guarded before the request
  leaves the browser) — the documented backend `400` rejection (`FRS-4` Error Scenarios) is a
  defense-in-depth guarantee this ticket does not need to trigger in normal use.
- Special-character queries (e.g. `&`, `'`, `--`) are passed through to the backend exactly as
  typed, untouched by any client-side escaping/sanitization — safe parameterization is the
  backend's existing `plainto_tsquery`-based guarantee (`FRS-4` Error Scenarios), not re-implemented
  here.
- Navigating to `/search` unauthenticated → redirected to `/login`, no request attempted.
- Network/`5xx` failure mid-search → `<ErrorFallback />` with retry; no partial or stale results
  rendered underneath (see dedicated Scenario above).

## Out-of-Scope Boundary Recap (binding)

Tag-filter combo UI on `/search` (Decision D1), global `Ctrl`/`Cmd`+`K` shortcut (Decision D2),
fuzzy/typo-tolerant search and cross-user search (`FRS-4`, unchanged), in-editor deep-linking/
scroll-to-match for a clicked result, recent-searches/search history, and tag/share/trash-status
chips on result rows — plus everything listed under "Out of Scope" above.
