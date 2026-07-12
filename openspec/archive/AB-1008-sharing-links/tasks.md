# Sequenced Tasks for AB-1008-sharing-links

Scope: **BACKEND** (`AB-1002..AB-1009`). No frontend, no DB migration (`ShareLink` model already
provisioned from `AB-1001`'s `20260710124549_init`).

## Phase 1: Foundation & Shared Tier (`packages/shared`)

_(Rule 11 — all DTOs, Zod schemas, and numeric literals for this ticket live in `packages/shared`;
`apps/api` only ever imports them, never redefines them)_

- [x] `packages/shared/src/constants/app-limits.constant.ts`: add `SHARE_LINK_DEFAULT_EXPIRY_DAYS: 7`,
      `SHARE_LINK_MIN_EXPIRY_DAYS: 1`, `SHARE_LINK_MAX_EXPIRY_DAYS: 30` (`[Rule 11, FRS-5.2]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: add `NOTES.SHARE: "/share"`; add new
      `PUBLIC: { ROOT: "/public", SHARE: "/share" }` group (`[FRS-8.6]`).
- [x] `packages/shared/src/constants/api-error-codes.constant.ts`: add `SHARE_LINK_NOT_FOUND`,
      `SHARE_LINK_UNAVAILABLE` (`[FRS-5.3, FRS-5.6]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: add
      `SHARE_EXPIRY_DAYS_INVALID` referencing `APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS`/
      `SHARE_LINK_MAX_EXPIRY_DAYS` (`[FRS-5.2]`).
- [x] `packages/shared/src/schemas/share.schema.ts` **(new)**: define `createShareLinkSchema`
      (`expiresInDays` — `z.coerce.number().int().min/max/default` against `APP_LIMITS`) (`[Rule 11,
  FRS-5.2]`).
- [x] `packages/shared/src/schemas/index.ts`: add `export * from "./share.schema"` (`[Rule 11]`).
- [x] `packages/shared/src/types/share.type.ts` **(new)**: define `CreateShareLinkInput` (`z.infer`),
      `ShareLinkResponseDto` (`{ noteId, token, expiresAt, viewCount, createdAt }`),
      `PublicNoteResponseDto` (`{ title, body, updatedAt }`) (`[Rule 11, FRS-5.1, FRS-5.5]`).
- [x] `packages/shared/src/types/index.ts`: add `export * from "./share.type"` (`[Rule 11]`).
- [x] `packages/shared/src/types/note.type.ts`: add `hasActiveShareLink: boolean` to
      `NoteResponseDto` (`[FRS-7.2]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint --
  --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/api`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage
loop. Controllers strictly `schema.parse` + one service call + `{ success, data }` wrap — zero SQL,
zero Zod definitions in `controllers/`/`routers/` per `SDS §1.1`. Two-stage soft delete (`FRS-2.2`)
and the `deletedAt`-based trash contract are read-only inputs here, not re-implemented.)_

- [x] `apps/api/src/repositories/share.repository.ts` **(new)**: implement `activeWhere(noteId)`
      helper, `findActiveShareLinkForNote`, `createShareLink`, `revokeShareLinkById`,
      `revokeActiveShareLinksForNote` (Prisma `updateMany`), and `consumePublicShareView` (atomic
      `$queryRaw` tagged-template `UPDATE ... FROM notes ... RETURNING`) (`[FRS-5.1, FRS-5.3, FRS-5.4,
  FRS-2.2.4]`).
- [x] `apps/api/src/repositories/note.repository.ts`: add exported `NoteWithShareLinks` type and
      `ACTIVE_SHARE_LINK_INCLUDE` (`satisfies Prisma.NoteInclude`, filtered `where`/`take: 1`); apply
      to `findActiveNoteByIdForUser`, `findTrashedNoteByIdForUser`, `updateNoteContent`,
      `softDeleteNote`, `restoreNote`, `listActiveNotesForUser`, `listTrashedNotesForUser`
      (`createNote` left unchanged) (`[FRS-7.2]`).
- [x] `apps/api/src/services/share.service.ts` **(new)**: implement `noteNotFound`/
      `shareLinkNotFound`/`shareLinkUnavailable` `AppError` helpers, `toShareLinkResponseDto`,
      `assertOwnedActiveNote`, `createShareLinkWithRetry` (P2002 collision retry, up to 3 attempts,
      `crypto.randomBytes(32).toString("hex")`), `getOrCreateShareLink` (idempotent get-or-create),
      `getActiveShareLink`, `revokeShareLink`, `getPublicNoteByToken` (single generic-404 path)
      (`[FRS-5.1, FRS-5.2, FRS-5.3, FRS-5.4, FRS-5.5, FRS-5.6]`).
- [x] `apps/api/src/services/note.service.ts`: update `toNoteResponseDto` to accept
      `NoteWithShareLinks` and map `hasActiveShareLink: note.shareLinks.length > 0`; update
      `createNote` to synthesize `shareLinks: []`; wrap `softDeleteNote` in `prisma.$transaction`
      calling both `noteRepository.softDeleteNote` and `shareRepository.revokeActiveShareLinksForNote`
      (`[FRS-7.2, FRS-2.2.4]`).
- [x] `apps/api/src/controllers/share.controller.ts` **(new)**: implement `create` (`201` if
      newly-created else `200`), `getActive`, `revoke` — `createShareLinkSchema.parse(req.body)` only,
      zero business logic (`[SDS §1.1, FRS-5.1, FRS-5.2, FRS-5.3]`).
- [x] `apps/api/src/controllers/public-share.controller.ts` **(new)**: implement `getByToken` — no
      auth context, zero business logic (`[SDS §1.1, FRS-5.4, FRS-5.5, FRS-5.6]`).
- [x] `apps/api/src/routers/share.router.ts` **(new)**: `Router({ mergeParams: true })` with
      `POST /`, `GET /`, `DELETE /` wired to `share.controller.ts`; no `requireAuth` re-applied here
      (inherited from parent mount) (`[FRS-8.6]`).
- [x] `apps/api/src/routers/public-share.router.ts` **(new)**: `Router()` with
      `GET ${API_PATHS.PUBLIC.SHARE}/:token` wired to `public-share.controller.ts`; no `requireAuth`
      (`[FRS-5.5, FRS-8.6]`).
- [x] `apps/api/src/routers/note.router.ts`: mount `share.router.ts` at
      `` `/:id${API_PATHS.NOTES.SHARE}` `` (`[FRS-8.6]`).
- [x] `apps/api/src/routers/index.ts`: mount `public-share.router.ts` at
      `API_PATHS.BASE + API_PATHS.PUBLIC.ROOT` (`[FRS-8.6]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint --
  --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `FRS-0.3.2, FRS-0.3.3`)

_(Derived solely from `FRS-5.1`–`FRS-5.6`, `FRS-2.2.4`, `FRS-7.2` numbered requirement text — never
from Acceptance Criteria bullet wording. All suites run against isolated `notes_app_test`.)_

- [x] `apps/api/tests/contract/share.test.ts` **(new)**: first-time creation (`201`),
      default-expiry-when-omitted, out-of-range `expiresInDays` (`0`, `31`, negative, non-integer)
      rejection, re-`POST` idempotency (`200`, unchanged token/expiresAt/viewCount, `expiresInDays`
      ignored), `GET` with/without an active link, `DELETE` with no active link (`404
  SHARE_LINK_NOT_FOUND`), all three verbs against a trashed note and a cross-user note (`404
  NOTE_NOT_FOUND`, never `403`) (`[FRS-5.1, FRS-5.2, FRS-5.3]`).
- [x] `apps/api/tests/contract/public-share.test.ts` **(new)**: valid token (`200`, exact `{ title,
  body, updatedAt }` shape, no other keys), repeat visits increment `view_count` by exactly N (via
      direct DB read), concurrent-request view-count correctness (N parallel requests, assert final
      count via DB), expired/revoked/trashed/nonexistent token all returning byte-identical `404`
      bodies (`SHARE_LINK_UNAVAILABLE`) (`[FRS-5.4, FRS-5.5, FRS-5.6, FRS-2.2.4]`).
- [x] `apps/api/tests/unit/share.service.test.ts` **(new)**: `createShareLinkWithRetry`'s `P2002`
      retry path, get-or-create branching (`created: true` vs `false`), `assertOwnedActiveNote` 404
      framing (`[FRS-5.1, FRS-5.2]`).
- [x] `apps/api/tests/unit/share.repository.test.ts` **(new)**: `activeWhere` predicate shape,
      `consumePublicShareView` uses `$queryRaw` tagged-template parameterization (not string
      concatenation) (`[FRS-5.4]`).
- [x] `apps/api/tests/unit/note.service.test.ts` (extend): `hasActiveShareLink: true/false` mapping
      for `getNoteById`/`updateNote`/`listNotes`/`listTrash`; `softDeleteNote`'s transaction revokes an
      active link and is a no-op when none exists (`[FRS-7.2, FRS-2.2.4]`).
- [x] `apps/api/tests/unit/note.repository.test.ts` (extend): `ACTIVE_SHARE_LINK_INCLUDE` correctly
      excludes expired/revoked links from the returned `shareLinks` array (`[FRS-7.2]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` (100% green against
      `notes_app_test`, ≥80% coverage on new code).

## Phase 4: Documentation Follow-Up

- [x] `apps/api/src/docs/openapi.ts`: add sharing schemas/paths (`POST/GET/DELETE
  /api/v1/notes/:id/share`, `GET /api/v1/public/share/:token`) to Swagger docs — follow-up
      doc-sync mirroring `AB-1007`'s search doc commit (`[FRS-8.7]`).

## Phase 5: OpenSpec Compliance Audit (`/review` — archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta (`openspec/changes/AB-1008-sharing-links/`).
- [x] Run `/review AB-1008-sharing-links` (`reviewer` agent checks `@shared/core` usage, controller
      thinness, IDOR `404`-never-`403` pattern, public route auth isolation, no `viewCount`/URL leakage
      in the public response).
- [x] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1008-sharing-links`
      (where `openspec archive` takes place).

---

## Out of Scope (carried from plan/spec, unchanged)

Frontend share modal/UI (`AB-1014`), password-protected links, edit/comment permissions on shared
links, per-viewer analytics beyond total view count, any DB migration, rate-limiting the public
endpoint, multiple concurrent active links per note, a link-history/audit list, or a `:linkId` route
param.
