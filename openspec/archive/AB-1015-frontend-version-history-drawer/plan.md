# Technical Implementation Plan — AB-1015: Frontend — Version History Drawer + Restore

Change directory: `openspec/changes/AB-1015-frontend-version-history-drawer/`
Spec source: `spec.md` (read in full). Target requirements: `FRS-6.2`–`FRS-6.4`, `FRS-7.4`, `FRS-8.4`,
`FRS-8.5`, `docs/ux.md §1, §3, §5, §7, §9`.

## 0. Scope Confirmation

Pure frontend (`apps/web`) + one Tier-1 constants addition (`packages/shared`). Zero backend
(`apps/api`) changes — `AB-1009` already ships every route/DTO/error-code this ticket consumes.
No new Zod schema, no new DTO, no new `APP_LIMITS` entry. Verified against existing code:

- `apps/api/src/routers/note-version.router.ts` → `GET /`, `GET /:versionId`,
  `POST /:versionId/restore`, mounted at `` `/:id${API_PATHS.NOTES.VERSIONS}` `` (i.e.
  `/api/v1/notes/:id/versions...`) already exists, unchanged.
- `apps/api/src/controllers/note-version.controller.ts` /
  `apps/api/src/services/note-version.service.ts` → confirmed exact response shapes:
  `list` → `{ success: true, data: { versions: NoteVersionSummaryDto[] } }`,
  `getById` → `{ success: true, data: NoteVersionResponseDto }`,
  `restore` → `{ success: true, data: NoteResponseDto }` (full note, not just the version) — already
  exists, unchanged.
- `packages/shared/src/types/note.type.ts` → `NoteVersionSummaryDto` (`id, titleSnapshot, createdAt`),
  `NoteVersionResponseDto` (`id, noteId, titleSnapshot, bodySnapshot, createdAt`) already exist,
  unchanged.
- `packages/shared/src/constants/api-paths.constant.ts` → `API_PATHS.NOTES.VERSIONS = "/versions"`,
  `API_PATHS.NOTES.RESTORE = "/restore"` (already reused verbatim for the version-restore suffix —
  same literal segment, no new path constant needed) already exist, unchanged.
- `packages/shared/src/constants/api-error-codes.constant.ts` → `VERSION_NOT_FOUND` already exists,
  unchanged.
- `packages/shared/src/constants/ui-copy.constant.ts` → gains 4 new entries (below). This is the
  **only** `packages/shared` file this ticket touches.

## 1. `packages/shared` — UI Copy Additions Only

**File**: `packages/shared/src/constants/ui-copy.constant.ts` (append to existing `UI_COPY` object,
same grouping convention `AB-1014` used for its share-link entries — no new file, no barrel change
needed since this file is already re-exported from `src/constants/index.ts`).

```typescript
VERSION_RESTORE_CONFIRM:
  "This will overwrite the current content with this version. Your existing content becomes a new history entry, nothing is lost — are you sure?",
VERSION_RESTORE_SUCCESS: "Version restored.",
VERSION_UNAVAILABLE: "This version is no longer available.",
EMPTY_VERSION_HISTORY: "No earlier versions yet — keep editing to build history.",
```

Exact copy strings above are placeholders matching existing tone (`PERMANENT_DELETE_CONFIRM`,
`SHARE_LINK_UNAVAILABLE`) — finalize wording during `/implement`, not a blocker for `/tasks`.

## 2. `apps/web` — Error Message Mapping

**File**: `apps/web/src/lib/errorMessages.ts` (existing `mapApiError` switch — add 1 `case` branch
before the `default`, no signature change):

```typescript
case API_ERROR_CODES.VERSION_NOT_FOUND:
  return UI_COPY.VERSION_UNAVAILABLE;
```

This one mapping serves both call sites the spec distinguishes at the _component_ level, not here:
the restore-mutation's error toast (Scenario "Restore fails because the version was purged") and any
other generic `mapApiError`-driven surface. The preview pane's dedicated `VERSION_UNAVAILABLE` empty
state (Scenario "Selected version has been purged") is rendered directly from the `404` branch of
`useNoteVersion`, not via this toast mapping — `mapApiError` alone can't express "render a specific
pane," only "return a string," so the component still branches on `isAxiosError` + `status === 404`
exactly like `ShareModal`/`ShareViewPage` already do for their own 404 cases.

## 3. `apps/web/src/api/note-version.api.ts` (new file)

Mirrors the existing `share.api.ts` pattern exactly (thin `httpClient` wrappers, zero business logic,
zero error swallowing — 404s propagate as rejected promises for the calling hook/component to
interpret):

```typescript
import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  NoteResponseDto,
  NoteVersionResponseDto,
  NoteVersionSummaryDto,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

const versionsUrl = (noteId: string) =>
  `${API_PATHS.NOTES.ROOT}/${noteId}${API_PATHS.NOTES.VERSIONS}`;

export async function listNoteVersions(
  noteId: string,
): Promise<NoteVersionSummaryDto[]> {
  const response = await httpClient.get<
    ApiSuccessResponse<{ versions: NoteVersionSummaryDto[] }>
  >(versionsUrl(noteId));
  return response.data.data.versions;
}

export async function getNoteVersion(
  noteId: string,
  versionId: string,
): Promise<NoteVersionResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<NoteVersionResponseDto>
  >(`${versionsUrl(noteId)}/${versionId}`);
  return response.data.data;
}

export async function restoreNoteVersion(
  noteId: string,
  versionId: string,
): Promise<NoteResponseDto> {
  const response = await httpClient.post<ApiSuccessResponse<NoteResponseDto>>(
    `${versionsUrl(noteId)}/${versionId}${API_PATHS.NOTES.RESTORE}`,
  );
  return response.data.data;
}
```

`listNoteVersions` unwraps the `{ versions: [...] }` envelope at the API-client boundary (matching
the confirmed `note-version.service.ts` `listVersions` return shape) so every consumer downstream
works with a plain `NoteVersionSummaryDto[]`, exactly as `spec.md`'s Scenarios describe ("the drawer
SHALL render each `NoteVersionSummaryDto` as a row").

## 4. `apps/web/src/hooks/` (new files)

Following the exact existing hook conventions (`useShareLink.ts`, `useGenerateShareLink.ts`,
`useRevokeShareLink.ts`).

### 4.1 `useNoteVersions.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import { listNoteVersions } from "@/api/note-version.api";

export function useNoteVersions(noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["notes", "versions", noteId],
    queryFn: () => listNoteVersions(noteId),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
```

- `enabled` wired to `VersionHistoryDrawer`'s `open` prop, identical to `useShareLink`'s
  `(noteId, open)` shape — `staleTime: 0` guarantees every `open` transition (`false → true`) is a
  genuine network refetch, satisfying "Drawer Fetches and Lists Versions on Open" (`FRS-8.4`) without
  extra imperative `refetch()` plumbing.
- Because `enabled` stays `true` for the drawer's entire open session, toggling the local
  list-vs-preview pane state does **not** re-trigger this query — satisfying Scenario "Owner navigates
  back to the list" (`... without re-fetching it`) for free, with zero extra caching logic.
- `retry: false` — a network/`5xx` failure must surface immediately so the inline `<ErrorFallback>`
  can render without an artificial delay (Scenario "List fetch fails").

### 4.2 `useNoteVersion.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import { getNoteVersion } from "@/api/note-version.api";

export function useNoteVersion(noteId: string, versionId: string | null) {
  return useQuery({
    queryKey: ["notes", "versions", noteId, versionId],
    queryFn: () => getNoteVersion(noteId, versionId!),
    enabled: versionId !== null,
    staleTime: 0,
    retry: false,
  });
}
```

- `enabled: versionId !== null` — the query only runs once the owner clicks a version row
  (Scenario "Owner selects a version"); `versionId!` inside `queryFn` is safe because TanStack Query
  never invokes `queryFn` while `enabled` is `false`, the same non-null-assertion pattern
  `usePublicShareNote`/`ShareViewPage` already use for their own always-present route param.
- `retry: false` + component-level `isAxiosError(...) && status === 404` branch (mirroring
  `ShareModal`'s `is404`) is what renders `UI_COPY.VERSION_UNAVAILABLE` (Scenario "Selected version has
  been purged") distinctly from a genuine network/`5xx` failure (Scenario "Preview fetch fails").

### 4.3 `useRestoreNoteVersion.ts`

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NoteResponseDto } from "@shared/core/types";
import { restoreNoteVersion } from "@/api/note-version.api";

export function useRestoreNoteVersion(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (versionId: string) => restoreNoteVersion(noteId, versionId),
    onSuccess: (data: NoteResponseDto) => {
      queryClient.setQueryData(["notes", "detail", noteId], data);
      queryClient.invalidateQueries({ queryKey: ["notes", "detail", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      queryClient.invalidateQueries({
        queryKey: ["notes", "versions", noteId],
      });
    },
  });
}
```

- No toast and no `onRestored`/drawer-close side effect inside the hook itself — per Requirement
  "Confirmed Restore Applies the Server's Authoritative Content and Closes the Drawer," the two error
  branches (`NOTE_NOT_FOUND` → leave preview unchanged; `VERSION_NOT_FOUND` → re-render
  `VERSION_UNAVAILABLE`) need different component-local state changes that a hook-level `onError`
  can't express — exactly the same division of responsibility `useGenerateShareLink` uses (hook owns
  cache writes, component owns the mutate-call's `onSuccess`/`onError` callbacks and their UI
  consequences).
- `setQueryData(["notes", "detail", noteId], data)` primes `NoteEditorPage`'s `useNoteById` cache with
  the authoritative restored note immediately (belt-and-suspenders alongside the `invalidateQueries`
  call), consistent with `useGenerateShareLink`'s identical `setQueryData` + `invalidateQueries` pair.

## 5. `apps/web/src/components/ui/Sheet.tsx` (edit existing file)

Add an optional `side` and `widthClassName` prop, default-preserving `SidebarNav`'s existing left-fixed
`260px` usage exactly (Requirement "`Sheet` Component Supports a Right-Side Panel Variant"):

```typescript
export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  side?: "left" | "right";
  widthClassName?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = "left",
  widthClassName = "w-[260px]",
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 z-50 flex h-full flex-col overflow-y-auto bg-white p-4 shadow-lg outline-none",
            side === "left"
              ? "left-0 border-r border-zinc-200"
              : "right-0 border-l border-zinc-200",
            widthClassName,
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- `SidebarNav`'s two existing call sites (`NoteEditorPage.tsx`, and the notes-list page) pass neither
  `side` nor `widthClassName` today — with both defaulted (`"left"`, `"w-[260px]"`), the rendered output
  and className string is byte-identical to the current unconditional `"fixed inset-y-0 left-0 ... w-[260px] ... border-r ..."`, satisfying Scenario "Existing left-side usage is unaffected."
- `widthClassName` is a plain string prop (not a `min-w`/`max-w` pair) so `VersionHistoryDrawer` can
  pass the exact responsive class `"w-full sm:w-[420px]"` the spec's own Scenario names, matching
  `docs/ux.md`/`FRS-7.5`'s mobile-full-width / desktop-fixed-width breakpoint rule without `Sheet`
  needing to know about any specific caller's breakpoint values.

## 6. `apps/web/src/components/versions/VersionHistoryDrawer.tsx` (new directory + file)

New feature-component directory, sibling to `components/notes/`, `components/editor/`,
`components/sharing/` — matches the "Feature Component" naming convention in `apps/web/CLAUDE.md`.

```typescript
export interface VersionHistoryDrawerProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (restoredNote: NoteResponseDto) => void;
}
```

Internal composition (no new generic drawer wrapper needed — `Sheet` from §5 supplies the Radix Dialog
scaffolding; this component owns only its list/preview content, matching `ShareModal`'s "compose
directly, don't add another abstraction layer" precedent):

- **Local state**: `selectedVersionId: string | null` (list pane vs. preview pane —
  `null` = list), `isRestoreConfirmOpen: boolean`. Both reset to their initial values whenever `open`
  flips to `true` (`useEffect` keyed on `open`, exact same reset pattern `ShareModal` uses for
  `expiryDaysInput`/`isRevokeConfirmOpen`) so re-opening the drawer for a different note (or the same
  note again) never leaks the previous session's selection.
- `versionsQuery = useNoteVersions(noteId, open)`; `isListMinLoading =
useMinLoadingTime(versionsQuery.isFetching)` (`docs/ux.md §1`, Scenario "Loading state respects
  minimum display timer").
- `versionQuery = useNoteVersion(noteId, selectedVersionId)`; `isPreviewMinLoading =
useMinLoadingTime(versionQuery.isFetching)` (Scenario "Preview loading state respects minimum
  display timer").
- `restoreMutation = useRestoreNoteVersion(noteId)`.
- `isVersionUnavailable = isAxiosError(versionQuery.error) && versionQuery.error.response?.status === 404`
  — the same `is404` branch-point idiom as `ShareModal`/`ShareViewPage`.
- Read-only preview editor: `useEditor({ editable: false, extensions: [StarterKit], content: "" })`
  plus a `useEffect` calling `editor.commands.setContent(versionQuery.data.bodySnapshot)` when
  `versionQuery.data` changes — **exact** mirror of `ShareViewPage.tsx`'s existing
  `editable: false` / `StarterKit`-only / `setContent`-in-`useEffect` mechanism (verified: `NoteEditor`
  itself only imports `StarterKit` too, since `@tiptap/starter-kit@3.27.3` already bundles
  Bold/Italic/Underline/Link — no separate extension import needed here either, so the spec's mention
  of `[StarterKit, Underline, Link]` collapses to `[StarterKit]` in practice, matching the codebase's
  one actual precedent instead of introducing a second, inconsistent extension list).
- **Sheet title**: `"Version History"`.
- Render branches inside `<Sheet side="right" widthClassName="w-full sm:w-[420px]" title="Version History" open={open} onOpenChange={onOpenChange}>`:
  1. `selectedVersionId === null` → **list pane**:
     - `isListMinLoading` → 4–5 stacked `<Skeleton className="h-14 w-full" />` rows.
     - `versionsQuery.isError` → `<ErrorFallback message="Couldn't load this note's version history." onRetry={() => versionsQuery.refetch()} />`.
     - `versionsQuery.data?.length === 0` → `UI_COPY.EMPTY_VERSION_HISTORY` empty state (icon +
       subtext, no primary action button — matches the search-empty-state precedent of omitting a CTA
       when there's nothing actionable to create, `docs/ux.md §3`).
     - Otherwise → a scrollable `<ul>` of version rows, each a `<button>` rendering `titleSnapshot` +
       `formatUpdatedAt(createdAt)` (reused from `@/components/notes/NoteCard`, same cross-component
       reuse precedent `ShareModal` already established), `onClick={() => setSelectedVersionId(version.id)}`.
  2. `selectedVersionId !== null` → **preview pane**:
     - A "← Back to list" `<Button variant="ghost">` with `onClick={() => setSelectedVersionId(null)}`
       (no query invalidation — Scenario "Owner navigates back to the list").
     - `isPreviewMinLoading` → title + body `<Skeleton>` shapes.
     - `isVersionUnavailable` → `UI_COPY.VERSION_UNAVAILABLE` text, back control still visible, **no**
       "Restore this version" button (Scenario "Selected version has been purged").
     - `versionQuery.isError && !isVersionUnavailable` → inline `<ErrorFallback onRetry={() => versionQuery.refetch()}>` distinct from the permanent unavailable state (Scenario "Preview fetch fails").
     - `versionQuery.data` → formatted `createdAt`, `titleSnapshot` as an `<h3>`,
       `<EditorContent editor={editor} />`, and a "Restore this version" `<Button>` with
       `onClick={() => setIsRestoreConfirmOpen(true)}`.
- **Confirm + restore flow**:
  ```tsx
  <ConfirmModal
    open={isRestoreConfirmOpen}
    onOpenChange={setIsRestoreConfirmOpen}
    heading="Restore Version"
    body={UI_COPY.VERSION_RESTORE_CONFIRM}
    confirmLabel="Restore"
    isConfirming={restoreMutation.isPending}
    onConfirm={() => {
      restoreMutation.mutate(selectedVersionId!, {
        onSuccess: (data) => {
          setIsRestoreConfirmOpen(false);
          onRestored(data);
          onOpenChange(false);
          toast.success(UI_COPY.VERSION_RESTORE_SUCCESS, { duration: 3000 });
        },
        onError: (error) => {
          const axiosError = error as AxiosError<ApiErrorResponse>;
          setIsRestoreConfirmOpen(false);
          toast.error(mapApiError(axiosError.response?.data.error.code), {
            duration: 5000,
          });
          if (
            axiosError.response?.data.error.code ===
            API_ERROR_CODES.VERSION_NOT_FOUND
          ) {
            queryClient.invalidateQueries({
              queryKey: ["notes", "versions", noteId, selectedVersionId],
            });
          }
          // NOTE_NOT_FOUND: preview pane and editor content deliberately left
          // unchanged — no partial apply (Scenario "Restore fails because the
          // note was trashed in another tab").
        },
      });
    }}
  />
  ```
  - On `VERSION_NOT_FOUND`, invalidating `["notes","versions",noteId,selectedVersionId]` forces
    `useNoteVersion` to refetch, which will itself 404 and flip `isVersionUnavailable` to `true` —
    satisfying Scenario "Restore fails because the version was purged in another tab" (`re-render the
preview pane in its VERSION_UNAVAILABLE state`) without a separate boolean flag duplicating query
    state.
  - `queryClient` obtained via `useQueryClient()` inside the component (already imported for the
    invalidate call above — `useRestoreNoteVersion`'s own `queryClient` instance is internal to that
    hook and not exposed, so the component gets its own handle exactly like `ShareModal` does for
    nothing extra today, but this ticket is the first to need it at the component layer).

## 7. `apps/web/src/components/editor/NoteEditor.tsx` (edit existing file)

- Add local state: `const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);`
- Import `History` from `lucide-react` and `VersionHistoryDrawer` from
  `@/components/versions/VersionHistoryDrawer`.
- Add a toolbar button in the existing `Button` row, directly after the "Share note" button
  (Requirement "Version History Toolbar Entry Point"):
  ```tsx
  <Button
    type="button"
    variant="ghost"
    className="h-8 min-w-0 px-2"
    aria-label="Version history"
    disabled={noteId === null}
    aria-disabled={noteId === null}
    onClick={() => setIsVersionHistoryOpen(true)}
  >
    <History className="h-4 w-4" aria-hidden="true" />
  </Button>
  ```
- After the existing conditional `<ShareModal ... />` mount, conditionally mount:
  ```tsx
  {
    noteId !== null ? (
      <VersionHistoryDrawer
        noteId={noteId}
        open={isVersionHistoryOpen}
        onOpenChange={setIsVersionHistoryOpen}
        onRestored={(restoredNote) => {
          clearDraft(draftKey);
          setTitle(restoredNote.title);
          lastSavedTitleRef.current = restoredNote.title;
          editor?.commands.setContent(restoredNote.body);
          setTagIds(restoredNote.tags.map((tag) => tag.id));
        }}
      />
    ) : null;
  }
  ```
  - `clearDraft(draftKey)` before applying the restored content — Requirement "Confirmed Restore
    Applies the Server's Authoritative Content..." (`silently discarding any local unsaved draft for
this note`) — reuses the exact `clearDraft` already destructured from `useUiStore` at the top of
    this component for the autosave flow, no new store access pattern introduced.
  - `editor?.commands.setContent(...)` is required (not just relying on the `note` prop) because, per
    the spec's explicit callout, `NoteEditor`'s TipTap instance does not re-derive its content from
    props after mount — the identical reasoning already documented for why `useNoteAutosave`'s
    `onCreated`/`onSaved` callbacks exist instead of prop-driven re-render.
  - `setTagIds` keeps the attached-tags badge row in sync since `restoredNote.tags` is the
    authoritative post-restore tag list (a version snapshot only ever captures `title`/`body`, not
    `tagIds`, but the restore _response_ is the full current `Note`, whose `tags` field reflects
    whatever was attached at restore time — unchanged by the restore itself, this assignment is a
    no-op in practice but keeps local state derived from the one authoritative response rather than
    left stale).
- Zero changes to `NoteEditor`'s autosave, draft-restore-from-`useUiStore`, sharing, or
  tag-attachment logic — purely additive, per spec's Out of Scope.

## 8. Exact File Manifest

| Action | Path                                                        |
| ------ | ----------------------------------------------------------- |
| Edit   | `packages/shared/src/constants/ui-copy.constant.ts`         |
| Edit   | `apps/web/src/lib/errorMessages.ts`                         |
| New    | `apps/web/src/api/note-version.api.ts`                      |
| New    | `apps/web/src/hooks/useNoteVersions.ts`                     |
| New    | `apps/web/src/hooks/useNoteVersion.ts`                      |
| New    | `apps/web/src/hooks/useRestoreNoteVersion.ts`               |
| Edit   | `apps/web/src/components/ui/Sheet.tsx`                      |
| New    | `apps/web/src/components/versions/VersionHistoryDrawer.tsx` |
| Edit   | `apps/web/src/components/editor/NoteEditor.tsx`             |

No `apps/api` file is touched. No `packages/shared` schema/type file is touched. No `App.tsx` route
change — the drawer is a component mounted inside `NoteEditor`, never its own route, matching the
"Version history stays reachable only from inside `NoteEditor`" Out-of-Scope entry.

## 9. Cross-Cutting Rule Verification

- **Zero DTO/schema duplication (`Rule 11`, `FRS-8.5`)**: `note-version.api.ts` imports
  `NoteResponseDto`, `NoteVersionResponseDto`, `NoteVersionSummaryDto` from `@shared/core/types`
  unchanged; zero hand-written interfaces.
- **Zero hardcoded literals (`FRS-8.5`)**: all route path fragments from `API_PATHS.NOTES.ROOT`/
  `VERSIONS`/`RESTORE`; all confirmation/toast/unavailable/empty copy from `UI_COPY`; error-code
  branching from `API_ERROR_CODES.VERSION_NOT_FOUND`. Toast durations (`3000`/`5000`) match the
  existing hardcoded convention already used verbatim by `useRevokeShareLink`/`useRestoreNote` — not a
  new inconsistent pattern (same note as `AB-1014`'s plan: a future ticket could promote these to
  Tier 3 constants, out of scope here).
- **No client-side re-derivation across requests (`FRS-8.4`)**: `useNoteVersions`'s `staleTime: 0` +
  `enabled` toggling forces a live fetch every drawer open; the list is rendered in the exact array
  order received, never client-sorted.
- **Confirm-before-destructive (`FRS-7.4`, `docs/ux.md §5`)**: restore is gated behind `<ConfirmModal>`
  with `Cancel` default-focused (inherited unchanged from `ConfirmModal`'s existing `autoFocus`
  Cancel button) — never a single click from the preview pane.
- **Token/storage security (`FRS-1.3`)**: no interaction with `useAuthStore` beyond the existing
  `httpClient` interceptor (read-only attach) — this ticket's routes are all authenticated, same as
  every existing `notes.api.ts`/`share.api.ts` call.
- **Backend layering (`routers/ → controllers/ → services/ → repositories/`)**: not applicable — no
  backend files change; `AB-1009`'s existing layering is consumed read-only.
- **Test DB isolation (`FRS-0.3.3`)**: applies to `test-writer.md`'s output at `/tasks`+`/implement`
  time — Vitest component tests for the new hooks/`VersionHistoryDrawer`/`NoteEditor` addition need no
  DB at all (pure frontend, mocked `httpClient`); no new isolation concern introduced.

## 10. Out-of-Scope Reaffirmed (no plan step contradicts these)

- No diff/comparison view between two versions.
- No manual pin/exempt-from-purge affordance.
- No "days until purge" or any purge-eligibility indicator anywhere in the new UI.
- No pagination/infinite-scroll for the version list (full unpaginated array, native panel scroll).
- No version-count indicator on `NoteCard`'s list-view card.
- No change to `NoteEditor`'s autosave, sharing, or tag-attachment behavior beyond the additive toolbar
  button + drawer mount in §7.
- The existing unused `hidden w-[320px] flex-shrink-0 lg:block` reserved spacer `<div>` at the end of
  `NoteEditorPage.tsx`'s JSX is left untouched — this ticket's spec explicitly chose an overlay
  `Sheet`-based drawer (matching `ShareModal`'s mechanism) over a persistent non-overlapping side
  panel, so that placeholder remains dead/unused after this ticket, exactly as it is today; repurposing
  or removing it is not one of this ticket's Requirements and is left for a future ticket if ever
  needed.

## 11. Quality Gates (must pass before `/tasks` execution is considered complete)

1. `pnpm turbo run build` — `0` errors (`tsup` for `packages/shared`; Vite build for `apps/web`).
2. `pnpm turbo run lint` — `--max-warnings 0`.
3. `pnpm turbo run typecheck` — `tsc --noEmit`, `0` static errors.
4. `pnpm turbo run test -- --coverage` — Vitest component tests for `VersionHistoryDrawer`, the 3 new
   hooks, the `Sheet` `side`/`widthClassName` prop addition, and the `NoteEditor` toolbar/restore-apply
   addition; ≥80% coverage on all new code. Test scenarios sourced from the numbered
   Requirements/Scenarios in `spec.md` directly (already phrased as `FRS`-style
   `SHALL`/`WHEN`/`THEN` text) plus the underlying `FRS-6.2`–`FRS-6.4`/`FRS-7.4` requirement text, per
   `test-writer.md`'s binding input-source constraint — never from the "Acceptance Criteria
   Traceability" line at the bottom of `spec.md`.

---

Waiting for explicit `APPROVED` before proceeding to `/tasks`.
