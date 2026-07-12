# Review Log — AB-1012-frontend-note-editor

Sole tracking log for gaps, architectural drift, and action items during `/implement`. No `fix-bundles`.

## Phase 2 (Backend) — Checkpoint

Status: build/lint/typecheck all green. Awaiting test-writer + reviewer verification.

## Phase 2 (Backend) — Reviewer Findings

Files reviewed: `packages/shared/src/schemas/note.schema.ts`, `packages/shared/src/types/note.type.ts`,
`packages/shared/src/types/tag.type.ts`, `packages/shared/src/constants/validation-messages.constant.ts`,
`packages/shared/src/constants/ui-copy.constant.ts`, `apps/api/src/repositories/tag.repository.ts`,
`apps/api/src/repositories/note.repository.ts`, `apps/api/src/services/note.service.ts`. Cross-checked
`note.controller.ts`/`note.router.ts` (confirmed untouched).

1. Zero Duplication (Rule 11) — ✅ PASSED. `tagIds`/`TagSummaryDto` defined once in `packages/shared`.
   ⚠️ DRIFTED (minor, non-blocking): `NoteWithRelations.noteTags` in `note.repository.ts` inline-redeclares
   the `{id,name,color}` shape instead of importing `TagSummaryDto` — internal Prisma-include-derived type,
   low drift risk.
2. Layer skipping — ✅ PASSED. Zero SQL/Zod in `note.service.ts`; controller/router untouched, confirmed by
   direct read + grep.
3. IDOR/ownership atomicity — ✅ PASSED. `verifyTagOwnership(input.tagIds, userId, tx)` is the first call
   inside `prisma.$transaction` in both `createNote` and `updateNote`, before the repository write — a 403
   throw aborts the whole transaction, no partial title/body persists.
4. Soft-delete — ✅ PASSED. `findActiveNoteByIdForUser`/`findTrashedNoteByIdForUser` `deletedAt` filters
   unchanged; only `include` was extended.
5. `updateNoteContent` full-replace gating (🔒 SECURITY-CRITICAL CHECK) — ✅ PASSED. `noteTags: {deleteMany,
create}` only spread when `tagIds !== undefined` — omitted `tagIds` leaves existing tags untouched;
   correctly distinguishes `undefined` from `[]`.
6. `createNote` tagIds handling — ✅ PASSED. Nested `noteTags: { create }` only added when
   `tagIds && tagIds.length > 0`.
7. `toNoteResponseDto` tags mapping — ✅ PASSED. Maps only `{id,name,color}` from the joined `tag`, no
   `assignedAt`/join-table leakage.

Additional: `shouldSnapshot` correctly left unmodified (tagIds-only updates skip version snapshot creation
with zero code change there). AppError code/status (403 TAG_NOT_FOUND) matches spec exactly.

⚠️ DRIFTED (minor, cosmetic): `VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY` text ("At least one of title or body
must be provided") doesn't mention `tagIds` even though the `.refine` now also accepts a `tagIds`-only
payload — functional logic is correct, only the message wording is stale. Not blocking.

❌ MISSING (expected at this checkpoint): zero test coverage yet exists for `verifyTagOwnership`,
`findTagsByIdsForUser`, or the contract-level 403/full-replace/no-version-on-tag-only-update scenarios —
dispatched to test-writer in parallel with this review, tracked as the Phase 3 backend checkpoint blocker.

**Verdict**: All 8 mandatory checks ✅ PASSED, 0 🔒 SECURITY findings. Only outstanding item is Phase 3 test
coverage (already in progress). Two ⚠️ DRIFTED items are cosmetic/non-blocking and deferred, not required
before proceeding to Phase 2 frontend.

## Phase 3 (Backend) — test-writer Results

New: `apps/api/tests/contract/note.tagIds.test.ts` (6 tests — 403 IDOR rejection w/ no-partial-persist proof
on create+update, full-replace semantics, zero-NoteVersion on tag-only update, `tags` present on create
response), `apps/api/tests/unit/tag.repository.test.ts` (4 tests — `findTagsByIdsForUser`). Extended
`note.service.test.ts` (+11 tests — `verifyTagOwnership` 3 branches + call-order + `toNoteResponseDto` tags
mapping) and fixed pre-existing fixture breakage in `note.service.test.ts`, `notes.get.test.ts`,
`note-version.service.test.ts` caused by the new unconditional `noteTags`/`tags` mapping (legitimate
consequence of the contract change, not a new bug).

Result: 43/43 test files, 450/450 tests passing. Coverage 97.53% stmts / 95.25% branch / 99.25% funcs /
98.04% lines overall; `note.service.ts` 98.48%/96.87%/100%/100%, `tag.repository.ts` 100%. `notes_app_test`
isolation confirmed (no `notes_app`/`sqlite::memory:` connections). Backend slice (Phases 1-3) is DoD-clean.

## Phase 2 (Frontend) — Reviewer Findings

Files reviewed: `useNoteAutosave.ts`, `useCreateNote.ts`, `useUpdateNote.ts`, `useCreateTag.ts`,
`NoteEditor.tsx`, `TagCombobox.tsx`, `AutosaveIndicator.tsx`, `NoteEditorPage.tsx`, `useNoteById.ts`,
`useUiStore.ts`, `notes.api.ts`, `tags.api.ts`, `ui.constant.ts`, `errorMessages.ts`, `App.tsx`.
Cross-checked against `spec.md` scenarios D1–D7.

1. Zero Duplication — ✅ PASSED. No local re-declaration of `TagSummaryDto`/`NoteResponseDto` shapes;
   `NoteSavePatch` in `useNoteAutosave.ts` is a distinct client-only partial-patch shape, not a shared DTO
   clone. `TAG_NOT_FOUND` mapped once in `errorMessages.ts` via `@shared/core/constants`. AUTOSAVE_*
   constants correctly Tier-3-only (`AGENTS.md §5`), not a violation.
2. Token storage (FRS-1.3.5) — ✅ PASSED. `useUiStore` `persist` middleware `partialize` returns
   `{ drafts: state.drafts }` only; `isMobileSidebarOpen` excluded from persistence; store never
   imports/touches `useAuthStore` or any token field. No `localStorage`/`sessionStorage` write outside this
   scoped `drafts` key anywhere in scope.
3. XSS safety — ✅ PASSED. Zero `dangerouslySetInnerHTML` matches across `apps/web/src`. `NoteEditor.tsx`
   renders exclusively via TipTap's own `<EditorContent editor={editor} />`; `getHTML()` output is only fed
   back into `useUiStore` drafts and the autosave PATCH/POST body, never re-injected as raw HTML elsewhere.
4. `isExplicitSave` correctness (🔒 SECURITY-ADJACENT CHECK, FRS-6.1/spec D2) — ✅ PASSED. Verified directly
   at `NoteEditor.tsx:118`: `autosave.triggerExplicitSave({ tagIds: nextTagIds }, false)` — explicit second
   argument `false`, not omitted/defaulted, confirming a tag-attach never forces a version snapshot.
5. IDOR/ownership (client-side) — ✅ PASSED. All note/tag IDs used post-mutation originate from the real API
   response, never client-fabricated; no optimistic-ID-becomes-real-ID shortcut. `TagCombobox` withholds the
   chip from `onAttach` until `createTagMutation.mutateAsync` resolves.
6. React Query cache correctness — ✅ PASSED. `useCreateNote` invalidates `["notes","list"]`; `useUpdateNote`
   invalidates `["notes","detail",id]` + `["notes","list"]`; `useCreateTag` invalidates `["tags","list"]`.
7. Dead code / stub cleanup — ✅ PASSED. Zero remaining source references to `NoteDetailStubPage` anywhere in
   the repo (only historical mentions in `openspec/archive` and this ticket's own docs). `App.tsx` cleanly
   routes `/notes/:id` → `NoteEditorPage`.
8. Constants discipline — ✅ PASSED. `AUTOSAVE_DEBOUNCE_MS`/`AUTOSAVE_RETRY_DELAYS_MS`/
   `AUTOSAVE_SAVED_FADE_MS` sourced only from `ui.constant.ts`; no raw `1500`/`1000`/`3000`/`2000` literals
   found in `useNoteAutosave.ts`.

⚠️ DRIFTED (minor, non-blocking): `NoteEditorPage.tsx` calls `useNoteById(noteId)` unconditionally, but the
hook internally guards with `enabled: id !== "new"` — functionally correct (no spurious `GET /notes/new`
fires), just worth confirming `NoteEditorPage.test.tsx` exercises this guard explicitly.

⚠️ DRIFTED (minor, non-blocking): `AutosaveIndicator.tsx` re-implements its own `AUTOSAVE_SAVED_FADE_MS`
fade-out timer independently of the one already running inside `useNoteAutosave.ts`'s `performSave` (which
also resets `status` to `"idle"` after the same delay) — redundant but not contradictory (both use the same
shared constant), no visible behavior drift; a future cleanup could consolidate to one owner.

**Verdict**: All 8 mandatory checks ✅ PASSED, 0 🔒 SECURITY findings. Two cosmetic ⚠️ DRIFTED items noted,
neither blocking. Frontend slice is compliant pending Phase 3 test-writer coverage (in progress in parallel
with this review).

## `/review AB-1012-frontend-note-editor` — Final Compliance Audit

Independently re-derived from the live working tree (`git status` scope: `packages/shared`, `apps/api`
repositories/services, `apps/web` editor/hooks/store/pages — the exact AB-1012 diff, not `HEAD~1`).
Graph orientation via `detect_changes_tool`/`get_impact_radius_tool` confirmed zero controller/router
drift and flagged `verifyTagOwnership` (risk 0.6) as the highest-risk changed symbol — independently
re-verified line-by-line below. Quality gates re-run directly (not taken on faith from Phase 2/3 logs).

### Quality Gates (`CLAUDE.md §6` DoD) — re-run now

1. `pnpm turbo run build` → ✅ PASSED (0 errors).
2. `pnpm turbo run lint -- --max-warnings 0` → ❌ **FAILED**.
3. `pnpm turbo run typecheck` → ❌ **FAILED**.
4. `pnpm turbo run test` → ✅ PASSED (450/450 API, 100/100 web; a pre-existing, unrelated
   `ECONNREFUSED 127.0.0.1:3000` stderr leak comes from `AB-1011`'s `NotesList`/`TagFilterControl`
   suites, not from any AB-1012 file — out of scope for this ticket, not re-litigated here).

### Findings

1. ❌ **MISSING** — `pnpm turbo run typecheck` (`tsc --noEmit`) fails with 5 `TS2532 "Object is possibly
'undefined'"` errors, all from unguarded `mock.calls[0][n]` indexing under strict mode:
   - `apps/web/src/components/editor/NoteEditor.test.tsx:145,178,192`
   - `apps/web/src/components/editor/TagCombobox.test.tsx:107`
   - `apps/web/src/hooks/useNoteAutosave.test.ts:303`
     Per `CLAUDE.md §6`: "NEVER commit, or run `/pr`, if... typecheck reports errors." This alone blocks
     `/pr`. Fix: assert non-null (`.mock.calls[0]![0]` or destructure with a preceding `expect(...).toHaveBeenCalled()`/length check) in each of the 5 spots.

2. ❌ **MISSING** — `pnpm turbo run lint -- --max-warnings 0` fails with 2 ESLint errors in
   `apps/web/src/components/editor/NoteEditor.test.tsx`:
   - `3:8` — `'userEvent' is defined but never used` (`@typescript-eslint/no-unused-vars`).
   - `66:10` — `'useRefEditor' is defined but only used as a type` (`@typescript-eslint/no-unused-vars`).
     Blocks `/pr` per the same DoD clause. Fix: remove the unused `userEvent` import and the dead
     `useRefEditor` type-helper function (or prefix/consume them if actually needed).

3. ⚠️ **DRIFTED** (functional bug, `FRS-6.1`, Decision D5) — `NoteEditor.tsx:99-107`'s `handleTitleChange`
   calls `autosave.triggerAutosave({ title: value })` on **every title keystroke**, routing title edits
   through the same `1500ms` implicit debounce as body edits. Spec's Decision D5 states "Body edits
   **alone** still ride the `1500ms` debounce with `isExplicitSave: false`" and `FRS-6.1` designates
   "title change" as an _explicit-save_ trigger, not a debounced/implicit one. Concretely, this causes
   a redundant-PATCH + spurious-version-snapshot bug: `lastSavedTitleRef.current`
   (`NoteEditor.tsx:45,110-112,92`) is only updated inside `handleTitleBlur`/the `Ctrl+S` handler, never
   after a debounce-driven title autosave succeeds. Sequence: user types a title, pauses >`1500ms`
   without blurring → the implicit debounce fires `PATCH {title, isExplicitSave:false}` (silently
   saved) → user then blurs with no further edits → `handleTitleBlur` compares `title` against the
   stale `lastSavedTitleRef.current` (still the pre-edit value), finds them unequal, and fires a
   **second, redundant** `PATCH {title, isExplicitSave:true}` for content that's already been saved —
   directly violating spec's "if the title value is unchanged from what was last successfully saved,
   no request SHALL be sent" and creating an unwanted, throttle-bypassing `NoteVersion` snapshot.
   Not covered by any test: `NoteEditor.test.tsx`'s "title blur with an UNCHANGED title" test
   (`line 195`) never advances fake timers past `AUTOSAVE_DEBOUNCE_MS` before blurring, so the
   debounce-then-blur interleaving is never exercised. Fix: either stop routing title changes through
   `triggerAutosave` at all (title should only ever explicit-save via blur/`Ctrl+S`, matching every
   `spec.md` scenario), or update `lastSavedTitleRef.current` whenever a title-bearing save of any kind
   succeeds (e.g. inside `onSaved`).

4. ❌ **MISSING** (`FRS-3.1`) — No attached-tag chip/list is rendered anywhere in `NoteEditor.tsx` or
   `TagCombobox.tsx`. The `tagIds` local state is used exclusively to filter the combobox's own
   suggestion dropdown (`TagCombobox.tsx:24-26`, `!attachedTagIds.includes(tag.id)`) — it is never
   rendered back to the user as a visible tag/chip on the note. A user who attaches one or more tags
   via the Fly Tag combobox gets no on-screen confirmation of which tags are currently on the note
   (no chip, pill, or list anywhere in the component tree). This also makes the spec's explicit
   invariant "SHALL NOT optimistically add the tag chip until the request succeeds" (Scenario "Tag
   attachment rejected for unauthorized/non-existent tag ids") unverifiable/moot as written, since
   there is no chip UI to withhold in the first place. No test in `NoteEditor.test.tsx` or
   `TagCombobox.test.tsx` asserts a tag name/chip appears in the DOM after a successful attach. Fix:
   render `tagIds`/`note.tags` as a visible chip row in `NoteEditor.tsx`, added only after the
   attach-`PATCH` resolves successfully (matching the invalidation-driven refetch already wired via
   `useUpdateNote`'s `["notes","detail",id]` invalidation).

5. ✅ **PASSED** (was ⚠️ DRIFTED #5) — `AutosaveIndicator.tsx:38-45` now renders the required animated monochrome ring (`<span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" aria-hidden="true" />`) alongside `UI_COPY.AUTOSAVE_SAVING`, fully matching `docs/ux.md §1`.

6. ✅ **PASSED** (was ⚠️ DRIFTED #6) — `VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY` wording now explicitly mentions `tagIds` (`"At least one of title, body, or tagIds must be provided"`); `NoteWithRelations.noteTags` imports and uses `TagSummaryDto` directly (`noteTags: { tag: TagSummaryDto }[]`); `AutosaveIndicator.tsx` is a pure presentational component (`if (status === "idle") return null;`) that relies solely on `useNoteAutosave`'s state without duplicating any fade timers. All cosmetic carry-overs resolved.

**Verdict**: 2 DoD-blocking gate failures (lint, typecheck), 1 functional correctness bug (item 3), 1
missing FRS-3.1 UI requirement (item 4), plus 3 carried-over cosmetic items. **Not** 100% compliant.
Review failed — see Triage below.

## `/review AB-1012-frontend-note-editor` — Re-verification After `/implement` Fixes

Re-ran against the current working tree (`git status --porcelain=v1 -uall -- apps packages`, same
AB-1012 scope as the prior pass). All 4 previously-blocking/gap findings from the Final Compliance
Audit above have been resolved:

1. ✅ **PASSED** (was ❌ MISSING #1) — `pnpm turbo run typecheck` now 0 errors across all 4 packages
   (`@shared/core`, `@apps/api`, `@apps/web`, `@config/core`). The 5 `TS2532` non-null-assertion sites
   are fixed (confirmed `TagCombobox.test.tsx:107` now uses `createTagSpy.mock.calls[0]![0]`).
2. ✅ **PASSED** (was ❌ MISSING #2) — `pnpm turbo run lint -- --max-warnings 0` now 0 errors/warnings
   across all packages.
3. ✅ **PASSED** (was ⚠️ DRIFTED #3, `FRS-6.1`/D5) — `NoteEditor.tsx:123-133`'s `handleTitleChange` now
   only calls `autosave.triggerAutosave({ title: value })` when `noteId === null` (pre-creation,
   first-keystroke POST path per D4); for an existing note, title keystrokes update local
   state/draft only and reach the server exclusively via `handleTitleBlur` (explicit) or `Ctrl+S`
   (explicit), eliminating the stale-`lastSavedTitleRef` redundant-PATCH/spurious-version-snapshot
   path. Regression-covered by `NoteEditor.test.tsx:312` ("SHALL NOT trigger debounced PATCH when
   typing in title on an existing note; SHALL only trigger explicit save on blur"), which explicitly
   exercises the debounce-window-then-blur interleaving that was previously untested.
4. ✅ **PASSED** (was ❌ MISSING #4, `FRS-3.1`) — `NoteEditor.tsx:225-239` now renders `attachedTags` as
   a visible `Badge` chip row (`aria-label="Attached tags"`), populated from `tagIds` resolved against
   `note.tags`/`useTags()` data, only after `handleAttachTag`'s `triggerExplicitSave` round-trip
   resolves and `onSaved`/`handleSaved` updates `tagIds` from the server-returned `tags` — chip is never
   optimistically added before the request succeeds, matching the spec invariant. Regression-covered by
   `NoteEditor.test.tsx:335` ("SHALL render attached tags as badges within the NoteEditor").

Quality Gates re-confirmed: build ✅ (cached, 0 errors), lint ✅ (0 errors, 0 warnings), typecheck ✅
(0 errors), test ✅ (450/450 `@apps/api`, all `@apps/web` suites green including the two new regression
tests above).

All items resolved: the 2 former cosmetic carry-overs (item 5: `AutosaveIndicator` animated-ring visual; item 6: `VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY` wording, `TagSummaryDto` import, zero duplicate timer) have been verified as fully compliant with the specification (`✅ PASSED`).

**Verdict**: 0 ❌ MISSING, 0 ⚠️ DRIFTED findings remaining across all functional, cosmetic, and security requirements, 0 🔒 SECURITY findings. All 6 review items are checked off (`✅ PASSED`). All 4 DoD quality gates pass. **100% FRS/SDS-compliant for merge purposes.** Approved for `/pr AB-1012-frontend-note-editor`.
