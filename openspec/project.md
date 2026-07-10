# OpenSpec Project Context (`openspec/project.md`)

Canonical specification summary for OpenSpec (`@fission-ai/openspec`) across all `/spec`, `/plan`, `/tasks`, and `/implement` phases (`AB-1001` to `AB-1016`).

## 1. Project Overview (`[FRS §1–§8]`)
Full-stack Note-Taking App (`apps/api` Express 5 + `apps/web` React 19 + `packages/shared` Zod/types). Features:
- **Auth**: Case-insensitive `Citext` email, 6-digit OTP states (`CONSUMED | INVALIDATED`), 15m JWT in client JS memory (`useAuthStore`), 7d `HttpOnly` cookie refresh sessions (`refreshToken`) with silent rotation and rate limiting (`5 wrong passwords / 15m -> 429`).
- **Notes & Trash**: Rich-text TipTap notes with two-stage soft delete: Stage 1 (`30d restorable`) -> Stage 2 (`30d audit-only`) -> permanent cascade purge (`03:00 UTC` cron).
- **Organization**: `Citext` user-scoped tags, live note count badges, and `Fly Tags` quick creation from editor.
- **Search**: Native `tsvector` + GIN index (`Title=A`, `Body=B`) with XSS-safe highlighted snippets (`[[[MARK]]]`/`[[[MARK_END]]]`).
- **Sharing & Versions**: Public read-only URLs (`/api/v1/public/share/:token`) with atomic view counts + expiration (`expiresAt`/`revokedAt`), plus append-only title/body snapshots (`NoteVersion`).

## 2. Tech Stack (`Locked & Pinned — Rule 20`)
- **Runtime**: Node.js 22 LTS · TypeScript 5.x · `pnpm workspaces` (v9.x) · Turborepo (`build` depends on `^build`)
- **Backend (`apps/api`)**: Express 5 · Prisma ORM 16 (`Citext` native extension) · Zod 3.x · Node Cron
- **Frontend (`apps/web`)**: React 19 · Vite 6 · TanStack Query v5 · Zustand · TipTap (`@tiptap/react`) · shadcn/ui
- **Database**: PostgreSQL 16 Alpine (`Citext` + GIN indexes; isolated `notes_app` dev & `notes_app_test` test containers)
- **Zero Version Ranges (`Rule 20`)**: All manifests pinned to exact versions (`no ^ ~ * >=`).

## 3. Architecture & Layering (`Rule 11`)
- **Single Source of Truth (`@shared/core`)**: Both `apps/api` and `apps/web` MUST import schemas (`src/schemas/`), DTOs (`src/types/`), and Tier 1 constants (`src/constants/`) from `packages/shared`. Zero duplication allowed.
- **Backend Layers (`apps/api`)**: `routers/ -> controllers/ -> services/ -> repositories/ -> shared`.
  - `controllers/`: HTTP parsing + unified `{ success: true, data }` response only. Zero SQL or Zod schemas allowed.
  - `services/`: Business transactions, ownership verification, soft-delete transitions.
  - `repositories/`: Prisma Client calls (`prisma.note...`) and raw SQL queries (`$queryRaw`) only.
- **Frontend State (`apps/web`)**: TanStack Query for server fetching/caching; Zustand (`useAuthStore`) for JS memory JWT access token (`Authorization: Bearer`). NEVER store tokens in `localStorage`/`sessionStorage` (`[FRS-1.3]`).

## 4. Conventions & Quality Gates (`DoD, Rule 12`)
- **REST & Commits**: Endpoints prefixed with `/api/v1`. Swagger docs at `/api/v1/docs`. Commits formatted as `type(scope): description AB#ticket` (`feat|fix|chore|docs|refactor|test`).
- **Quality Verification Checkpoints**: All 4 must pass before commit or PR (`/pr`):
  1. `pnpm turbo run build` (`0 errors` — `tsup` ESM bundling for `@shared/core` via `^build`)
  2. `pnpm turbo run lint` (`--max-warnings 0`)
  3. `pnpm turbo run typecheck` (`tsc --noEmit`, 0 static errors)
  4. `pnpm turbo run test -- --coverage` (`≥80% coverage on new code` against isolated `notes_app_test` DB per `[FRS-0.3.3]`). `test-writer.md` derives tests solely from numbered `FRS-x.y.z` text (`[FRS-0.3.2]`).
