Create technical implementation plan for: $ARGUMENTS

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Verify that `$ARGUMENTS` matches the exact descriptive change directory inside `openspec/changes/`. If `$ARGUMENTS` was supplied as only a bare ticket ID (`AB-xxxx`), search `openspec/changes/` for the exact folder matching `AB-xxxx-*` (e.g., `openspec/changes/AB-1001-project-setup-monorepo`) and use that exact descriptive name across the plan and subsequent tasks (`[Rule 3]`).

## Preconditions & Setup

1. Read canonical specification documents:
   - `openspec/changes/$ARGUMENTS/specs/<domain>/spec.md` (canonical specification and behavioral deltas)
   - `docs/FRS.md` (`[FRS-x.y.z]` numbered requirement text)
   - `docs/SDS.md` (`API/DB` schemas, route table, `CHECK/GIN` constraints, status codes)
   - `docs/ux.md` (`Global Frontend UX & Visual Architecture` — strictly required for `AB-1010` to `AB-1016`)
   - `AGENTS.md` and workspace `CLAUDE.md` files (`apps/api/`, `apps/web/`, `packages/shared/`)
2. Determine ticket scope by ID (`AB-1001 -> INFRA`, `AB-1002..AB-1009 -> BACKEND`, `AB-1010..AB-1015 -> FRONTEND`, `AB-1016 -> E2E`).
3. **GRAPH ORIENTATION (`code-review-graph`)**:
   - Run `query_graph` or `semantic_search_nodes` to identify reusable patterns, existing DTOs, and `@shared/core` utilities (~82x token savings over raw file reads).
   - Run `get_architecture_overview` to confirm exact dependency graph across `routers -> controllers -> services -> repositories -> shared`.

---

## Plan Generation & Critical NoteApp Rules Integration

Generate a comprehensive technical implementation plan (`plan.md`) covering:

1. **Exact Layered File Paths**:
   - Backend (`apps/api`): Strictly separate `repositories/ -> services/ -> controllers/ -> routers/`.
   - Frontend (`apps/web`): Strictly separate `store/ -> api/ -> hooks/ -> components/ -> pages/`.
2. **Single Source of Truth (`Rule 11, FRS-8.5`)**:
   - Define exact shapes for Zod validation schemas (`z.object(...)`) and inferred TS DTOs (`z.infer<typeof schema>`) inside `packages/shared/src/schemas/` & `src/types/`.
   - Ensure zero DTO or validation rule is ever duplicated inside `apps/api` or `apps/web`.
3. **Backend Layer Enforcement (`SDS §1.1`)**:
   - Confirm Controllers (`controllers/`) only parse Zod input (`z.parse`) and return `{ success: true, data }` wrappers.
   - Confirm Controllers contain zero SQL queries (`$queryRaw`, `prisma...`) and zero Zod schema definitions.
4. **Token & Storage Security (`FRS-1.3.5, SDS §3.1`)**:
   - Confirm JWT access tokens (`Authorization: Bearer`) and refresh tokens are NEVER stored in `localStorage` or `sessionStorage`.
   - Confirm access tokens are held purely in JS memory via Zustand `useAuthStore` + `HttpOnly`, `Secure`, `SameSite=Strict` refresh cookies.
5. **Two-Stage Soft Delete (`FRS-2.2`)**:
   - Confirm note deletion sets `deletedAt = now()` (`Stage 1 Trash`) rather than executing physical `DELETE` statements.
6. **Database & Test Isolation Contract (`FRS-0.3.3, SDS §1.5`)**:
   - Confirm native PostgreSQL 16 extensions (`Citext` and `tsvector` GIN index).
   - Confirm that all `supertest` and `playwright` tests will run against the isolated `notes_app_test` database (`DATABASE_URL=...notes_app_test...` / `.env.test`), with `TRUNCATE TABLE ... CASCADE` before/after runs. Zero connections to `notes_app` or `sqlite::memory:`.
7. **Quality Checkpoint Commands (`CLAUDE.md §6 / DoD`)**:
   - Specify explicit commands: `pnpm turbo run build` (`tsup`), `pnpm turbo run lint -- --max-warnings 0`, `pnpm turbo run typecheck` (`tsc --noEmit`), and `pnpm turbo run test -- --coverage`.

Save generated plan to: `openspec/changes/$ARGUMENTS/plan.md`
Wait for explicit user `APPROVED` confirmation (`[Rule 3]`) before proceeding to `/tasks` or `/implement`.

Format: `/plan ab-xxxx-short-description`
