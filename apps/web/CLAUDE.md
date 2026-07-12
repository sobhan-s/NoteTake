# CLAUDE.md — apps/web (Domain Blueprint)

Authoritative rules for `apps/web`. Root `AGENTS.md`/`CLAUDE.md` govern monorepo-wide standards (`crg`, git gates, `/tasks` DoD, commit format) and are never restated here.

## State Management Architecture (Strict Isolation)

```
Server State (Async/Remote)      Client UI State (Sync/Ephemeral)
  ┌──────────────────────┐         ┌───────────────────────────┐
  │  TanStack Query v5   │         │          Zustand          │
  │                      │         │                           │
  │ • useNotesList       │         │ • useAuthStore (Tokens)   │
  │ • useNoteById        │         │ • useUiStore (UI Toggles) │
  └──────────────────────┘         └───────────────────────────┘
```

- **TanStack Query v5**: Exclusive owner of remote data (`useNotesList`, `useTags`, `useTrash`).
  - **Zero Client-Side Re-Filtering (`FRS-8.4`)**: Every sorting, query (`q`), or tag filter change MUST trigger a fresh API fetch.
  - **Query Key Factory**: Hooks embed all parameters (`sort, order, tags, q, page, limit`) in exact Query Keys (`['notes', 'list', { ... }]`). **Never** `.filter()`, `.sort()`, or `.slice()` an already-fetched page in component memory.
  - **Targeted Cache Invalidation**: After successful mutations, invalidate only affected query keys (`queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })`).
- **Zustand**: Exclusive owner of ephemeral UI state (`useAuthStore` session memory, `useUiStore` sidebar toggles/active dialogs/theme/debounce buffers). **Never** store server collections in Zustand or access tokens in TanStack Query.

## Zero-Trust Auth & Silent Rotation (`FRS-1.3.5`)

```json
// Refresh API Response Shape
{ "success": true, "data": { "accessToken": "eyJhbGciOi..." } }
```

- **In-Memory Access Token**: 15m `accessToken` lives strictly inside `useAuthStore` JS memory (`accessToken: string | null`). **NEVER** save to `localStorage`, `sessionStorage`, or `IndexedDB`.
- **Cookie-Only Refresh Token**: 7d `refreshToken` is held purely by the browser inside `HttpOnly + Secure + SameSite=Strict` cookie (`refreshToken`). JS code **never** reads or touches it.
- **Silent Rotation Interceptor**: Axios interceptor attaches `Authorization: Bearer <accessToken>`. On `401 Unauthorized`, catches exactly once (`_retry` flag), executes `POST /api/v1/auth/refresh` (`withCredentials: true`), updates `useAuthStore` with the new token, and replays the request. If refresh fails, clears `useAuthStore` and redirects to `/login`.

## Frontend Naming & Conventions

| Component/Hook Type     | Naming Convention            | Example Directory/File              |
| :---------------------- | :--------------------------- | :---------------------------------- |
| **Atomic UI Component** | PascalCase (`shadcn/ui`)     | `src/components/ui/Button.tsx`      |
| **Feature Component**   | PascalCase                   | `src/components/notes/NoteCard.tsx` |
| **TanStack Query Hook** | `use` + PascalCase           | `src/hooks/useNotesList.ts`         |
| **Zustand Store**       | `use` + PascalCase + `Store` | `src/store/useAuthStore.ts`         |

## Rich-Text Editor (TipTap) & XSS Defense (`FRS-4.2.1`)

- **TipTap (`@tiptap/react`)**: Exclusive rich-text engine (`src/components/editor/`). Use safe extensions (`StarterKit`, `Underline`, `Link`, `Placeholder`).
- **Safe Snippets (`[[[MARK]]]` Sentinels)**: Search snippets (`"This is [[[MARK]]]highlighted[[[MARK_END]]] snippet."`) MUST **NEVER** use `dangerouslySetInnerHTML`. Split client-side on `[[[MARK]]]` / `[[[MARK_END]]]` to render safe React nodes (`<span className="bg-yellow-200 text-slate-900 rounded px-0.5">...</span>`).

## Atomic UI (`shadcn/ui`) & Debouncing Performance

- **Primitives (`src/components/ui/`)**: All buttons, dialogs, inputs, sheets, toasts must be composed via `shadcn/ui` + Radix. Never write ad-hoc CSS modal wrappers.
- **UX Rules (`docs/ux.md`)**: Skeleton loaders (`<Skeleton />`) during `isLoading === true`; clean empty cards (`EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN` from `UI_COPY`) when `items.length === 0`; mandatory confirmation dialogs (`TRASH_RESTORE_CONFIRM`, `PERMANENT_DELETE_CONFIRM` from `UI_COPY`) before destructive mutations (`TRASH_RESTORE_SUCCESS`, `PERMANENT_DELETE_SUCCESS` toasts).
- **Search Debouncing (`useDebounce`)**: Debounce search input keystrokes (`300ms`) before updating TanStack Query param (`q`).
- **Autosave (`useNoteAutosave`)**: Debounce editor changes (`1000ms` quiet window) before `PATCH /api/v1/notes/:id`. Show visual status (`Saving...`, `Saved at 10:42 AM`).
