## Why

`AB-1001` (`FRS §0`) establishes the monorepo, database schema, and AI-governance scaffolding every later ticket (`AB-1002+`) depends on. No feature ticket can begin until the workspace layout, `packages/shared` SSOT, Prisma schema, and quality-gate tooling exist.

## What Changes

Introduces the full `pnpm workspaces` + Turborepo monorepo (`apps/api`, `apps/web`, `packages/shared`, `packages/config`), the complete Prisma schema (8 models, `citext`/`tsvector`/GIN per `SDS §2.1-2.2`), root tooling (Husky, commitlint, ESLint flat config with a layer-boundary rule), the Context7 MCP server (closing the `FRS-0.3.1` gap), and the 3 missing domain `CLAUDE.md` files. Zero business logic — pure scaffolding.

## Capabilities

### New Capabilities

- `project-setup-infrastructure`: monorepo workspace layout, root tooling, Prisma schema/migration, Docker Postgres, AI-governance files, and the quality-gate pipeline required before any feature ticket.

### Modified Capabilities

_None — no existing `openspec/specs/` capability exists yet to modify._

## Impact

- New workspaces: `apps/api`, `apps/web`, `packages/shared`, `packages/config`.
- New DB schema: 8 Prisma models, 3 `CHECK` constraints, 1 FTS trigger, 1 GIN index, applied to local `notes_app` via migration `20260710124549_init`.
- New MCP server: `context7` (live third-party API verification).
- Root config: `turbo.json`, `commitlint.config.js`, `.lintstagedrc.json`, `.husky/*`, `.gitignore` additions.
- No impact on any existing feature code — none exists yet.
