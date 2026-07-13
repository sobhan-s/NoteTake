# Spec Delta — AB-1015: Frontend — Version History Drawer + Restore

Domain: `notes`. Target: `FRS-7.4` (preview-before-restore, no single-click destructive restore),
`FRS §6` (`FRS-6.1–6.5`, consumed as the existing `AB-1009` backend contract) — the frontend surface
for listing, previewing, and restoring a note's append-only version history.

## Executive Summary

`AB-1009` shipped the full backend contract (`GET /api/v1/notes/:id/versions`,
`GET /api/v1/notes/:id/versions/:vId`, `POST /api/v1/notes/:id/versions/:vId/restore`,
`NoteVersionSummaryDto`, `NoteVersionResponseDto`, `API_ERROR_CODES.VERSION_NOT_FOUND`) with zero
consuming UI. This ticket adds the missing interactive surface: a `VersionHistoryDrawer` reachable
from a new toolbar button inside `NoteEditor` (mirroring the existing `ShareModal` entry-point
pattern), backed by a new `note-version.api.ts` client and `useNoteVersions`/`useNoteVersion`/
`useRestoreNoteVersion` hooks, showing a reverse-chronological list that swaps to a read-only
full-content preview of a selected version, gated by the existing `<ConfirmModal />` pattern before
restoring. No backend or `packages/shared` schema/DTO changes are required to the request/response
shapes; `packages/shared` gains only new `UI_COPY` string constants (mirroring the `AB-1014`
precedent).

## Objective

Let a signed-in owner open a note's version history, see every snapshot reverse-chronologically with
a human-readable timestamp, preview any single version's full title/body read-only before acting on
it, and restore it — never as a single click, always behind an explicit confirmation — with the
editor immediately reflecting the restored content and the drawer closing back to the live note.

## Target Requirements

- `FRS-6.2` — `GET /api/v1/notes/:id/versions` populates the drawer's list, reverse-chronological
  (already guaranteed by `@@index([noteId, createdAt(sort: Desc)])` server-side per `SDS §2`; the
  frontend renders the array in the order received, no client-side re-sort).
- `FRS-6.3` — selecting a version calls `GET /api/v1/notes/:id/versions/:vId` and renders its full
  `titleSnapshot`/`bodySnapshot` read-only.
- `FRS-6.4` — restoring calls `POST /api/v1/notes/:id/versions/:vId/restore`; the response
  (`NoteResponseDto`) becomes the new live editor state — the frontend never assumes the restored
  content locally without applying the server's authoritative response, since restore appends a new
  version server-side rather than mutating in place.
- `FRS-7.4` — restore is never a single click: selecting a version shows a read-only preview first
  (split view inside the drawer, not an immediate mutation), and the preview's "Restore this version"
  button opens a `<ConfirmModal />` before the request fires (`docs/ux.md §5`'s "Restoring a historical
  note version" destructive-action entry).
- Error Scenarios (`docs/FRS.md` §6) — viewing a purged version (`404 VERSION_NOT_FOUND`) renders "no
  longer available" inline in the preview pane, not a silent blank state; restoring on a
  since-soft-deleted note (`404 NOTE_NOT_FOUND`, note trashed in another tab) surfaces via
  `mapApiError`, not a generic crash; requesting another user's note's history is structurally
  impossible from this UI (the drawer only ever opens for the currently-loaded, already-ownership-
  checked `noteId`), so no separate frontend-only handling is needed beyond the standard
  `mapApiError` fallback.
- `FRS-8.4` — every drawer open re-fetches `GET /api/v1/notes/:id/versions` fresh; no client-side
  caching is relied upon for correctness (`staleTime` irrelevant here since the list only changes via
  this ticket's own restore mutation, which invalidates its own key).
- `FRS-8.5` — zero hardcoded numeric/copy/path literals; `API_PATHS.NOTES.VERSIONS`/`RESTORE` and new
  `UI_COPY` entries are the sole source for every string/path this ticket introduces (no new
  `APP_LIMITS` constant is needed — the version list is unpaginated per the existing route contract).

## Architectural Mappings

- `SDS` route matrix (`GET/GET/POST .../versions`, `AB-1009` spec) — this ticket is a pure consumer of
  that contract; `NoteVersionSummaryDto`/`NoteVersionResponseDto` are read from
  `packages/shared/src/types/note.type.ts` unchanged.
- `apps/web/CLAUDE.md` — `TanStack Query v5` owns `useNoteVersions` (list, keyed
  `["notes", "versions", noteId]`) and `useNoteVersion` (single version, keyed
  `["notes", "versions", noteId, versionId]`); `useRestoreNoteVersion` is a mutation invalidating
  `["notes", "detail", noteId]`, `["notes", "list"]`, and `["notes", "versions", noteId]`. `Zustand`/
  `useUiStore` is not touched for server data — the drawer's own open/closed and
  list-vs-preview-pane state is local `useState` inside `VersionHistoryDrawer`, matching the
  `ShareModal`/`NotesList.tsx` local-state precedent, not global UI state.
- `apps/web/src/components/ui/Sheet.tsx` — currently hardcoded to a fixed-left, `w-[260px]` panel for
  `SidebarNav`. This ticket extends `Sheet` with a `side: "left" | "right"` prop (defaulting to
  `"left"` — zero behavior change for existing `SidebarNav` call sites) and a `widthClassName` prop,
  so `VersionHistoryDrawer` can render as a right-side panel without duplicating Radix Dialog
  boilerplate a third time.
- `NoteEditor.tsx` — gains a "Version History" toolbar button (`lucide-react` `History` icon) directly
  alongside the existing "Share" button, following the exact same `disabled={noteId === null}` /
  `aria-disabled` pattern (a version history cannot exist for a note with no `id` yet).
- `docs/ux.md §1, §3, §5, §9` — `<100ms` loading feedback + `>=200ms` minimum display timer
  (`useMinLoadingTime`) on both the list fetch and the per-version preview fetch, confirm-before-
  restore via `<ConfirmModal />` with "Cancel" default-focused, toast conventions (`sonner`, 3s
  success / 5s error), keyboard/focus-ring accessibility on the new toolbar button, drawer, and
  back/restore controls.
- `packages/shared/CLAUDE.md` — Zero Duplication Contract: no new Zod schema, no new DTO — only new
  `UI_COPY` string constants (Tier 1), matching the `AB-1014` precedent.

## Out of Scope

- Any backend or `packages/shared` schema/DTO change — `AB-1009` already shipped the full versions
  contract (`NoteVersionSummaryDto`, `NoteVersionResponseDto`, `API_ERROR_CODES.VERSION_NOT_FOUND`,
  `API_PATHS.NOTES.VERSIONS`/`RESTORE`); this ticket adds only `UI_COPY` string entries.
- Diff/comparison view between two versions (`FRS §6` "Out of Scope (Version History)", unchanged).
- Manual pinning of specific versions to exempt from the 90-day purge (`FRS §6` "Out of Scope",
  unchanged) — the drawer never exposes a pin/exempt affordance.
- Any visible "this version is purge-eligible" age warning in the UI — purging is an invisible,
  backend-only guarantee (`FRS-8a.1`); the frontend does not compute or display days-until-purge.
- Pagination or infinite-scroll for the version list — the existing `GET .../versions` endpoint
  returns the full unpaginated array (no `page`/`limit` query params in the route contract); the
  drawer renders the full list with native scroll inside the panel.
- Making `NoteCard`'s list-view card show any version-count indicator — version history stays reachable
  only from inside `NoteEditor`, matching the `AB-1014` "Share modal only reachable from the editor"
  precedent for this ticket's analogous surface.
- Any change to `NoteEditor`'s autosave, sharing, or tag-attachment behavior — this ticket only adds a
  new toolbar button and drawer alongside them.

---

## ADDED Requirements

### Requirement: Shared UI Copy Constants

`packages/shared` SHALL gain the following `UI_COPY` string entries (Tier 1, `FRS-8.5`) — no literal
confirmation/toast/unavailable-state string for this feature exists anywhere in `apps/web`:

- `UI_COPY.VERSION_RESTORE_CONFIRM` — confirmation body text shown in `<ConfirmModal />` before
  restoring (`docs/ux.md §5`).
- `UI_COPY.VERSION_RESTORE_SUCCESS` — success toast after a successful restore.
- `UI_COPY.VERSION_UNAVAILABLE` — text rendered in the preview pane when a selected version has been
  purged (`404 VERSION_NOT_FOUND`) between listing and selecting it.
- `UI_COPY.EMPTY_VERSION_HISTORY` — defensive empty-state text if the list ever returns zero versions
  (should not occur in practice since note creation always seeds one version per `FRS-2.1.1`/
  `FRS-6.1`, but the UI must not render a blank panel if it does).

`apps/web/src/lib/errorMessages.ts`'s `mapApiError` SHALL gain a `case` branch for
`API_ERROR_CODES.VERSION_NOT_FOUND` (currently unmapped, falling through to the generic message) so a
restore-time race (version purged or note trashed between listing and restoring) surfaces a specific,
correct toast instead of a generic one.

#### Scenario: New UI_COPY entries are the single source for this ticket's strings

- **WHEN** any component introduced by this ticket needs confirmation, success, or unavailable-state
  copy
- **THEN** it imports the exact string from `@shared/core/constants` — no inline string literal
  duplicates it

### Requirement: Version History Toolbar Entry Point

`NoteEditor` SHALL expose a "Version History" button in its existing toolbar (alongside Bold/Italic/
Underline/Link/Share) that opens `VersionHistoryDrawer` for the current note.

#### Scenario: Version History button on an existing (already-saved) note

- **WHEN** the owner is viewing/editing a note that already exists (`noteId !== null`)
- **THEN** the toolbar SHALL render a "Version History" button (`lucide-react` `History` icon,
  `aria-label="Version history"`) that opens `VersionHistoryDrawer` on click

#### Scenario: Version History button on an unsaved new note

- **WHEN** the owner is on the "new note" editor route (`noteId === null`, nothing persisted yet)
- **THEN** the button SHALL be disabled (`aria-disabled`, no click handler fired) — there is no
  version history for a note that does not yet have an `id`

### Requirement: Version History Drawer Fetches and Lists Versions on Open

Opening `VersionHistoryDrawer` SHALL always fetch the note's current version list fresh via
`GET /api/v1/notes/:id/versions`, rendered reverse-chronologically exactly as received.

#### Scenario: Drawer opens successfully

- **WHEN** `VersionHistoryDrawer` opens and `GET /api/v1/notes/:id/versions` returns `200 OK`
- **THEN** the drawer SHALL render each `NoteVersionSummaryDto` as a row showing its `titleSnapshot`
  and a formatted `createdAt` (matching `formatUpdatedAt`'s existing locale conventions), in the exact
  array order returned — no client-side re-sort (`FRS-8.4`)

#### Scenario: Drawer opens for a note with zero versions (defensive)

- **WHEN** the returned `versions` array is empty
- **THEN** the drawer SHALL render `UI_COPY.EMPTY_VERSION_HISTORY` instead of a blank panel

#### Scenario: List fetch fails

- **WHEN** `GET /api/v1/notes/:id/versions` fails with a network error or `5xx`
- **THEN** the drawer SHALL render an inline retry affordance (matching the existing
  `<ErrorFallback onRetry>` pattern), not a blank or partially-rendered panel

#### Scenario: Loading state respects minimum display timer

- **WHEN** the version list fetch is in flight
- **THEN** the drawer SHALL show a skeleton placeholder held for at least `200ms`
  (`useMinLoadingTime`, `docs/ux.md §1`) before showing the list

### Requirement: Selecting a Version Shows a Read-Only Preview (Split View)

Clicking a version row SHALL swap the drawer's list pane for a read-only preview of that version's
full content, fetched via `GET /api/v1/notes/:id/versions/:vId` — never restoring directly from the
list row (`FRS-7.4`).

#### Scenario: Owner selects a version

- **WHEN** the owner clicks a version row in the list
- **THEN** the drawer SHALL call `GET /api/v1/notes/:id/versions/:vId` and, on success, replace the
  list pane with: a "← Back to list" control, the version's formatted `createdAt`, its
  `titleSnapshot` as a heading, its `bodySnapshot` rendered read-only (`useEditor({ editable: false,
extensions: [StarterKit, Underline, Link] })` + `<EditorContent />` — the same read-only rendering
  mechanism `ShareViewPage` already uses, never `dangerouslySetInnerHTML`), and a "Restore this
  version" button

#### Scenario: Owner navigates back to the list

- **WHEN** the owner clicks "← Back to list" while viewing a preview
- **THEN** the drawer SHALL show the version list again without re-fetching it (the list query result
  is still cached from the initial open)

#### Scenario: Selected version has been purged since the list was fetched

- **WHEN** `GET /api/v1/notes/:id/versions/:vId` returns `404` (`VERSION_NOT_FOUND`)
- **THEN** the preview pane SHALL render `UI_COPY.VERSION_UNAVAILABLE` in place of the content, with a
  "← Back to list" control still available and no "Restore this version" button shown

#### Scenario: Preview fetch fails (network/5xx)

- **WHEN** the per-version fetch fails for a reason other than `404`
- **THEN** the preview pane SHALL render an inline retry affordance, distinct from the permanent
  `VERSION_UNAVAILABLE` state

#### Scenario: Preview loading state respects minimum display timer

- **WHEN** the per-version fetch is in flight
- **THEN** the preview pane SHALL show a skeleton placeholder held for at least `200ms`
  (`useMinLoadingTime`) before showing the content

### Requirement: Restore Requires Explicit Confirmation

Restoring SHALL require an explicit confirmation step via the existing `<ConfirmModal />` component,
never a single-click destructive action (`FRS-7.4`, `docs/ux.md §5`).

#### Scenario: Owner clicks "Restore this version"

- **WHEN** the owner clicks "Restore this version" from the preview pane
- **THEN** a `<ConfirmModal />` SHALL open with heading "Restore Version" and body
  `UI_COPY.VERSION_RESTORE_CONFIRM`, with "Cancel" as the default-focused button (`docs/ux.md §5`)

#### Scenario: Owner cancels the confirmation

- **WHEN** the owner clicks "Cancel" or dismisses the confirm modal
- **THEN** no restore request is sent and the preview pane remains unchanged

### Requirement: Confirmed Restore Applies the Server's Authoritative Content and Closes the Drawer

Confirming restore SHALL call `POST /api/v1/notes/:id/versions/:vId/restore`, apply the returned
`NoteResponseDto` directly to the live editor, and close the drawer — silently discarding any local
unsaved draft for this note, since restore is an explicit confirmed action equivalent to any other
explicit save.

#### Scenario: Restore succeeds

- **WHEN** the owner confirms restore inside the `<ConfirmModal />`
- **THEN** the frontend SHALL call `POST /api/v1/notes/:id/versions/:vId/restore`
- **AND** on success SHALL clear the local Zustand draft (`useUiStore.clearDraft(noteId)`) for this
  note, update `NoteEditor`'s title state and TipTap editor content (`editor.commands.setContent`)
  directly from the response's `title`/`body` (the editor does not re-derive from a prop after mount,
  so an explicit content set is required, not just a cache invalidation)
- **AND** SHALL invalidate `["notes", "detail", noteId]`, `["notes", "list"]`, and
  `["notes", "versions", noteId]` query keys so the version list and any list-view metadata stay
  correct on next fetch
- **AND** SHALL close both the `<ConfirmModal />` and `VersionHistoryDrawer`, and show a success toast
  (`UI_COPY.VERSION_RESTORE_SUCCESS`, `duration: 3000`)

#### Scenario: Restore fails because the note was trashed in another tab

- **WHEN** `POST /api/v1/notes/:id/versions/:vId/restore` fails with `404` (`NOTE_NOT_FOUND`)
- **THEN** the frontend SHALL show an error toast via `mapApiError`, close the `<ConfirmModal />`, and
  leave the preview pane and editor content unchanged (no partial apply)

#### Scenario: Restore fails because the version was purged in another tab

- **WHEN** `POST /api/v1/notes/:id/versions/:vId/restore` fails with `404` (`VERSION_NOT_FOUND`)
- **THEN** the frontend SHALL show an error toast via `mapApiError`, close the `<ConfirmModal />`, and
  re-render the preview pane in its `VERSION_UNAVAILABLE` state rather than assuming success

### Requirement: `Sheet` Component Supports a Right-Side Panel Variant

`apps/web/src/components/ui/Sheet.tsx` SHALL accept an optional `side: "left" | "right"` prop
(default `"left"`) and an optional `widthClassName` prop, with zero behavior change to existing
`SidebarNav` call sites that omit the new props.

#### Scenario: Existing left-side usage is unaffected

- **WHEN** `SidebarNav`'s existing `<Sheet>` usage (no `side`/`widthClassName` prop passed) renders
- **THEN** it SHALL render exactly as before this ticket — fixed-left, `w-[260px]`

#### Scenario: `VersionHistoryDrawer` renders as a right-side panel

- **WHEN** `VersionHistoryDrawer` renders its `<Sheet side="right" widthClassName="w-full sm:w-[420px]">`
- **THEN** the panel SHALL slide in from the right edge of the viewport, full-width on mobile
  (`docs/ux.md` responsive breakpoints, `FRS-7.5`) and a fixed `420px` on larger viewports

---

## Error Scenarios (this ticket's exact frontend behavior)

| Scenario                                                              | Frontend behavior                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Version History button clicked on an unsaved new note                 | Button is disabled; no click handler fires, no request sent               |
| Drawer open, list fetch network/5xx error                             | Inline retry affordance inside the drawer                                 |
| Drawer open, zero versions returned                                   | `UI_COPY.EMPTY_VERSION_HISTORY` empty state, not a blank panel            |
| Version selected, purged (`404 VERSION_NOT_FOUND`)                    | Preview pane shows `UI_COPY.VERSION_UNAVAILABLE`, no Restore button shown |
| Version selected, preview fetch network/5xx error                     | Inline retry in the preview pane, distinct from `VERSION_UNAVAILABLE`     |
| Restore confirmed, note trashed elsewhere (`404 NOTE_NOT_FOUND`)      | Error toast via `mapApiError`, no partial content apply                   |
| Restore confirmed, version purged elsewhere (`404 VERSION_NOT_FOUND`) | Error toast via `mapApiError`, preview re-renders `VERSION_UNAVAILABLE`   |
| Owner cancels restore confirmation                                    | No request sent, preview pane unchanged                                   |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1015 — §7.4, §6): user can preview a version's full
content before restoring; restore requires an explicit confirmation step, never a single click.
