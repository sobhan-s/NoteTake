# Technical Implementation Plan — AB-1011 (Notes List Page + Trash View)

Maps `specs/notes-list-trash-view/spec.md` (approved) against `SDS.md` / `docs/ux.md` /
`AGENTS.md` / `apps/web/CLAUDE.md` / `packages/shared/CLAUDE.md` contracts. **Frontend-only** —
zero backend routes, schemas, or DB changes (`AB-1004`/`AB-1005`/`AB-1006` contracts already
merged and are consumed as-is).

## 0. Codebase State Confirmed Before Planning

- `apps/web/src/pages/NotesStubPage.tsx` (AB-1010 stub) + its test currently render at `/notes`,
  wrapped in the existing `<ProtectedRoute>`. To be deleted, not left dead.
- Real backend schema/type names (source of truth, `packages/shared`) differ slightly from
  `SDS §5.1`'s illustrative `filterNotesSchema` — this plan uses the **actual** exports:
  `listNotesSchema` / `ListNotesQuery` (`page, limit, sort, order, tagIds, tagMode`) and
  `listTrashSchema` / `ListTrashQuery` (`page, limit` only). `NoteResponseDto` has no `tags`
  field (confirmed) — matches spec.md's Out-of-Scope note on per-note tag chips.
  `permanentDeleteSchema` / `PermanentDeleteInput` = `{ confirm: true }` already exists.
- `API_PATHS.NOTES` = `{ ROOT: "/notes", TRASH: "/trash", RESTORE: "/restore", PERMANENT: "/permanent", ... }`,
  `API_PATHS.TAGS.ROOT = "/tags"` — both already exported, zero additions needed there.
- Backend route matrix confirmed live in `apps/api/src/routers/note.router.ts`: `GET /`,
  `GET /trash`, `POST /:id/restore`, `DELETE /:id/permanent` all behind `requireAuth`. No backend
  work in this ticket.
- `apps/web` currently has only 5 atomic UI primitives (`Button`, `Card`, `Input`, `Label`,
  `Spinner`) — no `Skeleton`, `Sheet`/`Dialog`, `Badge`, `Tabs` exist yet. These must be built new.
  Existing `Button` pattern (`cva` + `class-variance-authority` + `@/lib/cn`) is the style
  precedent to replicate exactly.
- `apps/web/src/lib/errorMessages.ts` (`mapApiError`) has no case for
  `API_ERROR_CODES.NOTE_NOT_FOUND` yet — needs one for restore/permanent-delete 404 handling.
- No dark "obsidian" theme tokens exist in `index.css` (`@import "tailwindcss"` only) — AB-1010
  pages use a light `zinc-*` palette, diverging from `docs/ux.md §9`'s dark-theme contrast spec.
  **Decision**: follow the established AB-1010 `zinc-*` light-theme precedent for visual
  consistency across the app rather than unilaterally introducing a dark theme in this ticket;
  out of scope for a frontend-only notes-list ticket.

## 1. Backend Layer Enforcement — N/A

No router/controller/service/repository changes. `NoteRepository.listActiveNotes` (`SDS §5.1`)
and the Trash 30-day window enforcement (`SDS §5.2`) already exist and are exercised as-is via
HTTP calls from new TanStack Query hooks.

## 2. Single Source of Truth Additions (`packages/shared`)

Only one net-new file, per spec.md's "Shared Package Additions" section:

**`packages/shared/src/constants/ui-copy.constant.ts`** (NEW)

```ts
export const UI_COPY = {
  EMPTY_NOTES_LIST:
    "Your mind is a blank canvas. Press C to drop your first thought.",
  EMPTY_TRASH_BIN: "Spotless! Not even a digital crumb in sight.",
  PERMANENT_DELETE_CONFIRM:
    "Gone forever. Like tears in rain. Are you 100% sure?",
  TRASH_RESTORE_SUCCESS: "Note restored.",
} as const;
```

- Barrel: add `export * from "./ui-copy.constant";` to `packages/shared/src/constants/index.ts`.
- No schema/type changes — `note.schema.ts`, `note.type.ts`, `tag.schema.ts`, `tag.type.ts`,
  `api-paths.constant.ts`, `app-limits.constant.ts` consumed exactly as they exist today (D3, D4).
- Follow-up (same PR, per D3): update `AGENTS.md §12` to list these 4 exact `UI_COPY` key names so
  `AGENTS.md` and `docs/ux.md` stop disagreeing.

## 3. Token & Storage Security — Unchanged (Confirmed)

No auth/token code touched. `useAuthStore` (JS-memory access token) and the `httpClient` silent-
refresh interceptor are reused as-is by every new API call in this ticket (`FRS-1.3.5`).

## 4. Two-Stage Soft Delete — Reused, Not Modified (Confirmed)

Frontend only _calls_ the existing `POST /:id/restore` and `DELETE /:id/permanent` endpoints and
_renders_ their `404` (Stage-2/purged) responses via toast + optimistic local removal (`FRS-2.2.5`,
spec.md's Restore/Permanent-Delete scenarios). No new soft-delete logic is written client-side.

## 5. Database & Test Isolation Contract — N/A New DB Tests

This ticket adds zero `supertest`/`playwright` DB-touching tests (no backend changes). New test
coverage is Vitest + Testing Library component/hook tests mocking `httpClient` (`axios-mock-adapter`
or `vi.mock`) — never a live database. Existing AB-1004/1005/1006 contract tests already cover the
`GET /notes`, `GET /notes/trash`, restore, and permanent-delete endpoints against `notes_app_test`
and are unaffected by this change.

## 6. New Dependency — `@radix-ui/react-dialog`

`<ConfirmModal />` (permanent-delete confirmation) and `<Sheet />` (mobile sidebar slide-over) both
need focus-trapping, `Esc`-to-dismiss, and backdrop-click-to-dismiss (`docs/ux.md §5`, `FRS-7.5`).
Hand-rolling this is error-prone (a11y regressions); the existing `apps/web` already depends on
`@radix-ui/react-label` and `@radix-ui/react-slot` at exact pinned versions, so extending the same
family is consistent with precedent (`Rule 20`, zero ranges).

- **Add to `apps/web/package.json` dependencies**: `"@radix-ui/react-dialog": "1.1.19"` (latest
  exact version confirmed via `npm view @radix-ui/react-dialog version` at plan time — re-verify at
  `/implement` time in case it has moved, per `CLAUDE.md §1b`).
- **Decision — no `@radix-ui/react-tabs`**: the Active/Trash toggle (D2) is a simple two-state
  switch, not a generic tablist; implemented as two plain buttons with `role="tablist"`/`role="tab"`
  - `aria-selected` wired by hand, avoiding an extra dependency for a 2-state control.

## 7. Frontend File Plan (`apps/web`)

### 7.1 Atomic UI Primitives (`src/components/ui/`, shadcn/ui style, matches existing `Button.tsx`)

| File                      | Purpose                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Skeleton.tsx` (NEW)      | Pulse-animated placeholder block, sized via `className`; used for list-loading state (`docs/ux.md §1`).                                                                                |
| `Badge.tsx` (NEW)         | Small pill, used for the "Shared" share-status indicator (`FRS-7.2`).                                                                                                                  |
| `Sheet.tsx` (NEW)         | `@radix-ui/react-dialog`-based slide-over panel (`side="left"`), backdrop blur, `Esc`/backdrop dismiss — mobile sidebar (`SDS §4.5`).                                                  |
| `ConfirmModal.tsx` (NEW)  | `@radix-ui/react-dialog`-based centered modal: heading, body text, `Cancel` (`autoFocus`), destructive-styled primary action — generic, reused for permanent-delete (`docs/ux.md §5`). |
| `EmptyState.tsx` (NEW)    | Generic `{ icon: LucideIcon, heading, subtext, action? }` — reused for empty-notes and empty-trash (`docs/ux.md §3`).                                                                  |
| `ErrorFallback.tsx` (NEW) | Full-page error block with heading + `Retry` button (`docs/ux.md §2`).                                                                                                                 |

### 7.2 Feature Components

| File                                               | Purpose                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/layout/SidebarNav.tsx` (NEW)       | `260px` fixed panel `>=1024px` (`lg:` breakpoint); Trash/Active nav affordance + relocated Logout button (reuses `useLogout` exactly as in the deleted `NotesStubPage`).                                                                                                                          |
| `src/components/notes/NotesTabs.tsx` (NEW)         | Active/Trash toggle (D2), no distinct URL — lifts `activeTab` state from parent `NotesPage`.                                                                                                                                                                                                      |
| `src/components/notes/NoteCard.tsx` (NEW)          | `title`, plain-text-truncated `body` preview (via `getPlainTextPreview`, see §7.4), formatted `updatedAt`, `Share2` badge when `hasActiveShareLink`; `variant: "active" \| "trash"` swaps the action slot (none vs. Restore + Delete Forever buttons).                                            |
| `src/components/notes/NotesList.tsx` (NEW)         | Pure render-by-state component: skeleton list / empty state / filtered-empty state / grid of `NoteCard` — driven entirely by props from whichever query hook (`useActiveNotes` or `useTrash`) the parent passes in. No data fetching itself (`FRS-8.4` — keeps fetch logic exclusively in hooks). |
| `src/components/notes/SortControl.tsx` (NEW)       | `sort` (`updatedAt`/`createdAt`/`title`) + `order` (`asc`/`desc`) selects; Active tab only.                                                                                                                                                                                                       |
| `src/components/notes/TagFilterControl.tsx` (NEW)  | Multi-select chips from `useTags()` + `tagMode` (`ALL`/`ANY`) toggle; Active tab only; selection-only (D4, no Fly Tag creation).                                                                                                                                                                  |
| `src/components/notes/PaginationControl.tsx` (NEW) | Prev/Next + "Page X of Y", fixed page size, both tabs.                                                                                                                                                                                                                                            |

### 7.3 Pages

| File                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/pages/NotesPage.tsx` (NEW)          | Replaces `NotesStubPage`. Owns `activeTab` (`"active" \| "trash"`, local `useState`, no Zustand — page-local, not shared) and all `listNotesSchema`/`listTrashSchema` param state (`page`, `sort`, `order`, `tagIds`, `tagMode` — local `useState`, reset `page` to `1` on any sort/filter change). Composes `SidebarNav` + mobile `Sheet` + `NotesTabs` + (`SortControl`/`TagFilterControl` gated to Active tab) + `NotesList` + `PaginationControl`. |
| `src/pages/NoteDetailStubPage.tsx` (NEW) | Minimal `/notes/:id` stub (mirrors `AB-1010` D1): reads `id` param; if `id === "new"` renders a blank placeholder (no fetch — "Create Note" entry point); otherwise fetches via new `useNoteById(id)` and renders read-only `title`/`body` + "Back to notes" link. `AB-1012` replaces this file's contents only.                                                                                                                                       |

**Deleted**: `src/pages/NotesStubPage.tsx` and `tests/unit/pages/NotesStubPage.test.tsx` (superseded
by `NotesPage` + its own test suite, per the MODIFIED scenario).

### 7.4 API Client, Hooks, Utilities

| File                                        | Purpose                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/notes.api.ts` (NEW)                | `listNotes(params: ListNotesQuery)`, `listTrash(params: ListTrashQuery)`, `getNoteById(id: string)`, `restoreNote(id: string)`, `permanentDeleteNote(id: string, input: PermanentDeleteInput)` — same shape as existing `auth.api.ts` (plain async functions over `httpClient`, unwrapping `response.data.data`). |
| `src/api/tags.api.ts` (NEW)                 | `listTags(): Promise<TagListResponseDto>`.                                                                                                                                                                                                                                                                        |
| `src/hooks/useActiveNotes.ts` (NEW)         | `useQuery({ queryKey: ["notes", "list", params], queryFn: () => listNotes(params) })` (`SDS §5.1`, `FRS-8.4`).                                                                                                                                                                                                    |
| `src/hooks/useTrash.ts` (NEW)               | `useQuery({ queryKey: ["notes", "trash", params], queryFn: () => listTrash(params) })` (`FRS-2.3.6`).                                                                                                                                                                                                             |
| `src/hooks/useNoteById.ts` (NEW)            | `useQuery({ queryKey: ["notes", "detail", id], queryFn: () => getNoteById(id), enabled: id !== "new" })`.                                                                                                                                                                                                         |
| `src/hooks/useTags.ts` (NEW)                | `useQuery({ queryKey: ["tags", "list"], queryFn: listTags })`.                                                                                                                                                                                                                                                    |
| `src/hooks/useRestoreNote.ts` (NEW)         | `useMutation` → on `200` invalidate `["notes","trash"]` + `["notes","list"]`, `toast.success(UI_COPY.TRASH_RESTORE_SUCCESS)`; on `404` optimistic local-list removal (via `queryClient.setQueryData`) + `toast.error(mapApiError(...))`, no full refetch.                                                         |
| `src/hooks/usePermanentDeleteNote.ts` (NEW) | `useMutation` → on `200` invalidate `["notes","trash"]` + success toast; on `404` error toast + invalidate to reconcile.                                                                                                                                                                                          |
| `src/hooks/useMinLoadingTime.ts` (NEW)      | `(isLoading: boolean) => boolean` — holds `true` for at least `APP_LIMITS`-adjacent `UI_LIMITS.MIN_LOADING_DISPLAY_MS` even if `isLoading` flips faster (`docs/ux.md §1`).                                                                                                                                        |
| `src/lib/textPreview.ts` (NEW)              | `getPlainTextPreview(body: string, maxChars: number): string` — strips HTML tags (`DOMParser`-based, never regex-only) before truncating, so `NoteCard` never needs `dangerouslySetInnerHTML` on note bodies.                                                                                                     |
| `src/store/useUiStore.ts` (NEW)             | Zustand: `isMobileSidebarOpen: boolean`, `openMobileSidebar`, `closeMobileSidebar` — the one piece of state matching `apps/web/CLAUDE.md`'s documented `useUiStore` responsibility ("sidebar toggles"); everything else in this ticket is TanStack Query or page-local `useState`.                                |

### 7.5 Constants (Tier 3, `apps/web/src/constants/ui.constant.ts` — MODIFY, append only)

```ts
export const MIN_LOADING_DISPLAY_MS = 200; // docs/ux.md §1
```

(Toast durations are not overridden — `sonner`'s configured defaults, 3s success / 5s error per
`docs/ux.md §10`, are used as-is; no new constant needed for those.)

### 7.6 Wiring Changes

- **`apps/web/src/App.tsx`** (MODIFY): remove `NotesStubPage` import/route; add
  `<Route path="/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />` and
  `<Route path="/notes/:id" element={<ProtectedRoute><NoteDetailStubPage /></ProtectedRoute>} />`.
- **`apps/web/src/lib/errorMessages.ts`** (MODIFY): add
  `case API_ERROR_CODES.NOTE_NOT_FOUND: return "This note is no longer available.";` to
  `mapApiError` for restore/permanent-delete/detail-fetch 404s.
- **`apps/web/package.json`** (MODIFY): add `@radix-ui/react-dialog` (see §6).

## 8. Responsive Behavior (`SDS §4.5`, `FRS-7.5`)

- `>= 1024px` (Tailwind `lg:`): `SidebarNav` renders persistently (`lg:flex lg:w-[260px]`); no
  `Sheet` trigger rendered.
- `< 1024px`: `SidebarNav` content renders inside `<Sheet />`, triggered by a menu button in the
  page header; notes list occupies full viewport width (`w-full`).

## 9. Testing Strategy (dispatched to `test-writer.md`)

- Source strictly from `FRS-2.2.*`, `FRS-2.3.*`, `FRS-7.2`, `FRS-7.5`, `FRS-8.1`, `FRS-8.4` text and
  this ticket's `spec.md` scenarios — never from `FRS.md`'s AB-1011 Acceptance Criteria bullets
  (`FRS-0.3.2`).
- Vitest + Testing Library, mocking `httpClient` (no live DB) for: query-key param embedding on
  sort/filter/page change (spy asserting a _new_ network call, not a client-side array mutation —
  `FRS-8.4`), empty vs. filtered-empty state divergence, Trash 404-on-restore optimistic removal,
  permanent-delete modal issuing zero requests on dismiss vs. exactly one `DELETE` on confirm,
  share-badge presence/absence, responsive breakpoint rendering (`SidebarNav` vs. `Sheet`), and
  route-guard redirect preservation (`?next=%2Fnotes`).
- No new `supertest`/`playwright` DB tests required (§5).

## 10. Quality Gates (must pass before `/tasks` → `/implement` checkpoint closes)

1. `pnpm turbo run build` — 0 errors (`tsup` for `packages/shared`, Vite build for `apps/web`).
2. `pnpm turbo run lint -- --max-warnings 0`.
3. `pnpm turbo run typecheck` (`tsc --noEmit`).
4. `pnpm turbo run test -- --coverage` — all green, `>=80%` coverage on new code.

---

**Awaiting explicit user `APPROVED` on this plan before generating `tasks.md`.**
