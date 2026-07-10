# CLAUDE.md — apps/web

Domain rules for the React 19 + Vite SPA. Root `AGENTS.md`/`CLAUDE.md` govern everything not restated here.

## Server state vs. client state

- **TanStack Query**: all remote data (`useNotesList`, `useTags`, `useSearchNotes`, ...). Every list/filter/search hook includes all query tokens (sort, order, tags, tagMode, q, page, limit) in its query key — no client-side re-sort/re-filter of an already-fetched page (`FRS-8.4`). Every criteria change is a fresh backend request.
- **Zustand**: strictly ephemeral client UI state (`useAuthStore`, `useUiStore`) — sidebar/drawer state, filter selections, active modal IDs, local drafts.
- Never store server data collections in Zustand. Never store the access token or UI toggles in TanStack Query cache.

## Token storage (`FRS-1.3.5`)

The access token lives **only** in `useAuthStore`'s in-memory state. Never `localStorage`, never `sessionStorage`, never IndexedDB. The refresh token is never read by frontend JS at all — it's an `HttpOnly` cookie the browser sends automatically.

## UX conventions

Follow `docs/ux.md` exactly for loading states, empty states, destructive-action confirmations, and toast behavior — do not invent new patterns.
