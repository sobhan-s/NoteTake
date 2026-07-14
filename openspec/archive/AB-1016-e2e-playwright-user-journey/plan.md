# Technical Implementation Plan — AB-1016: E2E — Playwright Full User Journey

Change directory: `openspec/changes/AB-1016-e2e-playwright-user-journey/`
Spec source: `specs/e2e/spec.md` (read in full). Target requirements: `FRS-2.1`–`FRS-2.3`, `FRS-3.1`–`3.4`,
`FRS-4.1`–`4.5`, `FRS-5.1`–`5.6`, `FRS-6.1`–`6.5`, `FRS-7.1`–`7.5`, `FRS-8.1`, `FRS-8.4`, `FRS-8a.1`–`8a.5`.

## 0. Scope Confirmation Against Critical NoteApp Rules

Pure test-authorship in `apps/web/e2e/`. **Zero** `apps/api`, `apps/web/src`, or `packages/shared`
product-code changes — every route, DTO, constant, and component this ticket drives already ships
(`AB-1002`–`AB-1015`). The `[Rule 1–6]` compliance checklist below is therefore a set of
**verifications that new test code respects existing contracts**, not new implementation decisions:

1. **Layered file paths** — N/A, no backend/frontend source files change. All new files live in
   `apps/web/e2e/` (test-only workspace, outside the `routers→controllers→services→repositories`
   and `store→api→hooks→components→pages` layering rules, which govern `apps/api/src` and
   `apps/web/src` only).
2. **Single source of truth (`Rule 11`)** — new spec files import constants (`APP_LIMITS.PAGE_SIZE_DEFAULT`,
   `APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`, `APP_LIMITS.VERSION_RETENTION_DAYS`, etc.) and DTOs from
   `@shared/core` wherever a numeric literal or shape would otherwise be hand-duplicated in a test
   assertion — e.g. asserting the 91-day purge-eligibility boundary as
   `APP_LIMITS.VERSION_RETENTION_DAYS + 1`, never a bare `91`.
3. **Backend layer enforcement** — verified passively: every new spec drives `apps/web` UI or calls
   `/api/v1/...` directly via Playwright's `request` fixture; no test reaches into `apps/api/src`
   internals directly.
4. **Token & storage security (`FRS-1.3.5`)** — verified passively via existing behavior; no new spec
   inspects `localStorage`/`sessionStorage` for tokens (nothing to find — confirms the negative).
   Multi-context tests (Sharing "read-only public view", Version History "since-trashed note")
   use a fresh unauthenticated `browser.newContext()` precisely because the app never persists tokens
   anywhere a new context could read them.
5. **Two-stage soft delete (`FRS-2.2`)** — verified via direct `prisma.note.update({ data: { deletedAt } })`
   backdating (see §2 below) and reads of `deletedAt IS NULL`-scoped visibility, never a physical
   `DELETE` on trashed rows until the explicit "permanent" flow.
6. **DB & test isolation (`FRS-0.3.3`, `SDS §1.5`)** — every new file imports `resetTestDatabase`,
   `prisma`, and (new) backdating helpers exclusively from `./helpers/db.ts`; zero direct
   `new PrismaClient()` construction in a spec file; the existing module-level `DATABASE_URL`
   guard in `db.ts` is inherited, not re-implemented per-file.

## 1. `apps/web/e2e/helpers/db.ts` — Extend With Backdating Helpers

**File**: `apps/web/e2e/helpers/db.ts` (edit existing file — append 3 exported functions after
`setTestOtpCodeHash`; no changes to the existing guard, `prisma` export, or `resetTestDatabase`).

Exact Prisma model/field names confirmed from `apps/api/prisma/schema.prisma`: `Note.deletedAt`
(`DateTime?`), `NoteVersion.createdAt` (`DateTime`, immutable — no `@updatedAt`), `ShareLink.expiresAt`
(`DateTime`).

```typescript
export async function backdateNoteDeletedAt(
  noteId: string,
  daysAgo: number,
): Promise<void> {
  assertTestDatabaseGuard();
  const deletedAt = new Date();
  deletedAt.setDate(deletedAt.getDate() - daysAgo);
  await prisma.note.update({ where: { id: noteId }, data: { deletedAt } });
}

export async function backdateNoteVersionCreatedAt(
  versionId: string,
  daysAgo: number,
): Promise<void> {
  assertTestDatabaseGuard();
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - daysAgo);
  await prisma.noteVersion.update({
    where: { id: versionId },
    data: { createdAt },
  });
}

export async function backdateShareLinkExpiry(
  shareLinkId: string,
  daysAgo: number,
): Promise<void> {
  assertTestDatabaseGuard();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() - daysAgo);
  await prisma.shareLink.update({
    where: { id: shareLinkId },
    data: { expiresAt },
  });
}
```

Each function calls `assertTestDatabaseGuard()` as its first statement — matching
`resetTestDatabase`'s existing pattern — rather than relying solely on the module-load-time throw, so
a future refactor that lazily constructs `prisma` can't silently bypass the check on these specific
mutation paths.

**Note on the "current live version is exempt regardless of age" requirement (`FRS-6.5`)**: the live
version is identified as the `NoteVersion` row with the greatest `createdAt` for a given `noteId` (per
`SDS §6` — there is no separate `isCurrent` boolean column). The Version History spec (§6 below) must
therefore create at least 2 versions and back-date only the non-latest one, never the row returned by
`ORDER BY createdAt DESC LIMIT 1`.

## 2. `apps/web/e2e/notes-crud-trash.spec.ts` (new file)

Combines the two spec-domain requirements that share fixtures (CRUD/Trash + Pagination/Sort/Tag-Filter)
into one file per the spec's own file-manifest mapping. Structure mirrors `auth-journey.spec.ts`:
`test.describe` block, `beforeEach(resetTestDatabase)`, one authenticated user seeded via direct
`prisma`+`setTestOtpCodeHash` shortcut (register→verify→login through the UI once per test, exactly as
`auth-journey.spec.ts` already does — no shortcut that bypasses real auth, since this ticket's whole
point is real-HTTP verification).

Key mechanics per scenario (selectors grounded in actual `aria-label`/text already shipped —
`apps/web/src/pages/NotesPage.tsx`: `"New Note"` button text, `aria-label="Move note to trash"` on
`NoteCard`; `apps/web/src/components/notes/NotesList.tsx`: `ConfirmModal` `confirmLabel="Restore Note"`
/ `"Delete Forever"`; `apps/web/src/components/editor/NoteEditor.tsx`: `aria-label="Note title"`):

- **Length caps / empty title**: created via the editor's title `input`/body `EditorContent`, then the
  over-cap and empty-title branches are asserted via a **direct API call** using Playwright's
  `request` fixture with the access token captured from the page's in-memory auth state (Playwright
  exposes this via `page.evaluate(() => window.__ZUSTAND_DEVTOOLS__...)` is not needed — instead,
  intercept the `Authorization` header of a real outgoing request with `page.route`/`page.waitForRequest`
  to extract the bearer token issued during login, then reuse it in `request.patch(...)`). This is the
  same technique the concurrency test (§5) needs for its own token capture, so it is implemented once
  as a shared `captureAccessToken(page)` helper inside `notes-crud-trash.spec.ts` and imported by
  `sharing.spec.ts`.
- **Cross-user 404**: seed a second user directly via `prisma.user.create` (bcrypt-hashing a known
  password with the same `bcrypt.hash(..., 12)` pattern `setTestOtpCodeHash` already uses) plus one
  `prisma.note.create` owned by that user, then hit the note's ID as the primary test user and assert
  `404`.
- **Stage 1 delete/restore/direct-edit-rejection**: click the trash icon on `NoteCard`
  (`aria-label="Move note to trash"`) → assert removal from the active `NotesList` and presence in the
  Trash tab (`NotesTabs`, `aria-label="Notes view"`) → direct API `PATCH` on that note ID → `404` →
  click `"Restore Note"` confirm → assert it's back in the active list with unchanged content.
- **Stage 2 invisibility**: after Stage-1 trash, call `backdateNoteDeletedAt(noteId, 31)`, reload the
  Trash tab, assert absence; direct API restore call → `404`; `prisma.note.findUnique` directly confirms
  the row still exists (not asserted through any UI, since Stage 2 has no UI surface at all per FRS).
- **Delete forever**: `"Delete Forever"` confirm modal → assert `ConfirmModal`'s default-focused
  "Cancel" button first (keyboard/`toHaveFocus` check), then confirm → assert removal + no restore
  affordance remains for that note ID anywhere in Trash.
- **Share link breaks on trash / no resurrection**: generate a link (drives `ShareModal`, see §5), trash
  the note, visit the public URL in a **fresh unauthenticated `browser.newContext()`** → unavailable
  state; restore the note → re-visit the _same_ token → still unavailable; generating a **new** link via
  `ShareModal` produces a different token.
- **Pagination/sort/tiebreaker**: seed `APP_LIMITS.PAGE_SIZE_DEFAULT + 1` notes directly via
  `prisma.note.createMany` with identical `title` values (bypassing the editor for bulk seeding —
  the create/update _behavior itself_ is already covered by the first scenario, so this scenario is
  purely about list-ordering/pagination, matching the spec's own scenario boundary) and staggered
  `createdAt`.
- **tagMode ALL/ANY/invalid**: create 2 tags via `TagCombobox`, attach one-each to two notes and both to
  a third, toggle `TagFilterControl`'s mode switch, assert visible result-set membership by note title;
  invalid `tagMode` asserted via direct API call only (no UI path can construct an invalid value).
- **Fresh-network-request-per-change spy**: `page.on("request", ...)` filtered to
  `**/api/v1/notes*` (GET), counting matches; assert count increments by exactly 1 per sort/tag/query
  change — never wrapped in `page.route` interception (which would need a fulfill/continue and risks
  masking a real fetch), a passive listener is sufficient and lower-risk.

## 3. `apps/web/e2e/tags.spec.ts` (new file)

- CRUD scenario drives the standalone tag-management surface (`useTags`/tag list — confirm exact page
  location during `/implement` by inspecting `SidebarNav`'s tag-management entry point; not yet
  directly grepped in this plan since it's a straightforward navigation, no architectural decision
  hinges on the exact route).
- Fly Tag scenario: types a novel name into `TagCombobox` (`aria-label="Add a tag"`,
  `placeholder="Add a tag..."`) inside `NoteEditor`, selects the "create new" affordance; repeats the
  equivalent inline-create flow from the search/filter bar's own tag combobox instance
  (`TagFilterControl` — confirm it renders the same `TagCombobox` component or an equivalent inline
  input during `/implement`).
- Live count: attach → trash → restore → detach in one continuous session, asserting the tag's
  displayed count after each step (exact count-display location confirmed during `/implement`).
- Duplicate name (case-insensitive) → `409`; cross-user delete → seed User B's tag via
  `prisma.tag.create`, attempt delete as User A → `404`.

## 4. `apps/web/e2e/search.spec.ts` (new file)

- Own-notes-only + visible highlight: two users, shared keyword, assert `SnippetHighlight`'s rendered
  DOM (not raw JSON) shows a highlighted `<mark>`/`<span>` wrapping the term — confirm
  `SnippetHighlight.tsx`'s actual rendered element/class during `/implement` (spec's own Architectural
  Mapping already confirms it splits on `[[[MARK]]]`/`[[[MARK_END]]]` client-side, never
  `dangerouslySetInnerHTML`, per `AGENTS.md §9`).
- Empty/whitespace query rejected: drives `SearchInput` (`aria-label="Search notes"`) with a
  space-only value, then confirms via direct API call that the same value is a `400`/`422`, not
  "match everything."
- SQL-special-character query (`%`, `_`, `'`, `--`): submitted through the same UI input, asserting no
  error toast and a syntactically valid (possibly empty) result — proving Prisma's parameterized
  `tsquery` construction, not string concatenation.
- Pagination + fresh-request-per-query-change: same request-count-spy technique as §2, filtered to
  `**/api/v1/search*`.

## 5. `apps/web/e2e/sharing.spec.ts` (new file)

- Default/custom/out-of-range expiry: drives `ShareModal`'s generate form (`"Create Link"` button,
  numeric input bounded by `APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`/`MAX_EXPIRY_DAYS` per the already-
  shipped component); out-of-range asserted via direct API call (the input's own `min`/`max` HTML
  attributes make it impossible to submit an invalid value through the UI itself, so the negative case
  is inherently an API-level assertion, not a UI one).
- Manual revoke: `"Revoke"` button → `ConfirmModal` (`heading="Revoke Public Share Link"`,
  `confirmLabel="Revoke"`) → confirm → fresh unauthenticated context visits the token → unavailable.
- **Concurrency test**: reuses `captureAccessToken(page)` from §2 to get a bearer token, then uses
  Playwright's `request.newContext()` (a separate `APIRequestContext`, independent of any browser page)
  to fire `Promise.all([...Array(10)].map(() => apiContext.get(`/api/v1/public/share/${token}`)))`,
  then `GET /api/v1/notes/:id/share` as the owner and assert `viewCount === 10` exactly. This is a pure
  HTTP-layer test with no page navigation, matching the spec's Architectural Mapping.
- Trashed-note share creation rejected: direct API `POST .../share` on a trashed note ID → asserted
  status per `FRS-5.6` Error Scenarios (exact code confirmed against `share.service.ts` during
  `/implement`, not guessed here).
- Expired/revoked/trashed byte-identical page: three notes/links, one via `backdateShareLinkExpiry`,
  one via UI revoke, one via UI trash; visits all three in separate fresh contexts and diffs
  `page.content()` (or a scoped container's `innerText`) across all three, asserting equality.
- Read-only public view: fresh unauthenticated context, asserts absence of any edit-capable element
  (no `contenteditable`, no toolbar buttons, no owner-identity text) via negative `expect(...).toHaveCount(0)`
  assertions rather than trying to enumerate every possible edit affordance.

## 6. `apps/web/e2e/version-history.spec.ts` (new file)

- Explicit-save-always-versions + autosave-throttle: two `Ctrl+S`/explicit-save actions within 5 minutes
  assert 2 new versions; two autosave-eligible edits (debounced per `useNoteAutosave`, `1500ms` quiet
  window) within the same `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES` window assert at most 1
  additional version, by comparing `VersionHistoryDrawer`'s rendered list length before/after (drawer
  opened via `aria-label="Version history"` toolbar button).
- Reverse-chronological + preview + append-only restore: open drawer, select an older entry, assert
  full read-only preview content renders before any mutating control is reachable, then
  `"Restore this version"` → `ConfirmModal` (`heading="Restore Version"`, `confirmLabel="Restore"`) →
  confirm → assert editor content updated, a new version appended at the top, and the prior list length
  is `original + 1` (never `original`, proving nothing was deleted).
- Purge-eligible backdated version (91 days, per the live-version-exemption note in §1): create note →
  save twice (version A, then version B as the live/latest) → `backdateNoteVersionCreatedAt(versionA.id, 91)`
  → attempt to view version A by ID → unavailable; version B (live) and any other fresh version remain
  viewable.
- Restore-on-since-trashed-note rejected: two `browser.newContext()`/`page` pairs for the same
  authenticated user (two tabs sharing one login — captured access token reused across both API
  requests, since the in-memory Zustand store is per-tab but the underlying session/note data is
  server-side), trash from tab A, attempt restore-version from tab B → `404` surfaced via the existing
  `mapApiError` toast path (asserted by visible toast text, not implementation detail).

## 7. `apps/web/e2e/full-journey.spec.ts` (new file)

One `test()` (not `test.describe` with multiple `test()`s — a single continuous narrative per the
spec's explicit framing), reusing helpers/patterns already built for §2–§6 (tag creation, share
generation, version save/restore, trash/restore, permanent delete) in strict narrative order exactly as
enumerated in the spec's "One continuous authenticated journey" scenario. No new mechanics are
introduced in this file — it is purely a composition of steps already proven independently in the
domain-specific files above, which is why this file is authored **last** in the implementation
sequence (§9).

## 8. Exact File Manifest

| Action | Path                                    |
| ------ | --------------------------------------- |
| Edit   | `apps/web/e2e/helpers/db.ts`            |
| New    | `apps/web/e2e/notes-crud-trash.spec.ts` |
| New    | `apps/web/e2e/tags.spec.ts`             |
| New    | `apps/web/e2e/search.spec.ts`           |
| New    | `apps/web/e2e/sharing.spec.ts`          |
| New    | `apps/web/e2e/version-history.spec.ts`  |
| New    | `apps/web/e2e/full-journey.spec.ts`     |

No `apps/api`, `apps/web/src`, or `packages/shared` file is touched. `apps/web/playwright.config.ts` is
unchanged (already `workers: 1`, `fullyParallel: false`, already loads `apps/api/.env.test`).

## 9. Implementation Sequence (for `/tasks`)

1. `db.ts` backdating helpers first — every later file depends on them.
2. `notes-crud-trash.spec.ts` second — establishes the shared `captureAccessToken(page)` helper that
   `sharing.spec.ts`'s concurrency test imports.
3. `tags.spec.ts`, `search.spec.ts`, `sharing.spec.ts`, `version-history.spec.ts` — independent of each
   other, any order.
4. `full-journey.spec.ts` last — composes proven steps from all prior files; authoring it first would
   risk debugging journey-level flakiness before the individual mechanics are known-good in isolation.

Each file is a self-contained checkpoint: run `pnpm --filter @apps/web exec playwright test <file>`
after authoring it before moving to the next, rather than authoring all 6 files blind and debugging
them together at the end.

## 10. Cross-Cutting Rule Verification

- **Zero product code changes**: confirmed file manifest above touches only `apps/web/e2e/`.
- **Zero hardcoded literals for `APP_LIMITS` values (`FRS-8.5`)**: all day-boundary/page-size/expiry
  assertions reference `APP_LIMITS.*` imported from `@shared/core/constants`, never a bare number
  (e.g. `APP_LIMITS.VERSION_RETENTION_DAYS + 1`, not `91`).
- **Test DB isolation (`FRS-0.3.3`)**: every new file's only DB access is through `./helpers/db.ts`
  exports; `resetTestDatabase()` runs in `beforeEach` in every new `test.describe` block, matching the
  existing three specs' convention exactly.
- **No `NOTE_TRASHED` invention**: `notes-crud-trash.spec.ts` asserts `404 NOTE_NOT_FOUND` for every
  trashed-note-direct-edit case, per the spec's explicit correction of `AGENTS.md §8`'s aspirational
  table.
- **`FRS-8.4` (no client-side re-filtering)**: request-count-spy technique (§2, §4) is the single
  reusable mechanism for every "fresh request per change" assertion — not reimplemented per file.
- **Real-auth-only, no backdoor login**: every spec authenticates through the real
  register→verify→login UI flow at least once per `test()` (matching `auth-journey.spec.ts`'s existing
  pattern); direct `prisma` writes are used only for **fixture seeding** (second users, bulk notes,
  timestamp backdating), never to fabricate a logged-in session.

## 11. Quality Gates (must pass before `/tasks` execution is considered complete)

1. `pnpm turbo run build` — `0` errors (no product code changed, so this validates the workspace still
   builds cleanly; not expected to fail).
2. `pnpm turbo run lint -- --max-warnings 0` — new spec files must pass the existing ESLint config
   unchanged (no new lint rule overrides).
3. `pnpm turbo run typecheck` — `tsc --noEmit`, `0` static errors across the 6 new/1 edited files.
4. `pnpm --filter @apps/web exec playwright test` — all new specs plus the existing 3 (`auth-journey`,
   `password-reset-journey`, `route-guard`) green against `notes_app_test`, run sequentially
   (`workers: 1`) exactly as `playwright.config.ts` already mandates. Coverage in the `--coverage`
   Vitest sense (`CLAUDE.md §6`) does not apply to Playwright E2E specs themselves — the ≥80% bar is
   satisfied here by FRS-requirement traceability (every `#### Scenario:` in `specs/e2e/spec.md` maps to
   at least one `test()`), not a line-coverage percentage.

---

Waiting for explicit `APPROVED` before proceeding to `/tasks`.
