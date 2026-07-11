# Sequenced Tasks for AB-1006-tags-crud

Source: `openspec/changes/AB-1006-tags-crud/specs/tags/spec.md` + `plan.md`. Zero DB migration in
this ticket — `Tag`/`NoteTag` models and `tags_color_hex_check` already exist from `AB-1001`.

## Phase 1: Foundation & Shared Tier (`@shared/core`)

_(Rule 11 — all DTOs/Zod schemas/constants live only in `packages/shared`; zero duplication in `apps/api`)_

- [x] `packages/shared/src/constants/app-limits.constant.ts`: add `TAG_NAME_MAX_CHARS: 50` and
      `TAG_DEFAULT_COLOR: "#6B7280"` to the existing `APP_LIMITS` object (`[Rule 11, FRS-3.1]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: add `TAGS: { ROOT: "/tags" }` sibling to
      `AUTH`/`NOTES` (`[Rule 11, FRS-8.6]`).
- [x] `packages/shared/src/constants/api-error-codes.constant.ts`: add `TAG_NOT_FOUND` and
      `TAG_NAME_CONFLICT` (`[Rule 11, FRS-3.4]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: add `TAG_NAME_REQUIRED`,
      `TAG_NAME_TOO_LONG`, `TAG_COLOR_INVALID`, `TAG_UPDATE_EMPTY`, `TAG_NAME_CONFLICT` (`[Rule 11,
    FRS-3.1, FRS-3.4]`).
- [x] `packages/shared/src/schemas/tag.schema.ts` (new): define `createTagSchema` (`name`
      trim/min/max, `color` regex `^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$` defaulting to
      `TAG_DEFAULT_COLOR`) and `updateTagSchema` (`name`/`color` both optional, `.refine` rejecting an
      empty body) (`[Rule 11, FRS-3.1, FRS-3.4]`).
- [x] `packages/shared/src/schemas/index.ts`: add `export * from "./tag.schema";` (`[Rule 11]`).
- [x] `packages/shared/src/types/tag.type.ts` (new): `CreateTagInput`/`UpdateTagInput` (`z.infer`)
      plus hand-defined `TagResponseDto { id, name, color, noteCount, createdAt, updatedAt }` and
      `TagListResponseDto { tags: TagResponseDto[] }` (`[Rule 11, FRS-3.1, FRS-3.2]`).
- [x] `packages/shared/src/types/index.ts`: add `export * from "./tag.type";` (`[Rule 11]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint --
    --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/api`)

_(Strict four-layer invariant: Controllers do `schema.parse` + `{ success: true, data }` only —
zero SQL, zero Zod definitions in `controllers/`/`routers/`; ownership/IDOR checks live in
`services/`, throwing `404` never `403` for cross-user access, `[SDS §1.1]`)_

- [x] `apps/api/src/repositories/tag.repository.ts` (new): `createTag`, `findTagByIdForUser`,
      `findTagByNameForUser` (Citext-native equality, no `.toLowerCase()`/`mode: 'insensitive'`),
      `listTagsForUser` (ordered `name: "asc"`), `updateTag`, `deleteTag` — each with a filtered
      `_count.select.noteTags.where.note.deletedAt: null` include for live `noteCount`; each accepts
      `db: Db = prisma` for transaction composability (`[FRS-3.1, FRS-3.2]`).
- [x] `apps/api/src/services/tag.service.ts` (new): `createTag` (409 `TAG_NAME_CONFLICT` on same-user
      case-insensitive duplicate), `listTags`, `updateTag` (404 `TAG_NOT_FOUND` for cross-user, 409 on
      rename collision with a _different_ own tag, self-name-exempt via `conflicting.id !== tagId`),
      `deleteTag` (404 for cross-user/nonexistent, relies on existing `NoteTag.tagId` cascade FK — no
      explicit join cleanup query); `notFound()`/`toTagResponseDto()` helpers mirroring
      `note.service.ts` (`[FRS-3.1, FRS-3.3, FRS-3.4]`).
- [x] `apps/api/src/controllers/tag.controller.ts` (new): `create`/`list`/`update`/`remove` — each
      parses via `createTagSchema`/`updateTagSchema` from `@shared/core/schemas`, calls exactly one
      service function, wraps response in `{ success: true, data }` (`201` create, `200` list/update/
      delete) (`[SDS §1.1, FRS-8.6]`).
- [x] `apps/api/src/routers/tag.router.ts` (new): mount `requireAuth`, declare
      `POST /`, `GET /`, `PATCH /:id`, `DELETE /:id` (`[FRS-3.1, FRS-3.3]`).
- [x] `apps/api/src/routers/index.ts`: import `tagRouter` and mount at
      `API_PATHS.BASE + API_PATHS.TAGS.ROOT`, alongside the existing `authRouter`/`noteRouter` mounts
      (`[FRS-8.6]`).
- [x] `apps/api/src/middlewares/error.middleware.ts`: verify a generic Prisma `P2002` (unique
      violation) handler already maps to `409`; if none exists, add a narrow catch in
      `tagService.createTag` translating `P2002` → `409 TAG_NAME_CONFLICT` instead of touching shared
      middleware behavior for other domains (`[FRS-3.4]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint` →
      `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent)

_(Derived solely from `FRS-3.1`–`FRS-3.4` numbered requirement text and `SDS.md` contracts — never
from Acceptance Criteria bullet wording; runs only against isolated `notes_app_test`, `[FRS-0.3.2,
FRS-0.3.3]`)_

- [x] `apps/api/tests/unit/tag.service.test.ts`: create/list/update/delete happy paths; 404 on
      cross-user update/delete; 409 on same-user duplicate create; 409 on rename collision with a
      _different_ own tag; rename to own current name/case-variant succeeds (no conflict); empty
      `{}` update body rejected pre-service (schema-level) (`[FRS-3.1, FRS-3.3, FRS-3.4]`).
- [x] `apps/api/tests/contract/tag.routes.test.ts` (Supertest): full HTTP round trip for all four
      endpoints against `notes_app_test`; exact status codes (`201/200/400/404/409`) and
      `API_ERROR_CODES` values from the Error Scenarios table; alphabetical case-insensitive list
      ordering; `noteCount` correctness sequence (tag a note → count 1; trash it → count 0; restore
      it → count 1; untag it → count 0) exercising the existing `tagIds` note-update path purely as
      test setup (`[FRS-3.1, FRS-3.2, FRS-3.3, FRS-3.4]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — all green against
      `notes_app_test`, ≥80% coverage on every new file from Phase 1 & 2.

## Phase 4: OpenSpec Compliance Audit

_(`review-log.md` is the sole tracking log for this phase — no `fix-bundles.md` per project
convention, `AGENTS.md §13`)_

- [x] Run `openspec validate AB-1006-tags-crud` against the spec delta in `specs/tags/spec.md`.
- [x] Run `/review AB-1006-tags-crud` (`reviewer` agent): confirm `@shared/core` zero-duplication,
      controllers contain zero SQL/Zod definitions, `deletedAt`-based note-count filtering, no
      `localStorage`/`sessionStorage` token usage introduced, `404` (never `403`) on cross-user tag
      access.
- [x] Confirm `openspec/changes/AB-1006-tags-crud/review-log.md` reports all ✅ PASSED before
      proceeding to `/pr AB-1006-tags-crud` (archival happens there via `openspec archive`).

---

Awaiting explicit `APPROVED` before `/implement AB-1006-tags-crud`.
