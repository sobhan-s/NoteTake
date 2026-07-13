# Spec Delta — AB-1014: Frontend — Share Modal + Active Links

Domain: `sharing`. Target: `FRS-7.2` (at-a-glance shared/active-link indicator), `FRS §5` (`FRS-5.1–5.6`,
consumed as the existing `AB-1008` backend contract) — the frontend surface for generating, viewing,
copying, and revoking a note's public share link, plus the unauthenticated public read-only viewer
page itself.

## Executive Summary

`AB-1008` shipped the full backend contract (`POST/GET/DELETE /api/v1/notes/:id/share`,
`GET /api/v1/public/share/:token`, `NoteResponseDto.hasActiveShareLink`) with zero consuming UI.
`NoteCard.tsx` and `NoteEditor.tsx` already render a static, non-interactive "Shared" badge off
`hasActiveShareLink`. This ticket adds the missing interactive surface: a `ShareModal` reachable from
a new toolbar button inside `NoteEditor`, backed by `share.api.ts`/`useShareLink`/`useGenerateShareLink`/
`useRevokeShareLink`, plus a new unauthenticated `/share/:token` route (`ShareViewPage`) rendering the
public note or an identical "no longer available" state — consuming exactly the DTOs/constants
`AB-1008` already shipped in `packages/shared`. No backend or `packages/shared` schema changes to the
request/response shapes are required; `packages/shared` gains only new `UI_COPY` string constants.

## Objective

Let a signed-in owner generate a share link (default 7-day expiry, 1–30 day range), see its live view
count and expiry at a glance, copy it, and revoke it — all without leaving the note editor and without
a single-click destructive action — while an anonymous visitor holding a valid link sees a clean,
strictly read-only rendering of the note, or an unambiguous "no longer available" state that never
distinguishes expired vs. revoked vs. trashed.

## Target Requirements

- `FRS-5.1, FRS-5.2` — trigger `POST /api/v1/notes/:id/share` with an owner-chosen `expiresInDays`
  (`1`–`30`, default `7`); consumed via the existing `createShareLinkSchema` — no new validation logic
  duplicated client-side beyond what `react-hook-form` + `@hookform/resolvers/zod` already do
  elsewhere in the app.
- `FRS-5.3` — revoke via `DELETE /api/v1/notes/:id/share`, gated by the existing `<ConfirmModal />`
  pattern per `docs/ux.md §5`'s explicit "Revoking an active public share link" destructive-action
  entry.
- `FRS-5.4` — display the link's current `viewCount` (owner-only, from `GET .../share`), read-only,
  no client-side increment logic — the counter is server-authoritative.
- `FRS-5.5, FRS-5.6` — the public page (`ShareViewPage`) renders strictly read-only content with no
  edit affordance, no owner identity, no navigation to other notes, and an identical "no longer
  available" state regardless of the underlying `404` cause (expired/revoked/trashed/nonexistent —
  the frontend does not attempt to distinguish `SHARE_LINK_UNAVAILABLE` causes, matching the backend's
  own refusal to disambiguate).
- `FRS-7.2` — the existing `hasActiveShareLink` badges in `NoteCard`/`NoteEditor` remain the
  passive at-a-glance indicators (unchanged, already shipped); this ticket adds the actionable
  surface behind them via a new editor toolbar entry point.
- `FRS-8.4` — no client-side derivation of share state across requests; every open of the modal
  re-fetches `GET /api/v1/notes/:id/share` fresh (`staleTime` not relied upon for correctness).
- `FRS-8.5` — zero hardcoded numeric/copy/path literals; `APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`/
  `SHARE_LINK_MAX_EXPIRY_DAYS`/`SHARE_LINK_DEFAULT_EXPIRY_DAYS`, `API_PATHS.NOTES.SHARE`/`PUBLIC`, and
  new `UI_COPY` entries are the sole source for every string/number this ticket introduces.

## Architectural Mappings

- `SDS §2.2 (3)`, `SDS` route matrix (`AB-1008` spec Resolved Decisions #1–#8) — this ticket is a pure
  consumer of that contract; response shapes (`ShareLinkResponseDto`, `PublicNoteResponseDto`) are
  read from `packages/shared/src/types/share.type.ts` unchanged.
- `SDS §4.5` — the authenticated app shell (`SidebarNav` + `Sheet`) is **not** reused by
  `ShareViewPage`; the public page renders its own minimal, chrome-free layout (no sidebar, no auth
  state, no nav) since it must work for a signed-out visitor.
- `apps/web/CLAUDE.md` — `TanStack Query v5` owns `useShareLink` (server state, keyed
  `["notes", "share", noteId]`); `Zustand`/`useUiStore` is not touched — the modal's own open/closed
  state is local `useState` in `NoteEditor`, matching the existing `pendingDeleteNote`/
  `pendingRestoreNote` local-state pattern in `NotesList.tsx`, not global UI state.
- `docs/ux.md §1, §3, §5, §9` — `<100ms` loading feedback + `>=200ms` minimum display timer on modal
  open, confirm-before-revoke via `<ConfirmModal />`, toast conventions (`sonner`, 3s success / 5s
  error), and keyboard/focus-ring accessibility on the new toolbar button and modal.
- `packages/shared/CLAUDE.md` — Zero Duplication Contract: no new Zod schema, no new DTO — only new
  `UI_COPY` string constants (Tier 1, confirmation/toast copy, matching the existing
  `PERMANENT_DELETE_CONFIRM`/`TRASH_RESTORE_SUCCESS` precedent).

## Out of Scope

- Any backend or `packages/shared` schema/DTO change — `AB-1008` already shipped
  `createShareLinkSchema`, `ShareLinkResponseDto`, `PublicNoteResponseDto`,
  `API_PATHS.NOTES.SHARE`/`PUBLIC`, and all `APP_LIMITS.SHARE_LINK_*` constants; this ticket adds only
  `UI_COPY` string entries.
- Making `NoteCard`'s list-view "Shared" badge interactive — it stays a passive at-a-glance indicator
  (`FRS-7.2`); the Share modal is reachable only from inside `NoteEditor` (user-confirmed decision).
- A "regenerate"/"rotate" verb in the modal — per `AB-1008` Resolved Decision #1, there is no such
  backend operation; the UI reflects this by only ever offering **Revoke** while a link is active, and
  only showing the **generate** form again once no active link remains.
- Password-protected links, per-viewer analytics, edit/comment permissions on shared links — `FRS §5`
  "Out of Scope (Sharing)", unchanged.
- A manual clipboard-fallback UI for browsers without the `navigator.clipboard` API — the app already
  assumes a modern evergreen browser baseline elsewhere (TipTap, TanStack Query v5); copy failures
  surface via the existing error-toast pattern only.
- Any change to `NoteEditor`'s autosave, version-snapshot, or tag-attachment behavior — this ticket
  only adds a new toolbar button and modal alongside them.

---

## ADDED Requirements

### Requirement: Shared UI Copy Constants

`packages/shared` SHALL gain the following `UI_COPY` string entries (Tier 1, `FRS-8.5`) — no literal
confirmation/toast/empty-state string for this feature exists anywhere in `apps/web`:

- `UI_COPY.CONFIRM_REVOKE_SHARE_LINK` — confirmation body text shown in `<ConfirmModal />` before
  revoking (`docs/ux.md §5`).
- `UI_COPY.SHARE_LINK_REVOKED_SUCCESS` — success toast after a successful revoke.
- `UI_COPY.SHARE_LINK_COPIED_SUCCESS` — success toast after a successful clipboard copy.
- `UI_COPY.SHARE_LINK_UNAVAILABLE` — the exact heading/body text `ShareViewPage` renders for every
  invalid-link cause (expired, revoked, trashed, nonexistent token) — one string, never varied by
  cause (`FRS-5.6`).

`apps/web/src/lib/errorMessages.ts`'s `mapApiError` SHALL gain `case` branches for
`API_ERROR_CODES.SHARE_LINK_NOT_FOUND` and `API_ERROR_CODES.SHARE_LINK_UNAVAILABLE` (both currently
unmapped, falling through to the generic message) so an owner-side race (e.g. double-clicking Revoke)
surfaces a specific, correct toast instead of a generic one.

#### Scenario: New UI_COPY entries are the single source for this ticket's strings

- **WHEN** any component introduced by this ticket needs confirmation, success, or unavailable-state
  copy
- **THEN** it imports the exact string from `@shared/core/constants` — no inline string literal
  duplicates it

### Requirement: Share Toolbar Entry Point

`NoteEditor` SHALL expose a "Share" button in its existing toolbar (alongside Bold/Italic/Underline/
Link) that opens the `ShareModal` for the current note.

#### Scenario: Share button on an existing (already-saved) note

- **WHEN** the owner is viewing/editing a note that already exists (`noteId !== null`)
- **THEN** the toolbar SHALL render a "Share" button (`lucide-react` `Share2` icon,
  `aria-label="Share note"`) that opens `ShareModal` on click

#### Scenario: Share button on an unsaved new note

- **WHEN** the owner is on the "new note" editor route (`noteId === null`, nothing persisted yet)
- **THEN** the "Share" button SHALL be disabled (`aria-disabled`, no click handler fired) — a share
  link cannot be generated for a note that does not yet have an `id`

### Requirement: Share Modal Fetches Current Link State on Open

Opening `ShareModal` SHALL always fetch the note's current share-link state fresh, never assume the
passive `hasActiveShareLink` badge value is still accurate.

#### Scenario: Modal opens for a note with no active link

- **WHEN** `ShareModal` opens and `GET /api/v1/notes/:id/share` returns `404`
  (`SHARE_LINK_NOT_FOUND`)
- **THEN** the modal SHALL render the generate form: an expiry `<Input type="number" min={1} max={30}>`
  defaulting to `APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS` and a "Create Link" button

#### Scenario: Modal opens for a note with an active link

- **WHEN** `ShareModal` opens and `GET /api/v1/notes/:id/share` returns `200 OK`
- **THEN** the modal SHALL render the link's `token` (rendered as a full shareable URL built from
  `window.location.origin` + `/share/${token}`, per `AB-1008` Resolved Decision #6), its `expiresAt`
  (formatted, matching `formatUpdatedAt`'s locale conventions), its `viewCount`, a "Copy Link" button,
  and a "Revoke" button — the expiry input/"Create Link" form is **not** shown while a link is active

#### Scenario: Modal fetch fails on open

- **WHEN** `GET /api/v1/notes/:id/share` fails with a network error or `5xx`
- **THEN** the modal SHALL render an inline retry affordance (matching the existing
  `<ErrorFallback onRetry>` pattern), not a blank or partially-rendered dialog

#### Scenario: Loading state respects minimum display timer

- **WHEN** the share-link fetch is in flight
- **THEN** the modal SHALL show a skeleton/spinner placeholder held for at least `200ms`
  (`useMinLoadingTime`, `docs/ux.md §1`) before showing either the generate form or the active-link
  view

### Requirement: Generate Share Link From the Modal

Submitting the generate form SHALL call `POST /api/v1/notes/:id/share` with the chosen
`expiresInDays`, then immediately show the resulting active-link view.

#### Scenario: Owner submits a valid expiry

- **WHEN** the owner enters an integer within `1`–`30` (or leaves it at the default `7`) and clicks
  "Create Link"
- **THEN** the frontend SHALL call `POST /api/v1/notes/:id/share` with `{ expiresInDays }`
- **AND** on success SHALL replace the generate form with the active-link view showing the newly
  created `token`/`expiresAt`/`viewCount: 0`
- **AND** SHALL invalidate `["notes", "detail", noteId]` and `["notes", "list"]` query keys so
  `hasActiveShareLink` badges update immediately with no caching lag (`FRS-7.2`, mirroring
  `AB-1008`'s "no caching lag" server-side guarantee)

#### Scenario: Owner enters an out-of-range value

- **WHEN** the owner types a value outside `1`–`30` (e.g. `0`, `31`, negative, non-integer) and
  attempts to submit
- **THEN** the "Create Link" button SHALL be disabled (client-side bound check mirroring
  `APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`/`MAX_EXPIRY_DAYS`, `docs/ux.md §4`'s "Submit Button State"
  rule) and an inline validation message SHALL render below the input — no request is sent

#### Scenario: Generate request fails

- **WHEN** `POST /api/v1/notes/:id/share` fails (e.g. the note was trashed in another tab,
  `404 NOTE_NOT_FOUND`)
- **THEN** the frontend SHALL show an error toast via `mapApiError` and leave the generate form
  visible, unchanged

### Requirement: Copy Share Link to Clipboard

The active-link view's "Copy Link" button SHALL copy the full shareable URL to the clipboard and
confirm success via toast.

#### Scenario: Copy succeeds

- **WHEN** the owner clicks "Copy Link"
- **THEN** the frontend SHALL call `navigator.clipboard.writeText` with the full
  `${window.location.origin}/share/${token}` URL
- **AND** on success SHALL show a success toast with `UI_COPY.SHARE_LINK_COPIED_SUCCESS`
  (`duration: 3000`, `docs/ux.md §10`)

#### Scenario: Copy fails (clipboard API unavailable or permission denied)

- **WHEN** `navigator.clipboard.writeText` rejects
- **THEN** the frontend SHALL show an error toast (`duration: 5000`) using the generic error message —
  no fallback selection/manual-copy UI is built (Out of Scope)

### Requirement: Revoke Share Link Requires Explicit Confirmation

Revoking SHALL require an explicit confirmation step via the existing `<ConfirmModal />` component,
never a single-click destructive action (`FRS-7.4`, `docs/ux.md §5`).

#### Scenario: Owner clicks Revoke

- **WHEN** the owner clicks "Revoke" in the active-link view
- **THEN** a `<ConfirmModal />` SHALL open with heading "Revoke Public Share Link" and body
  `UI_COPY.CONFIRM_REVOKE_SHARE_LINK`, with "Cancel" as the default-focused button
  (`docs/ux.md §5`)

#### Scenario: Owner confirms revoke

- **WHEN** the owner clicks the destructive confirm button inside that `<ConfirmModal />`
- **THEN** the frontend SHALL call `DELETE /api/v1/notes/:id/share`
- **AND** on success SHALL close the confirm modal, show a success toast
  (`UI_COPY.SHARE_LINK_REVOKED_SUCCESS`), invalidate `["notes", "detail", noteId]` and
  `["notes", "list"]` query keys, and re-render `ShareModal`'s body back to the generate form (no
  active link remains)

#### Scenario: Owner cancels the confirmation

- **WHEN** the owner clicks "Cancel" or dismisses the confirm modal
- **THEN** no `DELETE` request is sent and the active-link view remains unchanged

#### Scenario: Revoke request fails

- **WHEN** `DELETE /api/v1/notes/:id/share` fails (e.g. already revoked in another tab,
  `404 SHARE_LINK_NOT_FOUND`)
- **THEN** the frontend SHALL show an error toast via `mapApiError` and re-fetch the current link
  state rather than assuming success

### Requirement: Public Share Route

A new unauthenticated route `/share/:token` SHALL render `ShareViewPage`, structurally outside
`<ProtectedRoute>` and outside the authenticated app shell.

#### Scenario: Route registration

- **WHEN** `App.tsx`'s router is inspected
- **THEN** it SHALL include `<Route path="/share/:token" element={<ShareViewPage />} />` registered
  alongside the other top-level (non-protected) routes (`/login`, `/register`, etc.), **not** nested
  inside any `<ProtectedRoute>` wrapper

#### Scenario: Signed-in owner visits their own share link

- **WHEN** a signed-in user (with a valid in-memory access token) navigates to their own
  `/share/:token`
- **THEN** the page SHALL still render the public, read-only view exactly as an anonymous visitor
  would see it — no owner-only affordance (edit link, view count, revoke button) leaks into this
  route; that surface exists only inside `ShareModal`

### Requirement: Public Share Page Fetches and Renders Read-Only Content

`ShareViewPage` SHALL call `GET /api/v1/public/share/:token` (no `Authorization` header required) and
render the result as strictly read-only rich text.

#### Scenario: Valid link

- **WHEN** `GET /api/v1/public/share/:token` returns `200 OK` with `{ title, body, updatedAt }`
- **THEN** the page SHALL render `title` as a heading and `body` inside a read-only TipTap instance
  (`useEditor({ editable: false, extensions: [StarterKit, Underline, Link] })` +
  `<EditorContent editor={editor} />`) — the same rendering mechanism `NoteEditor` already uses,
  parsed through ProseMirror's schema rather than injected via `dangerouslySetInnerHTML`
- **AND** SHALL display the formatted `updatedAt` timestamp
- **AND** SHALL render zero edit controls, zero owner-identity information, and zero links/navigation
  to any other note (`FRS-5.5`)

#### Scenario: Invalid link (any cause)

- **WHEN** `GET /api/v1/public/share/:token` returns `404` (`SHARE_LINK_UNAVAILABLE`) — whether the
  underlying cause is expiry, revocation, the note being trashed, or a nonexistent token
- **THEN** the page SHALL render one single "no longer available" state using
  `UI_COPY.SHARE_LINK_UNAVAILABLE` — identical presentation in every case, with no code path that
  inspects or displays which condition triggered the `404` (`FRS-5.6`)

#### Scenario: Loading state

- **WHEN** the public fetch is in flight
- **THEN** the page SHALL render a skeleton placeholder (title + body shape), held for the standard
  `>=200ms` minimum display timer (`docs/ux.md §1`)

#### Scenario: Network/5xx failure

- **WHEN** the request fails for a reason other than the documented `404` (network error, `5xx`)
- **THEN** the page SHALL render `<ErrorFallback />` with a "Retry" action — distinct from the
  permanent `SHARE_LINK_UNAVAILABLE` state, since a transient failure is recoverable by retrying the
  same still-possibly-valid link

#### Scenario: Responsive layout

- **WHEN** the viewport is any of the four breakpoint classes (`FRS-7.5`)
- **THEN** `ShareViewPage` SHALL render a single-column, centered, chrome-free layout that remains
  fully readable — no `SidebarNav`, no authenticated-app shell, since anonymous visitors have neither

---

## Error Scenarios (this ticket's exact frontend behavior)

| Scenario                                                            | Frontend behavior                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Share button clicked on an unsaved new note                         | Button is disabled; no click handler fires, no request sent                   |
| Modal open, no active link (`404 SHARE_LINK_NOT_FOUND`)             | Renders generate form, no error toast (expected state, not a failure)         |
| Modal open, fetch network/5xx error                                 | Inline retry affordance inside the modal                                      |
| Generate submitted with out-of-range expiry                         | Submit button disabled, inline validation message, no request sent            |
| Generate fails (`404 NOTE_NOT_FOUND`, e.g. note trashed elsewhere)  | Error toast via `mapApiError`, generate form remains                          |
| Copy-to-clipboard fails                                             | Error toast, no fallback UI                                                   |
| Revoke confirmed but link already gone (`404 SHARE_LINK_NOT_FOUND`) | Error toast via `mapApiError`, re-fetch current state (no optimistic apply)   |
| Public page: any invalid-link cause (`404 SHARE_LINK_UNAVAILABLE`)  | Identical `UI_COPY.SHARE_LINK_UNAVAILABLE` state, cause never disclosed       |
| Public page: network/5xx (not the documented 404)                   | `<ErrorFallback />` with Retry, distinct from the permanent unavailable state |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1014 — §7.2, §5): generate/revoke/view-active-link UI
matches the `AB-1008` contract including the 1–30 day expiry selector and view-count display; share
status reflected on the note per `FRS-7.2` (already-shipped passive badges, unchanged by this ticket).
