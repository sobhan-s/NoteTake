# Review Log — AB-1011-notes-list-trash-view

Sole tracking log for gaps, architectural drift, and action items surfaced during
`/implement`, `test-writer`, and `reviewer` passes for this ticket.

## `/review` pass — 2026-07-12

Diff base: `HEAD` (df87bcd, all AB-1011 work is uncommitted on this branch). 36 files
audited via `code-review-graph` (`get_review_context_tool`, `get_impact_radius_tool`)
plus direct reads of every changed/new file and its test file, cross-checked against
`docs/FRS.md` §2.2/2.3/7/8, `docs/SDS.md` §4.5/5.1/5.2/7, `docs/ux.md` §1,3,5,6,7,9,10,
and `openspec/changes/AB-1011-notes-list-trash-view/specs/notes-list-trash-view/spec.md`.

### Check 1 — Shared Source of Truth (`Rule 11, FRS-8.5, SDS §1.1`)

- ✅ PASSED: `packages/shared/src/constants/ui-copy.constant.ts` — new `UI_COPY` keys
  (`EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN`, `PERMANENT_DELETE_CONFIRM`,
  `TRASH_RESTORE_SUCCESS`, `PERMANENT_DELETE_SUCCESS`) live in `packages/shared`,
  barrel-exported via `packages/shared/src/constants/index.ts:5`. Zero duplication in
  `apps/web`. `AGENTS.md §12` diff correctly documents all 5 keys (D3 honored).
- ✅ PASSED: No new Zod schemas/DTOs introduced — `apps/web/src/api/notes.api.ts`,
  `apps/web/src/hooks/useActiveNotes.ts` reuse `ListNotesQuery`/`ListTrashQuery`/
  `NoteResponseDto` from `@shared/core/types` as-is, matching the ticket's "no
  schema/type/route changes" boundary.
- ✅ PASSED: `MIN_LOADING_DISPLAY_MS` / `NOTE_PREVIEW_MAX_CHARS`
  (`apps/web/src/constants/ui.constant.ts`) correctly placed Tier 3 (frontend-only
  display concerns, not `APP_LIMITS`-mandated numerics).

### Check 2 — Backend Layer Isolation (`Rule 11, SDS §1.1, FRS-8.6`)

- ✅ PASSED (N/A by design): Zero files under `apps/api/` touched in this diff — confirmed
  frontend-only scope per spec's Executive Summary.

### Check 3 — Token Exfiltration & Memory (`Rule 11, FRS-1.3.5, SDS §3.1`)

- ✅ PASSED: `apps/web/src/components/layout/SidebarNav.tsx:16-17` reads `user`/`reset`
  from `useAuthStore` (Zustand in-memory) only. Repo-wide grep of every new/changed file
  for `localStorage|sessionStorage|indexedDB` → zero matches.

### Check 4 — XSS Security & Sentinels (`FRS-4.2.1, SDS §4.3`)

- ✅ PASSED (N/A for sentinels — search/highlighting is `AB-1013` scope): No
  `dangerouslySetInnerHTML` anywhere in the diff (grep confirmed). `apps/web/src/lib/textPreview.ts`
  extracts plain text via `DOMParser().parseFromString(body, "text/html")` +
  `.textContent` — inert parsing, never re-injects HTML; verified safe against a
  `<script>` payload in `apps/web/tests/unit/lib/textPreview.test.ts:34-42`.

### Check 5 — Soft-Delete Lifecycle (`FRS-2.2, SDS §2.1, §5.3`)

- ✅ PASSED: Frontend performs zero physical-delete logic; `usePermanentDeleteNote`
  (`apps/web/src/hooks/usePermanentDeleteNote.ts`) and `useRestoreNote`
  (`apps/web/src/hooks/useRestoreNote.ts`) call the existing `restore`/`permanent`
  endpoints only, with correct `{ confirm: true }` body and 404/Stage-2 handling
  (`FRS-2.2.5`) verified in `usePermanentDeleteNote.test.ts:70-99` and
  `useRestoreNote.test.ts:87-127`.

### Check 6 — Test Isolation & Derivation (`FRS-0.3.2/0.3.3, SDS §1.5`)

- ✅ PASSED: All new `*.test.ts(x)` files cite `FRS-x.y.z`/`SDS §` IDs or exact ADDED/MODIFIED
  scenario titles in `describe()` blocks, not AC bullet wording (e.g.
  `usePermanentDeleteNote.test.ts:32`, `textPreview.test.ts:4`). Coverage is strong for
  hooks/mutations/pages (query-key composition, tag serialization, 404 optimistic
  removal, confirm-modal dismiss paths x3, empty-state variants).
- 📋 FRS GAP: `apps/web/src/hooks/useMinLoadingTime.ts` (the `>=200ms` minimum-display
  timer mandated by `docs/ux.md §1` and cited directly in the spec's "Active notes list
  loads with default params" ADDED Scenario) has **zero test coverage** — no
  `useMinLoadingTime.test.ts` exists, and no test in the suite uses
  `vi.useFakeTimers()`/`advanceTimersByTime` to verify the skeleton is held for the
  minimum duration when a query resolves faster than 200ms. This is a concrete,
  spec-cited numeric behavior that should have dedicated coverage before merge.

### Check 7 — Frontend UX Compliance (`docs/ux.md, FRS §7, FRS-8.4`)

- ✅ PASSED: Skeleton screens match final card height (`NotesList.tsx:36-40`), held via
  `useMinLoadingTime` per-tab (`NotesPage.tsx:68-69`); centralized `mapApiError`
  extended with `NOTE_NOT_FOUND` (`errorMessages.ts:25-26`, tested); `UI_COPY` empty
  states with correct icon/heading/subtext/CTA split for first-run vs filtered-empty
  (`NotesList.tsx:44-73`, tested); success/error toast durations (3s/5s) match spec
  exactly; `ConfirmModal` Cancel has `autoFocus`, destructive-styled confirm button,
  zero network calls on dismiss (backdrop/Esc/Cancel — all 3 tested in
  `NotesList.test.tsx:90-164`); query keys embed all filter tokens
  (`['notes','list',params]` / `['notes','trash',params]`, `FRS-8.4` verified via
  network-spy assertions, never client-side re-sort); a11y — `role="tablist"`/`role="tab"`,
  `sr-only` labels on sort selects, `aria-label`/`aria-pressed` on icon/toggle buttons,
  `focus-visible:ring-2` on card links.
- ⚠️ DRIFTED (minor, non-blocking): `apps/web/CLAUDE.md` ("Atomic UI & Debouncing
  Performance" section) still names `CONFIRM_TRASH_RESTORE`, `CONFIRM_PERMANENT_DELETE`,
  `CONFIRM_LOGOUT` as the expected `UI_COPY` confirmation-dialog keys. This ticket's D3
  decision (spec.md) established `PERMANENT_DELETE_CONFIRM` (ux.md's concrete example,
  noun/context-first `SCREAMING_SNAKE`) as canonical and updated `AGENTS.md §12` to
  match, but did not reconcile `apps/web/CLAUDE.md` — that doc now references three
  constant names (`CONFIRM_TRASH_RESTORE`, `CONFIRM_PERMANENT_DELETE`, `CONFIRM_LOGOUT`)
  that do not exist anywhere in `ui-copy.constant.ts` or the codebase. Restore
  intentionally ships with no confirm modal per this ticket's Out-of-Scope decision (not
  a violation), but the stale doc should be corrected for future-ticket consistency.

## Corrective Actions Required Before `/pr`

1. Add `apps/web/tests/unit/hooks/useMinLoadingTime.test.ts` — use fake timers to assert
   (a) the hook holds `true` for at least `MIN_LOADING_DISPLAY_MS` after `isLoading`
   flips to `false` when the underlying query resolves faster than the minimum, and
   (b) it does not artificially extend a load that already exceeds the minimum.
2. Update `apps/web/CLAUDE.md`'s confirmation-dialog `UI_COPY` key references
   (`CONFIRM_TRASH_RESTORE` / `CONFIRM_PERMANENT_DELETE` / `CONFIRM_LOGOUT`) to match the
   canonical names actually defined in `packages/shared/src/constants/ui-copy.constant.ts`
   (`PERMANENT_DELETE_CONFIRM`, etc.), and note that Trash restore ships without a confirm
   modal per this ticket's Out-of-Scope decision.

## Verdict (superseded by re-run below)

Review failed: Gaps logged above. Run `/implement AB-1011-notes-list-trash-view` to
resolve the items listed in this log. Do NOT run `/pr` until both corrective actions are
resolved and this log is re-run to `100% ✅ PASSED`.

---

## `/review` re-run — 2026-07-12 (later same day)

Re-audited the two open corrective actions from the pass above, plus a clean run of
`pnpm turbo run lint` / `typecheck` / `test -- --coverage` per `CLAUDE.md §6` `DoD`.

### Corrective Action 1 — `useMinLoadingTime` test coverage (`📋 FRS GAP`, prior pass)

- ✅ PASSED: `apps/web/tests/unit/hooks/useMinLoadingTime.test.ts` now exists — uses
  `vi.useFakeTimers()`/`vi.advanceTimersByTime()` to verify (a) the hook holds `true`
  until `MIN_LOADING_DISPLAY_MS` elapses when the query resolves faster than the
  minimum (50ms → still `true`, 199ms → still `true`, 200ms → `false`), and (b) it
  drops to `false` immediately when the load already exceeded the minimum (300ms
  case). `docs/ux.md §1` behavior now has dedicated coverage.
- 🔒 **NEW BLOCKING — Quality Gate failure**: `pnpm turbo run lint` fails
  (`@apps/web#lint` exit 1):
  `apps/web/tests/unit/hooks/useMinLoadingTime.test.ts:4:10 — 'MIN_LOADING_DISPLAY_MS'
is defined but never used (@typescript-eslint/no-unused-vars)`. The test imports the
  Tier 3 constant but every assertion hardcodes the raw literals it's meant to replace
  (`50`, `149`, `199`, `200`, `300` — grep confirms 8 raw-ms occurrences, zero uses of
  the imported symbol). This both violates `CLAUDE.md §6` DoD (`lint --max-warnings 0`
  → `0` errors, currently `1`) and the spirit of `AGENTS.md §11` (never hardcode a
  value that already has a named constant available) — the whole point of the test is
  to pin behavior to `MIN_LOADING_DISPLAY_MS`, so a config change to that constant
  would silently desync the test from the constant it claims to verify. **Fix**: either
  use the import directly (e.g. `MIN_LOADING_DISPLAY_MS - 1`, `MIN_LOADING_DISPLAY_MS
  - 100`) in the `advanceTimersByTime`calls and assertions, or remove the unused
import if literals are intentionally kept — the former is correct per the test's own
stated intent.
Confirmed via direct commands (bypassing turbo cache ambiguity):`pnpm --filter @apps/web typecheck`→ exit 0 (clean).`pnpm --filter @apps/api typecheck`→ exit 0 (clean).`pnpm --filter @apps/web test -- --coverage` → 72/72 tests green, but this does not
    substitute for the lint gate, which is a separate hard requirement.

### Corrective Action 2 — stale `apps/web/CLAUDE.md` `UI_COPY` key names (`⚠️ DRIFTED`, prior pass)

- ❌ MISSING (still unresolved): `apps/web/CLAUDE.md:51` still reads: `mandatory
confirmation dialogs (`CONFIRM_TRASH_RESTORE`, `CONFIRM_PERMANENT_DELETE`,
`CONFIRM_LOGOUT`from`UI_COPY`)`. None of these three names exist in
  `packages/shared/src/constants/ui-copy.constant.ts` — the canonical keys this ticket
  shipped are `EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN`, `PERMANENT_DELETE_CONFIRM`,
  `TRASH_RESTORE_CONFIRM`, `TRASH_RESTORE_SUCCESS`, `PERMANENT_DELETE_SUCCESS`. This
  file was not touched in the corrective-action commit; the action from the prior pass
  remains outstanding verbatim.
  (Note, out of this ticket's scope: `packages/shared/CLAUDE.md`'s own constant-table
  also cites `CONFIRM_TRASH_RESTORE`/`CONFIRM_LOGOUT` and a stale `ui-copy.ts` path —
  but `git log` confirms both files date to `AB-1004` commit `de4f706`, pre-dating this
  branch. Not a regression introduced by `AB-1011`; flagged here only so a future
  ticket reconciles it, not blocking this review.)

## `/review` final pass — 2026-07-12 (quality-gate verification)

Re-audited all corrective actions and verified final quality gates per `CLAUDE.md §6` DoD.

### Corrective Action 1 — `useMinLoadingTime` test coverage & lint gate (`FRS GAP` + `Quality Gate`, prior pass)

- ✅ PASSED: `apps/web/tests/unit/hooks/useMinLoadingTime.test.ts:4` correctly imports
  and uses `MIN_LOADING_DISPLAY_MS` throughout test body (lines 27, 42, 63). No unused-import
  warning. `pnpm turbo run lint` → exit 0 (clean across all workspaces).
- ✅ PASSED: Test assertions verify that (a) the hook holds `true` when
  `MIN_LOADING_DISPLAY_MS` hasn't elapsed (line 44, 199ms case still true), and (b)
  transitions to `false` once threshold crossed (line 51, 200ms+ case false), and (c)
  transitions immediately to `false` if query duration already exceeded minimum (line 70,
  `MIN_LOADING_DISPLAY_MS + 100`ms case). `docs/ux.md §1` behavior fully covered.

### Corrective Action 2 — stale `apps/web/CLAUDE.md` `UI_COPY` key names (`DRIFTED`, prior pass)

- ✅ PASSED (stale refs eliminated): Repo-wide grep of `apps/web/CLAUDE.md`,
  `packages/shared/CLAUDE.md`, and `packages/shared/src/constants/ui-copy.constant.ts`
  confirms **zero occurrences** of `CONFIRM_TRASH_RESTORE`, `CONFIRM_PERMANENT_DELETE`,
  `CONFIRM_LOGOUT`. Current canonical names (`PERMANENT_DELETE_CONFIRM`,
  `TRASH_RESTORE_CONFIRM`, `TRASH_RESTORE_SUCCESS`, `PERMANENT_DELETE_SUCCESS`) are
  exactly what the ticket ships (verified `ui-copy.constant.ts` and test assertions).
  `apps/web/CLAUDE.md:51` correctly names the canonical keys.

### Quality Gate Verification (CLAUDE.md §6 Definition of Done)

Ran all four gates per root `CLAUDE.md §6`:

1. ✅ `pnpm turbo run build` → 3/3 successful, 0 errors
2. ✅ `pnpm turbo run lint` → all workspaces clean, 0 warnings (--max-warnings 0)
3. ✅ `pnpm turbo run typecheck` → all workspaces clean, 0 static errors
4. ✅ `pnpm turbo run test -- --coverage` → 72/72 tests green, new code ≥80% coverage
   (hooks 94.54%, components 95%+, pages 65.49% with auth pages at 0% per AB-1010 scope)

### Final Compliance Checklist

| Check Category                  | FRS Ref             | Status | Evidence                                                                     |
| :------------------------------ | :------------------ | :----: | :--------------------------------------------------------------------------- |
| **Shared Source of Truth**      | Rule 11, FRS-8.5    |   ✅   | UI_COPY in `packages/shared`, barrel-exported, zero duplication              |
| **Backend Layer Isolation**     | Rule 11, SDS §1.1   |   ✅   | Zero `apps/api/` changes (frontend-only ticket per spec)                     |
| **Token Exfiltration & Memory** | FRS-1.3.5, SDS §3.1 |   ✅   | Access tokens in Zustand memory, no `localStorage`/`sessionStorage` anywhere |
| **XSS Security & Sentinels**    | FRS-4.2.1, SDS §4.3 |   ✅   | Safe text preview via DOMParser, no `dangerouslySetInnerHTML`                |
| **Soft-Delete Lifecycle**       | FRS-2.2, SDS §2.1   |   ✅   | Mutations call existing restore/permanent endpoints, handle 404 Stage-2      |
| **Test Isolation & Derivation** | FRS-0.3.2/0.3.3     |   ✅   | Tests cite FRS IDs, run against notes_app_test (Playwright), not AC wording  |
| **Frontend UX Compliance**      | docs/ux.md, FRS §7  |   ✅   | Skeleton screens, empty states, confirm modals, success toasts, a11y         |

## Verdict (100% PASSED — Ready for `/pr`)

**All corrective actions resolved.** Both prior gaps (`useMinLoadingTime` test coverage,
`CLAUDE.md` stale keys) have been addressed, and all four quality gates (`build`, `lint`,
`typecheck`, `test`) pass cleanly. Change is 100% FRS/SDS compliant per the mandatory
checklist above. Approved for `/pr AB-1011-notes-list-trash-view`.
