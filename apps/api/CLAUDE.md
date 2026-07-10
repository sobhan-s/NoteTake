# CLAUDE.md — apps/api

Domain rules for the Express 5 backend. Root `AGENTS.md`/`CLAUDE.md` govern everything not restated here.

## Layering (strict)

`routers/ → controllers/ → services/ → repositories/ → shared`. Import direction only flows one way — enforced automatically by the `no-restricted-imports` rules in `eslint.config.js` (`pnpm turbo run lint` fails on any violation, not just code review).

- **Controllers**: `schema.parse(req.body)` + call a service + return `{ success: true, data }` / `{ success: false, error }`. Zero SQL, zero Zod schema _definitions_ (schemas are imported from `@shared/core`, never written here).
- **Services**: transactions, ownership checks, state transitions.
- **Repositories**: Prisma Client / `$queryRaw` only. Never import from `controllers/` or `routers/`.

## Secrets & Tier 2 constants

JWT secrets, bcrypt work factor (`12`), and `CRON_CLEANUP_SCHEDULE` live in `apps/api/src/constants/` (Tier 2, backend-only) — never in `@shared/core`, never hardcoded inline.

## Soft delete

Delete = `deletedAt = now()`. Never a physical `DELETE` on `notes`.
