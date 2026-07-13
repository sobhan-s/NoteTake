# Review Log — AB-1014-share-modal-links-frontend

## Gap 1 — ShareModal does not fall back to the generate form after a successful revoke (FRS-5.3)

**Found by**: `test-writer` sub-agent, Phase 3, `ShareModal.test.tsx` ("Scenario: Owner confirms revoke").

**Requirement violated**: `specs/sharing/spec.md` Requirement "Revoke Share Link Requires Explicit Confirmation",
Scenario "Owner confirms revoke": "...re-render `ShareModal`'s body back to the generate form (no active
link remains)."

**Root cause**: `useRevokeShareLink`'s `onSuccess` invalidates `["notes", "share", noteId]`, triggering a
background refetch of `GET /notes/:id/share`, which correctly 404s (`SHARE_LINK_NOT_FOUND`) since the link
is now gone. TanStack Query v5's query reducer intentionally preserves the last successful `data` when a
subsequent fetch errors (it only flips `status`/`error`/`isInvalidated`). `ShareModal.tsx`'s render ternary
checks `shareLinkQuery.data` truthiness _before_ checking `is404`, so it keeps rendering the stale
(now-revoked) active-link view indefinitely instead of falling through to the generate form.

**Planned correction**: Reorder `ShareModal.tsx`'s render branches so `is404` is checked before `data`:
`isMinLoading` → skeleton; `isError && !is404` → `ErrorFallback`; `is404` → generate form; `data` →
active-link view. This fixes both the post-revoke stale-data case and remains correct for the original
"no active link yet" 404 case (where `data` is `undefined` anyway).

**Status**: ✅ Fixed — see Gap 1 resolution below.

### Resolution

Reordered the branch conditions in `apps/web/src/components/sharing/ShareModal.tsx` so `is404` is
evaluated before `shareLinkQuery.data`. Re-ran the full `apps/web` Vitest suite after the fix:
**37/37 test files, 184/184 tests passing**, including the previously-failing "Owner confirms revoke"
scenario. Coverage on new code: `ShareModal.tsx` 93.75% stmts/funcs, `ShareViewPage.tsx` 100%,
`useShareLink`/`useGenerateShareLink`/`useRevokeShareLink`/`usePublicShareNote` ~96%+ aggregate — all
above the 80% bar. `pnpm turbo run build`/`lint -- --max-warnings 0`/`typecheck` all green.

(Note: `apps/api`'s test suite fails in this environment because no local PostgreSQL server is running
at `localhost:5432` — a pre-existing local-environment condition, not related to this ticket, which
touches zero `apps/api` files.)

## Phase 3 Checkpoint — ✅ PASSED

- `pnpm --filter @apps/web test -- --coverage`: 37/37 files, 184/184 tests green, ≥80% coverage on all
  new code.
- `pnpm turbo run build`, `lint -- --max-warnings 0`, `typecheck`: all green.

## Reviewer Audit — Phase 4

**Scope**: pure `apps/web` frontend + one `packages/shared` constants addition (AB-1014). Zero `apps/api` files touched — confirmed.

1. ✅ PASSED — `@shared/core` usage: `apps/web/src/api/share.api.ts:1-8` imports `CreateShareLinkInput`, `PublicNoteResponseDto`, `ShareLinkResponseDto`, `ApiSuccessResponse` from `@shared/core/types` (no hand-written interfaces). All path fragments via `API_PATHS.NOTES.ROOT/SHARE`, `API_PATHS.PUBLIC.ROOT/SHARE`; all numeric bounds via `APP_LIMITS.SHARE_LINK_MIN/MAX/DEFAULT_EXPIRY_DAYS` (`ShareModal.tsx:28-53,174-175`). Zero hardcoded `1`/`7`/`30`/`/share`/`/public` literals found.
2. ✅ PASSED — Layer skipping: no `apps/api` file appears among the changed files; `GET/POST/DELETE /api/v1/notes/:id/share` and `GET /api/v1/public/share/:token` were confirmed already present pre-ticket (`apps/api/src/routers/share.router.ts`, `public-share.controller.ts`), unmodified.
3. ✅ PASSED — XSS: `ShareViewPage.tsx` renders exclusively via `useEditor({ editable: false, extensions: [StarterKit] })` + `<EditorContent editor={editor} />` (ProseMirror-parsed). No `dangerouslySetInnerHTML` in any production file (only appears inside the test's own TipTap mock double in `ShareViewPage.test.tsx`, which is test scaffolding, not shipped code).
4. ✅ PASSED — Token storage: no `localStorage`/`sessionStorage` reference anywhere in `share.api.ts`, hooks, `ShareModal.tsx`, or `ShareViewPage.tsx`. Public fetch reuses the existing shared `httpClient` (auth-optional attach-only interceptor); `useAuthStore` is never touched by this ticket's code.
5. ✅ PASSED (N/A) — No note-deletion logic in this ticket; no hard-delete pattern introduced.
6. ✅ PASSED — Out-of-scope check: no "regenerate"/"rotate" verb anywhere in `ShareModal.tsx` (grep clean, case-insensitive). `NoteCard.tsx`'s "Shared" `<Badge>` (line 49-52) has no `onClick`/interactive handler — confirmed passive. No manual clipboard-fallback UI (`ShareModal.tsx` copy-fail path is toast-only, per spec). Only `packages/shared/src/constants/ui-copy.constant.ts` was touched in `packages/shared` — no schema/type/DTO file modified.
7. ✅ PASSED — Revoke gated by `<ConfirmModal />` (`ShareModal.tsx:205-213`), heading "Revoke Public Share Link", body `UI_COPY.CONFIRM_REVOKE_SHARE_LINK`; `ConfirmModal.tsx`'s Cancel button carries `autoFocus` (default-focused, matches spec/docs/ux.md §5).
8. ✅ PASSED — `ShareViewPage.tsx` renders a single `is404` branch showing only `UI_COPY.SHARE_LINK_UNAVAILABLE`, with no code path reading/displaying the underlying error code; test suite explicitly proves both `SHARE_LINK_NOT_FOUND` and `SHARE_LINK_UNAVAILABLE` 404s render identical output.
9. ✅ PASSED — `useShareLink.ts` wires `staleTime: 0` and `enabled` (bound to modal's `open` prop by `ShareModal`); `useShareLink.test.ts` proves a genuine network re-fetch (`getSpy` called twice) across an `enabled` `true→false→true` toggle, not a stale-cache serve.

**Gap 1 verification**: Confirmed fixed in current source. `ShareModal.tsx` render ternary (lines 111-200) is ordered: `isMinLoading` → skeleton; `shareLinkQuery.isError && !is404` → `ErrorFallback`; `!is404 && shareLinkQuery.data` → active-link view; else → generate form. `is404` correctly takes precedence over stale `data`, resolving the post-revoke stale-view bug. `ShareModal.test.tsx`'s "Owner confirms revoke" test exercises this exact path and asserts the generate form reappears.

**Additional spot-checks**: `App.tsx` route `/share/:token` registered outside `<ProtectedRoute>` (correct). `NoteEditor.tsx` toolbar Share button correctly `disabled`/`aria-disabled` when `noteId === null`, and `ShareModal` only mounts when `noteId !== null`. Test coverage across `ShareModal.test.tsx`, `ShareViewPage.test.tsx`, and the four hook test files covers every scenario row in `specs/sharing/spec.md` including boundary cases (0/31/-5/3.5 expiry, network-vs-404 distinction, cancel-vs-confirm, copy success/failure).

**Verdict**: ✅ ALL PASSED — no `FAIL`/`WARN`/`SEC` findings. No triage required.
