# AB-1012 — Frontend: Note Editor (TipTap) + Autosave

## Executive Summary

Replaces the `AB-1011` `NoteDetailStubPage` with the real `apps/web` note editor: a TipTap
rich-text surface with a debounced background-autosave pipeline (`FRS-7.1`, `FRS-7.2`), a
real-time save-status indicator, an inline "Fly Tag" combobox for on-the-fly tag
creation/attachment (`FRS-3.1`), and a seamless new-note creation flow that auto-provisions a
`Note` row on first keystroke rather than requiring a separate create form. Because no backend
contract currently exists to attach a tag to a note (`createNoteSchema`/`updateNoteSchema` have no
`tagIds` field, `NoteResponseDto` has no `tags` field — confirmed against
`packages/shared/src/schemas/note.schema.ts` and `packages/shared/src/types/note.type.ts`), this
ticket also extends the shared contract and the backend layer (`routers → controllers → services →
repositories`) that AB-1004/AB-1006 left unbuilt, in addition to its frontend scope. Version
history (`AB-1015`) and share-link generation/revocation (`AB-1014`) remain untouched tickets; this
editor only reads existing `hasActiveShareLink` for display.

## Objective

Deliver an editor where every keystroke eventually reaches the server without a manual save
action, version-snapshot throttling (`FRS-6.1`) is respected exactly, save state is always
visibly accurate, in-progress edits survive an accidental refresh, and tag assignment is possible
without leaving the editor — all while respecting the existing IDOR/ownership and soft-delete
invariants already enforced elsewhere in `apps/api`.

## Target Requirements

- `FRS-2.1.2, FRS-2.1.3, FRS-2.1.5, FRS-2.1.6` — only the owning user can edit; title/body
  editable at any time; empty/whitespace title rejected; 200/100,000-char caps enforced
  server-side regardless of what the client allows.
- `FRS-3.1, FRS-3.4` — tags creatable/attachable inline from the note editor without navigating to
  a tag-management page; duplicate names (case-insensitive) rejected.
- `FRS-6.1` — every explicit save (title blur, `Ctrl/Cmd+S`) creates a version snapshot
  immediately; background autosave snapshots are throttled to at most one per 5-minute window per
  note (`APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES`).
- `FRS-7.1` — background autosave, no manual "Save" button.
- `FRS-7.2` — at-a-glance indicator of unsaved/in-flight changes and active-share status.
- `FRS-7.5` — usable across all four breakpoint classes.
- `FRS-8.1, FRS-8.4, FRS-8.5` — soft-deleted/Stage-2 notes are unreachable (`404`, never
  disambiguated); zero hardcoded numeric/copy/path literals — everything sourced from
  `@shared/core`.

## Architectural Mappings

- `SDS §4.1` — reuses `NoteController.update` → `NoteService.updateNote` → `NoteRepository`
  flow; extends it with the `tagIds` IDOR ownership-verification pattern already documented there
  (`prisma.tag.count({ where: { id: { in: tagIds }, userId } })` must equal `tagIds.length`, else
  reject — `403 Forbidden`, per `AGENTS.md §8`'s explicit carve-out for "IDOR-blocked tag attach",
  distinct from the general cross-user-note-access-looks-like-404 rule).
- `SDS §4.2` — Fly Tag flow (`TagCombobox.tsx` typing → `POST /api/v1/tags` on no-match → append
  new `Tag.id` to the note's active tag list) is implemented as-designed there; this ticket is
  what actually wires the combobox into a real editor instead of a stub.
- `SDS §4.4` — `PATCH /api/v1/notes/:id` throttling logic (`isExplicitSave` boolean →
  immediate snapshot vs. 5-minute-window check) is consumed exactly as implemented in
  `NoteService.updateNote`/`shouldSnapshot` — **unchanged** by this ticket except that `tagIds`-only
  updates must not force a snapshot (tags are not part of `NoteVersion.titleSnapshot`/
  `bodySnapshot`).
- `SDS §4.5` — `AutosaveIndicator` status pill (`saving`/`saved`/`error`) and the `>=1024px`
  persistent vs. `<1024px` slide-over layout for the version-history/tag drawer area.
- `docs/ux.md §1,2,4,5,9,10` — autosave debounce/status-pill timing, centralized error mapping,
  Zustand draft persistence, confirm-before-destructive (not triggered by this ticket's own
  mutations, but the pattern is reused for the `AutosaveIndicator`'s retry affordance), a11y,
  toasts.
- `packages/shared/CLAUDE.md` — Zero Duplication Contract: `note.schema.ts`/`note.type.ts` remain
  the single source for the new `tagIds`/`tags` shapes; no parallel interface defined in
  `apps/web` or `apps/api`.

## Out of Scope

- **Version history drawer / restore UI** (`AB-1015`) — this ticket only triggers snapshot
  creation server-side per `FRS-6.1`; it renders no version list, no preview modal, no restore
  action.
- **Share-link generation/revocation UI** (`AB-1014`) — the editor header shows the existing
  read-only `hasActiveShareLink` badge (see Decision D3) but has no "Share" button, expiry
  selector, or revoke action.
- **Search UI / global search box** (`AB-1013`) — untouched.
- **Tag management (rename/recolor/delete tags)** (`AB-1006`, already shipped) — the editor's Fly
  Tag combobox only creates and attaches; renaming/deleting a tag remains the responsibility of
  whatever surface `AB-1006` shipped that from (not re-exposed here).
- **Note folders/nesting, file/image attachments** (`FRS §2` Out of Scope, unchanged).
- **Offline mode / local-first editing** (`FRS §7` Out of Scope, unchanged) — draft persistence
  (Decision D6) is a refresh-survival safety net, not an offline-editing mode; it requires the
  initial `GET`/`POST` to have succeeded at least once and does not queue mutations while offline.
- **Automatic conflict resolution for concurrent multi-tab/multi-device edits** — last-write-wins
  via the existing `PATCH` semantics; no operational-transform/CRDT merge is introduced.

## Decisions Log (resolved with user before drafting)

- **D1 — Autosave debounce value**: `1500ms`, per `docs/ux.md §1`. `docs/ux.md` is a canonical doc
  (`AGENTS.md`'s conflict hierarchy: docs win over `CLAUDE.md`); `apps/web/CLAUDE.md`'s `1000ms`
  mention is stale and is corrected to `1500ms` in the same PR that implements this ticket.
- **D2 — Inline tag assignment is in scope.** `updateNoteSchema`/`createNoteSchema` gain an
  optional `tagIds: z.array(z.string().uuid())`; `NoteResponseDto` gains
  `tags: { id: string; name: string; color: string }[]`. This expands the ticket's backend surface
  (see "Backend Additions" below) beyond a pure frontend change, but ships the `FRS-3.1` editor
  requirement that was otherwise permanently unreachable.
- **D3 — Shared-status badge shown read-only in the editor header**, reusing the existing `Badge`
  pattern from `NoteCard.tsx` and `hasActiveShareLink`. Clicking it does nothing until `AB-1014`
  adds the share modal — it is a pure status indicator (`FRS-7.2`), not an entry point.
- **D4 — New-note flow**: landing on `/notes/new` renders an empty editor immediately (no create
  form). The first debounced keystroke (title or body) fires `POST /api/v1/notes`; on success the
  route silently replaces to `/notes/:newId` (`history.replaceState` via
  `navigate(..., { replace: true })`, no visible navigation/remount flash) and every subsequent
  change is a normal `PATCH`. If the initial `POST` fails, the editor stays on `/notes/new` and
  surfaces the `error` status pill — no content is lost since the TipTap/title state lives in the
  component regardless of persistence outcome.
- **D5 — Explicit-save triggers**: both a title-field blur (`onBlur`) and `Ctrl`/`Cmd`+`S` fire an
  immediate `PATCH` with `isExplicitSave: true`, matching `FRS-6.1`'s literal wording ("title
  change" is listed as an explicit-save trigger alongside `Ctrl+S`). Body edits alone still ride
  the `1500ms` debounce with `isExplicitSave: false`. A title blur with no actual title change
  (value unchanged) SHALL NOT fire a redundant `PATCH`.
- **D6 — Local draft persistence**: in-progress `{ title, body }` is buffered in a `useUiStore`
  slice (`drafts: Record<string, { title: string; body: string; savedAt: number }>`) persisted via
  Zustand's `persist` middleware to `localStorage` (this is UI draft content, not an auth token —
  does not conflict with the `FRS-1.3.5` token-storage rule). On editor mount, if a local draft
  exists for the note id and its `savedAt` is newer than the fetched note's `updatedAt`, the editor
  restores the draft into TipTap/the title field and immediately queues an autosave; the draft
  entry is deleted once a `PATCH`/`POST` response's `updatedAt` is `>=` the draft's `savedAt`.
- **D7 — Autosave retry policy**: on `PATCH`/`POST` failure, the client automatically retries with
  backoff (`2` attempts, `1s` then `3s` delay) while the pill shows `error` ("Save failed —
  Retrying...", `docs/ux.md §1`); if both automatic retries fail, the pill switches to a persistent
  error state with a manual click-to-retry button and automatic retries stop until the user
  triggers one manually or makes a new edit.

## Shared Package Additions (`packages/shared`)

- **MODIFIED** `src/schemas/note.schema.ts`:
  - `createNoteSchema` gains `tagIds: z.array(z.string().uuid()).optional()`.
  - `updateNoteSchema` gains `tagIds: z.array(z.string().uuid()).optional()`; the existing
    `.refine` (`NOTE_UPDATE_EMPTY`) is broadened to
    `title !== undefined || body !== undefined || tagIds !== undefined` so a tag-only update is
    valid.
- **MODIFIED** `src/types/note.type.ts`: `NoteResponseDto` gains
  `tags: Array<{ id: string; name: string; color: string }>`.
- **MODIFIED** `src/constants/ui-copy.constant.ts`: `UI_COPY` gains `AUTOSAVE_SAVING: "Saving to
cloud..."`, `AUTOSAVE_SAVED: "Saved"`, `AUTOSAVE_ERROR: "Save failed — Retrying..."` (exact
  `docs/ux.md §1` wording).
- **MODIFIED** `src/constants/validation-messages.constant.ts`: adds
  `NOTE_TAG_ATTACH_FORBIDDEN: "Cannot attach unauthorized or non-existent tags"` for the IDOR
  rejection path.
- **NO** changes to `api-paths.constant.ts` or `app-limits.constant.ts` — no new routes, no new
  numeric FRS-mandated limit (the `1500ms` debounce is a Tier-3 frontend-only value, see below).

## Backend Additions (`apps/api`)

- **MODIFIED** `services/note.service.ts`:
  - `createNote`/`updateNote` accept `input.tagIds`; when present, verify ownership
    (`prisma.tag.count({ where: { id: { in: tagIds }, userId } }) === tagIds.length`) inside the
    existing `$transaction`, else throw `AppError(403, API_ERROR_CODES.TAG_NOT_FOUND,
VALIDATION_MESSAGES.NOTE_TAG_ATTACH_FORBIDDEN)`.
  - `updateNote`'s `shouldSnapshot` check is unaffected by a `tagIds`-only payload — a tag-only
    update SHALL NOT create a `NoteVersion` (tags are not part of the snapshot shape).
  - `toNoteResponseDto` maps the note's joined `noteTags` to the new `tags` field.
- **MODIFIED** `repositories/note.repository.ts`: `createNote`/`updateNoteContent`/
  `findActiveNoteByIdForUser`/`findTrashedNoteByIdForUser` include `noteTags: { include: { tag:
true } }` in their Prisma queries; `updateNoteContent`/`createNote` replace the note's
  `NoteTag` join rows to match the verified `tagIds` (full replace, not incremental
  add/remove, matching `SDS §4.1`'s "Assigns or replaces `NoteTag` join rows").
- **NO** router/controller signature changes — `PATCH /api/v1/notes/:id` and
  `POST /api/v1/notes` already forward their full parsed body to the service; no new endpoint.

## Frontend Additions (`apps/web`)

- **NEW** `src/constants/ui.constant.ts`: `AUTOSAVE_DEBOUNCE_MS = 1500` (Tier-3, frontend-only,
  per `AGENTS.md §5`).
- **NEW** `src/hooks/useNoteAutosave.ts`: owns the debounce/explicit-save/retry state machine
  (Decisions D1, D5, D7), exposes `status: "idle" | "saving" | "saved" | "error"`.
- **NEW** `src/hooks/useCreateNote.ts` / extends `notes.api.ts` with `createNote`/`updateNote`
  calls (currently only `getNoteById`/`restoreNote`/`permanentDeleteNote` exist in
  `apps/web/src/api/notes.api.ts`).
- **NEW** `src/components/editor/NoteEditor.tsx`, `AutosaveIndicator.tsx`, `TagCombobox.tsx`
  (`@tiptap/react` `useEditor` + `StarterKit` — v3 `StarterKit` already includes `Underline`/
  `Link`, so no separate extension packages are needed beyond `@tiptap/extensions`' `Placeholder`).
- **NEW** exact-pinned dependencies added to `apps/web/package.json`:
  `@tiptap/react@3.27.3`, `@tiptap/starter-kit@3.27.3`, `@tiptap/pm@3.27.3`,
  `@tiptap/extensions@3.27.3` (verified current via `context7`/`npm view`, zero version ranges per
  `Rule 20`).
- **MODIFIED** `src/App.tsx`: `/notes/:id` route renders the new `NoteEditorPage` in place of
  `NoteDetailStubPage` (deleted, not left as dead code).
- **MODIFIED** `src/store/useUiStore.ts`: adds the `drafts` slice (Decision D6) with `persist`
  middleware scoped to a distinct `localStorage` key (never shares storage with any
  auth-token-related key).

## ADDED Requirements

### Requirement: Editor loads an existing note

The note editor SHALL load existing active note content and merge with any newer locally persisted draft.

#### Scenario: Editor loads an existing note

- **WHEN** an authenticated user navigates to `/notes/:id` for a note they own and that is not
  soft-deleted
- **THEN** the frontend SHALL call `GET /api/v1/notes/:id` via `useNoteById`, render a `<Skeleton
/>` matching the editor's final layout for a minimum of `200ms` (`docs/ux.md §1`), then populate
  the title input and TipTap `EditorContent` with the fetched `title`/`body`
- **AND** if a local draft exists for `:id` with `savedAt` newer than the fetched `updatedAt`, the
  editor SHALL restore the draft content instead and immediately queue an autosave (Decision D6).

### Requirement: New note — first keystroke provisions the note

The note editor SHALL automatically provision a new note row on the first debounced keystroke when creating a note.

#### Scenario: New note — first keystroke provisions the note

- **WHEN** a user on `/notes/new` types the first character in either the title or the TipTap body
- **THEN** after the `1500ms` debounce (Decision D1) the frontend SHALL call
  `POST /api/v1/notes` with the current `title`/`body`
- **AND** on `201 Created` SHALL replace the URL to `/notes/:newId` without remounting the editor
  or losing focus/selection state
- **AND** subsequent edits SHALL call `PATCH /api/v1/notes/:newId` as normal (Decision D4).

### Requirement: New note — initial creation fails

The note editor SHALL preserve typed draft content and allow automatic and manual retry if initial note creation fails.

#### Scenario: New note — initial creation fails

- **WHEN** the debounced `POST /api/v1/notes` from a fresh `/notes/new` session fails (network
  error or `5xx`)
- **THEN** the frontend SHALL remain on `/notes/new`, keep all typed content in place, show the
  `error` status pill, and automatically retry per Decision D7
- **AND** SHALL NOT send a `PATCH` (there is no note id yet) until a `POST` eventually succeeds.

### Requirement: Background body autosave (implicit)

The note editor SHALL automatically save body edits in the background after a 1500ms debounce without user intervention.

#### Scenario: Background body autosave (implicit)

- **WHEN** the user edits the TipTap body and stops typing for `1500ms`
- **THEN** the frontend SHALL call `PATCH /api/v1/notes/:id` with `{ body, isExplicitSave: false
}`, showing the `saving` pill (`UI_COPY.AUTOSAVE_SAVING`) immediately on debounce-fire and the
  `saved` pill (`UI_COPY.AUTOSAVE_SAVED`) on `200 OK`, fading out after `2s`
- **AND** the server-side 5-minute snapshot throttle (`FRS-6.1`, `SDS §4.4`) governs whether this
  particular call creates a `NoteVersion` — the frontend makes no throttling decision itself.

### Requirement: Explicit save via title blur

The note editor SHALL immediately trigger an explicit save whenever the user changes the note title and blurs the input.

#### Scenario: Explicit save via title blur

- **WHEN** the user changes the title and moves focus away from the title input
- **THEN** the frontend SHALL immediately call `PATCH /api/v1/notes/:id` with
  `{ title, isExplicitSave: true }` (Decision D5), bypassing the `1500ms` debounce entirely
- **AND** if the title value is unchanged from what was last successfully saved, no request SHALL
  be sent.

### Requirement: Explicit save via keyboard shortcut

The note editor SHALL immediately trigger an explicit save when the user presses Ctrl+S or Cmd+S.

#### Scenario: Explicit save via keyboard shortcut

- **WHEN** the user presses `Ctrl+S` (or `Cmd+S` on macOS) anywhere inside the editor (not
  intercepted by the browser's native save-page dialog)
- **THEN** the frontend SHALL immediately call `PATCH /api/v1/notes/:id` with the current
  `{ title, body, isExplicitSave: true }`, regardless of debounce timing or whether anything
  actually changed since the last save
- **AND** the shortcut SHALL expose `aria-keyshortcuts="Control+S"` (`docs/ux.md §9`) and SHALL be
  suppressed while focus is inside an `<input>`/`<textarea>` that isn't the editor itself (n/a
  here since the whole surface is the editor, but the global `C`-to-create shortcut elsewhere
  SHALL be suppressed while this editor has focus).

### Requirement: Autosave failure with automatic retry then manual fallback

The note editor SHALL surface save errors clearly and execute an automatic retry backoff before requiring a manual retry click.

#### Scenario: Autosave failure with automatic retry then manual fallback

- **WHEN** a debounced or explicit `PATCH`/`POST` fails
- **THEN** the frontend SHALL show the `error` pill (`UI_COPY.AUTOSAVE_ERROR`) and automatically
  retry after `1s`, then `3s` if the first retry also fails (Decision D7)
- **AND** if both automatic retries fail, the pill SHALL remain in an `error` state with a visible
  manual "Retry" button and SHALL NOT continue auto-retrying until the user clicks it or makes a
  new edit (which restarts the whole debounce/retry cycle fresh).

### Requirement: Draft restored after accidental refresh

The note editor SHALL persist in-flight drafts locally and restore them after an accidental refresh or tab closure.

#### Scenario: Draft restored after accidental refresh

- **WHEN** the user has unsaved edits (inside the `1500ms` debounce window, no `PATCH` sent yet)
  and the tab is refreshed or closed and reopened to the same `/notes/:id`
- **THEN** on remount the frontend SHALL detect the persisted `useUiStore` draft for that note id,
  restore it into the editor, and queue an autosave — the user SHALL NOT lose the in-flight edit.

### Requirement: Draft cleared once server catches up

The note editor SHALL clear locally persisted drafts once server-side updatedAt confirms the draft content is persisted.

#### Scenario: Draft cleared once server catches up

- **WHEN** a `PATCH`/`POST` response's `updatedAt` timestamp is `>=` the locally persisted draft's
  `savedAt`
- **THEN** the frontend SHALL delete that note id's entry from `useUiStore.drafts` — a stale draft
  SHALL NOT resurrect already-superseded content on a later visit.

### Requirement: Fly Tag creation and attachment from the editor

The note editor SHALL support inline tag creation and immediate attachment via the TagCombobox component.

#### Scenario: Fly Tag creation and attachment from the editor

- **WHEN** the user types a tag name into the editor's `TagCombobox` and no existing tag matches
  (case-insensitively)
- **THEN** the frontend SHALL show a `"Create new tag: '<name>'"` option; on selection it SHALL
  call `POST /api/v1/tags` (`{ name, color: APP_LIMITS.TAG_DEFAULT_COLOR }`)
- **AND** on success SHALL immediately call `PATCH /api/v1/notes/:id` with the new tag's `id`
  appended to the note's current `tagIds` list, `isExplicitSave: false` (tag attachment alone does
  not force a version snapshot — see "Backend Additions")
- **AND** the combobox SHALL also allow selecting an existing tag (no creation call), following the
  same attach-via-`PATCH` path.

### Requirement: Tag attachment rejected for unauthorized/non-existent tag ids

The backend and frontend SHALL reject and prevent attaching tag IDs not owned by the authenticated user or that do not exist.

#### Scenario: Tag attachment rejected for unauthorized/non-existent tag ids

- **WHEN** a `PATCH /api/v1/notes/:id` request's `tagIds` includes an id that does not belong to
  the requesting user or does not exist
- **THEN** the backend SHALL reject the entire update with `403 Forbidden`
  (`API_ERROR_CODES.TAG_NOT_FOUND`, `VALIDATION_MESSAGES.NOTE_TAG_ATTACH_FORBIDDEN`) inside the
  same transaction — no partial title/body update SHALL be persisted
- **AND** the frontend SHALL surface this via the centralized error dictionary as a toast, not a
  raw error, and SHALL NOT optimistically add the tag chip until the request succeeds.

### Requirement: Shared-status badge in editor header

The note editor header SHALL display a read-only badge indicating if the note has an active public share link.

#### Scenario: Shared-status badge in editor header

- **WHEN** the loaded note has `hasActiveShareLink === true`
- **THEN** the editor header SHALL render the same read-only "Shared" `Badge` used in `NoteCard`
  (Decision D3), with no click handler
- **AND** when `hasActiveShareLink === false`, no badge SHALL render.

### Requirement: Responsive editor layout

The note editor SHALL adapt its layout dynamically between persistent sidebar on >=1024px and slide-over sheet on <1024px.

#### Scenario: Responsive editor layout

- **WHEN** the viewport is `>= 1024px`
- **THEN** the editor SHALL render with the persistent `260px` `<SidebarNav />` and a reserved
  `320px` right-hand column for the future `AB-1015` version-history drawer (empty/collapsed in
  this ticket, not yet populated), with the TipTap surface filling the remaining width (`SDS
§4.5`)
- **WHEN** the viewport is `< 1024px`
- **THEN** all side panels SHALL collapse into slide-over `<Sheet />` overlays and the TipTap
  surface SHALL occupy 100% viewport width (`FRS-7.5`).

### Requirement: Editing a Stage-1 or Stage-2 trashed note directly

The system SHALL return 404 when attempting to directly access or edit a soft-deleted or trashed note in the editor.

#### Scenario: Editing a Stage-1 or Stage-2 trashed note directly

- **WHEN** a user navigates to `/notes/:id` for a note that is currently trashed (Stage 1 or
  Stage 2)
- **THEN** `GET /api/v1/notes/:id` SHALL return `404` (existing `NoteService.getNoteById`
  behavior, unchanged) and the frontend SHALL render the existing `<ErrorFallback />` ("This note
  is no longer available") rather than an editable surface — restoring first (from Trash) is
  required before editing, per `FRS §2` Error Scenarios.

### Requirement: Route guard reuse

The note editor routes SHALL require active authentication via ProtectedRoute wrapper.

#### Scenario: Route guard reuse

- **WHEN** an unauthenticated visitor navigates directly to `/notes/:id` or `/notes/new`
- **THEN** the existing `<ProtectedRoute>` SHALL redirect to `/login?next=...` unchanged
  (`docs/ux.md §6`) — this ticket adds no new guard logic.

## MODIFIED Requirements

### Requirement: /notes/:id route content (supersedes AB-1011 stub)

The application route `/notes/:id` SHALL render the full NoteEditorPage instead of the stub page.

#### Scenario: /notes/:id route content (supersedes AB-1011 stub)

- **WHEN** `App.tsx`'s `/notes/:id` route renders
- **THEN** it SHALL render the new `NoteEditorPage` in place of `NoteDetailStubPage`
  (`apps/web/src/pages/NoteDetailStubPage.tsx` is deleted, not left as dead code)
- **AND** the "← Back to notes" navigation affordance SHALL be preserved in the new page's header.

### Requirement: createNoteSchema and updateNoteSchema accept tagIds

The note creation and update validation schemas SHALL accept an optional tagIds array of UUIDs.

#### Scenario: createNoteSchema and updateNoteSchema accept tagIds

- **WHEN** either schema parses a payload containing `tagIds`
- **THEN** it SHALL validate each entry as a UUID string and SHALL NOT require `title`/`body` to
  also be present when only `tagIds` is supplied on an update (broadened `.refine`, Decision D2)
- **AND** a payload with `title`, `body`, and `tagIds` all `undefined` on update SHALL still be
  rejected (`VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY`, unchanged behavior for the all-absent case).

### Requirement: NoteResponseDto includes tags

All endpoints returning NoteResponseDto SHALL include the tags array populated with tag summary DTOs.

#### Scenario: NoteResponseDto includes tags

- **WHEN** any endpoint returning `NoteResponseDto` (`create`, `getById`, `update`, `list`,
  `listTrash`, `restore`) responds
- **THEN** the payload SHALL include a `tags` array reflecting the note's current `NoteTag` join
  rows (id/name/color), sourced from the same repository queries already joining `shareLinks` —
  no additional round-trip.

## Error Scenarios

- `GET /api/v1/notes/:id` returns `404` for another user's note, a Stage-2 note, or a fully purged
  note — identical `<ErrorFallback />` presentation in all three cases (no disambiguation, per the
  general cross-user "looks like not found" philosophy).
- `PATCH /api/v1/notes/:id` with an empty/whitespace-only `title` → `400`, surfaced inline on the
  title field via the centralized error dictionary, autosave pill returns to `error` state without
  losing the user's typed (invalid) input.
- `PATCH .../notes/:id` with `title`/`body` exceeding the char caps → `400`, same inline treatment;
  the TipTap character-count SHALL warn the user client-side before hitting the cap, but the
  server cap is the enforced source of truth (`FRS-2.1.6`).
- `PATCH` with unauthorized/non-existent `tagIds` → `403` (see dedicated Scenario above).
- `POST /api/v1/tags` returns a name conflict (`API_ERROR_CODES.TAG_NAME_CONFLICT`) while typing in
  `TagCombobox` → combobox surfaces the existing tag as a selectable option instead of erroring the
  whole editor (graceful degradation, not a page-level failure).
- Network failure mid-autosave → `error` pill + auto-retry-then-manual per Decision D7; never a
  full-page error (the editor itself remains usable/typeable throughout).

## Out-of-Scope Boundary Recap (binding)

Version history drawer/restore (`AB-1015`), share-link generation/revocation UI (`AB-1014`),
search UI (`AB-1013`), tag rename/recolor/delete UI (already shipped elsewhere in `AB-1006`), file/
image attachments and note folders/nesting (`FRS §2`, unchanged), offline mode (`FRS §7`,
unchanged), and multi-tab/multi-device conflict resolution beyond last-write-wins — plus everything
listed under "Out of Scope" above.
