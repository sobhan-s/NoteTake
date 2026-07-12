# Spec Delta — AB-1008: Sharing — Generate Link, Revoke, Public Access, Atomic View Count

Domain: `sharing`. Target: `FRS-5.1–5.6` (public read-only share links, atomic view counting, live
trash/expiry enforcement), plus the `hasActiveShareLink` slice of `FRS-7.2` (at-a-glance shared
status on the notes list/detail).

## Executive Summary

Adds the full share-link surface for notes: `POST /api/v1/notes/:id/share` (generate — idempotent
get-or-create, see Resolved Decision #1), `GET /api/v1/notes/:id/share` (fetch the note's current
active link, new endpoint not present in `SDS.md`'s route matrix, see Resolved Decision #2),
`DELETE /api/v1/notes/:id/share` (revoke), and the unauthenticated
`GET /api/v1/public/share/:token` (atomic view-increment + live trash/expiry check, `FRS-5.4,
FRS-2.2.4`). The `ShareLink` Prisma model, its indexes, and its `onDelete: Cascade` relation to
`Note` already exist from `AB-1001`'s initial migration (`20260710124549_init`) — **this ticket adds
no migration**, only `apps/api` endpoints, their `packages/shared` contracts, a one-boolean addition
to `NoteResponseDto`, and one small amendment to `NoteService.softDeleteNote` (Resolved Decision #3).
Frontend share modal / active-link UI (`FRS §7.2`) is ticket **AB-1014** — out of scope here beyond
the `hasActiveShareLink` DTO field it will consume.

## Architectural Mapping (`SDS.md`)

- §2.1 `ShareLink` model (`token @db.VarChar(64)`, `viewCount`, `expiresAt`, `revokedAt`,
  `@@index([token, revokedAt, expiresAt])`) — already provisioned, reused as-is, zero migration.
- §2.2 (3) Atomic Share-Link View Increment `$queryRaw` — adopted verbatim as the sole mechanism
  backing `GET /api/v1/public/share/:token` (`FRS-5.4, FRS-2.2.4, FRS-5.6`):
  ```sql
  UPDATE share_links sl
  SET view_count = view_count + 1
  FROM notes n
  WHERE sl.token = $1
    AND sl.note_id = n.id
    AND sl.revoked_at IS NULL
    AND sl.expires_at > NOW()
    AND n.deleted_at IS NULL
  RETURNING sl.view_count, sl.expires_at, n.id AS note_id, n.title, n.body, n.updated_at;
  ```
  Zero rows returned is the single signal driving `404` — the controller never inspects _which_
  condition failed (`FRS-5.6`).
- §7 route matrix rows for `POST/DELETE /api/v1/notes/:id/share` and
  `GET /api/v1/public/share/:token` — adopted, with the `GET /api/v1/notes/:id/share` addition
  documented as Resolved Decision #2 (SDS route matrix is silent on it; this spec is the update).
- `apps/api/CLAUDE.md` layering: `share.router.ts` → `share.controller.ts` → `share.service.ts` →
  `share.repository.ts` for the four owner/public endpoints, mirroring `tag.*`/`note.*` exactly.
  Public route carries **no** `requireAuth` middleware (`FRS-5.5`) and is mounted at
  `/api/v1/public/share/:token`, structurally separate from the authenticated `notes/:id/share`
  sub-routes.
- `NoteService.softDeleteNote` (already implemented, `AB-1004`) gains one additional write per
  Resolved Decision #3.

## Resolved Decisions (from clarification)

1. **`POST /api/v1/notes/:id/share` is idempotent get-or-create, not always-create-new
   (user decision, overriding this spec's own first draft default of "auto-revoke and regenerate").**
   If the note already has an active link (`revokedAt IS NULL AND expiresAt > NOW()`), the endpoint
   returns that **existing** link unchanged with `200 OK` — it does **not** rotate the token or touch
   `expiresInDays`, so a user re-opening the share modal always sees their current live link "at a
   glance" instead of silently getting a new one. Only when no active link exists (never generated,
   or previously revoked/expired) does it create a brand-new `ShareLink` row using the request's
   `expiresInDays`, returning `201 Created`. To genuinely rotate/replace a link, the owner must
   explicitly `DELETE` first, then `POST` again — there is no separate "regenerate" verb.
2. **This ticket adds `GET /api/v1/notes/:id/share`**, absent from `SDS.md`'s route matrix. It is the
   read-only counterpart the frontend (`AB-1014`) needs to fetch full link details (token, expiry,
   view count) when opening the share modal without invoking the create-shaped `POST`. Returns the
   active link (`200 OK`) or `404 Not Found` (`SHARE_LINK_NOT_FOUND`) if the note has none currently
   active. `docs/SDS.md` §7 should be updated to add this row in a follow-up doc-sync.
3. **Trashing a note explicitly revokes its active share link(s)** (`revokedAt = now()`), in addition
   to the atomic public query's own live `n.deleted_at IS NULL` check. The public link would already
   be blocked by the join check alone, but without this write the owner's own
   `GET /api/v1/notes/:id/share` would keep reporting `revokedAt: null` (looking "active") for a note
   that is actually trashed — confusing for the owner-facing UI. `NoteService.softDeleteNote` runs
   this alongside the existing `deletedAt` update inside the same transaction. Restoring a note does
   **not** un-revoke that link (`FRS-2.2.4`); a fresh one must be generated per Decision #1's
   create-when-none-active path.
4. **`NoteResponseDto` (and therefore the notes list/detail/search DTOs that reuse it) gains
   `hasActiveShareLink: boolean`.** Computed as "an active, non-expired, non-revoked `ShareLink` row
   exists for this note" via one additional join/exists-subquery per list query — avoids the
   frontend needing N extra requests to render the FRS-7.2 per-note shared-status badge. Full link
   detail (token/expiry/view count) stays behind the dedicated `GET .../share` endpoint (Decision
   #2); the list only ever needs a yes/no.
5. **The public response (`GET /api/v1/public/share/:token`) never includes `viewCount`.** View count
   is owner-only information, returned solely by the authenticated `GET /api/v1/notes/:id/share`.
   Nothing in `FRS-5.5`/`FRS-5.6` asks the public page to display a counter, and exposing it would be
   scope this ticket doesn't need to add. Public response shape: `{ title, body, updatedAt }` — no
   `id`, no owner info, no other-notes linkage (`FRS-5.5`).
6. **The response never includes a constructed shareable URL, only the raw `token`.** The frontend
   (`AB-1014`) builds the visitable link from its own known origin (e.g.
   `${window.location.origin}/share/${token}`); the backend has no reliable way to know which
   public-facing origin/domain the frontend is served from, and `SDS.md` doesn't specify one.
7. **Token generation**: `crypto.randomBytes(32).toString('hex')` — 64 lowercase hex characters,
   fitting `ShareLink.token @db.VarChar(64)` exactly. Collision retry (regenerate on a unique
   constraint violation) is a `/plan`-level implementation detail, not a spec-level behavior change.
8. **Creating a link for a currently-trashed note returns `404 Not Found` (`NOTE_NOT_FOUND`), not a
   new error code.** Consistent with the existing `NoteService` pattern (`findActiveNoteByIdForUser`
   returning `null` for a trashed note ⇒ `notFound()`), applied identically here — trashed notes are
   invisible to every owner-facing note-scoped action, sharing included (`FRS-2.1.2`-style "not
   found" framing, not a bespoke "note is trashed" error).

## Out of Scope (binding for this ticket)

- Frontend share modal, active-link display, copy-to-clipboard UI, or any `apps/web` code — `[FRS
§7.2]`, ticket **AB-1014**. This ticket ships only the `hasActiveShareLink` DTO field it depends on.
- Password-protected links, edit/comment permissions on shared links, per-viewer analytics beyond a
  total view count — explicitly out of scope per `FRS.md` §5 "Out of Scope (Sharing)".
- Any DB migration — the `ShareLink` model, its unique `token` constraint, and both indexes already
  exist from `AB-1001`'s initial migration.
- Rate-limiting the public endpoint — not requested by `FRS §5` or `FRS §8`; the atomic
  `UPDATE ... RETURNING` is already safe under concurrent hits (`FRS-5.4`), and general API
  rate-limiting (if any) is a cross-cutting concern outside this ticket.
- Multiple concurrent active links per note, a link history/audit list, or a `:linkId` param on any
  route — superseded by Resolved Decision #1's single-active-link model.

---

## ADDED Requirements

### Requirement: Shared Sharing Contracts

`packages/shared` SHALL gain the following, with every numeric value referencing a named
`APP_LIMITS` export (`FRS-8.5`) — no literal `7`, `1`, `30`, etc. anywhere in `apps/api`:

- `APP_LIMITS` gains `SHARE_LINK_DEFAULT_EXPIRY_DAYS: 7`, `SHARE_LINK_MIN_EXPIRY_DAYS: 1`,
  `SHARE_LINK_MAX_EXPIRY_DAYS: 30` (`FRS-5.2`).
- `API_PATHS.NOTES` gains `SHARE: "/share"`. A new `API_PATHS.PUBLIC` group is added:
  `{ ROOT: "/public", SHARE: "/share" }`, mounted so the full path resolves to
  `/api/v1/public/share/:token`.
- `API_ERROR_CODES` gains `SHARE_LINK_NOT_FOUND` (owner-side: no active link to fetch/revoke) and
  `SHARE_LINK_UNAVAILABLE` (public-side: expired, revoked, or trashed — identical presentation,
  `FRS-5.6`).
- `VALIDATION_MESSAGES` gains `SHARE_EXPIRY_DAYS_INVALID` (out-of-range `expiresInDays`).
- `src/schemas/share.schema.ts` gains:

  ```typescript
  export const createShareLinkSchema = z.object({
    expiresInDays: z.coerce
      .number()
      .int()
      .min(
        APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS,
        VALIDATION_MESSAGES.SHARE_EXPIRY_DAYS_INVALID,
      )
      .max(
        APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS,
        VALIDATION_MESSAGES.SHARE_EXPIRY_DAYS_INVALID,
      )
      .default(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS),
  });
  ```

- `src/types/share.type.ts` gains `CreateShareLinkInput` (`z.infer`), plus:

  ```typescript
  export type ShareLinkResponseDto = {
    noteId: string;
    token: string;
    expiresAt: string;
    viewCount: number;
    createdAt: string;
  };

  export type PublicNoteResponseDto = {
    title: string;
    body: string;
    updatedAt: string;
  };
  ```

- `src/types/note.type.ts`'s `NoteResponseDto` gains `hasActiveShareLink: boolean` (Resolved
  Decision #4) — every existing producer of this DTO (create, get, update, list, trash list, search)
  must populate it.

#### Scenario: Zod schemas and constants live only in packages/shared

- **WHEN** `apps/api` needs the share request/response shapes or numeric limits for this delta
- **THEN** it imports `createShareLinkSchema` from `@shared/core/schemas` and
  `APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS`/`SHARE_LINK_MIN_EXPIRY_DAYS`/
  `SHARE_LINK_MAX_EXPIRY_DAYS`/`API_PATHS.NOTES.SHARE`/`API_PATHS.PUBLIC` from
  `@shared/core/constants` — no duplicate schema, type, or numeric literal exists in the backend

### Requirement: Generate Share Link (Idempotent Get-or-Create)

`POST /api/v1/notes/:id/share` SHALL return the caller's own note's current active share link if one
exists, or create a new one otherwise (`FRS-5.1`, Resolved Decision #1), defaulting expiry to
`APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS` and accepting `1`–`30` days (`FRS-5.2`), rejecting
generation for a trashed or nonexistent note (`FRS-5.1` Error Scenarios) with `404 Not Found`.

#### Scenario: First-time generation creates a new link

- **WHEN** the caller `POST`s `{ expiresInDays: 14 }` against their own note with no active link
- **THEN** a new `ShareLink` row is created (`expiresAt = now() + 14d`, `viewCount: 0`), and
  `201 Created` returns `{ noteId, token, expiresAt, viewCount: 0, createdAt }`

#### Scenario: Omitted expiresInDays defaults to 7 days

- **WHEN** the caller `POST`s `{}` (no body / no `expiresInDays`) with no active link
- **THEN** the created link's `expiresAt` is `now() + APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS`

#### Scenario: Out-of-range expiresInDays is rejected

- **WHEN** `expiresInDays` is `0`, `31`, or negative
- **THEN** `createShareLinkSchema` rejects with `400 VALIDATION_ERROR` (`SHARE_EXPIRY_DAYS_INVALID`),
  and no row is created

#### Scenario: Re-POSTing while an active link exists returns that same link unchanged

- **WHEN** the caller already has an active (non-revoked, non-expired) link for the note and
  `POST`s again, with or without a different `expiresInDays`
- **THEN** `200 OK` returns the **existing** link's exact `token`/`expiresAt`/`viewCount` —
  `expiresInDays` in this request is ignored, no new row is created, no rotation occurs

#### Scenario: Generating a link for a trashed note is rejected

- **WHEN** the caller `POST`s against a note currently in Trash (Stage 1 or Stage 2)
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned, no `ShareLink` row is created

#### Scenario: Generating a link for another user's or nonexistent note is rejected

- **WHEN** the note `id` belongs to a different user, or matches no note at all
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned, never `403`

### Requirement: Fetch Current Active Share Link

`GET /api/v1/notes/:id/share` SHALL return the caller's own note's current active share link, or
`404 Not Found` if none is currently active (Resolved Decision #2) — never exposing another user's
note's link.

#### Scenario: Active link exists

- **WHEN** the caller's note has an active (non-revoked, non-expired) `ShareLink`
- **THEN** `200 OK` returns `{ noteId, token, expiresAt, viewCount, createdAt }` reflecting its
  current view count live (no caching lag)

#### Scenario: No active link exists

- **WHEN** the note has never had a link generated, or its only link is revoked or past `expiresAt`
- **THEN** `404 Not Found` (`SHARE_LINK_NOT_FOUND`) is returned

#### Scenario: Note is trashed

- **WHEN** the note is currently in Trash (Stage 1 or Stage 2), regardless of whether it has a
  (now-revoked, per Decision #3) share link on record
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned — trashed notes are invisible to this
  endpoint exactly as they are to `GET /api/v1/notes/:id`

#### Scenario: Cross-user access is rejected

- **WHEN** the caller requests share status for a note owned by a different user
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned, never `403`, never leaking whether a link
  exists

### Requirement: Revoke Share Link

`DELETE /api/v1/notes/:id/share` SHALL immediately invalidate the caller's own note's active share
link (`FRS-5.3`), returning `404 Not Found` if the note has no active link to revoke.

#### Scenario: Revoking an active link

- **WHEN** the caller `DELETE`s against a note with an active link
- **THEN** `200 OK` is returned, `revokedAt = now()` is set on that `ShareLink` row, and the very
  next public access attempt against its `token` returns the "no longer available" state
  (`FRS-5.3, FRS-5.6`)

#### Scenario: Revoking when no active link exists

- **WHEN** the note has no active link (never generated, already revoked, or expired)
- **THEN** `404 Not Found` (`SHARE_LINK_NOT_FOUND`) is returned, no write occurs

#### Scenario: Revoking another user's note's link is rejected

- **WHEN** the note `id` belongs to a different user
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned, never `403`

### Requirement: Public Read-Only Share View With Atomic View Count

`GET /api/v1/public/share/:token` SHALL be the only unauthenticated data-returning route (`FRS-8.6`
principle), atomically incrementing the link's view count and enforcing non-deleted/non-expired/
non-revoked state in one query (`FRS-5.4, FRS-2.2.4`), returning a strictly read-only note view
(`FRS-5.5`) or an identical "no longer available" `404` regardless of the underlying cause
(`FRS-5.6`).

#### Scenario: Valid, unexpired, non-revoked link on a non-trashed note

- **WHEN** a visitor requests a token meeting all three conditions
- **THEN** `200 OK` returns `{ title, body, updatedAt }` (no `id`, no `viewCount`, no owner info, no
  edit affordance data — `FRS-5.5`, Resolved Decision #5) and the link's `view_count` increments by
  exactly 1 in the same query

#### Scenario: Every visit counts, including repeats from the same visitor

- **WHEN** the same visitor (same IP/browser/session) requests the same valid token 5 times in a row
- **THEN** `view_count` increases by exactly 5 — no dedup by IP, cookie, or session (`FRS-5.4`)

#### Scenario: Concurrent visits are never lost

- **WHEN** many requests hit the same valid token simultaneously
- **THEN** the final `view_count` reflects every single request — the atomic
  `UPDATE ... SET view_count = view_count + 1 ... RETURNING` guarantees no read-then-write race
  (`FRS-5.4`)

#### Scenario: Expired link

- **WHEN** `expires_at <= NOW()`
- **THEN** the query's `WHERE` clause excludes the row, zero rows return, and the controller responds
  `404 Not Found` (`SHARE_LINK_UNAVAILABLE`) — indistinguishable from the revoked/trashed cases below

#### Scenario: Revoked link

- **WHEN** `revoked_at IS NOT NULL` (manually revoked, or auto-revoked by trashing per Decision #3)
- **THEN** zero rows return, identical `404` (`SHARE_LINK_UNAVAILABLE`) presentation to the expired
  case — the public caller cannot tell revoked from expired from trashed (`FRS-5.6`)

#### Scenario: Note currently trashed (Stage 1 or Stage 2), link otherwise still valid

- **WHEN** the parent note has `deleted_at IS NOT NULL` — whether or not Decision #3's explicit
  revoke has also fired
- **THEN** the `n.deleted_at IS NULL` join condition alone excludes the row, zero rows return,
  identical `404` (`SHARE_LINK_UNAVAILABLE`) — this is the **live per-access** enforcement required
  by `FRS-2.2.4`, verified independent of whether the nightly cleanup job has run

#### Scenario: Nonexistent token

- **WHEN** `:token` matches no `ShareLink` row at all
- **THEN** zero rows return, identical `404` (`SHARE_LINK_UNAVAILABLE`) — same presentation as every
  other invalid case, no distinguishing detail leaks

#### Scenario: No route to any other data

- **WHEN** a visitor holds a valid token
- **THEN** the response contains nothing enabling navigation to the owner's other notes, the owner's
  identity, or any mutation — strictly the single note's `title`/`body`/`updatedAt` (`FRS-5.5`)

### Requirement: Trashing a Note Explicitly Revokes Its Active Share Link

Soft-deleting a note (`DELETE /api/v1/notes/:id`, already implemented in `AB-1004`) SHALL also set
`revokedAt = now()` on that note's active `ShareLink`, if one exists, inside the same transaction
(Resolved Decision #3).

#### Scenario: Trashing a note with an active link revokes it explicitly

- **WHEN** a note with an active share link is soft-deleted
- **THEN** `NoteService.softDeleteNote`'s transaction also updates the `ShareLink` row's
  `revokedAt = now()`, so `GET /api/v1/notes/:id/share` called against the note before it leaves
  Stage 1 (impossible via the normal endpoint, since it 404s — verified via direct DB inspection)
  shows `revokedAt` populated rather than `null`

#### Scenario: Trashing a note with no active link is a no-op for sharing

- **WHEN** a note with no active share link (never generated, or already revoked/expired) is
  soft-deleted
- **THEN** no `ShareLink` row is touched; the soft-delete proceeds exactly as before this ticket

#### Scenario: Restoring a note does not resurrect the revoked link

- **WHEN** a note is restored from Trash after having been trashed with an active link (now revoked
  per this requirement)
- **THEN** the old `ShareLink` row remains `revokedAt`-populated; `GET .../share` still returns `404`
  after restore, and a fresh link must be generated via `POST` (`FRS-2.2.4`)

### Requirement: Share Status Visible on the Note DTO

`NoteResponseDto` (and every endpoint that returns it: create, get-by-id, update, list, trash list)
SHALL include `hasActiveShareLink: boolean`, reflecting whether an active (non-revoked, non-expired)
`ShareLink` currently exists for that note (Resolved Decision #4, `FRS-7.2`).

#### Scenario: Note with an active link

- **WHEN** a note has a non-revoked, non-expired `ShareLink`
- **THEN** every DTO representation of that note includes `hasActiveShareLink: true`

#### Scenario: Note with no link, or only a revoked/expired one

- **WHEN** a note has never had a link, or its only link is revoked or expired
- **THEN** `hasActiveShareLink: false`

#### Scenario: Flag updates immediately on revoke or expiry-driven state change

- **WHEN** an active link is revoked (manually or via trashing, Decision #3)
- **THEN** the very next fetch of that note's DTO reflects `hasActiveShareLink: false` — no caching
  lag, computed fresh on every request exactly like `FRS-3.2`'s live tag `noteCount` precedent

---

## Error Scenarios (this ticket's exact behavior)

| Scenario                                                          | Response                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `expiresInDays` out of `1`–`30` range                             | `400 VALIDATION_ERROR` (`SHARE_EXPIRY_DAYS_INVALID`)   |
| Generate link for a trashed or nonexistent/cross-user note        | `404 Not Found` (`NOTE_NOT_FOUND`), never `403`        |
| Re-`POST` while an active link exists                             | `200 OK`, returns existing link unchanged, no new row  |
| `GET`/`DELETE` share status/revoke with no active link            | `404 Not Found` (`SHARE_LINK_NOT_FOUND`)               |
| `GET`/`DELETE` share status/revoke on a trashed/cross-user note   | `404 Not Found` (`NOTE_NOT_FOUND`), never `403`        |
| Public view: expired link                                         | `404` (`SHARE_LINK_UNAVAILABLE`), generic message      |
| Public view: revoked link                                         | `404` (`SHARE_LINK_UNAVAILABLE`), identical to expired |
| Public view: trashed note (live check, regardless of cron timing) | `404` (`SHARE_LINK_UNAVAILABLE`), identical to above   |
| Public view: nonexistent token                                    | `404` (`SHARE_LINK_UNAVAILABLE`), identical to above   |
| Concurrent public visits to the same valid token                  | All counted exactly once each, zero lost increments    |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1008 — §5): default 7-day expiry with 1–30 day custom
range accepted/rejected correctly; manual revoke immediately unusable; concurrent visits all counted
under load with zero lost increments; the same query that increments the counter also live-rejects a
trashed note's access, confirmed as one query/transaction; public view exposes no edit affordance, no
viewer list, no link to the owner's other notes; expired/revoked/trashed links render the identical
"no longer available" state with no distinguishing detail; creating a link for an already-trashed
note is rejected.
