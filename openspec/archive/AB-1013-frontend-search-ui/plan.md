# AB-1013 — Frontend: Search UI with Highlights — Implementation Plan

Change: `openspec/changes/AB-1013-frontend-search-ui/` · Spec: `specs/notes/spec.md` (approved)
Scope: `FRONTEND` only (AB-1010..1015 range). Zero backend changes — `AB-1007`'s
`search.router.ts → search.controller.ts → search.service.ts → note.repository.ts` stack is
consumed unchanged.

## 0. Sequencing (build bottom-up, each step independently verifiable)

1. Shared: `UI_COPY.EMPTY_SEARCH_RESULTS` constant.
2. Frontend Tier-3 constant: `SEARCH_DEBOUNCE_MS`.
3. `useDebounce` (generic hook, no dependencies on the rest of the feature).
4. `search.api.ts` (API client fn).
5. `useSearchNotes` (TanStack Query hook, depends on 4).
6. `SnippetHighlight` (pure presentational, no dependencies).
7. `SearchResultRow` (depends on 6).
8. `SearchResultsList` (depends on 5, 7, existing `Skeleton`/`EmptyState`/`PaginationControl`).
9. `SearchInput` (depends on 3).
10. `SidebarNav` MODIFIED (route-aware active state + Search button).
11. `SearchPage` (composes 5, 9, 10, existing `Sheet`/`ErrorFallback`/`useMinLoadingTime`).
12. `App.tsx` MODIFIED (new `/search` route).
13. Tests written alongside each unit above (see §5), not batched at the end.

## 1. Exact Layered File Paths

### `packages/shared` (`@shared/core`)

| Path                                   | Change                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `src/constants/ui-copy.constant.ts`    | MODIFIED — add `EMPTY_SEARCH_RESULTS`                               |
| `src/schemas/search.schema.ts`         | **untouched**                                                       |
| `src/types/search.type.ts`             | **untouched**                                                       |
| `src/constants/api-paths.constant.ts`  | **untouched** (`API_PATHS.SEARCH.ROOT = "/search"` already present) |
| `src/constants/app-limits.constant.ts` | **untouched**                                                       |

### `apps/web` (`store/ → api/ → hooks/ → components/ → pages/`)

| Path                                          | Change                                    |
| --------------------------------------------- | ----------------------------------------- |
| `src/constants/ui.constant.ts`                | MODIFIED — add `SEARCH_DEBOUNCE_MS = 300` |
| `src/hooks/useDebounce.ts`                    | NEW                                       |
| `src/api/search.api.ts`                       | NEW                                       |
| `src/hooks/useSearchNotes.ts`                 | NEW                                       |
| `src/components/search/SnippetHighlight.tsx`  | NEW                                       |
| `src/components/search/SearchResultRow.tsx`   | NEW                                       |
| `src/components/search/SearchResultsList.tsx` | NEW                                       |
| `src/components/search/SearchInput.tsx`       | NEW                                       |
| `src/components/layout/SidebarNav.tsx`        | MODIFIED                                  |
| `src/pages/SearchPage.tsx`                    | NEW                                       |
| `src/App.tsx`                                 | MODIFIED                                  |

No `store/` changes — search has no ephemeral UI-toggle state worth Zustand (query/page live as
local `useState` in `SearchPage`, mirroring `NotesPage`'s `filters` pattern).

## 2. Single Source of Truth — exact shapes consumed (no new schema/type work)

```ts
// packages/shared/src/schemas/search.schema.ts (existing, unchanged)
searchNotesSchema: { q: string (trim, min 1), page: number (default 1),
  limit: number (default APP_LIMITS.PAGE_SIZE_DEFAULT, max APP_LIMITS.PAGE_SIZE_MAX),
  tagIds?: string, tagMode: "ALL" | "ANY" (default "ALL") }

// packages/shared/src/types/search.type.ts (existing, unchanged)
SearchNotesQuery = z.infer<typeof searchNotesSchema>
SearchResultResponseDto = { id, title, snippet, updatedAt }
PaginatedSearchResponseDto = { results: SearchResultResponseDto[], pagination: { page, limit, total, totalPages } }
```

`src/api/search.api.ts` sends only `{ q, page, limit }` (Decision D1 — `tagIds`/`tagMode` fields
exist on the type but are never populated by this ticket's UI).

```ts
// packages/shared/src/constants/ui-copy.constant.ts — ADD ONE LINE
export const UI_COPY = {
  ...
  EMPTY_SEARCH_RESULTS:
    "No notes matching query — try different keywords or search sentinels",
} as const;
```

```ts
// apps/web/src/constants/ui.constant.ts — ADD ONE LINE
export const SEARCH_DEBOUNCE_MS = 300;
```

Zero Duplication Contract check: no new Zod schema, no hand-written interface duplicating
`SearchResultResponseDto`/`PaginatedSearchResponseDto`, no hardcoded `/api/v1/search` string
anywhere in `apps/web` (always via `API_PATHS.SEARCH.ROOT`).

## 3. New Unit Specs

### `src/hooks/useDebounce.ts`

```ts
export function useDebounce<T>(value: T, delayMs: number): T;
```

Standard `useState` + `useEffect(() => { const t = setTimeout(...); return () => clearTimeout(t) }, [value, delayMs])`.
No dependency on `useNoteAutosave` (that hook's debounce is autosave-specific per spec — not refactored here).

### `src/api/search.api.ts`

```ts
import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  PaginatedSearchResponseDto,
  SearchNotesQuery,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

export async function searchNotes(
  params: Partial<SearchNotesQuery>,
): Promise<PaginatedSearchResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<PaginatedSearchResponseDto>
  >(API_PATHS.SEARCH.ROOT, { params });
  return response.data.data;
}
```

Mirrors `notes.api.ts`'s `listNotes` shape exactly (same `ApiSuccessResponse<T>` unwrap pattern).

### `src/hooks/useSearchNotes.ts`

```ts
export function useSearchNotes(params: Partial<SearchNotesQuery>) {
  return useQuery({
    queryKey: ["search", "list", params],
    queryFn: () => searchNotes(params),
    enabled: (params.q ?? "").trim().length > 0,
  });
}
```

`enabled` guard is the client-side enforcement of "no request fires for empty/whitespace query"
(spec Requirement, Decision D6). Mirrors `useActiveNotes`'s key-factory pattern exactly.

### `src/components/search/SnippetHighlight.tsx`

```ts
export interface SnippetHighlightProps {
  snippet: string;
}
export function SnippetHighlight({ snippet }: SnippetHighlightProps);
```

Split on `/(\[\[\[MARK\]\]\]|\[\[\[MARK_END\]\]\])/g`, track an "inside-mark" boolean toggled by
which sentinel was consumed, render plain text segments as React fragments and matched segments as
`<mark className="bg-amber-200 text-amber-950 font-semibold px-1 rounded">`. Zero
`dangerouslySetInnerHTML`, zero raw HTML parsing (`FRS-4.2.1`).

### `src/components/search/SearchResultRow.tsx`

```ts
export interface SearchResultRowProps {
  result: SearchResultResponseDto;
}
export function SearchResultRow({ result }: SearchResultRowProps);
```

`onClick={() => navigate(`/notes/${result.id}`)}`, renders `title`, `<SnippetHighlight snippet={result.snippet} />`,
formatted `updatedAt` (reuse whatever date-format util `NoteCard.tsx` already uses — confirm at
implementation time, do not introduce a second formatter).

### `src/components/search/SearchResultsList.tsx`

```ts
export interface SearchResultsListProps {
  hasQuery: boolean; // trimmed query.length > 0
  isLoading: boolean; // already passed through useMinLoadingTime by the caller
  results: SearchResultResponseDto[];
  pagination?: PaginatedSearchResponseDto["pagination"];
  onPageChange: (page: number) => void;
}
```

Branching order (mirrors `NotesList.tsx`): `!hasQuery` → neutral prompt `EmptyState` ("Start typing
to search your notes", no action) → `isLoading` → skeleton rows (reuse `<Skeleton className="h-20 w-full rounded-lg" />`,
count constant e.g. `SKELETON_ROW_COUNT = 5`, local to this file like `NotesList`'s
`SKELETON_CARD_COUNT`) → `results.length === 0` → `EmptyState` with `UI_COPY.EMPTY_SEARCH_RESULTS`,
**no `action` prop** (spec explicitly forbids a CTA here) → else render `results.map(SearchResultRow)`

- `PaginationControl` when `pagination.total > 0`.

### `src/components/search/SearchInput.tsx`

```ts
export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}
export function SearchInput({ value, onChange }: SearchInputProps);
```

Plain controlled `<Input>` (reuse existing `shadcn/ui` `Input` primitive), `aria-label="Search notes"`,
autofocus. Debouncing happens in the parent (`SearchPage`) via `useDebounce`, not inside this
component, so the component stays a dumb controlled input — parent resets `page` to `1` on every
raw keystroke per the spec.

### `src/pages/SearchPage.tsx`

State: `const [query, setQuery] = useState("")`, `const [page, setPage] = useState(1)`.
`const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)`.
On raw `setQuery`, also reset `page` to `1` (spec: "resets result pagination to page 1 on every raw
keystroke").
`const params = { q: debouncedQuery.trim(), page, limit: APP_LIMITS.PAGE_SIZE_DEFAULT }`.
`const searchQuery = useSearchNotes(params)`.
`const isLoading = useMinLoadingTime(searchQuery.isLoading)`.
Layout: identical responsive shell to `NotesPage` — `hidden lg:flex lg:w-[260px] ...` persistent
`SidebarNav` + mobile `Sheet` wrapping a second `SidebarNav`, both driven by the existing
`useUiStore` `isMobileSidebarOpen`/`openMobileSidebar`/`closeMobileSidebar`. `SidebarNav` is
rendered here **without** `activeTab`/`onTabChange` (both now optional per the MODIFIED
requirement) — active-state resolves purely from `useLocation()` inside `SidebarNav` itself.
Error branch: `searchQuery.isError ? <ErrorFallback message="..." onRetry={() => searchQuery.refetch()} /> : <SearchResultsList ... />`
— matches `NotesPage`'s `currentQuery.isError` branch exactly, so no stale/partial results render
underneath (spec Error Scenario).

### `src/components/layout/SidebarNav.tsx` (MODIFIED)

```ts
export interface SidebarNavProps {
  activeTab?: NotesTab;
  onTabChange?: (tab: NotesTab) => void;
}
```

Add `const location = useLocation();` Add a third button:

```tsx
<button
  onClick={() => navigate("/search")}
  className={cn(base, location.pathname === "/search" ? active : inactive)}
>
  <Search className="h-4 w-4" aria-hidden="true" /> Search
</button>
```

Existing "Active Notes"/"Trash" buttons: active-state becomes
`location.pathname === "/notes" && activeTab === "active"` (and `"trash"` respectively) so they
never show active while sitting on `/search`; `onClick` becomes
`() => { navigate("/notes"); onTabChange?.("active" | "trash"); }` (Decision D4 — navigate first,
then invoke the now-optional callback). `NotesPage`'s existing call sites
(`<SidebarNav activeTab={activeTab} onTabChange={handleTabChange} />`) need no change — they still
pass both props, and since `NotesPage` already lives at `/notes`, `navigate("/notes")` is a
same-route no-op there.

### `src/App.tsx` (MODIFIED)

```tsx
<Route
  path="/search"
  element={
    <ProtectedRoute>
      <SearchPage />
    </ProtectedRoute>
  }
/>
```

Placed alongside the existing `/notes`/`/notes/:id` protected routes, before the catch-all `*` redirect.

## 4. Critical NoteApp Rules — Confirmation Checklist

- **Backend Layer Enforcement (`SDS §1.1`)**: N/A — zero files touched under `apps/api`. No new
  controller/service/repository code; existing `search.controller.ts` already does
  `searchNotesSchema.parse(req.query)` + delegates to `search.service.ts`, zero SQL/Zod in the
  controller (unchanged, verified during spec drafting).
- **Token & Storage Security (`FRS-1.3.5`)**: unaffected — `httpClient` (reused, not modified)
  already attaches `Authorization: Bearer <accessToken>` from `useAuthStore` in-memory state and
  handles silent 401 refresh via its existing interceptor. No new token storage introduced.
- **Two-Stage Soft Delete (`FRS-2.2`)**: N/A — search results are read-only; `note.repository.ts`'s
  existing `searchNotesForUser` already filters `deletedAt IS NULL` server-side (unchanged).
- **DB & Test Isolation (`FRS-0.3.3`)**: N/A for this ticket's own new code (no DB access from
  `apps/web`), but any **new or modified backend test** touching `search.service.ts`/
  `note.repository.ts` — there are none planned — would still be required to run only against
  `notes_app_test` per the existing contract. Frontend unit tests use Vitest + mocked
  `httpClient`/MSW, never a real DB connection.
- **3-Tier Constants (`FRS-8.5`)**: `SEARCH_DEBOUNCE_MS` (Tier 3, `apps/web/src/constants`),
  `EMPTY_SEARCH_RESULTS` (Tier 1, `packages/shared`) — no magic numbers/strings introduced outside
  these two named exports.

## 5. Test Plan (Vitest + Testing Library, mirrors `AB-1011`'s `tests/unit/` convention)

| Test file                                                          | Coverage                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/unit/hooks/useDebounce.test.ts`                    | returns initial value immediately; only updates after `delayMs` via fake timers; resets timer on rapid value changes                                                                                                                                                                                                                                        |
| `apps/web/tests/unit/hooks/useSearchNotes.test.ts`                 | `enabled: false` (no `queryFn` call) for `""`/whitespace `q`; fires with trimmed `q`/`page`/`limit` for a real query; query key includes params                                                                                                                                                                                                             |
| `apps/web/tests/unit/components/search/SnippetHighlight.test.tsx`  | wraps sentinel-marked segment in `<mark>`; renders plain text with zero sentinels unchanged; never injects raw HTML (assert no `dangerouslySetInnerHTML` present / malicious `<script>` in snippet renders as literal text)                                                                                                                                 |
| `apps/web/tests/unit/components/search/SearchResultsList.test.tsx` | `hasQuery=false` → prompt state, zero network call; `isLoading` → skeleton rows; `results=[]` with query → `EMPTY_SEARCH_RESULTS` empty state with **no action button**; non-empty → rows + `PaginationControl` only when `pagination.total > 0`                                                                                                            |
| `apps/web/tests/unit/components/search/SearchResultRow.test.tsx`   | clicking navigates to `/notes/:id`                                                                                                                                                                                                                                                                                                                          |
| `apps/web/tests/unit/components/layout/SidebarNav.test.tsx`        | Search button active only on `/search`; Active/Trash buttons navigate to `/notes` then call `onTabChange`; renders with `activeTab`/`onTabChange` omitted (standalone usage) without throwing                                                                                                                                                               |
| `apps/web/tests/unit/pages/SearchPage.test.tsx`                    | debounced keystroke → single fresh request with `page` reset to `1`; page-change → new request, same query, no re-slice of prior results; request failure → `ErrorFallback` with working retry, no stale results underneath; unauthenticated render redirects via existing `ProtectedRoute` (smoke-level, guard logic itself untested here since unchanged) |

Coverage target: ≥80% on all new files under `src/hooks/useDebounce.ts`, `src/api/search.api.ts`,
`src/hooks/useSearchNotes.ts`, `src/components/search/*`, `src/pages/SearchPage.tsx`, and the
modified branches in `src/components/layout/SidebarNav.tsx`.

## 6. Quality Checkpoint Commands (run after implementation, before `/review`)

```
pnpm turbo run build
pnpm turbo run lint -- --max-warnings 0
pnpm turbo run typecheck
pnpm turbo run test -- --coverage
```

All four must be green (`CLAUDE.md §6` Definition of Done) before `/review` or `/pr`.

## 7. Out-of-Scope Boundary (unchanged from spec, restated for implementers)

Tag-filter combo UI (D1), `Ctrl`/`Cmd`+`K` shortcut (D2), fuzzy/cross-user search, in-editor
deep-link/scroll-to-match, recent-searches history, tag/share/trash chips on result rows. Do not
add any of these while implementing — flag to the user if a task seems to require expanding into
one of them.
