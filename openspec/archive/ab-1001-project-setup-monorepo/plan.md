# AB-1001 — Technical Implementation Plan

**Source spec:** `openspec/changes/ab-1001-project-setup-monorepo/spec.md` (all 7 clarifying questions resolved)
**Scope class:** INFRA (`AB-1001`) — scaffolding only, zero feature/business logic.

---

## 0. Version-Pinning Caveat (`FRS-0.3.1`)

Every exact version below is a **proposed pin** based on training-data knowledge of these libraries' release lines, not a live registry lookup. Per `FRS-0.3.1` and root `CLAUDE.md` §1 (Context7 MCP), `/implement` MUST verify each pin against the live npm registry (Context7 MCP, or `npm view <pkg> version` as fallback) before writing it into a `package.json`, and adjust to the actual latest-stable-in-major if this plan's guess is stale. This plan is not itself the FRS-0.3.1 verification step — the Context7 MCP registration (§7 below) is.

---

## 1. Root-Level Scaffolding

| File                   | Content                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`  | `packages: ["apps/*", "packages/*"]`                                                                                                                                                                                                                                                                                                                     |
| `.nvmrc`               | `22.14.0`                                                                                                                                                                                                                                                                                                                                                |
| `package.json` (root)  | `"private": true`, `"engines": { "node": "22.x", "pnpm": "9.x" }`, workspace-wide devDeps: `turbo`, `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`, `prettier`. Scripts: `"lint": "turbo run lint"`, `"typecheck": "turbo run typecheck"`, `"build": "turbo run build"`, `"test": "turbo run test"`, `"prepare": "husky"`. |
| `turbo.json`           | Pipeline below (§6).                                                                                                                                                                                                                                                                                                                                     |
| `.gitignore`           | Append `node_modules/`, `dist/`, `.turbo/`, `*.tsbuildinfo`, `.env`, `.env.test`, `!.env.example`, `!.env.test.example`, `coverage/`, `playwright-report/`, `test-results/` — keep the existing `code-review-graph`-added line.                                                                                                                          |
| `commitlint.config.js` | `module.exports = { extends: ['@commitlint/config-conventional'], rules: { 'header-max-length': [2, 'always', 100], 'subject-case': [0] } }` plus a custom rule/parser enforcing the literal suffix `AB#\d+` on `feat                                                                                                                                    | fix | chore | docs | refactor | test`types — exact commitlint plugin API verified against Context7 before finalizing in`/implement` (`FRS-0.3.1`). |
| `.lintstagedrc.json`   | `{ "*.{ts,tsx}": ["eslint --max-warnings 0", "prettier --write"], "*.{md,json,yml,yaml}": ["prettier --write"] }`                                                                                                                                                                                                                                        |
| `.husky/pre-commit`    | `npx lint-staged`                                                                                                                                                                                                                                                                                                                                        |
| `.husky/commit-msg`    | `npx --no -- commitlint --edit "$1"`                                                                                                                                                                                                                                                                                                                     |

**Pinned root devDependencies (proposed, verify via `FRS-0.3.1`):** `turbo@2.3.3`, `husky@9.1.7`, `lint-staged@15.2.11`, `@commitlint/cli@19.6.1`, `@commitlint/config-conventional@19.6.0`, `prettier@3.4.2`, `typescript@5.7.2`.

---

## 2. `packages/config` — Single Flat Package (resolved Q5)

```
packages/config/
├── package.json          # name: "@config/core", private: true, zero deps beyond peer tooling
├── eslint.config.js       # flat config (ESLint 9.x), --max-warnings 0 enforced at CI/local invocation
├── prettier.config.js     # shared formatting rules
└── tsconfig.base.json     # strict: true, target ES2022, module NodeNext
```

- `eslint.config.js` SHALL export a flat-config array importable via `import config from '@config/core/eslint.config.js'` and extended per-workspace with workspace-specific overrides (e.g. `apps/api` adds a Node globals block, `apps/web` adds a React/JSX block).
- **Layer-boundary lint rule**: add an `eslint-plugin-import` (or `no-restricted-imports`) rule scoped to `apps/api/src/**`:
  - `controllers/**` MUST NOT import from `repositories/**` (only `services/**`).
  - `routers/**` MUST NOT import from `services/**` or `repositories/**` (only `controllers/**`).
  - `repositories/**` MUST NOT import from `controllers/**` or `routers/**`.
    This turns the `AGENTS.md §5` layering rule into an automated `pnpm turbo run lint` failure instead of a code-review-only convention — verify `eslint-plugin-import`'s exact rule syntax via Context7 before implementing (`FRS-0.3.1`).
- `tsconfig.base.json`: `"strict": true, "noUncheckedIndexedAccess": true, "moduleResolution": "bundler", "target": "ES2022"`.

**Pinned:** `eslint@9.17.0`, `eslint-plugin-import@2.31.0`, `typescript-eslint@8.18.2`, `prettier@3.4.2` (peer, already root-level).

---

## 3. `packages/shared` — SSOT Scaffolding (no domain schemas yet)

```
packages/shared/
├── package.json           # name: "@shared/core", exports map for schemas/types/constants
├── tsconfig.json           # extends ../config/tsconfig.base.json
├── src/
│   ├── schemas/
│   │   └── index.ts        # empty barrel — `export {}` placeholder, populated by AB-1002+
│   ├── types/
│   │   ├── api-response.type.ts   # the ONE real type this ticket adds — see below
│   │   └── index.ts        # `export * from './api-response.type';`
│   └── constants/
│       └── index.ts        # empty barrel — populated by AB-1002+
└── CLAUDE.md               # domain AI rules (§8 below)
```

**Exact shape — `api-response.type.ts`** (the unified wrapper referenced by `AGENTS.md §6` and `FRS-8.6`, needed on day one by `AB-1002`'s first controller):

```typescript
export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
```

- `schemas/index.ts` and `constants/index.ts` SHALL be empty barrels (`export {}`) — **not** populated with placeholder auth/notes/tags content per spec Out-of-Scope. Any future ticket adding a schema file also updates this barrel's `export *`.
- Build: `packages/shared` uses `tsup` (per `SDS §1.1`), producing ESM + `.d.ts` output consumed by both `apps/api` and `apps/web` via workspace `"@shared/core": "workspace:*"`.

**Pinned:** `zod@3.24.1` (declared here even though unused until `AB-1002`, since it's this package's core purpose and an empty `schemas/index.ts` still needs the dependency declared for the first real schema to compile without a follow-up `package.json` edit), `tsup@8.3.5`.

---

## 4. `apps/api` — Backend Scaffolding

### 4.1 Exact layered directory tree (`AGENTS.md §2`, `SDS §1.1`)

```
apps/api/
├── package.json
├── tsconfig.json                # extends ../../packages/config/tsconfig.base.json
├── .env.example                 # DATABASE_URL=postgresql://postgres:postgres@localhost:5432/notes_app?schema=public
├── .env.test.example            # DATABASE_URL=postgresql://postgres:postgres@localhost:5432/notes_app_test?schema=public
├── prisma/
│   ├── schema.prisma            # full schema — see §4.2
│   └── migrations/
│       └── 0001_init/
│           └── migration.sql    # generated by `prisma migrate dev`, includes raw-SQL additions (§4.2)
├── src/
│   ├── routers/
│   │   └── index.ts             # empty Express Router() export — no route registrations yet
│   ├── controllers/
│   │   └── .gitkeep
│   ├── services/
│   │   └── .gitkeep
│   ├── repositories/
│   │   └── .gitkeep
│   ├── middlewares/
│   │   └── .gitkeep
│   ├── jobs/
│   │   └── cleanup.job.ts       # stub — see resolved Q6 below
│   └── app.ts                   # Express 5 init, global middleware only, NO listen(), NO routes mounted
└── CLAUDE.md
```

- `app.ts` SHALL configure: `express.json()`, `cors()` (permissive dev default, tightened later), and a centralized error-handling middleware **shell** (a function signature only — `(err, req, res, next) => { res.status(500).json(...) }` — since no real error taxonomy exists until `AB-1002` introduces `API_ERROR_CODES` usage). It SHALL export the configured `app` instance for a future `server.ts`/`index.ts` entrypoint to `listen()` — that entrypoint file is **not** created in this ticket since there is nothing to serve yet (Decision §4 in spec: no routes).
- `routers/index.ts` exports an empty `Router()` so `app.ts` has something syntactically valid to (not yet) mount, avoiding an empty-file/dead-import smell while staying genuinely routeless.

### 4.2 Full Prisma schema + initial migration (resolved: full schema now)

- `schema.prisma` SHALL contain the exact 8 models transcribed verbatim from `SDS §2.1` (`User`, `LoginAttempt`, `OtpCode`, `RefreshSession`, `Note`, `Tag`, `NoteTag`, `NoteVersion`, `ShareLink`), with `datasource db { provider = "postgresql", url = env("DATABASE_URL"), extensions = [citext] }` and `generator client { previewFeatures = ["fullTextSearchPostgres", "postgresqlExtensions"] }`.
- After `prisma migrate dev --name init` generates the base migration, `/implement` SHALL hand-append the exact `SDS §2.2` items 1–2 raw SQL to that same `0001_init/migration.sql` file — **not** a second migration — so a fresh clone gets a fully-formed schema in one migration step:
  - `ALTER TABLE notes ADD CONSTRAINT notes_title_length_check CHECK (char_length(trim(title)) >= 1 AND char_length(title) <= 200);` — **200, matching `FRS-2.1.6`'s title cap exactly**, not an approximated 255.
  - `ALTER TABLE notes ADD CONSTRAINT notes_body_length_check CHECK (char_length(body) <= 100000);`
  - `ALTER TABLE tags ADD CONSTRAINT tags_color_hex_check CHECK (color ~* '^#[0-9a-f]{6}([0-9a-f]{2})?$');`
  - `GIN` index: `CREATE INDEX notes_search_vector_gin ON notes USING GIN (search_vector);`
  - Trigger function `notes_search_vector_update()` populating `NEW.search_vector := setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') || setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');` — **references `NEW.body`, the actual column on `Note`; there is no `body_plaintext` column anywhere in the `SDS §2.1` schema.**
  - `CREATE TRIGGER trg_notes_search_vector_update BEFORE INSERT OR UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();`
- **Verification gate**: after running the migration against local Docker Postgres, `\d notes` (via `psql` or Prisma Studio) SHALL show `search_vector` as `tsvector`, the GIN index present, and all three `CHECK` constraints listed — this is a manual `/implement`-phase verification step, not an automated test (no test DB/test runner touches migrations directly per `FRS-0.3.3`).

**Pinned:** `prisma@6.1.0`, `@prisma/client@6.1.0` (kept in lockstep — Prisma requires matching CLI/client major.minor).

### 4.3 Cleanup job stub (resolved Q6)

```typescript
// apps/api/src/jobs/cleanup.job.ts
export function startCleanupJob(): void {}
```

- No `node-cron` import, no schedule string, no Prisma calls. `app.ts` SHALL NOT import this file in this ticket (confirmed in spec §4). Its only purpose is a typecheck-clean import target for whichever of `AB-1002`/`AB-1004`/`AB-1009` first implements real purge logic under `FRS-8a`.

### 4.4 `apps/api` runtime dependencies (proposed pins, verify per `FRS-0.3.1`)

`express@5.0.1`, `cors@2.8.5`, `dotenv@16.4.7`, `bcrypt@5.1.1`, `jsonwebtoken@9.0.2`, `node-cron@3.0.3` (installed now for the future `cleanup.job.ts` implementation, unused import-free in this ticket), `zod@3.24.1` (peer of `@shared/core`). Dev: `tsx@4.19.2` (local dev server), `tsup@8.3.5` (build), `vitest@2.1.8`, `@vitest/coverage-v8` (matching `vitest` version exactly — required for the `--coverage` flag to work at all; its absence is a real install-time failure, not an edge case), `supertest@7.0.1`, `@types/express@5.0.0`, `@types/cors@2.8.17`, `@types/bcrypt@5.0.2`, `@types/jsonwebtoken@9.0.7`, `@types/supertest@6.0.2`.

**`apps/api/package.json` test script (Vitest zero-test-file fix):** `"test": "vitest run --passWithNoTests"`. Without `--passWithNoTests`, Vitest exits code `1` ("No test files found") on a scaffolding-only tree, which would fail `pnpm turbo run test` before any feature ticket has written a single test. This flag is mandatory in this ticket, not optional polish. **`--coverage` is deliberately not baked into the script** — it is supplied by the DoD command itself (`pnpm turbo run test -- --coverage`, §11); hardcoding it here too caused a real `vitest` CLI failure during `/implement` (`Expected a single value for option "--coverage"`) from the flag being passed twice.

---

## 5. `apps/web` — Frontend Scaffolding

### 5.1 Exact layered directory tree

```
apps/web/
├── package.json
├── tsconfig.json                # extends ../../packages/config/tsconfig.base.json
├── vite.config.ts               # React plugin, path aliases (@/* -> src/*)
├── index.html
├── src/
│   ├── main.tsx                 # ReactDOM.createRoot mount only
│   ├── App.tsx                  # Router provider shell — NO routes/pages registered yet
│   ├── store/
│   │   └── .gitkeep              # useAuthStore.ts, useUiStore.ts land in AB-1002/AB-1010
│   ├── api/
│   │   └── .gitkeep              # axios client + interceptors land in AB-1002/AB-1010
│   ├── hooks/
│   │   └── .gitkeep
│   ├── components/
│   │   └── .gitkeep
│   ├── pages/
│   │   └── .gitkeep
│   └── types/
│       └── .gitkeep
└── CLAUDE.md
```

- `App.tsx` SHALL render a placeholder shell (e.g. a single empty `<div />` or a minimal "app scaffolding ready" text node) with **no** `react-router-dom` route table populated yet — routing structure (`/login`, `/notes`, `/trash`, etc.) is `AB-1010`/`AB-1011` scope.
- No Zustand store, no TanStack Query provider, no shadcn/ui component is instantiated in this ticket — only the empty directories exist so those tickets don't need to first create the directory structure.

### 5.2 `apps/web` dependencies (proposed pins, verify per `FRS-0.3.1`)

Runtime: `react@19.0.0`, `react-dom@19.0.0`. Dev: `vite@6.0.5`, `@vitejs/plugin-react@4.3.4` (verify against the installed `vite` major — `@vitejs/plugin-react`'s latest tag does not necessarily support the locked Vite major; check peer deps before pinning), `typescript@5.7.2` (already root), `vitest@2.1.8`, `@vitest/coverage-v8` (matching `vitest` exactly), `@playwright/test@1.49.1`.

**Explicitly NOT installed in this ticket** (deferred to the ticket that first uses them, avoiding unused-dependency lint noise and premature version-pinning risk): `@tanstack/react-query`, `zustand`, `@tiptap/react` + extensions, `axios`, shadcn/ui + Radix primitives, `tailwindcss`, `lucide-react`, `sonner`, `react-hook-form` + `@hookform/resolvers`. `AB-1010` (first frontend ticket) installs these as part of its own plan — installing a rich-text editor and toast library in a project-setup ticket would be scope creep beyond `FRS §0`.

**`apps/web/package.json` test script (Vitest zero-test-file fix):** `"test": "vitest run --passWithNoTests"` — same mandatory flag and same `--coverage`-supplied-externally reasoning as `apps/api` (§4.4).

---

## 6. Turborepo Pipeline (`turbo.json`)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {
      "dependsOn": []
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    }
  }
}
```

- `lint` has no dependency on `^build` — it can run on raw source instantly.
- `typecheck`/`test` depend on `^build` because `apps/api`/`apps/web` import `@shared/core`'s built `.d.ts`/JS output, not its raw TS source (workspace `exports` map points at `dist/`).
- **Zero-code green state**: with only `.gitkeep`/stub files and no test files, `pnpm turbo run test` SHALL still exit `0`. This is **not** Vitest's default behavior — Vitest exits code `1` with `Error: No test files found` when zero test files match, which would fail this exact gate on a scaffolding-only tree. This ticket therefore MUST mandate `--passWithNoTests` in every workspace's `test` script (`apps/api`, §4.4; `apps/web`, §5.2) as the concrete fix, not merely assume a pass. (A 3-line baseline sanity test, e.g. `apps/api/tests/sanity.test.ts` with `expect(true).toBe(true)`, is an acceptable alternative to the flag for any workspace where a reviewer prefers a real test file to exist over a CLI flag — but `--passWithNoTests` is the single mechanism this plan commits to for both `apps/api` and `apps/web`, so `/tasks` does not need to author placeholder test files.)

---

## 7. Context7 MCP Registration (resolved: `FRS-0.3.1` mechanism)

`.mcp.json` gains a second server entry alongside the existing `code-review-graph`:

```json
{
  "mcpServers": {
    "code-review-graph": { "...": "unchanged" },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "type": "stdio"
    }
  }
}
```

- Exact package name/command SHALL be verified at `/implement` time (this is itself an instance of the `FRS-0.3.1` problem — don't trust this plan's guess at the invocation command; confirm via the MCP's own published install docs before writing the final `.mcp.json` entry).
- Root `CLAUDE.md` gains a new numbered section (after existing §1 MCP Priority) documenting: _"Before generating code against any third-party library API (Prisma, Express 5, TipTap, TanStack Query, etc.), consult Context7 MCP for current API shape rather than relying solely on training data — binding per `FRS-0.3.1`."_
- **Verification gate**: after registration, invoke one real Context7 query (e.g. resolve-library-id + get-library-docs for `express`) during `/implement` to prove the server actually responds — satisfying spec.md's requirement that this be "a genuinely working, invocable MCP tool," not just a config entry.

---

## 8. Domain `CLAUDE.md` Files (3 missing files)

| File                        | Required content (scoped strictly to that workspace)                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/CLAUDE.md`        | Zero SQL/Zod in `controllers/`+`routers/`; layer-import direction (`routers→controllers→services→repositories`); bcrypt rounds=12 constant location; reference to the new `eslint-plugin-import` boundary rule (§2) as the automated enforcement mechanism. |
| `apps/web/CLAUDE.md`        | TanStack Query vs. Zustand boundary (`docs/ux.md §7`); access token strictly in `useAuthStore` memory, never `localStorage` (`FRS-1.3.5`); every filter/sort/search change issues a fresh backend request, never a local re-slice (`FRS-8.4`).              |
| `packages/shared/CLAUDE.md` | Pure TypeScript/Zod only — zero runtime deps beyond `zod`; every exported schema must have a matching `z.infer` type in `types/`; barrel `index.ts` files must stay in sync with new files added.                                                           |

Each file SHALL be short (target 20–40 lines) and SHALL NOT restate root `AGENTS.md`/`CLAUDE.md` content verbatim — only workspace-specific deltas, per spec §"Domain AI-governance files" scenario.

---

## 9. `.claude/skills/` Directory

Create `.claude/skills/` (currently missing per `SDS §1.1`'s directory contract) as an empty directory with a `.gitkeep` — no skill scripts authored in this ticket (none are mandated by any `FRS-0.x` line item; this only closes the directory-existence gap flagged in spec.md).

---

## 10. Critical NoteApp Rules — Confirmation Matrix

| Rule                                                               | Status in AB-1001                                                                 | Where enforced going forward                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@shared/core` SSOT, zero duplication (`Rule 11`, `FRS-8.5`)       | Scaffolded (empty barrels + `ApiResponse<T>`); no domain DTOs to duplicate yet    | Every `AB-1002+` ticket's plan must import from `@shared/core`, never redefine |
| `/api/v1` namespace + unified response wrapper (`FRS-8.6`)         | `ApiResponse<T>` type exists; no routes exist to wrap yet                         | `AB-1002`'s first controller returns `ApiResponse<T>`                          |
| Controllers: zero SQL/Zod (`AGENTS.md §5`)                         | No controllers exist; automated boundary lint rule (§2) is in place pre-emptively | `pnpm turbo run lint` fails any future violation                               |
| Access token in-memory, refresh in `HttpOnly` cookie (`FRS-1.3.5`) | No auth code exists; `store/` dir empty                                           | `AB-1002`/`AB-1010` implement `useAuthStore`                                   |
| Soft-delete `deletedAt` (`FRS-2.2`)                                | `Note.deletedAt` column exists in schema; zero transition logic                   | `AB-1004` implements trash state machine                                       |
| Test DB isolation, `notes_app_test` (`FRS-0.3.3`)                  | `.env.test.example` scaffolded; `test-writer.md` already states the rule          | Every test file created from `AB-1002` on must load `.env.test`                |

---

## 11. Definition-of-Done Verification Sequence (`CLAUDE.md §6`)

Run in this exact order once all scaffolding above lands:

```bash
docker compose up -d postgres
pnpm install --frozen-lockfile
pnpm --filter @apps/api prisma migrate dev --name init   # [y/n] gate — DB migration
pnpm turbo run build       # tsup: packages/shared, apps/api — expect 0 errors
pnpm turbo run lint        # --max-warnings 0 across all 5 workspaces
pnpm turbo run typecheck   # tsc --noEmit, 0 errors
pnpm turbo run test -- --coverage   # each workspace's "test" script includes --passWithNoTests (§6) — 0 test files = valid green, not a failure
```

A malformed-commit rejection (`git commit -m "bad message"` SHALL be rejected by `.husky/commit-msg`) SHALL also be manually verified once, per spec.md's `FRS-0.5` scenario.

---

## 12. Explicitly Deferred (do not create in `/implement` for this ticket)

- Any file under `apps/api/src/{controllers,services,repositories}/` beyond `.gitkeep` placeholders.
- Any file under `apps/web/src/{components,pages,hooks}/` beyond `.gitkeep` placeholders.
- `apps/api/src/index.ts`/`server.ts` entrypoint (`app.listen(...)`) — nothing to serve yet.
- Swagger/OpenAPI mounting (`FRS-8.7`) — no schemas to introspect yet.
- GitHub Actions / CI (confirmed out of scope in spec.md).
- `apps/web` UI dependency installs (TanStack Query, Zustand, TipTap, shadcn/ui, Tailwind) — deferred to `AB-1010`.

---

**Waiting for explicit `APPROVED` confirmation before proceeding to `/tasks`.**
