# Sequenced Tasks for AB-1012-frontend-note-editor

## Phase 1: Foundation & Shared Tier (`@shared/core`)

_(All DTOs/Zod schemas live exclusively in `packages/shared` — `Rule 11`. No parallel
interface may be hand-duplicated in `apps/api` or `apps/web`.)_

- [x] `packages/shared/src/schemas/note.schema.ts`: Add `tagIds: z.array(z.string().uuid()).optional()` to `createNoteSchema`; add the same field to `updateNoteSchema` and broaden its `.refine` to `title !== undefined || body !== undefined || tagIds !== undefined` (`VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY` on the all-absent case) (`[FRS-3.1, FRS-2.1.3]`).
- [x] `packages/shared/src/types/tag.type.ts`: Add `TagSummaryDto = { id: string; name: string; color: string }` as a lighter sibling of `TagResponseDto` (`[FRS-3.1]`).
- [x] `packages/shared/src/types/note.type.ts`: Add `tags: TagSummaryDto[]` to `NoteResponseDto`, importing `TagSummaryDto` from `../types/tag.type` (`[FRS-3.1]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: Append `NOTE_TAG_ATTACH_FORBIDDEN: "Cannot attach unauthorized or non-existent tags"` (`[FRS-3.1]`).
- [x] `packages/shared/src/constants/ui-copy.constant.ts`: Append `AUTOSAVE_SAVING: "Saving to cloud..."`, `AUTOSAVE_SAVED: "Saved"`, `AUTOSAVE_ERROR: "Save failed — Retrying..."` (verbatim `docs/ux.md §1`) (`[FRS-7.1, FRS-7.2]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` (`tsup`) → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck` (`tsc --noEmit`).

## Phase 2: Core Implementation (`apps/api`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop. Controllers strictly parse `z.parse` and contain zero SQL/business logic — `SDS §1.1`.)_

- [x] `apps/api/src/repositories/tag.repository.ts`: Add `findTagsByIdsForUser(ids: string[], userId: string, db: Db = prisma): Promise<Tag[]>` reusing the file's existing `Db = Pick<Prisma.TransactionClient, "tag">` (`[FRS-3.1, FRS-3.4]`).
- [x] `apps/api/src/repositories/note.repository.ts`: Rename `ACTIVE_SHARE_LINK_INCLUDE` → `NOTE_RESPONSE_INCLUDE`, extend with `noteTags: { include: { tag: { select: { id: true, name: true, color: true } } } }`, applied to every existing call site (`findActiveNoteByIdForUser`, `findTrashedNoteByIdForUser`, `updateNoteContent`, `softDeleteNote`, `restoreNote`, `listActiveNotesForUser`, `listTrashedNotesForUser`) (`[FRS-3.1, SDS §4.1]`).
- [x] `apps/api/src/repositories/note.repository.ts`: Extend `createNote(data: { userId; title; body; tagIds?: string[] }, db)` to pass `include: NOTE_RESPONSE_INCLUDE` and nest `noteTags: { create: tagIds.map((tagId) => ({ tagId })) }` when `tagIds` is non-empty (`[FRS-3.1, SDS §4.1]`).
- [x] `apps/api/src/repositories/note.repository.ts`: Extend `updateNoteContent(id, data: { title?; body?; tagIds?: string[] }, db)` to nest `noteTags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) }` (full replace) only when `tagIds !== undefined`, leaving existing tags untouched otherwise; confirm whether `Db` needs widening to `Pick<Prisma.TransactionClient, "note" | "noteTag">` or if `"note"` alone suffices for the nested write (`[FRS-3.1, SDS §4.1]`).
- [x] `apps/api/src/services/note.service.ts`: Add private `verifyTagOwnership(tagIds: string[] | undefined, userId: string, tx): Promise<void>` — no-op when `tagIds === undefined`; else calls `tagRepository.findTagsByIdsForUser` and throws `AppError(403, API_ERROR_CODES.TAG_NOT_FOUND, VALIDATION_MESSAGES.NOTE_TAG_ATTACH_FORBIDDEN)` when the returned count `!== tagIds.length`, executed inside the same `tx` as the note write (`[FRS-3.1, SDS §4.1]`).
- [x] `apps/api/src/services/note.service.ts`: Wire `verifyTagOwnership` into `createNote` (before `noteRepository.createNote`) and `updateNote` (before `noteRepository.updateNoteContent`); confirm `shouldSnapshot` remains unaffected by a `tagIds`-only payload so a tag-only update never creates a `NoteVersion` (`[FRS-6.1, FRS-3.1]`).
- [x] `apps/api/src/services/note.service.ts`: Update `toNoteResponseDto` (rename source type `NoteWithShareLinks` → `NoteWithRelations`) to map `tags: note.noteTags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color }))` (`[FRS-3.1]`).
- [x] **Mandatory Phase 2 Checkpoint (Backend)**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/web`)

- [x] `apps/web/package.json`: Add exact-pinned dependencies `@tiptap/react@3.27.3`, `@tiptap/starter-kit@3.27.3`, `@tiptap/pm@3.27.3`, `@tiptap/extensions@3.27.3` — re-verify current pinned versions via `npm view` immediately before implementing, per `CLAUDE.md §1b` (`[Rule 20, FRS-0.1]`).
- [x] `apps/web/src/constants/ui.constant.ts`: Add `AUTOSAVE_DEBOUNCE_MS = 1500`, `AUTOSAVE_RETRY_DELAYS_MS = [1000, 3000] as const`, `AUTOSAVE_SAVED_FADE_MS = 2000` (Tier-3 frontend-only constants, `docs/ux.md §1`) (`[FRS-7.1, FRS-7.2]`).
- [x] `apps/web/CLAUDE.md`: Correct the stale `1000ms` autosave mention to `1500ms` so it no longer disagrees with the canonical `docs/ux.md` value (`AGENTS.md` conflict-hierarchy fix, same PR).
- [x] `apps/web/src/api/notes.api.ts`: Add `createNote(input: CreateNoteInput): Promise<NoteResponseDto>` (`POST` to `API_PATHS.NOTES.ROOT`) and `updateNote(id: string, input: UpdateNoteInput): Promise<NoteResponseDto>` (`PATCH` to `API_PATHS.NOTES.ROOT/:id`), matching the file's existing wrapper shape (`[FRS-2.1.1, FRS-2.1.3]`).
- [x] `apps/web/src/api/tags.api.ts`: Add `createTag(input: CreateTagInput): Promise<TagResponseDto>` (`POST` to `API_PATHS.TAGS.ROOT`) (`[FRS-3.1]`).
- [x] `apps/web/src/hooks/useCreateNote.ts`: `useMutation({ mutationFn: createNote })`, invalidates `["notes", "list"]` on success, does not navigate itself (`[FRS-2.1.1]`).
- [x] `apps/web/src/hooks/useUpdateNote.ts`: `useMutation({ mutationFn: ({ id, input }) => updateNote(id, input) })`, invalidates `["notes", "detail", id]` and `["notes", "list"]` on success, no toast on autosave success (`[FRS-2.1.3, FRS-7.1]`).
- [x] `apps/web/src/hooks/useCreateTag.ts`: `useMutation({ mutationFn: createTag })`, invalidates `["tags", "list"]` on success (`[FRS-3.1]`).
- [x] `apps/web/src/store/useUiStore.ts`: Wrap in Zustand `persist` middleware (`name: "note-editor-drafts"`, `partialize` limited to `drafts` so `isMobileSidebarOpen` stays non-persisted); add `drafts: Record<string, { title: string; body: string; savedAt: number }>` slice with `setDraft(noteId, draft)` / `clearDraft(noteId)` (Decision D6) (`[FRS-7.1]`).
- [x] `apps/web/src/hooks/useNoteAutosave.ts`: Implement the debounce (`1500ms`)/explicit-save/retry (`1s` then `3s`, then persistent manual-retry) state machine per Decisions D1/D5/D7, exposing `{ status, triggerAutosave(patch), triggerExplicitSave(patch), retry() }`; translates a successful first `POST` into an `onCreated(newId)` callback, staying router-agnostic (`[FRS-7.1, FRS-7.2, FRS-6.1]`).
- [x] `apps/web/src/components/editor/AutosaveIndicator.tsx`: Pure presentational component `{ status: "idle" | "saving" | "saved" | "error"; onRetry: () => void }` rendering `UI_COPY.AUTOSAVE_*` pills (saved pill auto-hides after `2000ms`; error pill shows manual "Retry" button, `#fef08a` styling) (`[FRS-7.2]`).
- [x] `apps/web/src/components/editor/TagCombobox.tsx`: Typeahead over `useTags()`, case-insensitive match check, renders `"Create new tag: '<name>'"` when no match (Fly Tag), calls `onAttach(tagId: string)` on select (existing or newly created), stays "dumb" — no optimistic chip before success (`[FRS-3.1, FRS-3.4]`).
- [x] `apps/web/src/components/editor/NoteEditor.tsx`: Owns `useEditor({ extensions: [StarterKit, Placeholder.configure(...)], content, onUpdate })`, title `<input>`, inline formatting toolbar block (Bold/Italic/Underline/Link via `editor.chain().focus()...run()`), `Ctrl/Cmd+S` keydown handler (`aria-keyshortcuts="Control+S"`), title-blur explicit-save trigger (D5, no-op if title unchanged), body character-count check via `editor.getText().length` against `APP_LIMITS.NOTE_BODY_MAX_CHARS`, wires `useNoteAutosave` + `useCreateNote`/`useUpdateNote`, renders `<AutosaveIndicator />`, the read-only "Shared" `<Badge />` (D3, `hasActiveShareLink`), and `<TagCombobox />` with local `tagIds` state initialized from `note.tags.map(t => t.id)` (`[FRS-2.1.5, FRS-2.1.6, FRS-6.1, FRS-7.1, FRS-7.2, FRS-3.1]`).
- [x] `apps/web/src/pages/NoteEditorPage.tsx` (NEW, replaces `NoteDetailStubPage.tsx`): Reads `id` param (`"new"` or UUID), composes `SidebarNav` + mobile `Sheet` + "← Back to notes" link + reserved empty `320px` right column (`AB-1015` placeholder) + `<NoteEditor />`; fetches via `useNoteById(id)` when `id !== "new"`; renders `<Skeleton />` loading state (min `200ms` via `useMinLoadingTime`) and `<ErrorFallback />` on fetch failure/404 (`[FRS-7.5, FRS-8.1]`).
- [x] Delete `apps/web/src/pages/NoteDetailStubPage.tsx` and its test file (superseded, not left as dead code).
- [x] `apps/web/src/App.tsx`: Remove `NoteDetailStubPage` import/route; add `<Route path="/notes/:id" element={<ProtectedRoute><NoteEditorPage /></ProtectedRoute>} />` in its place (same path string, same guard) (`[FRS-7.5]`).
- [x] `apps/web/src/lib/errorMessages.ts`: Add `case API_ERROR_CODES.TAG_NOT_FOUND: return "One or more tags could not be attached.";` to the centralized error dictionary (`[FRS-3.1]`).
- [x] **Mandatory Phase 2 Checkpoint (Frontend)**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

_Derive tests solely from `FRS-2.1.2/2.1.3/2.1.5/2.1.6`, `FRS-3.1/3.4`, `FRS-6.1`, `FRS-7.1/7.2/7.5`, `FRS-8.1/8.4/8.5` requirement text and this ticket's `spec.md` scenarios — never from `FRS.md` Acceptance Criteria bullet wording._

- [x] `apps/api/tests/contract/note.tagIds.test.ts` (or equivalent existing suite file): Supertest coverage against isolated `notes_app_test` for `tagIds` ownership rejection (`403`, verify no partial title/body persisted via a follow-up `GET`), full-replace semantics on update (attach a set, then a different set → old `NoteTag` rows gone), tag-only update creates zero `NoteVersion` rows, `createNote` with `tagIds` returns `tags` in the same response (`[FRS-3.1, FRS-3.4, FRS-6.1]`).
- [x] `apps/api/tests/unit/note.service.test.ts`: Vitest coverage for `verifyTagOwnership` (owned vs. unowned vs. non-existent tag ids) and `findTagsByIdsForUser`, run against isolated `notes_app_test` (real `citext`/UUID columns) (`[FRS-3.1, FRS-3.4]`).
- [x] `apps/web/src/hooks/useNoteAutosave.test.ts`: Vitest + fake timers covering exact `1500ms` debounce firing, explicit-save bypass on unchanged-title blur (no request sent), `Ctrl+S` handler, retry sequence (`1s` then `3s`, then persistent manual-retry state that stops auto-retrying until next edit/click) (`[FRS-7.1, FRS-7.2, FRS-6.1]`).
- [x] `apps/web/src/components/editor/NoteEditor.test.tsx`: Testing Library coverage for new-note first-keystroke → `POST` → silent `replace` navigation with no remount/focus loss, and Stage-1/Stage-2 trashed-note `404` rendering `<ErrorFallback />` (`[FRS-2.1.2, FRS-8.1]`).
- [x] `apps/web/src/store/useUiStore.test.ts`: Vitest coverage for draft persistence, restore-on-mount (`savedAt` newer than fetched `updatedAt`), and clear-on-catch-up (`updatedAt >= savedAt`) (`[FRS-7.1]`).
- [x] `apps/web/src/components/editor/TagCombobox.test.tsx`: Testing Library coverage for create-vs-select paths and the `403` tag-attach toast without an optimistic chip (`[FRS-3.1, FRS-3.4]`).
- [x] `apps/web/src/pages/NoteEditorPage.test.tsx`: Testing Library coverage for responsive breakpoint rendering (`>=1024px` persistent panels vs. `<1024px` `<Sheet />` overlays) and `<ProtectedRoute>` guard preserved on `/notes/:id` and `/notes/new` (`[FRS-7.5]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` (100% green against isolated `notes_app_test`, ≥80% coverage on new code, zero connections to `notes_app`/`sqlite::memory:`).

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta (`openspec/changes/AB-1012-frontend-note-editor/specs/notes/spec.md`).
- [x] Run `/review AB-1012-frontend-note-editor` (`reviewer` agent checks `@shared/core` single-source-of-truth, controller purity, zero `localStorage` token writes, `deletedAt`/`404` soft-delete behavior, FRS/SDS traceability).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1012-frontend-note-editor` (where `openspec archive` takes place).
