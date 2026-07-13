# Sequenced Tasks for AB-1015-frontend-version-history-drawer

Scope: pure frontend (`apps/web`) + one Tier-1 shared constants file. Zero `apps/api` changes —
`AB-1009` already ships every route/DTO/error-code this ticket consumes (verified in `plan.md` §0).
No Prisma/DB migration phase applies to this ticket.

## Phase 1: Foundation & Shared Tier (`packages/shared` — UI Copy Only)

_(Rule 11: all copy/constants live in `packages/shared`, never inline-duplicated in `apps/web`)_

- [x] `packages/shared/src/constants/ui-copy.constant.ts`: Append `VERSION_RESTORE_CONFIRM`,
      `VERSION_RESTORE_SUCCESS`, `VERSION_UNAVAILABLE`, `EMPTY_VERSION_HISTORY` to the existing
      `UI_COPY` object (no new file, no barrel change — already re-exported from
      `src/constants/index.ts`) (`[Rule 11, FRS-8.5]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint --max-warnings 0` →
      `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/web`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop.
No `controllers/`/`services/`/`repositories/`/`routers/` items exist in this phase — `AB-1009`'s
backend layering is consumed read-only, unchanged, per `SDS §1.1`.)_

- [x] `apps/web/src/lib/errorMessages.ts`: Add one `case API_ERROR_CODES.VERSION_NOT_FOUND: return UI_COPY.VERSION_UNAVAILABLE;`
      branch to the existing `mapApiError` switch, before `default` — no signature change (`[FRS-8.5]`).
- [x] `apps/web/src/api/note-version.api.ts` (new file): Implement `listNoteVersions(noteId)`,
      `getNoteVersion(noteId, versionId)`, `restoreNoteVersion(noteId, versionId)` thin `httpClient`
      wrappers mirroring `share.api.ts`; `listNoteVersions` unwraps the `{ versions: [...] }` envelope
      at the client boundary (`[FRS-6.2, FRS-6.3, FRS-6.4]`).
- [x] `apps/web/src/hooks/useNoteVersions.ts` (new file): TanStack Query hook,
      `queryKey: ["notes","versions",noteId]`, `enabled` wired to drawer `open`, `staleTime: 0`,
      `retry: false` — guarantees a fresh fetch on every drawer open, no client-side caching relied
      upon for correctness (`[FRS-6.2, FRS-8.4]`).
- [x] `apps/web/src/hooks/useNoteVersion.ts` (new file): TanStack Query hook,
      `queryKey: ["notes","versions",noteId,versionId]`, `enabled: versionId !== null`,
      `staleTime: 0`, `retry: false` (`[FRS-6.3]`).
- [x] `apps/web/src/hooks/useRestoreNoteVersion.ts` (new file): TanStack Mutation hook,
      `mutationFn` calls `restoreNoteVersion`; `onSuccess` does `setQueryData(["notes","detail",noteId], data)` + `invalidateQueries` for `["notes","detail",noteId]`, `["notes","list"]`,
      `["notes","versions",noteId]`. No toast/`onRestored` side effect inside the hook — component owns
      per-mutate-call `onSuccess`/`onError` (`[FRS-6.4]`).
- [x] `apps/web/src/components/ui/Sheet.tsx` (edit): Add optional `side?: "left" | "right"` (default
      `"left"`) and `widthClassName?: string` (default `"w-[260px]"`) props; verify byte-identical
      rendered className for existing `SidebarNav` call sites that pass neither prop (`[FRS-8.5]`).
- [x] `apps/web/src/components/versions/VersionHistoryDrawer.tsx` (new file, new directory): Implement
      `{ noteId, open, onOpenChange, onRestored }` props; local `selectedVersionId`/
      `isRestoreConfirmOpen` state reset on `open` transition; list pane (skeleton/error/empty/rows via
      `useNoteVersions`) and preview pane (skeleton/error/`VERSION_UNAVAILABLE`/content via
      `useNoteVersion`, read-only `useEditor({ editable: false, extensions: [StarterKit] })` mirroring
      `ShareViewPage.tsx`) (`[FRS-6.2, FRS-6.3, FRS-7.4]`).
- [x] `apps/web/src/components/versions/VersionHistoryDrawer.tsx`: Wire "Restore this version" button →
      `<ConfirmModal heading="Restore Version" body={UI_COPY.VERSION_RESTORE_CONFIRM} confirmLabel="Restore" />`
      → `restoreMutation.mutate` with per-call `onSuccess` (clear confirm modal, call `onRestored`,
      close drawer, success toast) and `onError` (distinct `NOTE_NOT_FOUND` vs `VERSION_NOT_FOUND`
      handling, error toast via `mapApiError`) (`[FRS-7.4, FRS-6.4]`).
- [x] `apps/web/src/components/editor/NoteEditor.tsx` (edit): Add `isVersionHistoryOpen` state, import
      `History` icon + `VersionHistoryDrawer`, add toolbar button
      (`disabled={noteId === null}`/`aria-disabled`) directly after the "Share note" button
      (`[FRS-6.1]`).
- [x] `apps/web/src/components/editor/NoteEditor.tsx` (edit): Conditionally mount
      `VersionHistoryDrawer` when `noteId !== null`; implement `onRestored` callback —
      `clearDraft(draftKey)`, `setTitle`, `lastSavedTitleRef.current`, `editor?.commands.setContent`,
      `setTagIds` from the restored `NoteResponseDto` (`[FRS-6.4]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint --max-warnings 0` →
      `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

_(Derive test cases solely from the numbered `Requirement`/`Scenario` text in `spec.md` and the
underlying `FRS-6.2`–`FRS-6.4`/`FRS-7.4` requirement text in `docs/FRS.md` — never from the
"Acceptance Criteria Traceability" line at the bottom of `spec.md`. Pure frontend: Vitest + Testing
Library component tests with a mocked `httpClient`/MSW — no live DB, no `notes_app_test` connection
needed for this ticket's scope.)_

- [x] `apps/web/src/api/note-version.api.test.ts`: Unit tests for `listNoteVersions` envelope-unwrap,
      `getNoteVersion`, `restoreNoteVersion` request-path construction (`[FRS-6.2, FRS-6.3, FRS-6.4]`).
- [x] `apps/web/src/hooks/useNoteVersions.test.ts` / `useNoteVersion.test.ts` /
      `useRestoreNoteVersion.test.ts`: Test `enabled` gating, `staleTime: 0` refetch-on-open behavior,
      mutation cache invalidation/`setQueryData` side effects (`[FRS-6.2, FRS-6.3, FRS-6.4, FRS-8.4]`).
- [x] `apps/web/src/components/ui/Sheet.test.tsx`: Test default `side="left"`/`widthClassName="w-[260px]"`
      renders unchanged className; `side="right"` + custom `widthClassName` renders right-anchored
      panel (`[FRS-8.5]`).
- [x] `apps/web/src/components/versions/VersionHistoryDrawer.test.tsx`: Cover every `spec.md` Scenario —
      list success/empty/error/loading-min-timer; version-select success/purged-404/error/loading-min-
      timer/back-navigation-no-refetch; restore-confirm-open/cancel-no-request/confirm-success/
      `NOTE_NOT_FOUND` failure (no partial apply)/`VERSION_NOT_FOUND` failure (re-render
      `VERSION_UNAVAILABLE`) (`[FRS-6.2, FRS-6.3, FRS-6.4, FRS-7.4]`).
- [x] `apps/web/src/components/editor/NoteEditor.test.tsx`: Extend existing suite — toolbar button
      disabled when `noteId === null`, enabled + opens drawer otherwise; `onRestored` callback applies
      title/body/tags to editor state and clears the Zustand draft (`[FRS-6.1, FRS-6.4]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — all green, ≥80%
      coverage on new code.

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta in
      `openspec/changes/AB-1015-frontend-version-history-drawer/specs/`.
- [x] Run `/review AB-1015-frontend-version-history-drawer` (`reviewer` agent checks `@shared/core`
      usage, zero hardcoded literals, zero client-side re-sort/re-filter, `ConfirmModal`
      confirm-before-destructive gating, no `localStorage`/`sessionStorage` token usage introduced).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to
      `/pr AB-1015-frontend-version-history-drawer` (where `openspec archive` takes place).

---

Waiting for explicit `APPROVED` before allowing `/implement`.
