# AB-1011 — Frontend: Notes List Page + Trash View

## Executive Summary

Replaces the `AB-1010` `NotesStubPage` with the real authenticated `apps/web` notes dashboard: a
paginated, sortable, tag-filterable list of the user's active notes, plus a Trash view (folded
into this same ticket per `FRS.md` line 33 — no separate ticket exists for Trash UI) supporting
restore and permanent-delete. All backend contracts already exist (`AB-1004`/`AB-1005`/`AB-1006`
merged) — this ticket is frontend-only: no new routes, schemas, or DB changes.

## Objective

Deliver a fully server-driven (`FRS-8.4`), responsive, accessible notes list + Trash experience
where every pagination/sort/tag-filter change issues a fresh `GET` request — never a local
re-sort/re-filter of an already-fetched page — with per-note share-status visibility and
confirmation-gated destructive actions.

## Target Requirements

- `FRS-2.2.1–2.2.8` — Trash Stage 1 (30-day restorable), restore, "delete forever" with
  confirmation; Stage-2/purged notes are invisible to these UIs (`404` treated as "gone").
- `FRS-2.3.1–2.3.6` — pagination (default 20 / max 100), sort (`createdAt`/`updatedAt`/`title`,
  asc/desc), tag filter (`ALL`/`ANY`, default `ALL`), stable `createdAt desc` tiebreaker, Trash
  view has no sort/page-size controls and is always `deletedAt desc`.
- `FRS-7.2` — at-a-glance shared/active-link status per note.
- `FRS-7.5` — responsive across all four breakpoint classes (phone/tablet/laptop/large-desktop).
- `FRS-8.1` — no read path here can be coerced into returning soft-deleted content.
- `FRS-8.4` — server-side sort/filter, zero client-side re-slicing.
- `FRS-8.5` — every numeric/copy/path value sourced from `@shared/core`, zero hardcoding.

## Architectural Mappings

- `SDS §4.5` — responsive drawer breakpoints (`>=1024px` persistent `SidebarNav`; `<1024px`
  slide-over `Sheet`).
- `SDS §5.1` — `filterNotesSchema` query contract, `NoteRepository.listActiveNotes` `ALL`/`ANY`
  tag logic, `useActiveNotes(params)` query-key-embeds-all-params pattern.
- `SDS §5.2` — Trash query enforces its own 30-day window server-side; frontend passes no
  sort/limit override, only `page`/`limit` (default).
- `SDS §7` route matrix — `GET /api/v1/notes`, `GET /api/v1/notes/trash`,
  `POST /api/v1/notes/:id/restore`, `DELETE /api/v1/notes/:id/permanent`, `GET /api/v1/tags`.
- `docs/ux.md §1,3,5,6,7,9,10` — loading skeletons/min-display-timer, empty states, confirm-before-
  destructive modals, route guards, TanStack Query/Zustand boundary, a11y, toasts.
- `packages/shared/CLAUDE.md` — Zero Duplication Contract: reuses `note.schema.ts`,
  `note.type.ts`, `tag.type.ts`, `API_PATHS.NOTES`/`API_PATHS.TAGS`, `APP_LIMITS` as-is.

## Out of Scope

- The note editor/detail content itself (`AB-1012`) — clicking a card opens a **minimal stub**
  `/notes/:id` route (title + read-only body + "Back to notes"), mirroring the `AB-1010` D1
  pattern; `AB-1012` replaces the stub's contents without touching this ticket's routing/guards.
- Per-note tag chips on list/Trash cards — **not a preference, a hard API constraint**:
  `NoteResponseDto` (`packages/shared/src/types/note.type.ts`) has no `tags` field (confirmed
  against `apps/api/src/services/note.service.ts#toNoteResponseDto` — the backend never joins/
  returns per-note tag associations). Adding it would require a backend/DTO change outside this
  frontend-only ticket's scope. The tag **filter** control instead reads the independent
  `GET /api/v1/tags` list.
- Fly Tag inline creation (`POST /api/v1/tags` from the filter bar) — `FRS-3.1` assigns on-the-fly
  creation to the editor and search/filter bar; the search/filter bar combobox ships with
  `AB-1013` (Search UI). This ticket's tag filter is **selection-only** over existing tags.
- Global search box / `q` param — `GET /api/v1/notes` (`filterNotesSchema`) has no `q` field;
  full-text search lives on the separate `GET /api/v1/search` endpoint, owned entirely by
  `AB-1013`.
- Note creation form — the "Create Note" button navigates to the same `/notes/:id` stub (as a
  `new` pseudo-id or blank state) that `AB-1012` fills in; no create form is built here beyond the
  navigation entry point.
- Share-link generation/revocation UI (`AB-1014`), version history drawer (`AB-1015`).
- Autosave / unsaved-changes indicator — no editor exists yet in this ticket, so the per-note
  indicator (`FRS-7.2`) surfaces **shared/active-link status only** (`hasActiveShareLink`); an
  "unsaved" state has no meaning without `AB-1012`'s editor and is deferred to that ticket.
- Restore confirmation modal — `docs/ux.md §5`'s destructive-action list is exactly {revoke share
  link, permanent delete, restore-over-live-content-from-version-history}; a Trash **restore**
  (undoing a Stage-1 delete) is reversible (the note can simply be trashed again) and is not in
  that list, so it ships as a direct action + success toast, not a confirm modal. Only
  **permanent delete** (`FRS-2.2.8`, irreversible) gets a confirm modal.

## Decisions Log (resolved with user before drafting)

- **D1 — Card click destination**: Navigate to a minimal stub `/notes/:id` route (read-only
  title/body + back button), not a dead click and not a full editor. Matches `AB-1010`'s D1
  precedent so `AB-1012` has a real route to replace.
- **D2 — Trash presentation**: Single route `/notes`; an in-page tab/toggle (`Active` / `Trash`)
  swaps which query hook (`useActiveNotes` vs `useTrash`) drives the list, with no distinct URL.
  This is the most literal reading of the `AB-1011` AC wording "a filtered view … not a bespoke
  page."
- **D3 — `UI_COPY` key naming (first ticket to create this file)**: `packages/shared` currently has
  no `ui-copy.constant.ts` despite being referenced by `docs/ux.md` and `apps/web/CLAUDE.md`. Root
  `CLAUDE.md`/`AGENTS.md` precedence rule states docs win over `AGENTS.md` on conflict — `ux.md`'s
  one concrete example (`UI_COPY.PERMANENT_DELETE_CONFIRM`) is taken as canonical naming style
  (`SCREAMING_SNAKE`, noun/context-first). New keys for this ticket: `EMPTY_NOTES_LIST`,
  `EMPTY_TRASH_BIN`, `PERMANENT_DELETE_CONFIRM`, `TRASH_RESTORE_SUCCESS`.
  `AGENTS.md §12` is updated in the same PR to reference these exact names so the two documents
  stop disagreeing.
- **D4 — Tag filter scope**: Multi-select filter chips sourced from `GET /api/v1/tags`
  (`TagResponseDto[]`), selection-only. No inline tag creation here (see Out of Scope).

## ADDED Scenarios

### Scenario: Active notes list loads with default params

- **WHEN** an authenticated user navigates to `/notes` with the "Active" tab selected
- **THEN** the frontend SHALL call `GET /api/v1/notes` with `sort=updatedAt&order=desc&page=1&limit=20`
  (the `filterNotesSchema` defaults) via a TanStack Query hook `useActiveNotes(params)` keyed
  `['notes', 'list', params]` (`SDS §5.1`)
- **AND** SHALL render a `<Skeleton />` list matching final card height until the response resolves,
  held for a minimum of `200ms` even if the response is faster (`docs/ux.md §1`)
- **AND** SHALL render each note card showing `title`, a plain-text-truncated preview of `body`,
  formatted `updatedAt`, and a share-status icon driven by `hasActiveShareLink`.

### Scenario: Changing sort triggers a fresh server request

- **WHEN** the user changes the sort field (`createdAt`/`updatedAt`/`title`) or direction
  (`asc`/`desc`) via the sort control
- **THEN** the frontend SHALL update the `useActiveNotes` query-key params and let TanStack Query
  issue a new `GET /api/v1/notes` request
- **AND** SHALL NOT reorder the currently-rendered array client-side at any point, even
  transiently (`FRS-8.4`, verified via network-tab/test-spy per the cross-cutting AC).

### Scenario: Changing the tag filter triggers a fresh server request

- **WHEN** the user selects/deselects tags in the filter control or toggles `tagMode`
  (`ALL`/`ANY`)
- **THEN** the frontend SHALL serialize selected tag ids as a comma-joined `tagIds` query param and
  the chosen `tagMode`, then refetch `GET /api/v1/notes` with the new params
- **AND** an invalid/empty combination (all tags deselected) SHALL omit `tagIds`/`tagMode` entirely
  rather than sending empty-string params.

### Scenario: Pagination controls trigger a fresh server request

- **WHEN** the user changes page via pagination controls
- **THEN** the frontend SHALL refetch `GET /api/v1/notes` with the new `page` value, preserving all
  other active sort/filter params
- **AND** page-size is fixed at `APP_LIMITS.PAGE_SIZE_DEFAULT` (`20`) for this ticket — no
  page-size selector ships (not required by any `AB-1011` AC line).

### Scenario: Active list empty state

- **WHEN** `GET /api/v1/notes` resolves with `pagination.total === 0`
- **THEN** the frontend SHALL render an empty-state card with a `FileText` icon, heading
  `"No notes yet"`, subtext `UI_COPY.EMPTY_NOTES_LIST`, and a primary "Create your first note"
  button (`docs/ux.md §3`)
- **AND** the empty state SHALL NOT render if a tag filter is active and simply yields zero
  results for that filter combination — that is a filtered-empty state, not the first-run empty
  state (distinct copy: `"No notes match the selected tags"`, no primary CTA, matching the
  search-exception pattern in `docs/ux.md §3`).

### Scenario: Trash tab loads Stage-1 trashed notes only

- **WHEN** the user switches to the "Trash" tab
- **THEN** the frontend SHALL call `GET /api/v1/notes/trash` via `useTrash(params)` keyed
  `['notes', 'trash', params]`, passing only `page`/`limit` — **no** `sort`/`order`/`tagIds`
  params exist on this call (`listTrashSchema` accepts none)
- **AND** SHALL render results in the exact server order (`deletedAt desc`) with zero client-side
  sort controls rendered in this tab (`FRS-2.3.6`).

### Scenario: Trash empty state

- **WHEN** `GET /api/v1/notes/trash` resolves with `pagination.total === 0`
- **THEN** the frontend SHALL render an empty-state card with a `Trash2` icon, heading
  `"Spotless bin!"`, subtext `UI_COPY.EMPTY_TRASH_BIN`, and no primary action button (there is
  nothing to "create" in Trash).

### Scenario: Restoring a trashed note

- **WHEN** the user clicks "Restore" on a Trash card
- **THEN** the frontend SHALL call `POST /api/v1/notes/:id/restore` immediately (no confirmation
  modal — see Out of Scope) via a mutation hook, and on `200 OK` SHALL invalidate both
  `['notes', 'trash']` and `['notes', 'list']` query keys and show a success toast
  (`UI_COPY.TRASH_RESTORE_SUCCESS`, `3s` duration)
- **AND** if the server responds `404` (note already past Stage 1 / already purged — `FRS-2.2.5`),
  the frontend SHALL show an error toast via the centralized error-code dictionary and remove the
  stale card from the local Trash list without a full refetch delay (optimistic removal).

### Scenario: Permanently deleting a note requires confirmation

- **WHEN** the user clicks "Delete forever" on a Trash card
- **THEN** the frontend SHALL open a `<ConfirmModal />` with heading `"Permanent Delete Note"`,
  body `UI_COPY.PERMANENT_DELETE_CONFIRM`, a `Cancel` button with `autoFocus` (default keyboard
  focus per `docs/ux.md §5`), and a destructive-styled `Delete Forever` button
- **AND** only on explicit confirmation SHALL the frontend call
  `DELETE /api/v1/notes/:id/permanent` with body `{ confirm: true }`
  (`permanentDeleteSchema`), then invalidate `['notes', 'trash']` and show a success toast
- **AND** dismissing the modal (backdrop click, `Esc`, or Cancel) SHALL issue zero network
  requests.

### Scenario: Per-note share-status indicator

- **WHEN** a note card (Active or Trash) renders and `hasActiveShareLink === true`
- **THEN** the frontend SHALL render a distinct "Shared" badge/icon (e.g. `Share2` from
  `lucide-react`) on that card, with an `aria-label` describing the state (`FRS-7.2`)
- **AND** when `hasActiveShareLink === false`, no badge SHALL render (not a dimmed/disabled
  variant — simple absence, avoiding visual noise on the common case).

### Scenario: Responsive layout across breakpoints

- **WHEN** the viewport is `>= 1024px`
- **THEN** the frontend SHALL render a persistent `260px` fixed `<SidebarNav />` alongside the
  notes grid/list (`SDS §4.5`)
- **WHEN** the viewport is `< 1024px`
- **THEN** the sidebar SHALL collapse into a slide-over `<Sheet />` triggered by a menu button,
  and the notes list SHALL occupy 100% viewport width (`SDS §4.5`, `FRS-7.5`).

### Scenario: Route guard reuse

- **WHEN** an unauthenticated visitor (no `accessToken` in `useAuthStore`) navigates directly to
  `/notes`
- **THEN** the existing `<ProtectedRoute>` SHALL redirect to `/login?next=%2Fnotes` unchanged
  (`docs/ux.md §6`) — this ticket adds no new guard logic, only new protected children.

## MODIFIED Scenarios

### Scenario: `/notes` route content (supersedes `AB-1010` stub)

- **WHEN** `App.tsx`'s `/notes` route renders
- **THEN** it SHALL render the new `NotesPage` (Active/Trash tabs) in place of `NotesStubPage`
  (`apps/web/src/pages/NotesStubPage.tsx` is deleted, not left as dead code)
- **AND** the existing Logout button/flow (calling `useLogout`, resetting `useAuthStore`,
  navigating to `/login`) SHALL be preserved, relocated into the new page's header/sidebar.

## Shared Package Additions (`packages/shared`)

- **NEW** `src/constants/ui-copy.constant.ts` — `UI_COPY` Tier-1 export with (at minimum, for this
  ticket): `EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN`, `PERMANENT_DELETE_CONFIRM`,
  `TRASH_RESTORE_SUCCESS`. Barrel-exported via `src/constants/index.ts` (`packages/shared/CLAUDE.md`
  barrel-integrity rule).
- **NO** schema/type/route changes — `note.schema.ts`, `note.type.ts`, `tag.type.ts`,
  `api-paths.constant.ts`, `app-limits.constant.ts` are consumed exactly as they exist today.

## Error Scenarios

- `GET /api/v1/notes` / `/trash` network or `5xx` failure → full-page `<ErrorFallback />` with a
  `"Retry"` primary action (`docs/ux.md §2`), never a raw stack trace.
- `POST .../restore` on an already-Stage-2 note → `404` → error toast (centralized dictionary) +
  optimistic local removal (see Scenario above), not a page-level error.
- `DELETE .../permanent` on an already-purged note → `404` → error toast, modal closes, list
  invalidated to reconcile state.
- Invalid `tagIds`/`tagMode` sent by a corrupted client state (should be unreachable via normal UI
  interaction) → `400` surfaced via the centralized error dictionary, never raw Zod issue arrays.

## Out-of-Scope Boundary Recap (binding)

File/image attachments, note folders/nesting (`FRS §2` Out of Scope, unchanged), offline mode
(`FRS §7` Out of Scope, unchanged), and everything listed under "Out of Scope" above.
