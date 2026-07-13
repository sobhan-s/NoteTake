# Technical Implementation Plan — AB-1014: Share Modal + Active Links

Change directory: `openspec/changes/AB-1014-share-modal-links-frontend/`
Spec source: `specs/sharing/spec.md` (read in full). Target requirements: `FRS-5.1`–`FRS-5.6`, `FRS-7.2`, `FRS-8.4`, `FRS-8.5`.

## 0. Scope Confirmation

Pure frontend (`apps/web`) + one Tier-1 constants addition (`packages/shared`). Zero backend
(`apps/api`) changes — `AB-1008` already ships every route/DTO/constant this ticket consumes.
No new Zod schema, no new DTO. Verified against existing code:

- `packages/shared/src/schemas/share.schema.ts` → `createShareLinkSchema` already exists, unchanged.
- `packages/shared/src/types/share.type.ts` → `ShareLinkResponseDto`, `PublicNoteResponseDto` already
  exist, unchanged.
- `packages/shared/src/constants/api-paths.constant.ts` → `API_PATHS.NOTES.SHARE = "/share"`,
  `API_PATHS.PUBLIC.ROOT = "/public"`, `API_PATHS.PUBLIC.SHARE = "/share"` already exist, unchanged.
- `packages/shared/src/constants/app-limits.constant.ts` → `SHARE_LINK_DEFAULT_EXPIRY_DAYS` (`7`),
  `SHARE_LINK_MIN_EXPIRY_DAYS` (`1`), `SHARE_LINK_MAX_EXPIRY_DAYS` (`30`) already exist, unchanged.
- `packages/shared/src/constants/api-error-codes.constant.ts` → `SHARE_LINK_NOT_FOUND`,
  `SHARE_LINK_UNAVAILABLE` already exist, unchanged.
- `packages/shared/src/constants/ui-copy.constant.ts` → gains 4 new entries (below). This is the
  **only** `packages/shared` file this ticket touches.

## 1. `packages/shared` — UI Copy Additions Only

**File**: `packages/shared/src/constants/ui-copy.constant.ts` (append to existing `UI_COPY` object,
alphabetical/grouping convention already used — no new file, no barrel change needed since this file
is already re-exported from `src/constants/index.ts`).

```typescript
CONFIRM_REVOKE_SHARE_LINK:
  "Anyone with the link will lose access immediately. Are you sure you want to revoke it?",
SHARE_LINK_REVOKED_SUCCESS: "Share link revoked.",
SHARE_LINK_COPIED_SUCCESS: "Link copied to clipboard.",
SHARE_LINK_UNAVAILABLE: "This link is no longer available.",
```

Exact copy strings above are placeholders matching existing tone (`PERMANENT_DELETE_CONFIRM`,
`TRASH_RESTORE_SUCCESS`) — finalize wording during `/implement`, not a blocker for `/tasks`.

## 2. `apps/web` — Error Message Mapping

**File**: `apps/web/src/lib/errorMessages.ts` (existing `mapApiError` switch — add 2 `case` branches
before the `default`, no signature change):

```typescript
case API_ERROR_CODES.SHARE_LINK_NOT_FOUND:
  return "No active share link found for this note.";
case API_ERROR_CODES.SHARE_LINK_UNAVAILABLE:
  return UI_COPY.SHARE_LINK_UNAVAILABLE;
```

`SHARE_LINK_NOT_FOUND` on the **owner-side** generate/revoke mutations is a genuine error (link
vanished mid-action, e.g. double-click race) — gets its own toast copy. On the **public** `ShareModal`
open-fetch, a `404 SHARE_LINK_NOT_FOUND` is the _expected_ empty state (Scenario: "Modal opens for a
note with no active link") and must **not** toast — it renders the generate form silently. This
distinction is handled in the component layer (§5), not in `mapApiError` itself, since `mapApiError`
has no context on which of the two call sites triggered the `404`.

## 3. `apps/web/src/api/share.api.ts` (new file)

Mirrors the existing `tags.api.ts` / `notes.api.ts` pattern exactly (thin `httpClient` wrappers, zero
business logic, zero error swallowing — 404s propagate as rejected promises for the calling hook/
component to interpret):

```typescript
import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  CreateShareLinkInput,
  PublicNoteResponseDto,
  ShareLinkResponseDto,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

const shareUrl = (noteId: string) =>
  `${API_PATHS.NOTES.ROOT}/${noteId}${API_PATHS.NOTES.SHARE}`;

export async function getShareLink(
  noteId: string,
): Promise<ShareLinkResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<ShareLinkResponseDto>
  >(shareUrl(noteId));
  return response.data.data;
}

export async function createShareLink(
  noteId: string,
  input: CreateShareLinkInput,
): Promise<ShareLinkResponseDto> {
  const response = await httpClient.post<
    ApiSuccessResponse<ShareLinkResponseDto>
  >(shareUrl(noteId), input);
  return response.data.data;
}

export async function revokeShareLink(noteId: string): Promise<void> {
  await httpClient.delete(shareUrl(noteId));
}

export async function getPublicShareNote(
  token: string,
): Promise<PublicNoteResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<PublicNoteResponseDto>
  >(`${API_PATHS.PUBLIC.ROOT}${API_PATHS.PUBLIC.SHARE}/${token}`);
  return response.data.data;
}
```

`getPublicShareNote` reuses the shared `httpClient` (not a bare `axios` instance) — its
`Authorization` interceptor only _attaches_ a header when `useAuthStore` holds a token; it never
_requires_ one, and the backend route is auth-optional (`SDS §7`). This means a signed-in owner
visiting their own `/share/:token` sends a harmless, backend-ignored `Authorization` header — no new
unauthenticated Axios client is warranted (Rule: don't build abstractions the task doesn't need).

## 4. `apps/web/src/hooks/` (new files)

Following the exact existing hook conventions (`useNoteById.ts`, `useCreateTag.ts`,
`usePermanentDeleteNote.ts`):

### 4.1 `useShareLink.ts`

```typescript
export function useShareLink(noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["notes", "share", noteId],
    queryFn: () => getShareLink(noteId),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
```

- `enabled` is wired to `ShareModal`'s `open` prop by the caller — `staleTime: 0` guarantees that every
  `open` transition (`false → true`) triggers a genuine network refetch rather than serving cached
  data, satisfying `FRS-8.4`/Requirement "Share Modal Fetches Current Link State on Open" without extra
  imperative `refetch()` plumbing.
- `retry: false` — a `404` (expected "no link yet" state) must not trigger TanStack's default retry
  backoff; a real network/`5xx` failure surfaces immediately so the inline retry affordance can render
  without an artificial delay.

### 4.2 `useGenerateShareLink.ts`

```typescript
export function useGenerateShareLink(noteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareLinkInput) => createShareLink(noteId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(["notes", "share", noteId], data);
      queryClient.invalidateQueries({ queryKey: ["notes", "detail", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
    },
  });
}
```

No `onError` toast inside the hook — per Requirement "Generate Share Link From the Modal" Scenario
"Generate request fails", the component owns the toast via `mapApiError` so it can also decide to keep
the generate form visible (a hook-level side effect can't express "leave this specific UI state
unchanged").

### 4.3 `useRevokeShareLink.ts`

```typescript
export function useRevokeShareLink(noteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeShareLink(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", "share", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "detail", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      toast.success(UI_COPY.SHARE_LINK_REVOKED_SUCCESS, { duration: 3000 });
    },
    onError: (error: AxiosError<ApiErrorResponse>) => {
      queryClient.invalidateQueries({ queryKey: ["notes", "share", noteId] });
      toast.error(mapApiError(error.response?.data.error.code), {
        duration: 5000,
      });
    },
  });
}
```

Both branches invalidate `["notes", "share", noteId]` — success clears to the generate form, failure
re-fetches the true current state instead of assuming success (Requirement "Revoke Share Link Requires
Explicit Confirmation" Scenario "Revoke request fails").

### 4.4 `usePublicShareNote.ts`

```typescript
export function usePublicShareNote(token: string) {
  return useQuery({
    queryKey: ["public", "share", token],
    queryFn: () => getPublicShareNote(token),
    retry: false,
  });
}
```

Separate query-key namespace (`"public"` root, not `"notes"`) — this is anonymous-visitor data, never
invalidated by any authenticated mutation, and must never collide with an owner's own `["notes", ...]`
cache entries if they happen to be signed in while viewing their own link.

## 5. `apps/web/src/components/sharing/` (new directory + files)

New feature-component directory, sibling to `components/notes/`, `components/editor/` — matches the
"Feature Component" naming convention in `apps/web/CLAUDE.md`.

### 5.1 `ShareModal.tsx`

```typescript
export interface ShareModalProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Internal composition (no new generic `Dialog` wrapper — `ConfirmModal.tsx` shows the established
pattern of composing `@radix-ui/react-dialog` primitives directly per-component, so `ShareModal`
follows the identical `Dialog.Root` / `Dialog.Portal` / `Dialog.Overlay` / `Dialog.Content` structure
and Tailwind classes for visual consistency):

- `shareLinkQuery = useShareLink(noteId, open)`.
- `isMinLoading = useMinLoadingTime(shareLinkQuery.isFetching)` — `>=200ms` skeleton floor
  (`docs/ux.md §1`).
- `is404 = isAxiosError(shareLinkQuery.error) && shareLinkQuery.error.response?.status === 404` —
  the local branch point between "expected empty state" and "real failure."
- Render branches, in order:
  1. `isMinLoading` → skeleton placeholder (`<Skeleton>` blocks approximating the active-link layout).
  2. `shareLinkQuery.isError && !is404` → inline `<ErrorFallback message={...} onRetry={() => shareLinkQuery.refetch()} />` rendered _inside_ `Dialog.Content` (not a full-page fallback).
  3. `shareLinkQuery.data` (200 OK, active link) → **active-link view**: full URL
     (`${window.location.origin}/share/${data.token}`) in a read-only `<Input readOnly>`, formatted
     `expiresAt` (reuse `formatUpdatedAt` from `@/components/notes/NoteCard` — already exported,
     already used cross-component by `SearchResultRow.tsx`, so this is precedent, not a new coupling),
     `viewCount`, "Copy Link" button, "Revoke" button.
  4. Otherwise (`is404` or post-revoke) → **generate form**: `<Input type="number" min={APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS} max={APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS}>` bound to local `expiryDays` state (default `APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS`), inline validation message when out of range, "Create Link" button `disabled` when out of range or `generateMutation.isPending`.
- Copy Link handler: `navigator.clipboard.writeText(url).then(() => toast.success(UI_COPY.SHARE_LINK_COPIED_SUCCESS, { duration: 3000 })).catch(() => toast.error(GENERIC_ERROR_MESSAGE-equivalent, { duration: 5000 }))` — reuses `mapApiError()` (no arg → default branch) for the generic failure string rather than a new literal, keeping one source of truth for the fallback copy.
- Revoke handler: clicking "Revoke" sets local `isRevokeConfirmOpen = true`; a nested
  `<ConfirmModal open={isRevokeConfirmOpen} heading="Revoke Public Share Link" body={UI_COPY.CONFIRM_REVOKE_SHARE_LINK} confirmLabel="Revoke" isConfirming={revokeMutation.isPending} onConfirm={() => revokeMutation.mutate(undefined, { onSettled: () => setIsRevokeConfirmOpen(false) })} onOpenChange={setIsRevokeConfirmOpen} />` — exact same nesting pattern `NotesList.tsx` already uses for `pendingDeleteNote`/`pendingRestoreNote`, confirming local `useState` (not `useUiStore`) is correct here per the spec's explicit architectural mapping.
- Generate submit handler: `generateMutation.mutate({ expiresInDays: expiryDays }, { onError: (error) => toast.error(mapApiError((error as AxiosError<ApiErrorResponse>).response?.data.error.code), { duration: 5000 }) })` — generate form stays mounted on error since the component doesn't move to a new render branch.

### 5.2 Barrel

No new barrel needed — `components/sharing/` is a leaf feature directory like `components/notes/`,
imported directly by path (`@/components/sharing/ShareModal`), matching existing import style (no
`components/notes/index.ts` exists either).

## 6. `apps/web/src/components/editor/NoteEditor.tsx` (edit existing file)

- Add local state: `const [isShareModalOpen, setIsShareModalOpen] = useState(false);`
- Add a toolbar button in the existing `Button` row (after the "Link" button), reusing the already-
  imported `Share2` icon (currently only used for the passive "Shared" badge at line 168 — importing
  it a second time for the button is a non-issue, same import):
  ```tsx
  <Button
    type="button"
    variant="ghost"
    className="h-8 min-w-0 px-2"
    aria-label="Share note"
    disabled={noteId === null}
    aria-disabled={noteId === null}
    onClick={() => setIsShareModalOpen(true)}
  >
    <Share2 className="h-4 w-4" aria-hidden="true" />
  </Button>
  ```
- After the closing `</div>` of the component's returned JSX tree, conditionally mount:
  ```tsx
  {
    noteId !== null ? (
      <ShareModal
        noteId={noteId}
        open={isShareModalOpen}
        onOpenChange={setIsShareModalOpen}
      />
    ) : null;
  }
  ```
  (guard mirrors the disabled-button guard — `ShareModal` never receives a `null` `noteId`, so its
  prop type can stay `string`, not `string | null`, keeping the component's own logic simpler).
- Zero changes to `NoteEditor`'s autosave, draft-restore, or tag-attachment logic — purely additive.

## 7. `apps/web/src/pages/ShareViewPage.tsx` (new file)

Chrome-free page, structurally independent of `SidebarNav`/`Sheet` (unlike every other page in
`src/pages/`) since anonymous visitors have no auth state:

- `const { token } = useParams<{ token: string }>();`
- `const query = usePublicShareNote(token!);` (route guarantees `token` present — same non-null
  assertion style `NoteEditorPage.tsx` uses for its own `useParams` param).
- `const isMinLoading = useMinLoadingTime(query.isLoading);`
- `const is404 = isAxiosError(query.error) && query.error.response?.status === 404;`
- Read-only TipTap render, matching `NoteEditor`'s actual extension set (`StarterKit` alone — verified
  via `apps/web/node_modules/@tiptap/starter-kit/package.json`: `@tiptap/starter-kit@3.27.3` already
  bundles `extension-link`, `extension-underline`, `extension-bold`, `extension-italic`, etc., which is
  why `NoteEditor.tsx` itself only imports `StarterKit` despite having Bold/Italic/Underline/Link
  toolbar buttons — no separate `Underline`/`Link` extension package import is needed or installed):
  ```tsx
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit],
    content: "",
  });

  useEffect(() => {
    if (editor && query.data) {
      editor.commands.setContent(query.data.body);
    }
  }, [editor, query.data]);
  ```
- Render branches (same three-way split as `ShareModal`, adapted to a full page):
  1. `isMinLoading` → title+body `<Skeleton>` shapes (Requirement "Public Share Page..." Scenario
     "Loading state").
  2. `query.isError && !is404` → `<ErrorFallback message="..." onRetry={() => query.refetch()} />`
     (Scenario "Network/5xx failure" — explicitly distinct from the permanent unavailable state).
  3. `is404` → single unavailable state: heading + `UI_COPY.SHARE_LINK_UNAVAILABLE` body, no retry
     button (there is nothing to retry — the link is permanently gone), no cause disclosed anywhere in
     this branch (`FRS-5.6`).
  4. `query.data` → `title` as an `<h1>`, formatted `updatedAt` (`formatUpdatedAt`), and
     `<EditorContent editor={editor} />` inside a centered, single-column, `max-w-2xl` container — zero
     `SidebarNav`, zero edit affordances, zero links to any other note or route.
- Layout: a bare `<div className="min-h-screen bg-zinc-50 flex justify-center px-4 py-10">` wrapper —
  no reuse of `NoteEditorPage`'s sidebar/Sheet scaffolding at all (Architectural Mapping: `SDS §4.5`'s
  authenticated shell is explicitly not reused here).

## 8. `apps/web/src/App.tsx` (edit existing file)

Add one new top-level route, registered alongside `/login`/`/register` (**outside** `ProtectedRoute`,
per Requirement "Public Share Route"):

```tsx
<Route path="/share/:token" element={<ShareViewPage />} />
```

Placed before the catch-all `<Route path="*" ...>`, after the other unauthenticated routes — exact
insertion point: immediately after `<Route path="/reset-password" .../>` and before the first
`<ProtectedRoute>`-wrapped route, preserving the file's existing grouping of "public routes" then
"protected routes."

## 9. Exact File Manifest

| Action | Path                                                |
| ------ | --------------------------------------------------- |
| Edit   | `packages/shared/src/constants/ui-copy.constant.ts` |
| Edit   | `apps/web/src/lib/errorMessages.ts`                 |
| New    | `apps/web/src/api/share.api.ts`                     |
| New    | `apps/web/src/hooks/useShareLink.ts`                |
| New    | `apps/web/src/hooks/useGenerateShareLink.ts`        |
| New    | `apps/web/src/hooks/useRevokeShareLink.ts`          |
| New    | `apps/web/src/hooks/usePublicShareNote.ts`          |
| New    | `apps/web/src/components/sharing/ShareModal.tsx`    |
| Edit   | `apps/web/src/components/editor/NoteEditor.tsx`     |
| New    | `apps/web/src/pages/ShareViewPage.tsx`              |
| Edit   | `apps/web/src/App.tsx`                              |

No `apps/api` file is touched. No `packages/shared` schema/type file is touched.

## 10. Cross-Cutting Rule Verification

- **Zero DTO/schema duplication (`Rule 11`, `FRS-8.5`)**: `share.api.ts` imports `CreateShareLinkInput`,
  `ShareLinkResponseDto`, `PublicNoteResponseDto` from `@shared/core/types` unchanged; zero hand-written
  interfaces.
- **Zero hardcoded literals (`FRS-8.5`)**: expiry bounds from `APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`/
  `MAX_EXPIRY_DAYS`/`DEFAULT_EXPIRY_DAYS`; all route path fragments from `API_PATHS.NOTES.SHARE`/
  `API_PATHS.PUBLIC.ROOT`/`API_PATHS.PUBLIC.SHARE`; all confirmation/toast copy from `UI_COPY`.
  Toast durations (`3000`/`5000`) already match the existing hardcoded convention used verbatim in
  `usePermanentDeleteNote.ts` and elsewhere in this codebase — not introducing a new inconsistent
  pattern, though a future ticket could promote these to `Tier 3` constants (out of scope here).
- **Token/storage security (`FRS-1.3`)**: no interaction with `useAuthStore` beyond the existing
  `httpClient` interceptor (read-only attach); `ShareViewPage` never reads or writes auth state.
- **No client-side re-derivation across requests (`FRS-8.4`)**: `useShareLink`'s `staleTime: 0` +
  `enabled` toggling forces a live fetch every modal open — no reliance on the passive
  `hasActiveShareLink` badge value once inside the modal.
- **No new soft-delete/version-history logic touched** — this ticket is additive only around the
  existing `NoteEditor` toolbar and a net-new unauthenticated route.
- **Backend layering (`routers/ → controllers/ → services/ → repositories/`)**: not applicable — no
  backend files change.
- **Test DB isolation (`FRS-0.3.3`)**: applies to `test-writer.md`'s output at `/tasks`+`/implement`
  time (Vitest component tests need no DB at all since this is pure frontend; Playwright E2E for the
  full `/share/:token` flow will run against `notes_app_test` per the existing global contract — no
  new isolation concern introduced by this ticket).

## 11. Out-of-Scope Reaffirmed (no plan step contradicts these)

- No "regenerate/rotate" verb — only Create Link (while none active) or Revoke (while one is active).
- `NoteCard`'s badge stays passive/non-interactive.
- No manual clipboard-fallback UI.
- No backend or shared schema/DTO change.

## 12. Quality Gates (must pass before `/tasks` execution is considered complete)

1. `pnpm turbo run build` — `0` errors (`tsup` for `packages/shared`; Vite build for `apps/web`).
2. `pnpm turbo run lint` — `--max-warnings 0`.
3. `pnpm turbo run typecheck` — `tsc --noEmit`, `0` static errors.
4. `pnpm turbo run test -- --coverage` — Vitest component tests for `ShareModal`, `ShareViewPage`,
   the 4 new hooks, and the `NoteEditor` toolbar addition; ≥80% coverage on all new code. Test scenarios
   sourced from the numbered Requirements/Scenarios in `specs/sharing/spec.md` directly (already
   phrased as `FRS`-style `SHALL`/`WHEN`/`THEN` text), per `test-writer.md`'s binding input-source
   constraint — never from the "Acceptance Criteria Traceability" line at the bottom of that spec file.

---

Waiting for explicit `APPROVED` before proceeding to `/tasks`.
