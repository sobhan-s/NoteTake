# Technical Implementation Plan — AB-1012 (Frontend: Note Editor (TipTap) + Autosave)

Maps `specs/notes/spec.md` (approved) against `SDS.md §4.1-4.5` / `docs/ux.md` / `AGENTS.md` /
`apps/api/CLAUDE.md` / `apps/web/CLAUDE.md` / `packages/shared/CLAUDE.md` contracts. **Full-stack** —
unlike `AB-1011`, this ticket touches `packages/shared` and `apps/api` in addition to `apps/web`,
because `createNoteSchema`/`updateNoteSchema`/`NoteResponseDto` currently have no `tagIds`/`tags`
contract for the editor's inline tag-attach flow (Decision D2, confirmed absent by direct read of
`packages/shared/src/schemas/note.schema.ts` and `src/types/note.type.ts`).

## 0. Codebase State Confirmed Before Planning

- `apps/web/src/pages/NoteDetailStubPage.tsx` (AB-1011 stub) currently renders at `/notes/:id`
  (including the literal string `"new"` as `:id` — there is **no separate `/notes/new` route**,
  confirmed in `App.tsx`). `useNoteById(id)` already guards with `enabled: id !== "new"`. AB-1012
  preserves this exact routing convention — no new route is added to `App.tsx`, only the element
  swapped.
- `packages/shared/src/schemas/note.schema.ts`: `createNoteSchema = { title, body }`,
  `updateNoteSchema = { title?, body?, isExplicitSave: boolean.default(false) }.refine(title !==
undefined || body !== undefined)`. Neither has `tagIds`. `isExplicitSave` already exists —
  clearly designed for this ticket's D5/D7 distinction, unused by any current caller.
- `packages/shared/src/types/note.type.ts`: `NoteResponseDto` = `{ id, title, body, deletedAt,
createdAt, updatedAt, hasActiveShareLink }` — no `tags` field.
- `apps/api/src/repositories/note.repository.ts`: single shared include constant
  `ACTIVE_SHARE_LINK_INCLUDE` (`shareLinks` only) applied uniformly across `createNote` (**not
  currently applied** — `createNote` has no `include` at all), `findActiveNoteByIdForUser`,
  `findTrashedNoteByIdForUser`, `updateNoteContent`, `softDeleteNote`, `restoreNote`,
  `listActiveNotesForUser`, `listTrashedNotesForUser`. `Db = Pick<Prisma.TransactionClient,
"note">`. `NoteTag` is an **explicit join model** (composite PK `[noteId, tagId]`, relation name
  `noteTags` on `Note` — confirmed via `buildTagFilter`'s existing `noteTags: { some: { tagId }
}` usage in the list-filter path) — no Prisma implicit m2m sugar exists; tag reassignment means
  directly writing `NoteTag` rows via nested `create`/`deleteMany`, not `connect`/`set`.
- `apps/api/src/services/tag.service.ts` / `repositories/tag.repository.ts`: `Db =
Pick<Prisma.TransactionClient, "tag">` already — sufficient as-is for a new
  `findTagsByIdsForUser` ownership-check repo function; no widening needed there. No existing
  "verify N tag ids belong to user" bulk helper — new function required.
- `apps/web` currently has **zero** TipTap/editor-related files or dependencies anywhere in the
  monorepo (`grep` for `tiptap` across all `package.json` returns nothing) and no
  `src/components/editor/` directory. `src/hooks/useDebounce.ts` does not exist. `src/api/notes.api.ts`
  has `listNotes`/`listTrash`/`getNoteById`/`restoreNote`/`permanentDeleteNote` only — **no
  `createNote`/`updateNote`**. `src/api/tags.api.ts` has `listTags` only — **no `createTag`**.
  `src/store/useUiStore.ts` has only `isMobileSidebarOpen` (no `persist` middleware anywhere yet,
  no `drafts` slice).
- Note `body` is confirmed stored/consumed as an **HTML string** end-to-end (`src/lib/textPreview.ts`
  strips it via `DOMParser` for previews) — TipTap's `editor.getHTML()` / `setContent(html)` map
  directly onto the existing `title`/`body` contract with zero backend format migration.
- **TipTap v3 verified (WebSearch against tiptap.dev docs, not `context7` per user instruction)**:
  `StarterKit` in v3 bundles `Underline` and `Link` marks natively ("New in v3") — confirms
  spec.md's claim and supersedes `apps/web/CLAUDE.md`'s phrasing that lists them as if separate
  extensions (stale wording, not a real conflict — no fix-bundle needed, unlike the `1000ms`/
  `1500ms` debounce value which `docs/ux.md` §1 explicitly fixes at `1500ms`, the canonical value
  used throughout this plan). `Placeholder` (and `CharacterCount`, noted for future use) both live
  in the single `@tiptap/extensions` package (`import { Placeholder } from "@tiptap/extensions"`)
  — confirms Decision-log's "no separate extension packages … beyond `@tiptap/extensions`'
  Placeholder" claim exactly. Exact pinned versions re-confirmed via `npm view` at plan time:
  `@tiptap/react@3.27.3`, `@tiptap/starter-kit@3.27.3`, `@tiptap/pm@3.27.3`,
  `@tiptap/extensions@3.27.3` — matches spec.md verbatim, zero drift; re-verify once more
  immediately before `/implement` per `CLAUDE.md §1b`.
- `packages/shared/src/constants/api-error-codes.constant.ts` already has `TAG_NOT_FOUND` — spec's
  Backend Additions reuse this code for the 403 IDOR-rejection path; **no new error code** needed.
  `validation-messages.constant.ts` needs exactly one new key: `NOTE_TAG_ATTACH_FORBIDDEN`.
  `ui-copy.constant.ts` needs exactly three new keys: `AUTOSAVE_SAVING`, `AUTOSAVE_SAVED`,
  `AUTOSAVE_ERROR` (verbatim `docs/ux.md §1` copy).

## 1. Backend Layer Enforcement (`SDS §4.1`, `apps/api/CLAUDE.md`)

Strict `router → controller → service → repository` unchanged; no router/controller signature
changes (both `POST /` and `PATCH /:id` already forward the full parsed Zod body to the service —
adding `tagIds` to the schemas is sufficient for it to flow through untouched controller code).

### 1.1 `repositories/tag.repository.ts` (MODIFY — add one function)

```ts
export function findTagsByIdsForUser(
  ids: string[],
  userId: string,
  db: Db = prisma,
): Promise<Tag[]> {
  return db.tag.findMany({ where: { id: { in: ids }, userId } });
}
```

Reuses the file's existing `Db = Pick<Prisma.TransactionClient, "tag">` — no type widening
required (already `"tag"`-scoped).

### 1.2 `services/note.service.ts` (MODIFY)

- New private helper `verifyTagOwnership(tagIds: string[] | undefined, userId: string, tx):
Promise<void>` — if `tagIds === undefined`, no-op (tags untouched); else calls
  `tagRepository.findTagsByIdsForUser(tagIds, userId, tx)` and throws `AppError(403,
API_ERROR_CODES.TAG_NOT_FOUND, VALIDATION_MESSAGES.NOTE_TAG_ATTACH_FORBIDDEN)` if the returned
  count `!==` `tagIds.length` (`SDS §4.1`'s exact IDOR check, run inside the same `tx` used for the
  note write so the whole operation is atomic — a partial title/body update must never persist
  alongside a rejected tag set, per spec's Error Scenario).
- `createNote`: calls `verifyTagOwnership(input.tagIds, userId, tx)` before
  `noteRepository.createNote(..., tx)`; the repo call is extended to also nest-create `NoteTag`
  rows (see §1.3) and returns the full `NOTE_RESPONSE_INCLUDE` shape directly — the current manual
  `{ ...note, shareLinks: [] }` post-construction is deleted since the repo now returns
  `shareLinks`/`noteTags` itself via `include` (consistent, no special-casing of the create path).
- `updateNote`: calls `verifyTagOwnership(input.tagIds, userId, tx)` before
  `noteRepository.updateNoteContent(...)`; `shouldSnapshot` is called **unchanged** — it only
  inspects `isExplicitSave` and the title/body throttle window, so a `tagIds`-only payload (with
  `title`/`body` both `undefined`) correctly skips version-snapshot creation with zero code change
  there, matching spec's explicit "tag-only update SHALL NOT create a `NoteVersion`."
- `toNoteResponseDto(note: NoteWithRelations)`: adds `tags: note.noteTags.map(({ tag }) => ({ id:
tag.id, name: tag.name, color: tag.color }))` to the returned object. `NoteWithShareLinks` is
  renamed `NoteWithRelations` (repository export) to reflect the added `noteTags` field — grep
  confirms this type is only imported in `note.service.ts`, so the rename is a same-PR, zero-risk
  local refactor.

### 1.3 `repositories/note.repository.ts` (MODIFY)

- Rename `ACTIVE_SHARE_LINK_INCLUDE` → `NOTE_RESPONSE_INCLUDE`, extended with:
  ```ts
  noteTags: { include: { tag: { select: { id: true, name: true, color: true } } } }
  ```
  applied to **every** existing call site unchanged (`findActiveNoteByIdForUser`,
  `findTrashedNoteByIdForUser`, `updateNoteContent`, `softDeleteNote`, `restoreNote`,
  `listActiveNotesForUser`, `listTrashedNotesForUser`) — this is exactly spec's "sourced from the
  same repository queries already joining `shareLinks` — no additional round-trip" (`MODIFIED
Scenarios`).
- `createNote(data: { userId; title; body; tagIds?: string[] }, db)`: now passes `include:
NOTE_RESPONSE_INCLUDE` and, when `tagIds` is non-empty, nests
  `noteTags: { create: tagIds.map((tagId) => ({ tagId })) }` into `data` (standard Prisma
  one-to-many nested write against the `NoteTag` relation — no implicit-m2m assumption needed).
- `updateNoteContent(id, data: { title?; body?; tagIds?: string[] }, db)`: when `tagIds !==
undefined`, nests `noteTags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) }` —
  **full replace**, matching `SDS §4.1`/spec's explicit "Assigns or replaces `NoteTag` join rows"
  (not an incremental add/remove diff). When `tagIds === undefined` (title/body-only update), the
  `noteTags` key is omitted entirely from `data` so existing tags are left untouched.
- `Db` type (`Pick<Prisma.TransactionClient, "note">`) is widened to `Pick<Prisma.TransactionClient,
"note" | "noteTag">` — harmless for every existing function (they simply gain unused access);
  required so the nested-write nature of the nested nested `create`/`deleteMany` blocks type-checks
  against the narrower `Db` (Prisma's nested-write typings resolve through the parent `note` model,
  so in practice this widening may prove unnecessary once implemented — confirm at `/implement`
  time; nested writes go through `db.note.create`/`update`, not `db.noteTag.*` directly, so `"note"`
  alone is likely already sufficient. Flagging as a checkpoint, not a certainty, to avoid
  over-committing to an unverified Prisma typing detail).

### 1.4 No controller/router changes

`NoteController.create`/`update` already do `schema.parse(req.body)` then forward the whole typed
object to the service — `input.tagIds` exists automatically once the Zod schemas gain the field
(§2). Zero lines changed in `controllers/note.controller.ts` or `routers/note.router.ts`.

## 2. Single Source of Truth Additions (`packages/shared`)

### 2.1 `src/schemas/note.schema.ts` (MODIFY)

```ts
export const createNoteSchema = z.object({
  title: z.string().trim().min(1, ...).max(APP_LIMITS.NOTE_TITLE_MAX_CHARS, ...),
  body: z.string().max(APP_LIMITS.NOTE_BODY_MAX_CHARS, ...),
  tagIds: z.array(z.string().uuid()).optional(),
});

export const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1, ...).max(APP_LIMITS.NOTE_TITLE_MAX_CHARS, ...).optional(),
    body: z.string().max(APP_LIMITS.NOTE_BODY_MAX_CHARS, ...).optional(),
    tagIds: z.array(z.string().uuid()).optional(),
    isExplicitSave: z.boolean().default(false),
  })
  .refine(
    (data) => data.title !== undefined || data.body !== undefined || data.tagIds !== undefined,
    { message: VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY },
  );
```

Broadened `.refine` matches spec's `MODIFIED Scenarios` exactly: an all-`undefined` payload is
still rejected; a `tagIds`-only payload is now valid.

### 2.2 `src/types/note.type.ts` (MODIFY) + `src/types/tag.type.ts` (MODIFY)

- **NEW** in `tag.type.ts`: `export type TagSummaryDto = { id: string; name: string; color: string
};` — a lighter sibling of the existing `TagResponseDto` (which also carries `noteCount`,
  irrelevant on a per-note embed). Keeps the "symmetric schema-to-type, never hand-duplicate"
  contract intact since this is a plain derived shape, not a parallel schema.
- `note.type.ts`: `NoteResponseDto` gains `tags: TagSummaryDto[]` (imported from `../types/tag.type`).
  `CreateNoteInput`/`UpdateNoteInput` automatically pick up `tagIds` via existing `z.infer`.

### 2.3 `src/constants/validation-messages.constant.ts` (MODIFY, append one key)

```ts
NOTE_TAG_ATTACH_FORBIDDEN: "Cannot attach unauthorized or non-existent tags",
```

### 2.4 `src/constants/ui-copy.constant.ts` (MODIFY, append three keys — verbatim `docs/ux.md §1`)

```ts
AUTOSAVE_SAVING: "Saving to cloud...",
AUTOSAVE_SAVED: "Saved",
AUTOSAVE_ERROR: "Save failed — Retrying...",
```

- **No changes** to `api-paths.constant.ts` (no new routes) or `app-limits.constant.ts` (no new
  FRS-mandated numeric limit — `1500ms` debounce is a Tier-3 frontend-only value per `AGENTS.md
§5`, not a shared/backend limit). **No new `API_ERROR_CODES`** entry — `TAG_NOT_FOUND` is reused.

## 3. Token & Storage Security — Unchanged (Confirmed)

No auth/token code touched. `useAuthStore` (JS-memory access token) and the existing `httpClient`
silent-refresh interceptor are reused as-is by the two new mutation hooks (`useCreateNote`,
`useUpdateNote`) and the new `useCreateTag` hook (`FRS-1.3.5`). The new `useUiStore` `drafts` slice
persisted to `localStorage` (Decision D6) stores only note **content** (`{ title, body, savedAt }`
keyed by note id) — never a token, never anything under a key that could collide with an
auth-related storage key (there currently is none, since access tokens are never persisted at all).

## 4. Two-Stage Soft Delete — Reused, Not Modified (Confirmed)

Navigating to `/notes/:id` for a Stage-1 or Stage-2 trashed note continues to 404 via the
**existing, untouched** `NoteService.getNoteById` → `findActiveNoteByIdForUser` path (`deletedAt:
null` filter unchanged). The frontend renders the existing `<ErrorFallback />` rather than an
editable surface — no new soft-delete logic, no new query param, no client-side override
(`FRS-8.1`).

## 5. Database & Test Isolation Contract (`FRS-0.3.3`)

- New backend Supertest coverage (dispatched to `test-writer.md`) exercises the extended
  `createNote`/`updateNote` transaction against the isolated `notes_app_test` database only —
  `TRUNCATE ... CASCADE` guarded by the existing `process.env.DATABASE_URL?.includes("notes_app_test")`
  check already enforced by the current suite scaffolding (`Rule 10`), unchanged.
- New Vitest coverage for `verifyTagOwnership`/`findTagsByIdsForUser` runs against the same
  isolated DB (real `citext`/UUID columns — no `sqlite::memory:` substitution).
- Frontend tests (autosave debounce/retry state machine, `TagCombobox`, draft persistence,
  responsive layout) are Vitest + Testing Library, mocking `httpClient` — zero live DB, same
  pattern as `AB-1011`.

## 6. New Dependencies

### 6.1 `apps/web/package.json` — TipTap (exact versions re-confirmed via `npm view`, zero ranges per `Rule 20`)

```json
"@tiptap/react": "3.27.3",
"@tiptap/starter-kit": "3.27.3",
"@tiptap/pm": "3.27.3",
"@tiptap/extensions": "3.27.3"
```

No other new dependency — `StarterKit` already bundles `Bold`/`Italic`/`Underline`/`Link`/`Strike`/
`Code`/lists/headings/etc. (v3, confirmed §0); `Placeholder` comes from `@tiptap/extensions`. No
new Radix package needed (no new modal/overlay primitive introduced by this ticket beyond what
`AB-1011` already added).

### 6.2 Decision — no dedicated `Toolbar.tsx` file, no `CharacterCount` extension dependency

- A minimal formatting toolbar (Bold/Italic/Underline/Link buttons via
  `editor.chain().focus().toggleBold().run()` etc., using existing `lucide-react` icons and the
  existing `Button` primitive) is implemented as a private JSX block **inside** `NoteEditor.tsx`,
  not a new top-level component file — spec.md's `Frontend Additions` names exactly three new
  components (`NoteEditor.tsx`, `AutosaveIndicator.tsx`, `TagCombobox.tsx`); splitting the toolbar
  out is a valid future refactor but not required to satisfy any scenario in `spec.md`.
- The body character-count warning (Error Scenarios: "TipTap character-count SHALL warn... before
  hitting the cap") is computed via `editor.getText().length` on every `onUpdate`, compared against
  `APP_LIMITS.NOTE_BODY_MAX_CHARS` — no `CharacterCount` extension dependency added, keeping the
  dependency list exactly as spec.md pins it. (`@tiptap/extensions` does also export
  `CharacterCount` for future precision if plain-text-length proves inaccurate vs. TipTap's
  internal node counting, but that's a non-blocking refinement, not required now.)

## 7. Frontend File Plan (`apps/web`)

### 7.1 Feature Components (`src/components/editor/`, all NEW)

| File                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoteEditor.tsx`        | Owns `useEditor({ extensions: [StarterKit, Placeholder.configure(...)], content, onUpdate })`, the title `<input>`, inline toolbar block (§6.2), `Ctrl/Cmd+S` keydown handler (`aria-keyshortcuts="Control+S"`, suppressed logic n/a — whole surface is the editor), title-blur explicit-save trigger (D5), wires `useNoteAutosave` + `useCreateNote`/`useUpdateNote`, renders `<AutosaveIndicator />`, the read-only "Shared" `<Badge />` (D3, reusing `NoteCard`'s exact pattern), and `<TagCombobox />`. Also owns the `tagIds` local state (initialized from `note.tags.map(t => t.id)` on load) passed to `TagCombobox`. |
| `AutosaveIndicator.tsx` | Pure presentational: `{ status: "idle" \| "saving" \| "saved" \| "error"; onRetry: () => void }` → renders the three `UI_COPY.AUTOSAVE_*` pills per `docs/ux.md §1` (saved pill auto-hides after `2000ms`; error pill shows a manual "Retry" button, `#fef08a` high-contrast styling).                                                                                                                                                                                                                                                                                                                                        |
| `TagCombobox.tsx`       | Typeahead over `useTags()` results; case-insensitive match check; renders `"Create new tag: '<name>'"` when no match (Fly Tag, `FRS-3.1`); on select (existing or newly created) calls a passed-in `onAttach(tagId: string)` callback — stays "dumb," all mutation/attach logic lives in `NoteEditor`'s handlers per spec's "no optimistic chip until success."                                                                                                                                                                                                                                                               |

### 7.2 Pages

| File                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoteEditorPage.tsx` (NEW) | Replaces `NoteDetailStubPage.tsx` (**deleted**, not left dead, along with its test file). Reads `id` param (`"new"` or a UUID, same convention as today), composes `SidebarNav` + mobile `Sheet` (identical layout wiring to `NotesPage`) + "← Back to notes" link (preserved per spec's `MODIFIED Scenarios`) + reserved empty `320px` right-hand column (`AB-1015` placeholder, collapsed on `<1024px`) + `<NoteEditor />`. Fetches via `useNoteById(id)` when `id !== "new"`; renders the `<Skeleton />`-based loading state (min `200ms` via existing `useMinLoadingTime`) matching the editor's final layout while loading; renders `<ErrorFallback />` on fetch failure/404 (trashed/cross-user/purged note, indistinguishable — `FRS-8.1`). |

### 7.3 API Client (MODIFY)

- **`src/api/notes.api.ts`**: add
  ```ts
  export async function createNote(input: CreateNoteInput): Promise<NoteResponseDto> { ... } // POST NOTES_ROOT
  export async function updateNote(id: string, input: UpdateNoteInput): Promise<NoteResponseDto> { ... } // PATCH NOTES_ROOT/:id
  ```
  Same shape as the file's four existing functions (plain async wrapper unwrapping
  `response.data.data`).
- **`src/api/tags.api.ts`**: add
  ```ts
  export async function createTag(input: CreateTagInput): Promise<TagResponseDto> { ... } // POST API_PATHS.TAGS.ROOT
  ```

### 7.4 Hooks (all NEW unless noted)

| File                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useNoteAutosave.ts` | The debounce/explicit-save/retry state machine (Decisions D1/D5/D7). Internally owns a `setTimeout` ref (no generic `useDebounce.ts` extracted — the explicit-save-bypasses-debounce and 2-stage-retry-then-manual-fallback behavior doesn't fit a plain "debounced value" hook cleanly; a generic `useDebounce` is deferred to whichever ticket first needs a _value_-debounce, e.g. `AB-1013` search). Exposes `{ status, triggerAutosave(patch), triggerExplicitSave(patch), retry() }`. Internally calls `useCreateNote`/`useUpdateNote` (below) and tracks the "no note id yet" vs. "has note id" branch (D4) itself, translating a successful first `POST` into the `navigate(..., { replace: true })` call via a passed-in callback (page-level `NoteEditorPage`/`NoteEditor` owns the actual `useNavigate()` call — the hook stays router-agnostic, only invoking `onCreated(newId)`). |
| `useCreateNote.ts`   | `useMutation({ mutationFn: createNote })` — on success, invalidates `["notes", "list"]` (new note should appear there) but does **not** navigate itself (caller's job, per above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `useUpdateNote.ts`   | `useMutation({ mutationFn: ({ id, input }) => updateNote(id, input) })` — on success invalidates `["notes", "detail", id]` and `["notes", "list"]`; does not toast on every autosave success (only the `AutosaveIndicator` pill communicates status — a toast on every 1500ms-debounced save would violate `docs/ux.md §10`'s "don't over-toast" spirit and isn't in any spec scenario).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `useCreateTag.ts`    | `useMutation({ mutationFn: createTag })` — invalidates `["tags", "list"]` on success; `TagCombobox` awaits this before calling `onAttach`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 7.5 Store (`src/store/useUiStore.ts`, MODIFY)

- Wrapped in Zustand `persist` middleware, `name: "note-editor-drafts"` (a distinct
  `localStorage` key — never shares a key with anything auth-related, of which none exist), with
  `partialize: (state) => ({ drafts: state.drafts })` so `isMobileSidebarOpen` stays a
  purely in-memory, non-persisted toggle (unaffected refresh behavior for the existing `AB-1011`
  sidebar).
- New slice: `drafts: Record<string, { title: string; body: string; savedAt: number }>`,
  `setDraft(noteId, draft)`, `clearDraft(noteId)` — implements Decisions D6 (restore-on-mount,
  newer-than-`updatedAt` check happens in `NoteEditor`/`useNoteAutosave`, not the store itself) and
  D6's clear-on-catch-up rule.

### 7.6 Constants (`src/constants/ui.constant.ts`, MODIFY, append only)

```ts
export const AUTOSAVE_DEBOUNCE_MS = 1500; // docs/ux.md §1, Decision D1 — supersedes the stale
// 1000ms mentioned in apps/web/CLAUDE.md
export const AUTOSAVE_RETRY_DELAYS_MS = [1000, 3000] as const; // Decision D7
export const AUTOSAVE_SAVED_FADE_MS = 2000; // docs/ux.md §1
```

- Follow-up (same PR, per `AB-1011`'s D3 precedent): correct `apps/web/CLAUDE.md`'s `1000ms`
  autosave mention to `1500ms` so it stops disagreeing with `docs/ux.md` (canonical per `AGENTS.md`'s
  conflict hierarchy).

### 7.7 Wiring Changes

- **`apps/web/src/App.tsx`** (MODIFY): remove `NoteDetailStubPage` import/route; add
  `<Route path="/notes/:id" element={<ProtectedRoute><NoteEditorPage /></ProtectedRoute>} />` in
  its place (same path string, same guard — literal swap).
- **`apps/web/src/lib/errorMessages.ts`** (MODIFY): add
  `case API_ERROR_CODES.TAG_NOT_FOUND: return "One or more tags could not be attached.";` — the
  existing `switch` has no case for this code yet (only auth/OTP/rate-limit/`NOTE_NOT_FOUND` cases
  exist today); needed for the 403 tag-attach-rejection toast (spec's dedicated Error Scenario).
- **Deleted**: `src/pages/NoteDetailStubPage.tsx` and its test file (superseded).

## 8. Responsive Behavior (`SDS §4.5`, `FRS-7.5`)

- `>= 1024px` (`lg:`): `SidebarNav` persistent `260px` (reused from `AB-1011`, unchanged) + editor
  fills remaining width + a reserved, empty/collapsed `320px` right column (`AB-1015` placeholder
  `<div>` — no content, no drawer logic yet).
- `< 1024px`: both side panels collapse into slide-over `<Sheet />` overlays (left `SidebarNav`
  reused as-is; the right `320px` column simply doesn't render at all rather than becoming a sheet,
  since it has no content to show yet); TipTap surface occupies 100% viewport width.

## 9. Testing Strategy (dispatched to `test-writer.md`)

Source strictly from `FRS-2.1.2/2.1.3/2.1.5/2.1.6`, `FRS-3.1/3.4`, `FRS-6.1`, `FRS-7.1/7.2/7.5`,
`FRS-8.1/8.4/8.5` text and this ticket's `spec.md` scenarios — never from `FRS.md` Acceptance
Criteria bullet wording (`FRS-0.3.2`).

- **Backend (Supertest, `notes_app_test`)**: `tagIds` ownership rejection (403, no partial
  title/body persisted — assert via a follow-up `GET`), full-replace semantics on update (attach
  then attach a different set → old `NoteTag` rows gone), tag-only update does not create a
  `NoteVersion` (assert version count unchanged), `createNote` with `tagIds` returns `tags` in the
  same response with zero extra queries (assert via query-count/log spy if feasible), explicit-save
  vs. throttled-window boundary cases (4th/5th snapshot at exactly `5min - 1s` / `5min` — already
  covered by `AB-1009`'s existing suite, only re-verify `tagIds` doesn't perturb that logic).
- **Frontend (Vitest + Testing Library, mocked `httpClient`)**: debounce timing (fake timers,
  exactly `1500ms`), explicit-save bypass on title blur (no request if unchanged), `Ctrl+S` handler,
  retry sequence (`1s` then `3s`, then persistent manual-retry state, stops auto-retrying until
  next edit or click), new-note first-keystroke → `POST` → silent `replace` navigation with no
  remount/focus loss, draft persistence + restore-on-refresh + clear-on-catch-up (`savedAt` vs.
  `updatedAt` comparison), `TagCombobox` create-vs-select paths, 403 tag-attach toast without
  optimistic chip, responsive breakpoint rendering, `ProtectedRoute` guard preserved on `/notes/:id`.
- No new Playwright E2E required by this ticket alone (`AB-1016` owns end-to-end coverage
  aggregation) — flagging per `AGENTS.md §10`'s "no silent caps" spirit: this plan does not add
  E2E specs here, not because they're unnecessary, but because the existing convention places
  cross-feature E2E in the dedicated `AB-1016` ticket.

## 10. Quality Gates (must pass before `/tasks` → `/implement` checkpoint closes)

1. `pnpm turbo run build` — 0 errors (`tsup` for `packages/shared` + `apps/api`, Vite build for
   `apps/web`).
2. `pnpm turbo run lint -- --max-warnings 0`.
3. `pnpm turbo run typecheck` (`tsc --noEmit`).
4. `pnpm turbo run test -- --coverage` — all green, `>=80%` coverage on new code, zero
   `notes_app`/`sqlite::memory:` connections.

---

**Awaiting explicit user `APPROVED` on this plan before generating `tasks.md`.**
