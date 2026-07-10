Create technical implementation plan for: $ARGUMENTS

Steps:
1. Read: `openspec/changes/$ARGUMENTS/proposal.md` and spec delta inside `openspec/changes/$ARGUMENTS/specs/`.
2. Read: `docs/SDS.md` (architecture decisions, DB schema tables/indexes, and API endpoint contracts).
3. Read: `AGENTS.md`, `CLAUDE.md`, and workspace-specific `CLAUDE.md` files (`apps/api/`, `apps/web/`, `packages/shared/`).
4. Scan existing codebase via `code-review-graph` (`query_graph`) to identify reusable patterns, existing DTOs, and `@shared/core` utilities.
5. Generate comprehensive plan covering:
   - **Exact File Paths** to create or modify across our layered backend (`routers/ -> controllers/ -> services/ -> repositories/`) or frontend (`components/`, `pages/`, `hooks/`, `store/`).
   - **TypeScript Interfaces & Zod Schemas**: Final exact shapes matching `SDS` contracts, located strictly in `@shared/core` (`packages/shared/src/schemas/` and `src/types/`).
   - **Architecture Decisions with Reasoning**: Why specific layers, Zustand stores (`useAuthStore`), or TanStack Query hooks were chosen.
   - **Database Changes (`schema.prisma`)**: Verify backward compatibility (`citext`, `tsvector`), migration steps, and soft-delete index impacts.
   - **Reuse Check**: Confirm zero duplication of `@shared/core` models.
   - **Quality Checkpoint Commands**: Explicit build, lint, typecheck, and isolated test (`notes_app_test`) commands.
6. Save generated plan to: `openspec/changes/$ARGUMENTS/plan.md`
7. Wait for explicit user approval before proceeding to `/tasks` or implementation.

Format: `/plan AB-xxxx-short-description`
