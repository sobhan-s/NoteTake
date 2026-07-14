# Sequenced Tasks for AB-1016-e2e-playwright-user-journey

Ticket ID `AB-1016-E2E-playwright-test` normalized to the existing change directory
`openspec/changes/AB-1016-e2e-playwright-user-journey/` (`[Rule 3]`) — `spec.md` and `plan.md`
already live there. Scope: **`E2E`** (ticket-ID range `AB-1016`).

Source documents read for this breakdown: `specs/e2e/spec.md`, `plan.md` (this change directory),
`docs/FRS.md` §2–§8a, `docs/SDS.md` §1.5/§2.2(3)/§7, `docs/ux.md` §1/§3/§5, `AGENTS.md`,
`apps/web/CLAUDE.md`.

## Phase 1 & 2 — N/A for This Ticket

Per `plan.md` §0 (Scope Confirmation): AB-1016 is **pure test-authorship**. It introduces zero
`packages/shared` schemas/DTOs/constants, zero `apps/api` repository/service/controller/router
code, and zero `apps/web/src` store/api/hooks/components/pages code — every contract this ticket
drives already shipped in `AB-1002`–`AB-1015`. There is nothing to place in Phase 1 (Foundation &
Shared Tier) or Phase 2 (Core Implementation) as defined by the standard template — those phases
are collapsed into the single "Test Helper Extension" phase below, since the _only_ new production
artifact this ticket adds is three helper functions in an existing test-support file. All Zod
schemas, controllers, and layering rules referenced by the standard checklist are verified
passively by the new specs, never re-implemented.

## Phase A: Test Helper Extension (`apps/web/e2e/helpers/db.ts`)

- [x] `apps/web/e2e/helpers/db.ts`: Add `backdateNoteDeletedAt(noteId, daysAgo)` — direct
      `prisma.note.update({ data: { deletedAt } })`, guarded by `assertTestDatabaseGuard()` as its
      first statement, matching `resetTestDatabase`'s existing pattern (`[FRS-2.2.5, FRS-2.2.6]`).
- [x] `apps/web/e2e/helpers/db.ts`: Add `backdateNoteVersionCreatedAt(versionId, daysAgo)` — direct
      `prisma.noteVersion.update({ data: { createdAt } })`, same guard pattern; document inline that
      the caller must never pass the row with the greatest `createdAt` for a given `noteId` (the
      implicit "live version," no `isCurrent` column exists) (`[FRS-6.5]`).
- [x] `apps/web/e2e/helpers/db.ts`: Add `backdateShareLinkExpiry(shareLinkId, daysAgo)` — direct
      `prisma.shareLink.update({ data: { expiresAt } })`, same guard pattern (`[FRS-5.6]`).
- [x] **Mandatory Phase A Checkpoint**: `pnpm turbo run lint -- --max-warnings 0` →
      `pnpm turbo run typecheck` (`tsc --noEmit`) on the edited file. No `build`/`test --coverage` gate
      yet — no spec consumes these helpers until Phase B.

## Phase B: `apps/web/e2e/notes-crud-trash.spec.ts` (new file)

_(Authored second per `plan.md` §9 — establishes the shared `captureAccessToken(page)` helper that
`sharing.spec.ts`'s concurrency test reuses in Phase D.)_

- [x] Author `captureAccessToken(page)` helper (intercepts an outgoing request's `Authorization`
      header via `page.route`/`page.waitForRequest` to extract the bearer token issued at login) inside
      this file, exported for reuse by `sharing.spec.ts` (`[FRS-1.3.5]` — passive verification only, no
      token ever read from storage).
- [x] Scenario: create/update respecting `APP_LIMITS.NOTE_TITLE_MAX_CHARS`/`NOTE_BODY_MAX_CHARS`,
      over-cap rejected via direct API call bypassing the frontend guard (`[FRS-2.1.6]`).
- [x] Scenario: empty/whitespace-only title (`""`, `"   "`) rejected on create and update, no
      persistence (`[FRS-2.1.5]`).
- [x] Scenario: cross-user `GET`/`PATCH`/`DELETE` on another user's note ID returns
      `404 NOTE_NOT_FOUND`, never `403` — seed User B directly via `prisma.user.create` +
      `prisma.note.create` (`[FRS-2.1.2]`).
- [x] Scenario: Stage 1 delete → disappears from active list, appears in Trash; direct `PATCH` on
      that ID returns `404 NOTE_NOT_FOUND`; "Restore Note" confirm returns it unchanged
      (`[FRS-2.2.1, FRS-2.2.2, FRS-2.2.3]`).
- [x] Scenario: Stage 2 invisibility — `backdateNoteDeletedAt(noteId, 31)`, absent from Trash view,
      restore attempt `404`, row still present via direct `prisma.note.findUnique`
      (`[FRS-2.2.5, FRS-2.2.6]`).
- [x] Scenario: "Delete Forever" — confirmation modal with "Cancel" default-focused
      (`toHaveFocus` check), confirming removes the note immediately with no restore affordance
      remaining (`[FRS-2.2.8]`).
- [x] Scenario: trashing a note breaks its share link immediately (fresh unauthenticated
      `browser.newContext()` visit → unavailable, `viewCount` frozen); restoring the note does not
      resurrect the old token; a brand-new `ShareModal` link produces a different token
      (`[FRS-2.2.4]`).
- [x] Scenario: seed `APP_LIMITS.PAGE_SIZE_DEFAULT + 1` notes via `prisma.note.createMany` with tied
      `title` values and staggered `createdAt`; assert stable `createdAt desc` tiebreaker across
      paginated calls; `limit` above `APP_LIMITS.PAGE_SIZE_MAX` rejected (`[FRS-2.3.1, FRS-2.3.4]`).
- [x] Scenario: `tagMode` defaults to `ALL` with no explicit param, explicit `ANY` switches to `OR`
      semantics via `TagFilterControl`'s mode switch, invalid `tagMode` rejected via direct API call
      only (`[FRS-2.3.3]`).
- [x] Scenario: `page.on("request", ...)` spy on `GET /api/v1/notes*`, asserting exactly one new
      request per sort/tag/query change (`[FRS-8.4]`).
- [x] **Mandatory Phase B Checkpoint**: `pnpm --filter @apps/web exec playwright test
notes-crud-trash.spec.ts` green against `notes_app_test`, then
      `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase C: Independent Domain Specs (any order — `tags`, `search`, `sharing`, `version-history`)

### `apps/web/e2e/tags.spec.ts` (new file)

- [x] Scenario: create/rename/recolor/delete a tag scoped to the owning user; delete detaches from
      notes without deleting those notes (`[FRS-3.1, FRS-3.3]`).
- [x] Scenario: Fly Tag creation from the note editor's `TagCombobox` (`aria-label="Add a tag"`)
      and, separately, from the search/filter bar's tag combobox — both attach inline with no
      navigation to a tag-management page (`[FRS-3.1]`).
- [x] Scenario: live note count updates after attach → trash → restore → detach, in one continuous
      session (`[FRS-3.2]`).
- [x] Scenario: duplicate tag name differing only by case rejected `409 TAG_NAME_CONFLICT`;
      cross-user delete (seed via `prisma.tag.create`) rejected `404 TAG_NOT_FOUND` (`[FRS-3.4]`).
- [x] **Mandatory Checkpoint**: `pnpm --filter @apps/web exec playwright test tags.spec.ts` green.

### `apps/web/e2e/search.spec.ts` (new file)

- [x] Scenario: two users share a keyword; User A's search returns only User A's note, with the
      matched term visibly wrapped in a highlight element in the rendered results DOM (not raw JSON)
      (`[FRS-4.2, FRS-7.3]`).
- [x] Scenario: empty/whitespace-only query rejected as a validation error via `SearchInput`
      (`aria-label="Search notes"`), not "match everything"; SQL-special-character query (`%`, `_`,
      `'`, `--`) returns a safe result with no error/injection side-effect (`[FRS-4.1]`).
- [x] Scenario: request-count spy on `GET /api/v1/search*`, one fresh request per query change;
      same pagination rules as the notes list (`[FRS-4.3, FRS-8.4]`).
- [x] **Mandatory Checkpoint**: `pnpm --filter @apps/web exec playwright test search.spec.ts`
      green.

### `apps/web/e2e/sharing.spec.ts` (new file)

- [x] Scenario: default (7d) and custom (1–30d) expiry generate successfully via `ShareModal`;
      `expiresInDays: 0` or `31` rejected via direct API call (HTML `min`/`max` blocks UI submission)
      (`[FRS-5.2]`).
- [x] Scenario: manual revoke (`"Revoke"` → `ConfirmModal` `heading="Revoke Public Share Link"` →
      confirm) makes the public URL immediately render unavailable (`[FRS-5.3]`).
- [x] Scenario: import `captureAccessToken(page)` from Phase B; fire 10 concurrent unauthenticated
      `GET /api/v1/public/share/:token` via `request.newContext()` + `Promise.all`; assert owner-visible
      `viewCount === 10` exactly via `GET /api/v1/notes/:id/share` (`[FRS-5.4]`).
- [x] Scenario: `POST /api/v1/notes/:id/share` on a trashed note rejected — confirm exact status
      against `share.service.ts` at implementation time (`[FRS-5.6]`).
- [x] Scenario: three links — one via `backdateShareLinkExpiry`, one via UI revoke, one via trashing
      the note — render byte-identical "no longer available" content across separate fresh contexts
      (`[FRS-5.6]`).
- [x] Scenario: anonymous context on a valid share URL shows no edit control, no owner-identity
      text, no navigation to any other note (`[FRS-5.5]`).
- [x] **Mandatory Checkpoint**: `pnpm --filter @apps/web exec playwright test sharing.spec.ts`
      green.

### `apps/web/e2e/version-history.spec.ts` (new file)

- [x] Scenario: two explicit saves (`Ctrl+S`) within 5 minutes each create a version immediately;
      two autosave-eligible edits within the same `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES` window
      produce at most one additional version, compared via `VersionHistoryDrawer` list length
      (`[FRS-6.1]`).
- [x] Scenario: drawer renders newest-first; selecting an older entry shows full read-only preview
      before any mutating control is reachable; "Restore this version" → `ConfirmModal`
      (`heading="Restore Version"`) → confirm updates the editor, appends a new version at the top, and
      leaves prior list length at `original + 1` (`[FRS-6.2, FRS-6.3, FRS-6.4, FRS-7.4]`).
- [x] Scenario: create note, save version A then version B (live); `backdateNoteVersionCreatedAt`
      version A only to 91 days ago; version A renders "no longer available," version B and other fresh
      versions remain viewable (`[FRS-6.5]`).
- [x] Scenario: two `browser.newContext()`/`page` pairs sharing one login; trash the note from tab
      A; restore-version attempt from tab B rejected `404`, surfaced via the `mapApiError` toast path
      (`[FRS-6 Error Scenarios]`).
- [x] **Mandatory Checkpoint**: `pnpm --filter @apps/web exec playwright test
version-history.spec.ts` green.

## Phase D: Capstone — `apps/web/e2e/full-journey.spec.ts` (new file)

_(Authored last per `plan.md` §9 — composes only mechanics already proven independently above; no
new mechanics introduced.)_

- [x] Single `test()` (not multiple `test()`s under one `describe`): register → OTP-verify → login →
      create note → attach Fly Tag → observe autosave "Saved" indicator → explicit save → open Version
      History and confirm the version exists → search by keyword and see it highlighted → generate a
      share link and confirm read-only public rendering → trash the note and confirm the share link
      breaks immediately → restore from Trash → edit again (second version) → restore the first version
      and confirm content reverts while the second version remains queryable → permanently delete a
      separate throwaway note with explicit confirmation → log out (`[Assignment Definition-of-Done,
FRS-2.1–FRS-2.3, FRS-3, FRS-4, FRS-5, FRS-6, FRS-7]`).
- [x] **Mandatory Checkpoint**: `pnpm --filter @apps/web exec playwright test full-journey.spec.ts`
      green.

## Phase E: OpenSpec Compliance Audit & Final Quality Gates

- [x] Run `pnpm turbo run build` — `0` errors (validates the workspace still builds cleanly; no
      product code changed by this ticket).
- [x] Run `pnpm turbo run lint -- --max-warnings 0` across all 6 new + 1 edited file.
- [x] Run `pnpm turbo run typecheck` (`tsc --noEmit`) — `0` static errors.
- [x] Run `pnpm --filter @apps/web exec playwright test` — all 6 new specs **plus** the existing 3
      (`auth-journey.spec.ts`, `password-reset-journey.spec.ts`, `route-guard.spec.ts`) green against
      `notes_app_test`, sequentially (`workers: 1`). `--coverage` (Vitest sense) does not apply to
      Playwright E2E — the bar is FRS-scenario traceability: every `#### Scenario:` in `specs/e2e/spec.md`
      maps to ≥1 `test()`.
- [x] Run `openspec validate` against `specs/e2e/spec.md`.
- [x] Run `/review AB-1016-e2e-playwright-user-journey` (`reviewer` agent — checks FRS/SDS coverage,
      out-of-scope violations, real-auth-only compliance, `APP_LIMITS` literal-hardcoding).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to
      `/pr AB-1016-e2e-playwright-user-journey` (`openspec archive` occurs there, not here).

---

Saved to: `openspec/changes/AB-1016-e2e-playwright-user-journey/tasks.md`

Waiting for explicit `APPROVED` before `/implement` begins.
