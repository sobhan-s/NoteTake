# Sequenced Tasks for AB-1011-notes-list-trash-view

Scope: **FRONTEND** (`apps/web` only), plus one net-new `packages/shared` constants file. Zero
`apps/api` changes — all routes/schemas (`AB-1004`/`AB-1005`/`AB-1006`) already exist, confirmed in
`plan.md §0/§1` (`Rule 11, FRS-8.5`).

## Phase 1: Foundation — Shared Tier, Dependency, Design-System Primitives

- [x] Run `pnpm --filter @apps/web add @radix-ui/react-dialog@1.1.19` — re-verify exact version live
      via `npm view @radix-ui/react-dialog version` before installing, per `CLAUDE.md §1b`; zero
      `^`/`~`/`*` ranges (`[Rule 20, plan.md §6]`).
- [x] `packages/shared/src/constants/ui-copy.constant.ts` (new): `UI_COPY` — `EMPTY_NOTES_LIST`,
      `EMPTY_TRASH_BIN`, `PERMANENT_DELETE_CONFIRM`, `TRASH_RESTORE_SUCCESS` (`[Rule 11, FRS-8.5, D3]`).
- [x] `packages/shared/src/constants/index.ts`: add `export * from "./ui-copy.constant";` (barrel
      integrity, `packages/shared/CLAUDE.md`) (`[Rule 11, FRS-8.5]`).
- [x] `AGENTS.md §12`: append the 4 exact `UI_COPY` key names so `AGENTS.md`/`docs/ux.md` stop
      disagreeing (`[D3]`).
- [x] `apps/web/src/constants/ui.constant.ts` (MODIFY, append only, Tier 3):
      `MIN_LOADING_DISPLAY_MS = 200` (`[docs/ux.md §1, FRS-8.5]`).
- [x] `apps/web/src/lib/errorMessages.ts` (MODIFY): add
      `case API_ERROR_CODES.NOTE_NOT_FOUND: return "This note is no longer available.";` to
      `mapApiError` (`[FRS-2.2.5, Restoring a trashed note / Permanently deleting a note scenarios]`).
- [x] `apps/web/src/lib/textPreview.ts` (new): `getPlainTextPreview(body, maxChars)` — `DOMParser`-
      based HTML stripping (never regex-only) before truncation, so note bodies never need
      `dangerouslySetInnerHTML` (`[Active notes list loads with default params scenario]`).
- [x] `apps/web/src/components/ui/Skeleton.tsx` (new): pulse-animated placeholder block, sized via
      `className` (`[docs/ux.md §1, Active notes list loads with default params scenario]`).
- [x] `apps/web/src/components/ui/Badge.tsx` (new): small pill variant, used for "Shared" indicator
      (`[FRS-7.2, Per-note share-status indicator scenario]`).
- [x] `apps/web/src/components/ui/Sheet.tsx` (new): `@radix-ui/react-dialog`-based slide-over
      (`side="left"`), backdrop blur, `Esc`/backdrop dismiss (`[SDS §4.5, Responsive layout across
    breakpoints scenario]`).
- [x] `apps/web/src/components/ui/ConfirmModal.tsx` (new): `@radix-ui/react-dialog`-based centered
      modal — heading, body text, `Cancel` (`autoFocus`), destructive-styled primary action, generic/
      reusable (`[docs/ux.md §5, Permanently deleting a note requires confirmation scenario]`).
- [x] `apps/web/src/components/ui/EmptyState.tsx` (new): generic
      `{ icon: LucideIcon, heading, subtext, action? }` (`[docs/ux.md §3, Active list empty state /
    Trash empty state scenarios]`).
- [x] `apps/web/src/components/ui/ErrorFallback.tsx` (new): full-page error block + `Retry` button
      (`[docs/ux.md §2, Error Scenarios]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/web`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage
loop. Layer order: `store/ → api/ → hooks/ → components/ → pages/` per `apps/web/CLAUDE.md`. Zero
Zod schemas defined client-side — all imported from `@shared/core` `[Rule 11]`.)_

- [x] `apps/web/src/store/useUiStore.ts` (new): Zustand — `isMobileSidebarOpen`,
      `openMobileSidebar`, `closeMobileSidebar` — the sole new global state slice; everything else
      is TanStack Query or page-local `useState` (`[apps/web/CLAUDE.md state-boundary rule, SDS §4.5]`).
- [x] `apps/web/src/api/notes.api.ts` (new): `listNotes(params: ListNotesQuery)`,
      `listTrash(params: ListTrashQuery)`, `getNoteById(id)`, `restoreNote(id)`,
      `permanentDeleteNote(id, input: PermanentDeleteInput)` — plain async functions over
      `httpClient`, unwrapping `response.data.data`, zero hardcoded route strings
      (`[FRS-8.5, SDS §7 route matrix]`).
- [x] `apps/web/src/api/tags.api.ts` (new): `listTags(): Promise<TagListResponseDto>`
      (`[FRS-8.5, D4]`).
- [x] `apps/web/src/hooks/useActiveNotes.ts` (new): `useQuery` keyed
      `['notes','list',params]` over `listNotes` (`[SDS §5.1, FRS-8.4, Active notes list loads with
    default params scenario]`).
- [x] `apps/web/src/hooks/useTrash.ts` (new): `useQuery` keyed `['notes','trash',params]` over
      `listTrash`, params limited to `page`/`limit` only (`[FRS-2.3.6, Trash tab loads Stage-1
    trashed notes only scenario]`).
- [x] `apps/web/src/hooks/useNoteById.ts` (new): `useQuery` keyed `['notes','detail',id]`,
      `enabled: id !== 'new'` (`[D1]`).
- [x] `apps/web/src/hooks/useTags.ts` (new): `useQuery` keyed `['tags','list']` over `listTags`
      (`[D4]`).
- [x] `apps/web/src/hooks/useRestoreNote.ts` (new): `useMutation` — `200` invalidates
      `['notes','trash']` + `['notes','list']` + success toast
      (`UI_COPY.TRASH_RESTORE_SUCCESS`); `404` optimistic local-list removal via
      `queryClient.setQueryData` + error toast, no full refetch
      (`[FRS-2.2.5, Restoring a trashed note scenario]`).
- [x] `apps/web/src/hooks/usePermanentDeleteNote.ts` (new): `useMutation` — `200` invalidates
      `['notes','trash']` + success toast; `404` error toast + invalidate to reconcile
      (`[FRS-2.2.8, Permanently deleting a note requires confirmation scenario]`).
- [x] `apps/web/src/hooks/useMinLoadingTime.ts` (new): `(isLoading: boolean) => boolean` holding
      `true` for at least `MIN_LOADING_DISPLAY_MS` (`[docs/ux.md §1]`).
- [x] `apps/web/src/components/layout/SidebarNav.tsx` (new): persistent `260px` panel `>=1024px`
      (`lg:` breakpoint); Trash/Active nav affordance + relocated Logout button reusing `useLogout`
      exactly as in the deleted `NotesStubPage` (`[SDS §4.5, MODIFIED /notes route content scenario,
    FRS-1.4.1]`).
- [x] `apps/web/src/components/notes/NotesTabs.tsx` (new): Active/Trash toggle (D2), no distinct
      URL — `activeTab` lifted from parent `NotesPage`, `role="tablist"`/`role="tab"` +
      `aria-selected` wired by hand (`[D2]`).
- [x] `apps/web/src/components/notes/NoteCard.tsx` (new): `title`, `getPlainTextPreview(body)`,
      formatted `updatedAt`, `Share2` badge when `hasActiveShareLink`;
      `variant: "active" | "trash"` swaps action slot (`[FRS-7.2, Per-note share-status indicator
    scenario]`).
- [x] `apps/web/src/components/notes/NotesList.tsx` (new): pure render-by-state — skeleton list /
      empty state / filtered-empty state / grid of `NoteCard`, driven entirely by props, no data
      fetching itself (`[FRS-8.4, Active list empty state scenario]`).
- [x] `apps/web/src/components/notes/SortControl.tsx` (new): `sort`
      (`updatedAt`/`createdAt`/`title`) + `order` (`asc`/`desc`) selects, Active tab only
      (`[FRS-2.3.2, Changing sort triggers a fresh server request scenario]`).
- [x] `apps/web/src/components/notes/TagFilterControl.tsx` (new): multi-select chips from
      `useTags()` + `tagMode` (`ALL`/`ANY`) toggle, selection-only, Active tab only
      (`[FRS-2.3.3, D4, Changing the tag filter triggers a fresh server request scenario]`).
- [x] `apps/web/src/components/notes/PaginationControl.tsx` (new): Prev/Next + "Page X of Y",
      fixed page size, both tabs (`[FRS-2.3.1, Pagination controls trigger a fresh server request
    scenario]`).
- [x] `apps/web/src/pages/NotesPage.tsx` (new): owns `activeTab` + all
      `listNotesSchema`/`listTrashSchema` param state (page-local `useState`, reset `page` to `1`
      on any sort/filter change); composes `SidebarNav` + mobile `Sheet` + `NotesTabs` +
      (`SortControl`/`TagFilterControl` gated to Active tab) + `NotesList` + `PaginationControl`
      (`[FRS-8.4, FRS-2.3.6, D2]`).
- [x] `apps/web/src/pages/NoteDetailStubPage.tsx` (new): minimal `/notes/:id` stub — `id === "new"`
      renders blank placeholder (no fetch); otherwise fetches via `useNoteById(id)`, renders
      read-only `title`/`body` + "Back to notes" link (`[D1]`).
- [x] `apps/web/src/App.tsx` (MODIFY): remove `NotesStubPage` import/route; add
      `<Route path="/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />` and
      `<Route path="/notes/:id" element={<ProtectedRoute><NoteDetailStubPage /></ProtectedRoute>} />`
      (`[MODIFIED /notes route content scenario, Route guard reuse scenario]`).
- [x] Delete `apps/web/src/pages/NotesStubPage.tsx` and
      `apps/web/tests/unit/pages/NotesStubPage.test.tsx` — superseded, not left dead
      (`[MODIFIED /notes route content scenario]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

_(Vitest + Testing Library, mocking `httpClient` only — zero live DB, per `plan.md §5`.)_

- [x] `apps/web/tests/unit/lib/textPreview.test.ts`: strips tags via `DOMParser` (not regex),
      truncates at `maxChars`, never invokes `dangerouslySetInnerHTML` (`[Active notes list loads
    with default params scenario]`).
- [x] `apps/web/tests/unit/hooks/useActiveNotes.test.ts`: query-key embeds every param; a param
      change issues a genuinely new mocked network call (spy-asserted), never a client-side reorder
      of the previous response array (`[FRS-8.4, Changing sort triggers a fresh server request
    scenario]`).
- [x] `apps/web/tests/unit/hooks/useTrash.test.ts`: query only ever sends `page`/`limit` — never
      `sort`/`order`/`tagIds` (`[FRS-2.3.6, Trash tab loads Stage-1 trashed notes only scenario]`).
- [x] `apps/web/tests/unit/hooks/useRestoreNote.test.ts`: `200` invalidates both query keys + success
      toast; `404` triggers optimistic local removal without a full refetch delay
      (`[FRS-2.2.5, Restoring a trashed note scenario]`).
- [x] `apps/web/tests/unit/hooks/usePermanentDeleteNote.test.ts`: modal dismiss (backdrop/`Esc`/
      Cancel) issues zero requests; confirm issues exactly one `DELETE` with `{confirm:true}`
      (`[FRS-2.2.8, Permanently deleting a note requires confirmation scenario]`).
- [x] `apps/web/tests/unit/components/notes/TagFilterControl.test.tsx`: all-tags-deselected state
      omits `tagIds`/`tagMode` from the emitted params entirely, never sends empty-string params
      (`[FRS-2.3.3, Changing the tag filter triggers a fresh server request scenario]`).
- [x] `apps/web/tests/unit/components/notes/NotesList.test.tsx`: first-run empty state (icon/
      heading/`UI_COPY.EMPTY_NOTES_LIST`/CTA) vs. filtered-empty state (distinct copy, no CTA) are
      rendered under the correct conditions (`[Active list empty state scenario]`).
- [x] `apps/web/tests/unit/components/notes/NoteCard.test.tsx`: `Share2` badge renders iff
      `hasActiveShareLink === true`, with `aria-label`; absent (not dimmed) otherwise
      (`[FRS-7.2, Per-note share-status indicator scenario]`).
- [x] `apps/web/tests/unit/pages/NotesPage.test.tsx`: sort/filter/page changes each assert a new
      mocked `GET` call; page resets to `1` on sort/filter change; `SidebarNav` vs. `Sheet` render
      per breakpoint (`jsdom` viewport mock); Trash tab renders zero sort/tag controls
      (`[FRS-8.4, FRS-2.3.6, Responsive layout across breakpoints scenario]`).
- [x] `apps/web/tests/unit/pages/NoteDetailStubPage.test.tsx`: `id==="new"` renders placeholder with
      zero fetch calls; real `id` fetches and renders read-only content + back link (`[D1]`).
- [x] `apps/web/tests/unit/components/ProtectedRoute.test.tsx` (extend existing suite if present):
      unauthenticated `/notes` visit redirects to `/login?next=%2Fnotes` (`[Route guard reuse
    scenario]`).
- [x] `apps/web/tests/unit/lib/errorMessages.test.ts` (extend existing suite): `NOTE_NOT_FOUND` maps
      to "This note is no longer available." (`[Error Scenarios]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — all green, zero
      connections to `notes_app`/`notes_app_test`/`sqlite::memory:` from this suite (mocked
      `httpClient` only), ≥80% new-code coverage.

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against spec delta
      (`openspec/changes/AB-1011-notes-list-trash-view/specs/notes-list-trash-view/spec.md`).
- [x] Run `/review AB-1011-notes-list-trash-view` (`reviewer` agent checks: zero client-side re-sort/
      re-filter, zero hardcoded `UI_COPY`/routes/limits, `NoteResponseDto` no-`tags`-field boundary
      respected, TanStack Query/Zustand state boundary, `NOTE_NOT_FOUND` 404 handling, confirm-modal
      scope matches `docs/ux.md §5` exactly (restore excluded), responsive breakpoint contract — per
      `plan.md`).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to
      `/pr AB-1011-notes-list-trash-view`.

---

Awaiting explicit **APPROVED** confirmation before allowing `/implement`.
