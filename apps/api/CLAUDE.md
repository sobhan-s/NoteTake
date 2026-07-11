# CLAUDE.md — apps/api (Domain Blueprint)

Authoritative rules for `apps/api`. Root `AGENTS.md`/`CLAUDE.md` govern monorepo-wide standards (`crg`, git gates, `/tasks` DoD, commit format) and are never restated here.

## Four-Layer Architecture (Strict Invariant)

```
Router  →  Controller  →  Service  →  Repository  →  Database
  │             │            │             │
  └─ Auth/Rate  └─ Zod parse └─ Business & └─ Prisma Client
     Guards        & Wrapper    Transactions   & Raw SQL
```

- **Routers** (`src/routers/`): HTTP paths (`/api/v1/...`), OpenAPI `@swagger` tags, rate limits, and auth guards (`authenticate`, `requireVerified`). **Zero parsing, zero business logic.**
- **Controllers** (`src/controllers/`): HTTP boundary adapters. Validate inputs (`req.body/query/params`) using Zod schemas imported from `@shared/core`. Call exactly one service method. Wrap output in `{ success: true, data }`. Forward errors via `next(err)`. **Zero SQL, zero `z.object()` definitions, zero Prisma calls.**
- **Services** (`src/services/`): Core domain logic. **Zero HTTP context** (no `req`/`res`). Enforce ownership (`note.userId === currentUserId`; throw `404 Not Found` for IDOR defense per `SDS §2.2`). Orchestrate multi-step mutations inside `prisma.$transaction(async (tx) => { ... })`. Emit domain audit logs (`FRS-8.3`).
- **Repositories** (`src/repositories/`): Pure DB access (`Prisma Client` + native `$queryRawUnsafe`). Methods inside transaction flows MUST accept optional `tx: Prisma.TransactionClient = prisma`. Enforce `deletedAt IS NULL` on standard reads.

## Unified API Response Shape (`FRS-8.6`)

Every endpoint MUST respond with exactly one of these two structures:

```json
// Success
{ "success": true, "data": { ... } }

// Failure
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human readable summary.", "details": { ... } } }
```

- All error codes (`UNAUTHORIZED`, `NOTE_NOT_FOUND`, `NOTE_TRASHED`, `RATE_LIMIT_EXCEEDED`, `OTP_EXPIRED`) MUST be imported from `@shared/core`. Never hardcode raw strings.

## Database & Domain Naming

| Component Layer | Naming Convention            | Example Directory/File                 |
| :-------------- | :--------------------------- | :------------------------------------- |
| **Router**      | camelCase + `.router.ts`     | `src/routers/notes.router.ts`          |
| **Controller**  | camelCase + `.controller.ts` | `src/controllers/notes.controller.ts`  |
| **Service**     | camelCase + `.service.ts`    | `src/services/notes.service.ts`        |
| **Repository**  | camelCase + `.repository.ts` | `src/repositories/notes.repository.ts` |
| **Cron Job**    | camelCase + `.job.ts`        | `src/jobs/cleanup.job.ts`              |

## PostgreSQL 16 & Prisma Rules

- **Native `Citext`**: `User.email` and `Tag.name` use `@db.Citext`. **Never** use `.toLowerCase()` or `mode: 'insensitive'` hacks; PostgreSQL handles case-insensitive index lookups automatically.
- **Full-Text Search (`tsvector`)**: `Note.search_vector` (`GIN` index) is auto-weighted (`title=A, body=B`) via DB trigger `notes_search_vector_update()`. **Never** mutate `search_vector` in Prisma inserts/updates.
- **XSS-Safe Highlighting (`ts_headline`)**: Raw SQL (`$queryRawUnsafe`) for search snippets **ALWAYS** passes strict sentinels (`FRS-4.2.1`):
  `ts_headline('english', body, query, 'StartSel=[[[MARK]]], StopSel=[[[MARK_END]]], MaxWords=35, MinWords=15')`
  **Never** return HTML tags (`<b>`, `<mark>`) from SQL; `apps/web` splits on `[[[MARK]]]` client-side.

## Two-Stage Soft Delete & Retention (`FRS-2.2`)

- **Stage 1 (Days 1–30, User Trash)**: Deletion sets `deletedAt = now()`. Note and relations remain (`deletedAt IS NOT NULL`) and are restorable via `/api/v1/notes/trash`.
- **Stage 2 (Days 31–60, Audit Only)**: When `now() - deletedAt > 30 days`, note is excluded from user endpoints (`404 Note Not Found`), retained solely for audit compliance.
- **Nightly Purge Job (`03:00 UTC`)**: Physical `DELETE FROM notes` executes ONLY on Stage 2 notes where `deletedAt < now() - 60 days`. **Never** physically `DELETE` from controllers or services.

## Testing & Secrets Governance

- **Secrets (Tier 2)**: JWT secrets, `BCRYPT_ROUNDS = 12`, cron strings live in `src/constants/` (Tier 2). **Never** expose to `@shared/core` or `apps/web`.
- **Isolation Contract**: All tests (`unit`, `supertest`) MUST verify connection to isolated `notes_app_test` (`Rule 10`). Trace tests directly to `FRS-x.y.z` requirement IDs.
