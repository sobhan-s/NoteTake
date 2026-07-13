# Sequenced Tasks for AB-1014-share-modal-links-frontend

Scope: pure `apps/web` frontend + one `packages/shared` constants addition. Zero `apps/api`
changes (`AB-1008` already shipped the full backend contract). No DB migration phase applies.

## Phase 1: Foundation & Shared Tier (`@shared/core`)

- [x] `packages/shared/src/constants/ui-copy.constant.ts`: Append 4 new `UI_COPY` entries —
      `CONFIRM_REVOKE_SHARE_LINK`, `SHARE_LINK_REVOKED_SUCCESS`, `SHARE_LINK_COPIED_SUCCESS`,
      `SHARE_LINK_UNAVAILABLE` (`[Rule 11, FRS-8.5]`).
- [x] `apps/web/src/lib/errorMessages.ts`: Add 2 `case` branches to `mapApiError` for
      `API_ERROR_CODES.SHARE_LINK_NOT_FOUND` and `API_ERROR_CODES.SHARE_LINK_UNAVAILABLE`, no
      signature change (`[FRS-8.5]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/web`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude -> Tester -> Reviewer -> Triage loop)_

- [x] `apps/web/src/api/share.api.ts` (new): Implement `getShareLink`, `createShareLink`,
      `revokeShareLink`, `getPublicShareNote` as thin `httpClient` wrappers, importing
      `CreateShareLinkInput`/`ShareLinkResponseDto`/`PublicNoteResponseDto` from `@shared/core/types`
      and path fragments from `API_PATHS.NOTES.SHARE`/`API_PATHS.PUBLIC.*` — zero hand-written
      interfaces, zero error swallowing (`[Rule 11, FRS-5.1, FRS-5.2, FRS-5.3, FRS-5.5]`).
- [x] `apps/web/src/hooks/useShareLink.ts` (new): `useQuery` keyed `["notes","share",noteId]`,
      `enabled` prop passthrough, `staleTime: 0`, `retry: false` — guarantees a fresh fetch on every
      modal open, no reliance on the passive `hasActiveShareLink` badge (`[FRS-8.4]`).
- [x] `apps/web/src/hooks/useGenerateShareLink.ts` (new): `useMutation` calling `createShareLink`;
      `onSuccess` sets `["notes","share",noteId]` query data directly and invalidates
      `["notes","detail",noteId]` + `["notes","list"]` so `hasActiveShareLink` badges update with no
      caching lag; no `onError` (component owns the toast) (`[FRS-5.1, FRS-5.2, FRS-7.2]`).
- [x] `apps/web/src/hooks/useRevokeShareLink.ts` (new): `useMutation` calling `revokeShareLink`;
      `onSuccess` invalidates `["notes","share",noteId]` + `["notes","detail",noteId]` +
      `["notes","list"]` and shows `UI_COPY.SHARE_LINK_REVOKED_SUCCESS` toast (`duration: 3000`);
      `onError` invalidates `["notes","share",noteId]` (re-fetch true state, no optimistic apply) and
      shows `mapApiError` toast (`duration: 5000`) (`[FRS-5.3, FRS-7.4]`).
- [x] `apps/web/src/hooks/usePublicShareNote.ts` (new): `useQuery` keyed `["public","share",token]`
      (separate root namespace from `["notes",...]`), `retry: false` (`[FRS-5.5, FRS-5.6]`).
- [x] `apps/web/src/components/sharing/ShareModal.tsx` (new): `{noteId, open, onOpenChange}` props;
      compose `@radix-ui/react-dialog` primitives directly (matching `ConfirmModal.tsx`'s precedent —
      no new generic `Dialog` wrapper); render branches in order — `useMinLoadingTime` skeleton →
      inline `ErrorFallback` for non-404 error → active-link view (URL/`expiresAt`/`viewCount`/Copy/
      Revoke) → generate form (`APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`/`MAX_EXPIRY_DAYS`/
      `DEFAULT_EXPIRY_DAYS` bound input, disabled submit + inline validation when out of range)
      (`[FRS-5.1, FRS-5.2, FRS-5.4, FRS-8.4, FRS-8.5]`).
- [x] `apps/web/src/components/sharing/ShareModal.tsx`: Copy Link handler —
      `navigator.clipboard.writeText` + success toast (`UI_COPY.SHARE_LINK_COPIED_SUCCESS`,
      `duration: 3000`) / failure toast (`mapApiError()` default branch, `duration: 5000`), no
      manual-copy fallback UI (`[FRS-5.4]`).
- [x] `apps/web/src/components/sharing/ShareModal.tsx`: Revoke handler — local
      `isRevokeConfirmOpen` state nesting `<ConfirmModal heading="Revoke Public Share Link"
  body={UI_COPY.CONFIRM_REVOKE_SHARE_LINK} />`, matching `NotesList.tsx`'s local-state
      `pendingDeleteNote`/`pendingRestoreNote` pattern — never `useUiStore` (`[FRS-5.3, FRS-7.4]`).
- [x] `apps/web/src/components/editor/NoteEditor.tsx` (edit): Add `isShareModalOpen` local state, a
      "Share" toolbar `Button` (`Share2` icon, `aria-label="Share note"`, `disabled`/`aria-disabled`
      when `noteId === null`), and a conditionally-mounted `<ShareModal>` guarded on
      `noteId !== null` — zero changes to autosave/draft-restore/tag-attachment logic
      (`[FRS-7.2]`).
- [x] `apps/web/src/pages/ShareViewPage.tsx` (new): `useParams<{token}>`, `usePublicShareNote(token!)`,
      `useMinLoadingTime`, read-only `useEditor({editable:false, extensions:[StarterKit], content:""})` + `useEffect` calling `editor.commands.setContent(query.data.body)`; render branches — skeleton
      → non-404 `ErrorFallback` (retry) → 404 single `UI_COPY.SHARE_LINK_UNAVAILABLE` state (no
      retry, cause never disclosed) → success (`title`, `formatUpdatedAt`, `<EditorContent>`); bare
      chrome-free centered layout, zero `SidebarNav`/`Sheet` reuse (`[FRS-5.5, FRS-5.6, FRS-7.5]`).
- [x] `apps/web/src/App.tsx` (edit): Add
      `<Route path="/share/:token" element={<ShareViewPage />} />` after `/reset-password` and before
      the first `<ProtectedRoute>`-wrapped route, outside `ProtectedRoute` (`[FRS-5.5]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

- [x] `apps/web/src/hooks/__tests__/useShareLink.test.tsx` (+ `useGenerateShareLink`,
      `useRevokeShareLink`, `usePublicShareNote`): Vitest unit tests derived solely from the spec's
      numbered Requirements/Scenarios text (`FRS-5.1`–`FRS-5.6`, `FRS-8.4`) — cover 404-as-empty-state
      vs. genuine-error branching, query-key invalidation targets, and `retry: false` behavior
      (`[FRS-0.3.2]`).
- [x] `apps/web/src/components/sharing/__tests__/ShareModal.test.tsx`: Vitest + Testing Library —
      cover all render branches (loading/error/active-link/generate-form), out-of-range expiry
      validation, Copy success/failure, Revoke confirm/cancel/failure (`[FRS-5.1..5.4, FRS-7.4]`).
- [x] `apps/web/src/pages/__tests__/ShareViewPage.test.tsx`: Vitest + Testing Library — cover
      valid-link render, identical-unavailable-state-per-cause assertion, loading skeleton, network/
      5xx retry path, no edit affordances/owner-identity leakage (`[FRS-5.5, FRS-5.6]`).
- [x] `apps/web/src/components/editor/__tests__/NoteEditor.test.tsx` (edit existing suite): Add cases
      for Share button enabled/disabled state and `ShareModal` open/close wiring (`[FRS-7.2]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` (100% green,
      ≥80% coverage on new code — no `notes_app_test` DB dependency for this pure-frontend suite).

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against `specs/sharing/spec.md`.
- [x] Run `/review AB-1014-share-modal-links-frontend` (`reviewer` agent checks `@shared/core` zero-
      duplication, no hardcoded literals, no `localStorage`/`sessionStorage` token storage touched,
      out-of-scope items untouched — no regenerate/rotate verb, `NoteCard` badge stays passive, no
      clipboard-fallback UI, no backend/schema change).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to
      `/pr AB-1014-share-modal-links-frontend` (where `openspec archive` takes place).

---

Waiting for explicit `APPROVED` before allowing `/implement`.
