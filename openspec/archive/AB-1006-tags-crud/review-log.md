# Review Log — AB-1006-tags-crud

Tracks `/review` findings and action items only. No `fix-bundles.md` per project convention
(`AGENTS.md §13`).

## Status: ✅ PASSED

### Review Findings (`/review AB-1006-tags-crud`)

- ✅ **`@shared/core` Zero-Duplication**: All Zod validation schemas (`createTagSchema`, `updateTagSchema`), DTO interfaces (`TagResponseDto`, `TagListResponseDto`), and constants (`TAG_NAME_MAX_CHARS`, `TAG_DEFAULT_COLOR`, `API_PATHS.TAGS`) are defined strictly inside `packages/shared` (`Rule 11`). Zero duplication in `apps/api`.
- ✅ **Four-Layer Architecture (`SDS §1.1`)**: Controllers (`tag.controller.ts`) perform only `schema.parse(req.body)` + service invocation + unified `{ success: true, data }` response formatting. Zero Zod schema definitions and zero SQL in controllers or routers.
- ✅ **Soft-Delete Note Count Filtering (`FRS-3.2`)**: Repository queries include `_count: { select: { noteTags: { where: { note: { deletedAt: null } } } } }` ensuring accurate live `noteCount` across tagging, untagging, trashing, and restoring notes.
- ✅ **Cross-User Security (`IDOR` Protection)**: `findTagByIdForUser` scopes all updates/deletes to `userId`. Attempting cross-user updates/deletes returns `404 TAG_NOT_FOUND` (never `403`), preserving cross-tenant privacy.
- ✅ **Citext Native Equality (`FRS-3.1`)**: `findTagByNameForUser` leverages PostgreSQL `@db.Citext` for case-insensitive duplicate prevention without `.toLowerCase()` or `mode: 'insensitive'`.
- ✅ **No Client-Side Token Storage**: No changes introduced to browser storage; token handling remains in client JS memory (`useAuthStore`) per `FRS-1.3`.
- ✅ **OpenSpec & Quality Gates**: `openspec validate --type change AB-1006-tags-crud` passed without errors. `pnpm turbo run test -- --coverage` confirms 100% statement, branch, function, and line coverage across `tag.service.ts`, `tag.repository.ts`, `tag.controller.ts`, and `tag.router.ts` against isolated `notes_app_test`.
