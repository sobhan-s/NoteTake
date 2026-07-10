# AGENTS.md — Note-Taking App (Universal AI Brain)

Single source of truth for all AI tools and developers. If code conflicts with this file, this file wins; if this file conflicts with `docs/FRS.md`/`docs/SDS.md`, the docs win — update this file to match.

## 1. Project Overview

Authenticated CRUD note-taking app with rich-text (TipTap) editing, a two-stage Trash (30-day restorable + 30-day audit-only, then permanent purge), user-scoped tags with live counts, PostgreSQL full-text search with highlighted snippets, public read-only share links with atomic view counting, and append-only version history snapshots with restore.

## 2. Repository Structure

```
/
├── apps/
│   ├── api/                  # Express 5 + TS + Prisma backend
│   │   ├── prisma/           # schema.prisma, migrations/ (citext, tsvector GIN)
│   │   ├── src/
│   │   │   ├── routers/      # /api/v1 route declarations
│   │   │   ├── controllers/  # HTTP handling + Zod parse only
│   │   │   ├── services/     # business logic, transactions
│   │   │   ├── repositories/ # Prisma Client + raw SQL
│   │   │   ├── middlewares/  # auth, rate-limit, error handling
│   │   │   ├── jobs/         # node-cron cleanup.job.ts (03:00 UTC)
│   │   │   └── app.ts
│   │   └── CLAUDE.md
│   └── web/                  # React 19 + Vite + TS SPA
│       ├── src/
│       │   ├── components/   # atomic UI components (shadcn/ui, TipTap editor)
│       │   ├── pages/        # route views (Login, NotesDashboard, Trash, Share)
│       │   ├── hooks/        # custom React hooks (useNoteAutosave, useDebounce)
│       │   ├── store/        # Zustand state stores (useAuthStore, useUiStore)
│       │   ├── api/          # Axios/fetch HTTP clients with credential interceptors
│       │   └── types/        # UI-specific view DTOs & theme types
│       └── CLAUDE.md
├── packages/
│   ├── shared/               # @shared/* — single source of truth (Rule 11)
│   │   ├── src/
│   │   │   ├── schemas/      # Zod validation schemas (auth, notes, tags, sharing)
│   │   │   ├── types/        # inferred TypeScript DTOs (z.infer<typeof schema>)
│   │   │   └── constants/    # Tier 1 constants (API_PATHS, APP_LIMITS, UI_COPY)
│   │   └── CLAUDE.md
│   └── config/               # @config/* — eslint, prettier, tsconfig.base.json
├── openspec/                  # config.yaml, changes/, archive/, specs/
├── .claude/
│   ├── commands/              # /start /spec /plan /tasks /implement /review /pr
│   ├── agents/                # reviewer.md, test-writer.md
│   └── settings.json
├── docker-compose.yml         # postgres:16-alpine
├── turbo.json                 # build depends on ^build
├── AGENTS.md                  # this file
└── CLAUDE.md                  # root permissions, quality gates
```

## 3. Tech Stack (Locked & Pinned — Rule 20)

Node.js **22 LTS** · Express **5** · TypeScript **5.x** · React **19** · Vite **6** · TanStack Query **v5** · Zustand · TipTap (`@tiptap/react`) · shadcn/ui · PostgreSQL **16 Alpine** (`Citext` + GIN index) · Prisma ORM (native `citext` extension via `previewFeatures = ["postgresqlExtensions"]`) · `pnpm workspaces` **9.x** · Turborepo (`build` depends on `^build`) · Vitest · Supertest · Playwright.

**Zero `^`, `~`, `*`, `>=` ranges anywhere** in any `package.json`. Every dependency pinned to an exact version. Zero `@latest` in install scripts.

## 4. Key Commands

- **Setup**: `pnpm install --frozen-lockfile` && `docker compose up -d postgres`
- **DB migrate**: `pnpm --filter @apps/api prisma migrate dev`
- **Dev server**: `pnpm turbo run dev`
- **Lint** (Rule 12): `pnpm turbo run lint` — `--max-warnings 0`
- **Typecheck**: `pnpm turbo run typecheck` — `tsc --noEmit` only, never used to emit/compile
- **Build**: `pnpm turbo run build` — `tsup` bundles `apps/api` + `packages/shared` via `^build`
- **Test**: `pnpm turbo run test -- --coverage` — Vitest (unit) + Supertest (contract) + Playwright (E2E), ≥80% coverage on new code, all green
- **Graph tools**: `uvx code-review-graph build` / `detect_changes_tool`
- PR gate: no `/pr` unless lint + typecheck + build + test all pass AND `/review` agent returns all ✅. When invoked, `/pr` executes `openspec archive <ticket>` and immediately separates the archive folder out to `openspec/archive/<ticket>` before staging (`git add .`) and committing.

## 5. Architecture & Layering

- `packages/shared` is the absolute single source of truth (`Rule 11`, `FRS-8.5`). Both `apps/api` and `apps/web` import schemas/types/constants from `@shared/*`. **No DTO or validation rule is ever duplicated across workspaces.**
- Backend is strictly layered: `routers/ → controllers/ → services/ → repositories/ → shared`.
  - Controllers: `schema.parse(req.body)` + call service. Zero business logic, zero SQL.
  - Services: transactions, ownership checks, state transitions.
  - Repositories: Prisma Client / raw SQL only.
  - **Zero Zod schemas or SQL queries in controllers or routers.**
- 3-Tier constants (Rule 11, FRS-8.5): Tier 1 shared (`packages/shared/src/constants`: `API_PATHS`, `APP_LIMITS`, `VALIDATION_MESSAGES`, `ERROR_CODES`, `UI_COPY`); Tier 2 backend-only (`apps/api/src/constants`: JWT secrets, bcrypt rounds=12, `CRON_CLEANUP_SCHEDULE`); Tier 3 frontend-only (`apps/web/src/constants`: debounce delays, refetch intervals, TanStack keys). Every FRS-mandated numeric value maps to exactly one named export — never hardcoded, never re-derived.

## 6. Coding Standards & Error Handling

- Explicit return types on all exported functions.
- `tsup` bundles `apps/api` and `packages/shared`; `tsc --noEmit` is reserved strictly for type verification, never for compilation.
- Unified API response wrapper on every endpoint:
  - Success: `{ success: true, data: T }`
  - Failure: `{ success: false, error: { code: string, message: string, details?: any } }`
- ESLint `--max-warnings 0`, Prettier, shared `tsconfig.base.json` strict mode across all workspaces.
- Commit format (binding): `type(scope): description AB#ticket`, e.g. `feat(auth): implement user registration AB#1002`. Types: `feat|fix|chore|docs|refactor|test`. Enforced by `commitlint` + Husky `commit-msg` hook.

## 7. Auth Approach (`FRS-1.3`, SDS §3.1)

- **Access token**: JWT, 15-minute expiry (`APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES`), payload `{ userId, email, isVerified }`. Held **purely in client JS memory** via Zustand `useAuthStore` — **NEVER** in `localStorage`/`sessionStorage`. Sent as `Authorization: Bearer <token>`.
- **Refresh token**: 7-day expiry (`APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS`), 64-byte random hex, SHA-256 hashed and stored in `RefreshSession.tokenHash`. Raw token returned only in an `HttpOnly` + `Secure` + `SameSite=Strict` cookie named `refreshToken`. Individually revocable (`revokedAt`).
- Silent rotation: 401 on expired access token → Axios interceptor calls `POST /api/v1/auth/refresh` → old session revoked, new cookie + new in-memory access token issued.
- Logout revokes only the session's own refresh token; other devices unaffected (`FRS-1.4.1`).
- Login rate limit: 5 wrong-password attempts / 15 min per email → 429 for 15 min. Counts **wrong-password failures only** — a correct-password-but-unverified attempt never counts (`FRS-1.3.4` v2.1 decision).
- OTP terminal states are strictly distinct and independently queryable (`FRS-1.2.4a`):
  - `CONSUMED` — entered correctly, single-use, permanent.
  - `INVALIDATED` — hit the 3-attempt cap without succeeding; requires a fresh OTP.
  - Never conflate the two in queries or audit logic.
- OTPs: 6 digits, 10-min expiry, 60s resend cooldown, 3 max attempts, console-logged only (no real email, `FRS-8.3`).

## 8. API Design Conventions

- RESTful, every route namespaced under `/api/v1` (`FRS-8.6`). Interactive Swagger docs at `/api/v1/docs` (`FRS-8.7`), generated from `packages/shared` schemas.
- Status codes: `200 OK` (success/reads), `201 Created` (new resource), `400 Bad Request` (validation), `401 Unauthorized` (auth missing/invalid), `403 Forbidden` (unverified account, IDOR-blocked tag attach), `404 Not Found` (cross-user access, Stage-2 note, purged version — never "forbidden" for cross-user), `410 Gone` (unused — invalid share links return `404`, not `410`, per SDS §2.2), `422 Unprocessable Entity` (semantic validation failures), `429 Too Many Requests` (rate limits, OTP cooldown/cap).
- `/api/v1/public/share/:token` is the only unauthenticated data-returning route; it performs one atomic `UPDATE ... RETURNING` that increments the view counter and enforces `deletedAt IS NULL` + `revokedAt IS NULL` + `expiresAt > NOW()` in a single query — zero rows returned means `404` "no longer available," identical for expired/revoked/trashed (never disambiguated to the caller).

## 9. DB Schema & Soft Delete (`FRS-2.2`, SDS §2)

- **User** (`email @db.Citext @unique`), **OtpCode** (`type: EMAIL_VERIFICATION|PASSWORD_RESET`, `status: PENDING|CONSUMED|INVALIDATED`), **RefreshSession** (`tokenHash`, `revokedAt`), **Note** (`deletedAt` indexed with `userId` for Stage 1/2 soft-delete; `search_vector tsvector`), **Tag** (`name @db.Citext`, unique per `userId`), **NoteTag** (join), **NoteVersion** (`titleSnapshot`, `bodySnapshot`, indexed `noteId, createdAt desc`), **NoteShare**/`ShareLink` (`token`, `viewCount`, `expiresAt`, `revokedAt`).
- All datetimes `@db.Timestamptz(6)`, UTC (`FRS-8.2`).
- Soft delete: `deletedAt` set on delete (Stage 1, 30 days restorable) → auto Stage 2 (30 more days, DB-only, not user-accessible) → nightly job permanently cascades notes + versions + tags + share links.
- Full-text search: trigger `notes_search_vector_update()` populates `search_vector` (`setweight` title=A, body=B) on insert/update; `GIN` index `notes_search_vector_gin`. `ts_headline` uses `StartSel=[[[MARK]]], StopSel=[[[MARK_END]]]` sentinels — XSS-safe, rendered client-side via string split, never `dangerouslySetInnerHTML` (`FRS-4.2.1`).

## 10. Testing & Database Isolation Contract (`FRS-0.3.2`, `FRS-0.3.3`)

- `test-writer.md` MUST derive tests solely from numbered `FRS-x.y.z` requirement text (`SHALL` statements, Error Scenarios, Out-of-Scope boundaries) and `SDS.md` API/DB contracts — **NOT** from Acceptance Criteria bullet wording. An AC line must never be copied/reworded into a test name or assertion. One AC item typically yields several tests covering boundaries, concurrency, and negative paths the checklist never enumerated (e.g. FRS-1.3.4 → 4th/5th/6th-attempt tests, the 15-min-minus-1s boundary, per-email isolation — not one "rate limit works" test).
- `reviewer.md` checks coverage against FRS requirement IDs/SDS contracts directly, never against AC-line-to-test-name matching.
- All `supertest` and `playwright` suites MUST run against an isolated `notes_app_test` database (`.env.test` or `@testcontainers/postgresql`). **Zero** connections to `notes_app` (dev) or production. **Zero** `sqlite::memory:` substitution — native `citext`/`tsvector` require real PostgreSQL 16.
- Suites truncate tables (`TRUNCATE ... CASCADE`) before/after runs for determinism — only ever against the test DB. Every test suite running `TRUNCATE` MUST check `process.env.DATABASE_URL?.includes('notes_app_test')` before truncating to prevent accidental data loss (`Rule 10`).

## 11. Do NOT Do (Strict Anti-Patterns)

- NO storing JWT access tokens (or refresh tokens) in `localStorage`/`sessionStorage`.
- NO `^`, `~`, `*`, `>=` version ranges anywhere in any `package.json`; NO `@latest`.
- NO bypassing `packages/shared` or duplicating interfaces/schemas/constants across workspaces.
- NO `TRUNCATE TABLE` or any test execution against `notes_app` or a production database.
- NO copying/rewording FRS Acceptance Criteria lines into test names or assertions.
- NO Zod schemas or raw SQL inside `controllers/` or `routers/`.
- NO real email sending — OTPs/notifications are console-logged only.
- NO client-side re-sort/re-filter/re-search of an already-fetched page — every criteria change is a fresh backend request (`FRS-8.4`).
- NO resurrecting an old share link on note restore — a new link must be generated (`FRS-2.2.4`).
- NO hardcoded numeric literals for anything listed in `APP_LIMITS` — reference the constant.

## 12. Shared Packages (`packages/shared`)

- `src/schemas/` — Zod schemas (auth, notes, tags, search, sharing) — canonical validation source for both client and server.
- `src/types/` — inferred TS DTOs (`z.infer<typeof schema>`) — never hand-duplicated.
- `src/constants/` — `API_PATHS` (`/api/v1` + route paths), `APP_LIMITS` (all FRS numeric constants: OTP timing/attempts, rate limits, token expiries, page sizes, trash/version retention, share expiry), `VALIDATION_MESSAGES`, `API_ERROR_CODES` (`OTP_EXPIRED`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED`, `NOTE_NOT_FOUND`, `NOTE_TRASHED`, `SHARE_LINK_EXPIRED`, ...), `UI_COPY` (confirmation prompts: `CONFIRM_TRASH_RESTORE`, `CONFIRM_PERMANENT_DELETE`, `CONFIRM_LOGOUT`).

## 13. OpenSpec Workflow & File Lifecycle Patterns

The repository strictly enforces three distinct structural patterns for OpenSpec (`@fission-ai/openspec`) proposals and living specifications:

1. **Active Change Proposals (`openspec/changes/<AB-xxxx-name>/`)**: When `/spec` creates a proposal, it resides here while active during implementation, testing, and review. It contains `proposal.md` (high-level objective & scope) + `specs/<domain>/spec.md` (exact RFC 2119 `SHALL/MUST` deltas), plus operational tracking files (`plan.md`, `tasks.md`, `review-log.md`). Note: `review-log.md` is the sole log where important feature review notes and action items are tracked (`fix-bundles` are not used at all).
2. **Archived Proposals (`openspec/archive/<AB-xxxx-name>/`)**: Created exclusively when `/pr` executes `openspec archive <name>` and automatically moves the folder out to the separate `openspec/archive/` root directory. Represents the immutable historical audit trail of the merged change.
3. **Canonical System Specs (`openspec/specs/<domain>/spec.md`)**: The permanent living specification representing the unified capabilities of the application once changes are merged.

---

Full detail: `docs/FRS.md` (requirements, `FRS-x.y.z` IDs) and `docs/SDS.md` (architecture, schema, API contracts). This file is the compressed index — when in doubt, the docs are authoritative.
