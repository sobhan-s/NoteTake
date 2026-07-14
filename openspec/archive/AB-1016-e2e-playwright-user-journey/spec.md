# Spec Delta — AB-1016: E2E — Playwright Full User Journey

Domain: `e2e`. Target: Assignment Definition-of-Done + `docs/FRS.md` §1–§8a in full (`[SDS §1.5
Test Database Isolation Contract, SDS §7 Route Matrix]`) — the end-to-end Playwright coverage of
every feature already shipped by `AB-1002`–`AB-1015`, exercised through the real browser UI against
the real API and an isolated `notes_app_test` database.

## Executive Summary

`AB-1010` bootstrapped the Playwright infrastructure (`apps/web/playwright.config.ts`,
`apps/web/e2e/helpers/db.ts`) and shipped three specs as an incidental side-effect of building the
auth pages: `auth-journey.spec.ts` (register→verify→login→`/notes`→logout),
`password-reset-journey.spec.ts` (forgot→reset→forced re-login), and `route-guard.spec.ts`
(unauthenticated redirect + `?next=` preservation). Those three files already satisfy `FRS §1.1–1.4`
and `FRS-1.5` end-to-end and are **not** re-authored by this ticket. Every other feature —
notes CRUD + two-stage Trash (`FRS §2`), tags + Fly Tags (`FRS §3`), full-text search (`FRS §4`),
sharing + atomic view counts (`FRS §5`), version history (`FRS §6`), and the cross-cutting/cleanup
guarantees (`FRS §8, §8a`) — has zero Playwright coverage today, despite each backend/frontend
ticket having its own `supertest`/`vitest` coverage. This ticket closes that gap with one Playwright
spec file per feature domain plus a single capstone `full-journey.spec.ts` that chains every feature
together in one continuous authenticated session, satisfying the Assignment's Definition-of-Done
requirement for a complete end-to-end user journey. No product code in `apps/api`, `apps/web`, or
`packages/shared` changes as part of this ticket — it is test-authorship only against the existing,
already-implemented contract. If implementation surfaces a genuine product bug, it is logged in
`review-log.md` and fixed as a minimal, separately-justified patch, not silently folded into scope.

## Objective

Prove, by driving the real `apps/web` UI in a real browser against the real `apps/api` server and an
isolated `notes_app_test` Postgres 16 database, that a user can complete the full note-taking
lifecycle — create, tag, search, share, version, trash, restore, and permanently delete notes — with
every FRS-mandated guarantee (ownership isolation, soft-delete visibility rules, atomic share-link
view counting, append-only version history, server-side-only filtering) holding under real HTTP/DB
conditions, not just mocked unit assumptions.

## Target Requirements

Already satisfied by existing `AB-1010` specs (cited for traceability, **not** re-tested by this
ticket): `FRS-1.1.1–1.1.5`, `FRS-1.2.1–1.2.5`, `FRS-1.3.1–1.3.5`, `FRS-1.4.1`, `FRS-1.5.1–1.5.6`.

New coverage this ticket adds:

- `FRS-2.1.1–2.1.6` — authenticated create/update with title/body caps (`200`/`100,000` chars) and
  empty/whitespace-title rejection enforced server-side even if a crafted request bypasses the
  frontend form.
- `FRS-2.2.1–2.2.8` — Stage 1 delete (`deletedAt` set, restorable 30 days), Stage 2 invisibility
  (day 31+, still present in DB), permanent purge state (day 61+), and "delete forever" requiring
  explicit confirmation (`docs/ux.md §5`). Editing a Stage-1 note directly (without restoring first)
  SHALL be rejected `404 NOTE_NOT_FOUND` (the actual repository behavior — standard reads enforce
  `deletedAt IS NULL` per `apps/api/CLAUDE.md`; there is no separate `NOTE_TRASHED` error code in
  `packages/shared/src/constants/api-error-codes.constant.ts` today, so the test asserts the real
  `NOTE_NOT_FOUND` code, not the aspirational one named in `AGENTS.md §8`).
- `FRS-2.2.4` — trashing a note breaks its share link immediately, re-verified live per access (not
  merely at delete time); restoring the note does **not** resurrect the old link.
- `FRS-2.3.1–2.3.6` — default/max page size, 3-field sort × 2 directions, `tagMode` default `ALL`
  vs explicit `ANY`, stable `createdAt desc` tiebreaker across repeated calls, combined query+tag
  filter in one request, and the Trash view's independent 30-day window enforcement with zero
  sort/page-size controls.
- `FRS-3.1–3.4` — tag create/rename/recolor/delete scoped to the owning user, inline Fly Tag creation
  from **both** the note editor and the search/filter bar, live note-count updates as notes are
  trashed/restored/tagged/untagged, case-insensitive duplicate-name rejection (`409 TAG_NAME_CONFLICT`),
  and cross-user tag delete returning `404 TAG_NOT_FOUND`.
- `FRS-4.1–4.5` — full-text search over title+body scoped to the caller's own non-deleted notes,
  visible `[[[MARK]]]`/`[[[MARK_END]]]` highlight rendering in the results list (not just present in
  the raw API JSON, per `FRS-7.3`), same pagination rules as the notes list, empty/whitespace query
  rejected as a validation error (not "match everything"), and safe handling of special-character
  queries.
- `FRS-5.1–5.6` — generate link (default 7d, custom 1–30d, out-of-range rejected), manual revoke,
  **atomic concurrent view-count increments with zero lost updates** (explicit concurrency test per
  the FRS-5.4/AB-1008 Acceptance Criteria's own "verify with a concurrency test, not just sequential
  calls" instruction), one atomic query gating both the increment and the live trash/expiry check,
  strictly read-only public rendering with no edit affordance/viewer-identity/other-notes leakage, and
  byte-identical "no longer available" presentation across expired/revoked/trashed causes.
- `FRS-6.1–6.5` — explicit save always creates a version immediately even inside the 5-minute
  autosave-throttle window; autosave-triggered versions capped at 1 per 5 minutes per note; version
  list reverse-chronological; restore appends a new version without touching or deleting any prior
  version (queryable after restore); versions older than 90 days are purge-eligible while the current
  live version is exempt regardless of age; viewing a purged version renders "no longer available";
  restoring on a since-trashed note is rejected.
- `FRS-7.1–7.5` — background autosave requires no manual save click; saving/saved/error indicator
  states are visibly distinct; version preview-before-restore with an explicit confirmation step
  (never single-click); responsive usability is not re-verified per-breakpoint in this ticket (already
  covered by each frontend ticket's own manual/AC verification) except where the full-journey test
  incidentally exercises the default desktop viewport.
- `FRS-8.1, FRS-8.4` — no read endpoint or share-link path returns soft-deleted content via any
  request parameter; every sort/filter/tag/query change in the notes list and search page issues a
  **new** network request, verified via a Playwright route/request-count spy, never a local
  re-slice of an already-fetched page.
- `FRS-8a.1–8a.5` — the shared cleanup guarantee is exercised at the E2E layer only for the
  user-visible edge (Stage-2 invisibility, purge-eligible version invisibility) via deterministic
  timestamp seeding (see Architectural Mappings); the nightly cron job's own execution and its
  five-pass idempotency are `apps/api` `supertest`/`vitest` concerns (`AB-1004`/`AB-1009`,
  unchanged) and are explicitly **not** re-run or re-verified by Playwright, which has no mechanism to
  invoke `cleanup.job.ts` directly.

## Architectural Mappings

- `SDS §1.5 (Test Database Isolation Contract)` — every new spec file imports the existing
  `apps/web/e2e/helpers/db.ts` (`prisma`, `resetTestDatabase`, `assertTestDatabaseGuard`), which
  already throws a `FATAL SAFETY BREAK` unless `DATABASE_URL` includes `notes_app_test`. No new spec
  file talks to Postgres directly without routing through this helper.
- `apps/web/playwright.config.ts` — unchanged; all new specs run under the existing single
  `chromium` project, `workers: 1`, `fullyParallel: false` configuration (deterministic ordering
  against a shared test DB, matching the existing three specs' assumptions).
- **Deterministic time-boundary seeding (new helper functions in `apps/web/e2e/helpers/db.ts`)** —
  Stage-2 (`FRS-2.2.5`, day 31+), Stage-2-purge-eligible (`FRS-2.2.6`, day 61+), and version-retention
  (`FRS-6.5`, day 91+) boundaries are never awaited in real time. Each new boundary scenario performs
  the real user action first (trash a note, save a version) through the UI/API, then calls a new
  Prisma-backed helper (e.g. `backdateNoteDeletedAt(noteId, daysAgo)`,
  `backdateNoteVersionCreatedAt(versionId, daysAgo)`) to directly `UPDATE` the row's timestamp column
  in `notes_app_test` before asserting the resulting visibility/rejection behavior — mirroring how
  `apps/api/tests/contract/cleanup.*.test.ts` already seeds backdated rows for the same guarantee at
  the `supertest` layer.
- **Atomic view-count concurrency test** — uses Playwright's `request.newContext()`
  (`APIRequestContext`, not the browser page) to fire `N` (e.g. 10) parallel unauthenticated
  `GET /api/v1/public/share/:token` calls via `Promise.all`, then asserts the final `viewCount`
  (fetched by the owner via `GET /api/v1/notes/:id/share`) equals exactly `N` — directly exercising
  the `SDS §2.2 (3)` atomic `UPDATE ... RETURNING` query's race-safety guarantee end-to-end, not
  through a mocked or sequential call.
- `SDS §7 (Route Matrix)` — every new spec asserts against the documented request/response DTO
  shapes (`NoteResponseDto`, `TagResponseDto`, `ShareLinkResponseDto`, `PublicNoteResponseDto`,
  `NoteVersionSummaryDto`, `NoteVersionResponseDto`) exactly as already defined in
  `packages/shared/src/types/`; no new DTO or schema is introduced.
- `apps/web/src/components/notes/`, `.../search/`, `.../sharing/`, `.../versions/` — new specs drive
  the already-shipped components (`NotesList`, `NoteEditor`, `TagCombobox`/Fly Tag inputs,
  `SearchPage`/`SnippetHighlight`, `ShareModal`, `ShareViewPage`, `VersionHistoryDrawer`,
  `VersionPreviewModal`) purely through their public UI surface (clicks, form fills, visible text
  assertions) — no direct component/hook unit invocation, consistent with Playwright's role as the
  outermost, most-integrated test tier.
- `docs/ux.md §1, §3, §5` — confirmation-modal assertions (destructive actions never single-click),
  empty-state assertions (`EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN`), and loading-state assertions are
  black-box UI checks (visible text/attribute presence), not implementation-detail checks.

## Out of Scope

- Re-authoring or modifying `auth-journey.spec.ts`, `password-reset-journey.spec.ts`, or
  `route-guard.spec.ts` — already-shipped, already-passing coverage of `FRS §1`.
- Any new `apps/api` `supertest`/`vitest` unit or contract test — those already exist per ticket
  (`AB-1002`–`AB-1009`) and are unchanged; this ticket is Playwright-only.
- Directly invoking or unit-testing `apps/api/src/jobs/cleanup.job.ts`'s cron execution or its
  five-pass idempotency — that is `AB-1004`/`AB-1009`'s existing `supertest` concern (`FRS-8a`); E2E
  only observes the user-visible _result_ of a state that would exist post-purge, via timestamp
  seeding, never by running the job itself.
- Cross-browser matrices (Firefox/WebKit/mobile viewports) — `playwright.config.ts` defines a single
  `chromium` desktop project today; adding projects is a separate, explicitly out-of-scope
  infrastructure decision.
- Any product code change in `apps/api`, `apps/web`, or `packages/shared` — pure test authorship
  against the existing contract (see Executive Summary for the bug-discovery exception).
- Load/performance testing beyond the single specified `FRS-5.4` concurrency assertion — no
  general-purpose load-testing harness is introduced.
- Real email delivery, OAuth/social login, file/image attachments, note folders, offline/local-first
  editing, or any other item on the FRS §9 Master Out-of-Scope List — unchanged, not exercised.

---

## ADDED Requirements

### Requirement: Notes CRUD & Two-Stage Trash E2E Coverage (`apps/web/e2e/notes-crud-trash.spec.ts`)

A new spec file SHALL exercise note creation, update, ownership isolation, and both Trash stages
end-to-end.

#### Scenario: Create, read, and update respecting length caps

- **WHEN** an authenticated user creates a note with a valid title/body, then updates its title
  and/or body
- **THEN** the UI SHALL reflect the persisted `title`/`body`/`updatedAt` after each save
- **AND** submitting a title exceeding `APP_LIMITS.NOTE_TITLE_MAX_CHARS` or a body exceeding
  `APP_LIMITS.NOTE_BODY_MAX_CHARS` via a direct API call (bypassing any frontend `maxLength` guard)
  SHALL be rejected `400`/`422` naming the offending field, proving server-side enforcement
  independent of the frontend (`FRS-2.1.6`)

#### Scenario: Empty or whitespace-only title rejected

- **WHEN** a create/update request is submitted with a title of `""` or `"   "`
- **THEN** the request SHALL be rejected naming `title`, and no note/update is persisted
  (`FRS-2.1.5`)

#### Scenario: Cross-user access returns not-found, never forbidden

- **WHEN** User B attempts to `GET`/`PATCH`/`DELETE` a note ID owned by User A (via direct API call
  with User B's valid access token)
- **THEN** every such request SHALL return `404 NOTE_NOT_FOUND` — never `403` (`FRS-2.1.2`,
  `AGENTS.md §8`)

#### Scenario: Stage 1 delete, restorability, and direct-edit rejection

- **WHEN** the user deletes a note from the active list
- **THEN** it SHALL disappear from the active list immediately and appear in Trash
- **AND** attempting to `PATCH` that note's ID directly (without restoring first) SHALL return
  `404 NOTE_NOT_FOUND`
- **AND** clicking "Restore" from Trash within the 30-day window SHALL return it to the active list
  with its content unchanged

#### Scenario: Stage 2 invisibility (backdated, deterministic)

- **WHEN** a trashed note's `deletedAt` is backdated via the new `backdateNoteDeletedAt` helper to
  31 days ago
- **THEN** the note SHALL no longer appear in the Trash view (`GET /api/v1/notes/trash`)
- **AND** a direct restore attempt on that note ID SHALL return `404 NOTE_NOT_FOUND`
- **AND** the row SHALL still exist in the `notes_app_test` database (queried directly via `prisma`),
  proving Stage 2 is audit-retained, not deleted (`FRS-2.2.5, FRS-2.2.6`)

#### Scenario: "Delete forever" requires explicit confirmation and is immediate

- **WHEN** the user clicks "Delete Forever" on a Stage-1 trashed note
- **THEN** a confirmation modal SHALL appear (`UI_COPY.PERMANENT_DELETE_CONFIRM`) with "Cancel"
  default-focused
- **AND** confirming SHALL immediately and permanently remove the note (`DELETE
/api/v1/notes/:id/permanent`), with no further restore option available (`FRS-2.2.8`)

#### Scenario: Trashing a note breaks its share link live, and restore does not resurrect it

- **WHEN** a note with an active share link is trashed
- **THEN** the public share URL SHALL immediately render "no longer available" on next visit — not
  merely after any scheduled job — and the link's `viewCount` SHALL NOT increment while trashed
  (`FRS-2.2.4`)
- **AND** after restoring the note, the old share token SHALL remain permanently unavailable; only
  generating a brand-new link via `ShareModal` SHALL work (`FRS-2.2.4`, no-resurrection rule)

### Requirement: Pagination, Sorting, and Tag-Filter E2E Coverage (`apps/web/e2e/notes-crud-trash.spec.ts`)

The note list specification SHALL verify pagination limits, tiebreaker ordering across pages, tag filter modes (`ALL`/`ANY`), and fresh network refetches.

#### Scenario: Default/max page size and stable secondary sort

- **WHEN** more than `APP_LIMITS.PAGE_SIZE_DEFAULT` notes exist with intentionally-tied primary sort
  values (e.g. identical `title`)
- **THEN** repeated/paginated `GET /api/v1/notes` calls SHALL return tied rows in a stable order
  driven by the `createdAt desc` tiebreaker (`FRS-2.3.4`), and requesting `limit` above
  `APP_LIMITS.PAGE_SIZE_MAX` SHALL be rejected

#### Scenario: tagMode defaults to ALL, explicit ANY works, invalid value rejected

- **WHEN** the user filters by two tags with no explicit `tagMode`
- **THEN** the request SHALL apply `AND` semantics (`FRS-2.3.3` default)
- **AND** explicitly selecting "Any" in the filter UI SHALL switch to `OR` semantics, changing the
  visible result set accordingly
- **AND** a crafted request with an invalid `tagMode` value SHALL be rejected, listing `ALL`/`ANY`

#### Scenario: Every filter/sort/query change issues a fresh network request

- **WHEN** the user changes sort field, sort direction, tag filter, or search query on the notes list
- **THEN** a Playwright request-count spy on `GET /api/v1/notes` SHALL record exactly one new request
  per change — proving no client-side re-sort/re-filter of a cached page (`FRS-8.4`)

### Requirement: Tags & Fly Tag E2E Coverage (`apps/web/e2e/tags.spec.ts`)

The specification SHALL verify tag management operations, inline Fly Tag creation affordances from editor and search bar, live note counting, and name uniqueness/ownership isolation.

#### Scenario: Create, rename, recolor, delete scoped to owner

- **WHEN** the user creates, renames, recolors, and deletes a tag
- **THEN** each operation SHALL succeed and be reflected in the tag list, and deleting the tag SHALL
  detach it from any notes without deleting those notes (`FRS-3.1, FRS-3.3`)

#### Scenario: Fly Tag creation from both the editor and the search/filter bar

- **WHEN** the user types a novel tag name inside the note editor's tag input and selects "Create
  new tag"
- **THEN** the tag SHALL be created and immediately attached to the note, with no navigation to a
  separate tag-management page
- **AND** performing the equivalent "create new tag" action from the search/filter bar's tag
  combobox SHALL likewise succeed inline (`FRS-3.1`)

#### Scenario: Live note count updates

- **WHEN** a tag is attached to a note, then that note is trashed, then restored, then the tag is
  detached
- **THEN** the tag's displayed note count SHALL update after each step to reflect only non-deleted,
  currently-tagged notes (`FRS-3.2`)

#### Scenario: Duplicate name and cross-user delete rejected

- **WHEN** the user attempts to create a second tag with the same name in a different case (e.g.
  `"work"` vs `"Work"`)
- **THEN** the request SHALL be rejected `409 TAG_NAME_CONFLICT` (`FRS-3.4`)
- **AND** User B attempting to delete a tag ID owned by User A SHALL receive `404 TAG_NOT_FOUND`

### Requirement: Full-Text Search E2E Coverage (`apps/web/e2e/search.spec.ts`)

The search feature SHALL verify user-scoped note matching, DOM-level `<mark>` element highlighting, validation rules for queries, and exact request spying per filter change.

#### Scenario: Search returns only the caller's own notes, with visible highlights

- **WHEN** two users each have a note containing the same keyword, and User A searches for that
  keyword
- **THEN** results SHALL include only User A's matching note
- **AND** the matched keyword SHALL render visibly wrapped in a highlight element in the results list
  (asserted via the rendered DOM, not the raw API JSON) — `FRS-4.2, FRS-7.3`

#### Scenario: Empty/whitespace query rejected, special characters handled safely

- **WHEN** the user submits an empty or whitespace-only search query
- **THEN** the request SHALL be rejected as a validation error, not treated as "match everything"
- **AND** a query containing SQL-special characters (e.g. `%`, `_`, `'`, `--`) SHALL return a safe,
  correct (possibly empty) result set with no error and no injection side-effect (`FRS-4.1` Error
  Scenarios)

#### Scenario: Search pagination and every query change refetches

- **WHEN** the user changes the search query text
- **THEN** each change SHALL trigger a fresh `GET /api/v1/search` request (request-count spy,
  `FRS-8.4`), and results SHALL respect the same page-size rules as the notes list (`FRS-4.3`)

### Requirement: Sharing & Atomic View-Count E2E Coverage (`apps/web/e2e/sharing.spec.ts`)

The sharing and public view specification SHALL verify link generation expiration bounds, immediate manual revocation, atomic concurrency-safe view counting without lost updates, and read-only isolation.

#### Scenario: Generate with default and custom expiry, reject out-of-range

- **WHEN** the owner generates a share link with the default expiry, then generates a link with a
  custom `1`–`30` day value
- **THEN** both SHALL succeed with the expected `expiresAt`
- **AND** attempting `expiresInDays: 0` or `31` via direct API call SHALL be rejected (`FRS-5.2`)

#### Scenario: Manual revoke is immediate

- **WHEN** the owner revokes an active link
- **THEN** the public URL SHALL immediately render "no longer available" on next visit (`FRS-5.3`)

#### Scenario: Concurrent public visits are all counted atomically

- **WHEN** 10 concurrent unauthenticated `GET /api/v1/public/share/:token` requests are fired via
  `Promise.all` against one active link
- **THEN** the owner-visible `viewCount` (`GET /api/v1/notes/:id/share`) SHALL equal exactly `10`
  afterward — proving no lost increments under concurrent load (`FRS-5.4`)

#### Scenario: Creating a link for an already-trashed note is rejected

- **WHEN** the owner attempts `POST /api/v1/notes/:id/share` for a note currently in Trash
- **THEN** the request SHALL be rejected (`FRS-5.6` Error Scenarios)

#### Scenario: Expired, revoked, and trashed links render an identical unavailable state

- **WHEN** three separate links are, respectively, allowed to expire (backdated `expiresAt` via the
  DB helper), manually revoked, and orphaned by trashing their note
- **THEN** all three public URLs SHALL render byte-identical "no longer available" content — the
  test diffs the three rendered pages to confirm zero distinguishing detail leaks (`FRS-5.6`)

#### Scenario: Public view is strictly read-only

- **WHEN** an anonymous browser context (no auth cookie/token) visits a valid share URL
- **THEN** the page SHALL render the note content with no edit control, no owner-identity text, and
  no link/navigation to any other note (`FRS-5.5`)

### Requirement: Version History E2E Coverage (`apps/web/e2e/version-history.spec.ts`)

The version history specification SHALL verify explicit save checkpoints, debounced autosave throttling, reverse-chronological presentation, read-only preview before confirmation, append-only restoration, and purge eligibility.

#### Scenario: Explicit save always versions; autosave is throttled

- **WHEN** the user makes an explicit save (e.g. `Ctrl+S`) twice within 5 minutes
- **THEN** both SHALL create a new version immediately, bypassing the throttle
- **AND** two background-autosave-triggered edits occurring within the same 5-minute window SHALL
  produce at most one autosave-originated version — asserted by comparing the version list length
  before/after (`FRS-6.1`)

#### Scenario: List is reverse-chronological; preview before restore; restore is append-only

- **WHEN** the user opens the Version History drawer, selects an older version, previews its full
  read-only content, then confirms "Restore"
- **THEN** the list SHALL render newest-first with correct timestamps (`FRS-6.2`)
- **AND** the preview SHALL show the selected version's full content before any mutating action is
  possible, gated by an explicit confirm modal — never a single click (`FRS-6.3, FRS-7.4`)
- **AND** after confirming, the editor SHALL reflect the restored content, a brand-new version SHALL
  appear at the top of the list, and every version that existed before the restore SHALL remain
  present and individually viewable (`FRS-6.4`)

#### Scenario: Versions older than 90 days are purge-eligible; live version is exempt (backdated)

- **WHEN** a non-current version's `createdAt` is backdated via `backdateNoteVersionCreatedAt` to 91
  days ago, while the note's current live version remains untouched
- **THEN** attempting to view that backdated version by ID SHALL render "no longer available"
  (simulating post-purge state) while the live version and all other still-fresh versions remain
  fully viewable (`FRS-6.5`)

#### Scenario: Restoring on a since-trashed note is rejected

- **WHEN** a note is trashed in one browser tab and a restore-version action for that note is
  attempted from another already-open tab
- **THEN** the restore request SHALL be rejected `404`, and the frontend SHALL surface this via
  `mapApiError`, not a silent failure (`FRS-6` Error Scenarios)

### Requirement: Cross-Feature Full-Journey Capstone Test (`apps/web/e2e/full-journey.spec.ts`)

A single continuous-session spec SHALL chain every feature domain together in one narrative,
satisfying the Assignment's end-to-end Definition-of-Done in one file that a reviewer can read
top-to-bottom as the product's complete story.

#### Scenario: One continuous authenticated journey

- **WHEN** the test registers a new user, verifies via console-logged OTP, logs in, creates a note,
  attaches a newly-created Fly Tag, waits past the autosave debounce to see the "Saved" indicator,
  performs an explicit save, opens Version History and confirms the version exists, searches for the
  note by keyword and sees it highlighted in results, generates a share link and confirms the public
  view renders read-only content, trashes the note and confirms the share link breaks immediately,
  restores the note from Trash, edits it again producing a second version, restores the first
  version and confirms the content reverts while the second version remains queryable, and finally
  permanently deletes a separate throwaway note with explicit confirmation before logging out
- **THEN** every step SHALL succeed against the real `apps/api` server and `notes_app_test` database,
  with no step silently skipped or mocked — this is the single test whose pass/fail is the ticket's
  primary Definition-of-Done signal

### Requirement: Deterministic Time-Boundary Seeding Helpers (`apps/web/e2e/helpers/db.ts`)

The existing helper module SHALL gain new exported functions so time-dependent boundary scenarios
above never depend on real wall-clock waiting.

#### Scenario: Backdating helpers exist and are guarded by the same safety check

- **WHEN** `backdateNoteDeletedAt(noteId, daysAgo)`, `backdateNoteVersionCreatedAt(versionId,
daysAgo)`, and `backdateShareLinkExpiry(shareLinkId, daysAgo)` are called
- **THEN** each SHALL perform a direct `prisma.<model>.update` against `notes_app_test` only,
  inheriting the existing module-level `DATABASE_URL` safety guard (no new bypass path is introduced)

---

## Error Scenarios (this ticket's exact E2E assertions)

| Scenario                                                 | Expected E2E-observable behavior                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Direct edit of a Stage-1 trashed note (no restore first) | `404 NOTE_NOT_FOUND`                                                |
| Cross-user note/tag access or mutation                   | `404 NOTE_NOT_FOUND` / `404 TAG_NOT_FOUND` — never `403`            |
| Stage-2 note (backdated 31+ days)                        | Invisible in Trash view; restore returns `404`; row still in DB     |
| Title/body over length cap via direct API call           | Rejected naming the field, even though frontend form would block it |
| Empty/whitespace title or search query                   | Rejected as validation error, not silently accepted                 |
| Duplicate tag name (any case)                            | `409 TAG_NAME_CONFLICT`                                             |
| Creating a share link for a trashed note                 | Rejected                                                            |
| Expired / revoked / trashed share link                   | Byte-identical "no longer available" page, cause never disclosed    |
| Viewing a purge-eligible (backdated 91+ day) version     | "no longer available"                                               |
| Restoring a version on a since-trashed note              | `404`, surfaced via `mapApiError`, no silent failure                |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria for `AB-1004`, `AB-1005`, `AB-1006`, `AB-1007`, `AB-1008`,
`AB-1009` (backend contracts, already implemented and already `supertest`-covered — this ticket adds
the missing browser-level E2E layer on top) and the cross-cutting `AB-1004/1009/1002/1003` cleanup
acceptance criteria (`FRS §8a`, exercised here only at the user-visible boundary via deterministic
seeding, per Out of Scope above), plus the Assignment's own Definition-of-Done requirement for one
complete end-to-end user journey.
