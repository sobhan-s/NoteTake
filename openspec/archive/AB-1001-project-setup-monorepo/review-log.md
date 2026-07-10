# Review Log — AB-1001

Append-only log of `reviewer` sub-agent findings for `AB-1001-project-setup-monorepo`.

## Review pass 1 (post-Phase 3, pre-archive)

### Mandatory Checks

✅ PASSED: `@shared/core` empty barrels — no domain logic invented -> `packages/shared/src/schemas/index.ts:1`, `packages/shared/src/constants/index.ts:1`
✅ PASSED: `ApiResponse<T>` union matches unified wrapper convention (`AGENTS.md §6`) -> `packages/shared/src/types/api-response.type.ts:1-15`
✅ PASSED: Layer directories empty (`.gitkeep` only) -> `apps/api/src/{controllers,services,repositories,middlewares}/.gitkeep`
✅ PASSED: `app.ts` contains zero SQL/Zod/business logic; `routers/index.ts` exports an empty `Router()` with zero route registrations
✅ PASSED: Zero `localStorage`/`sessionStorage` occurrences in `apps/web/` code (only a policy reference in `apps/web/CLAUDE.md` prose)
✅ PASSED: `Note.deletedAt DateTime?` present; zero physical `DELETE`/`.delete()` calls anywhere in `apps/api/src`
✅ PASSED: All 8 `SDS §2.1` models present with correct `@map`/`@@map` names
✅ PASSED: `Note.title @db.VarChar(200)`; migration's `notes_title_length_check` is `<= 200` (not 255); FTS trigger references `NEW.body` (no `body_plaintext`); `notes_search_vector_gin` GIN index present
✅ PASSED: `.mcp.json` registers both `code-review-graph` and `context7`; root `CLAUDE.md §1a` documents binding usage
✅ PASSED: Layer-boundary `no-restricted-imports` ESLint rule in `apps/api/eslint.config.js` structurally sound
✅ PASSED: `apps/api`/`apps/web` `test` scripts are exactly `"vitest run --passWithNoTests"` — no double `--coverage`
✅ PASSED: Zero `^`/`~`/`*`/`>=` version ranges in any `package.json`; `engines` fields correctly exempted

### Additional Scaffolding Verification

✅ PASSED: `docker-compose.yml` matches `SDS §1.5` exactly
✅ PASSED: `.env.example`/`.env.test.example` use distinct DB names
✅ PASSED: `User.email`/`Tag.name` use native `@db.Citext`; all `DateTime` fields use `@db.Timestamptz(6)`
✅ PASSED: `cleanup.job.ts` is exact no-op stub, not imported by `app.ts`
✅ PASSED: `.claude/skills/.gitkeep` closes the directory-existence gap
✅ PASSED: `turbo.json` pipeline matches plan exactly

### Non-blocking findings (resolved directly)

⚠️ DRIFTED: `tasks.md` prose still stated `--passWithNoTests --coverage` for the test scripts, contradicting `plan.md §4.4/§5.2`'s corrected decision and the actually-shipped code (which was correct). **Resolved**: `tasks.md` prose corrected to match shipped code and verified version pins.
📋 FRS GAP: Phase 4 of `tasks.md` was itself still in progress at review time (this review pass is part of completing it). **Resolved**: this is expected — review runs as part of Phase 4, not before it.

**Summary**: All mandatory architectural/compliance checks passed. No 🔒 SECURITY findings (no auth/token/SQL code exists yet in this INFRA-only ticket). Both non-blocking findings were documentation-only drift within the openspec change artifacts, now corrected directly.
