# Review Log — AB-1015-frontend-version-history-drawer

## Reviewer Findings (`reviewer` sub-agent, appended by Main Claude — agent had no write tool)

1. ✅ PASSED — `packages/shared` (Rule 11) usage: `UI_COPY.VERSION_RESTORE_CONFIRM/VERSION_RESTORE_SUCCESS/VERSION_UNAVAILABLE/EMPTY_VERSION_HISTORY` added to `ui-copy.constant.ts`; `API_PATHS.NOTES.VERSIONS`/`RESTORE` reused unchanged; `NoteVersionSummaryDto`/`NoteVersionResponseDto`/`NoteResponseDto` imported from `@shared/core/types`, no hand-duplicated interfaces; `API_ERROR_CODES.VERSION_NOT_FOUND` reused. Zero new Zod schema/DTO.
2. ✅ PASSED — No `apps/api` file touched (confirmed via `git diff --stat apps/api/` — empty output).
3. ✅ PASSED — XSS/FRS-4.2.1: `VersionHistoryDrawer.tsx` renders the preview via `useEditor({ editable: false, extensions: [StarterKit] })` + `<EditorContent />`, mirroring `ShareViewPage`'s precedent. No `dangerouslySetInnerHTML` in production code.
4. ✅ PASSED — Token storage (FRS-1.3.5): zero JWT/refresh-token interaction introduced.
5. ✅ PASSED (N/A) — Soft-delete (FRS-2.2): no delete operation in this ticket's scope.
   6a. ✅ PASSED — FRS-8.4 zero client-side re-sort: `versionsQuery.data?.map(...)` renders the array exactly as received, no `.sort()`/`.reverse()`.
   6b. ✅ PASSED — Restore gated behind `<ConfirmModal />`, never a single click; "Cancel" is `autoFocus`-default (FRS-7.4).
   6c. ✅ PASSED — `Sheet.tsx` defaults `side="left"`/`widthClassName="w-[260px]"`; existing `SidebarNav` call sites (`NotesPage.tsx`, `NoteEditorPage.tsx`, `SearchPage.tsx`) pass neither prop, so behavior is unaffected.
   6d. ✅ PASSED — `NoteEditor.tsx`'s `onRestored` calls `clearDraft(draftKey)` before applying restored content — no stale-draft resurrection.
6. ✅ PASSED — `mapApiError` gained a `VERSION_NOT_FOUND` case returning `UI_COPY.VERSION_UNAVAILABLE`.
7. ✅ PASSED — All spec.md Scenarios have corresponding tests in `VersionHistoryDrawer.test.tsx`.
8. ⚠️ DRIFTED (informational, no code fix required) — spec.md's own prose mentions `extensions: [StarterKit, Underline, Link]` but the implementation uses `[StarterKit]` only, per `plan.md §6`'s explicit reasoning: `@tiptap/starter-kit@3.27.3` already bundles Underline/Link, matching the one existing `ShareViewPage.tsx` precedent. Functionally equivalent; textual spec.md wording vs. plan.md's deliberate implementation choice, not a defect.
9. ⚠️ DRIFTED (informational, no code fix required) — `docs/SDS.md` §4.5 describes a persistent 320px non-overlapping panel and a separate diff/comparison `VersionPreviewModal`, both of which pre-date this ticket and conflict with `docs/FRS.md` §6's explicit "Out of Scope: Diff/comparison view between two versions." This ticket's approved `spec.md` (the higher-authority, ticket-scoped document, itself derived from FRS) mandates the implemented inline split-view overlay `Sheet` design. The implementation correctly follows `spec.md`/FRS; `docs/SDS.md` §4.5 is stale and should be corrected in a future documentation ticket — out of scope for AB-1015's code.
10. ✅ PASSED — Test isolation: pure-frontend Vitest/Testing-Library suite with mocked `httpClient`, no real DB connection — `notes_app_test` isolation contract not applicable to this ticket.

No `🔒 SECURITY` findings. No `❌ MISSING`. No `📋 FRS GAP` beyond the 3 defensively-unreachable/no-blank-title-scenario branches noted by `test-writer` (not fabricated tests, per FRS-derivation rule).

**Triage (Main Claude)**: Both ⚠️ DRIFTED findings are pre-existing `docs/SDS.md` staleness unrelated to this ticket's diff — `docs/SDS.md` §4.5 already conflicted with `docs/FRS.md` §6's Out-of-Scope clause _before_ this ticket started, and this ticket's own approved `spec.md`/`plan.md` explicitly reasoned through and chose the FRS-aligned design. No code change required for AB-1015; recommend a follow-up docs-only ticket to reconcile `docs/SDS.md` §4.5 with `docs/FRS.md` §6.

## Test Results

- `pnpm --filter @apps/web test -- --coverage`: **43 test files passed, 225 tests passed, 0 failed**.
- New/edited files coverage: `note-version.api.ts` 100/100/100/100, `useNoteVersions.ts` 100/100/100/100, `useNoteVersion.ts` 100/100/100/100, `useRestoreNoteVersion.ts` 100/100/100/100, `Sheet.tsx` 100/100/100/100, `VersionHistoryDrawer.tsx` 97.22/91.17/100/100, `NoteEditor.tsx` 89.88/83.33/85.29/92.1 (uncovered lines are pre-existing toolbar code outside this ticket's scope). All ≥80% per DoD.
- `pnpm --filter @apps/api test` (run in isolation): **43 test files passed, 450 tests passed, 0 failed**. Zero `apps/api` files were touched by this ticket (confirmed via `git diff --stat`). A `pnpm turbo run test -- --coverage` run that executed `@apps/api` and `@apps/web` suites concurrently produced 146 spurious `@apps/api` failures (`Foreign key constraint violated on refresh_sessions_user_id_fkey`) from a test-DB concurrency race across parallel workspace test runs against the shared `notes_app_test` database — pre-existing test-infrastructure flakiness, reproducibly absent when `@apps/api`'s suite runs alone. Not caused by, or related to, this ticket's frontend-only diff.

## Verdict

✅ All mandatory NoteApp checks PASSED. Two informational DRIFTED findings both trace to pre-existing `docs/SDS.md` staleness outside this ticket's scope, not a defect in this ticket's implementation. Case A (all OK) — proceeding to mark all `tasks.md` items complete.
