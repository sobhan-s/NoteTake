# Sequenced Tasks for AB-1002-auth-user-verification

Source: `specs/auth/spec.md` (approved) + `plan.md`. Executed via the `/implement` Main Claude → Tester → Reviewer → Triage loop, one unchecked `[ ]` at a time, in the order listed.

Resolved open item from `plan.md` (`Exact ordering of Zod-parse vs. rate-limit middleware on POST /auth/login`): `express.json()` is mounted globally in `app.ts` before the router, so `req.body` is already parsed by the time `checkLoginRateLimit` runs. The middleware reads `req.body.email` directly (no re-parse) and is mounted **before** the controller on the router — the controller still runs `loginSchema.parse(req.body)` as the single source of validation truth. No wrapper needed.

---

## Phase 0: Context Verification (`context7`, `FRS-0.3.1`)

- [x] Verify current Prisma 6.x interactive-transaction (`prisma.$transaction(async (tx) => {...})`) row-locking semantics on a read-then-update against `context7` before writing `incrementOtpAttemptsForUpdate` — confirms `ReadCommitted` default serializes concurrent updates on the same row (`[FRS-0.3.1]`, backs the OTP-attempt-cap concurrency guarantee in spec line 31). **Resolved**: use explicit `SELECT ... FOR UPDATE` via `tx.$queryRaw` inside `prisma.$transaction` (documented Prisma pattern), not implicit locking.
- [x] Verify `bcrypt@6.0.0` and `jsonwebtoken@9.0.3` current API surface (`hash`/`compare`, `sign`/`verify` option shapes) against `context7` before implementing `token.service.ts`/`otp.service.ts` (`[FRS-0.3.1]`). **Resolved**: already-pinned versions, standard API, no changes needed.
- [x] Resolve exact pinned versions for `cookie-parser` and a Zod→OpenAPI generator (e.g. `@asteasolutions/zod-to-openapi`) via `context7`, recording the exact version strings to use in Phase 2 (`[FRS-0.3.1, Rule 20]`). **Resolved**: `cookie-parser@1.4.7` (+`@types/cookie-parser@1.4.10`), `swagger-ui-express@5.0.1` (+`@types/swagger-ui-express@4.1.8`), `@asteasolutions/zod-to-openapi@7.3.4` (v8 requires zod `^4.0.0`, incompatible with this repo's pinned `zod@3.25.76`; v7.3.4 requires `^3.20.2`).

## Phase 1: Foundation & Shared Tier (`packages/shared` — Rule 11, `FRS-8.5`)

_All DTOs, Zod schemas, and Tier 1 constants for this ticket live exclusively in `packages/shared`; zero duplication into `apps/api` — `AGENTS.md §5`._

- [x] `packages/shared/src/constants/app-limits.constant.ts`: add `OTP_LENGTH=6`, `OTP_EXPIRY_MINUTES=10`, `OTP_MAX_ATTEMPTS=3`, `OTP_RESEND_COOLDOWN_SECONDS=60` (`[FRS-1.2.1, FRS-1.2.3, FRS-1.2.4]`).
- [x] `packages/shared/src/constants/app-limits.constant.ts`: add `LOGIN_RATE_LIMIT_MAX_ATTEMPTS=5`, `LOGIN_RATE_LIMIT_WINDOW_MINUTES=15`, `ACCESS_TOKEN_EXPIRY_MINUTES=15`, `REFRESH_TOKEN_EXPIRY_DAYS=7` (`[FRS-1.3.2, FRS-1.3.3, FRS-1.3.4]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: add `API_PATHS.BASE = "/api/v1"` and `API_PATHS.AUTH = { REGISTER, VERIFY_OTP, RESEND_OTP, LOGIN, REFRESH, LOGOUT, ME }` (`[FRS-8.6]`).
- [x] `packages/shared/src/constants/api-error-codes.constant.ts`: add `API_ERROR_CODES.EMAIL_ALREADY_VERIFIED`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `RESEND_COOLDOWN_ACTIVE`, `INVALID_CREDENTIALS`, `ACCOUNT_NOT_VERIFIED`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED` (`[FRS-8.5]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: add user-facing validation strings referenced by the Zod schemas below — no inline literal messages in schema files (`[FRS-8.5]`).
- [x] `packages/shared/src/constants/index.ts`: re-export all four new constant files from the barrel (`[Rule 11]`).
- [x] `packages/shared/src/schemas/auth.schema.ts`: define `registerSchema` (email + password ≥8 chars/1 digit/1 symbol) (`[FRS-1.1.1, FRS-1.1.3]`).
- [x] `packages/shared/src/schemas/auth.schema.ts`: define `loginSchema` (`{ email, password }`) (`[FRS-1.3.1]`).
- [x] `packages/shared/src/schemas/auth.schema.ts`: define `verifyOtpSchema` and `resendOtpSchema`, both `.refine`-requiring exactly one of `userId`/`email` (`[FRS-1.2.4a]`).
- [x] `packages/shared/src/schemas/index.ts`: re-export `auth.schema.ts` from the barrel (`[Rule 11]`).
- [x] `packages/shared/src/types/auth.type.ts`: `z.infer` types for all four schemas, plus `AuthUserDto`, `LoginResponseDto`, `RegisterResponseDto`, `MeResponseDto` mirroring exact controller output shapes (`[Rule 11, FRS-8.5]`).
- [x] `packages/shared/src/types/index.ts`: re-export `auth.type.ts` from the barrel (`[Rule 11]`).
- [x] **Mandatory Phase 1 Checkpoint**: `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`. All green.

## Phase 2: Backend Core Implementation (`apps/api`)

_Controllers strictly do `schema.parse` + call service, zero SQL/business logic (`SDS §1.1`, `AGENTS.md §5`). Tokens issued here are never persisted client-side beyond `useAuthStore` memory (`[FRS-1.3.5]`) — that wiring is `AB-1010`'s job, not this ticket's._

- [x] `apps/api/src/constants/api.constants.ts` (new, Tier 2): `BCRYPT_ROUNDS=12`, `JWT_ACCESS_SECRET=process.env.JWT_ACCESS_SECRET!`, `JWT_ISSUER="notes-app"`, `REFRESH_TOKEN_BYTE_LENGTH=64` (`[AGENTS.md §5]`). Required adding `JWT_ACCESS_SECRET` to `.env.example`/`.env.test.example`.
- [x] `apps/api/src/errors/app-error.ts` (new): `AppError { statusCode, code, message }` class for services to throw, translated by the error middleware into the unified `{ success: false, error }` wrapper (`[SDS §1.1]`).
- [x] `apps/api/src/repositories/auth.repository.ts`: `findUserByEmail`, `findUserById` (added — needed by `refresh`/`getMe`, not listed in plan), `createUser`, `updateUserPasswordHash`, `markUserVerified` — Prisma Client only, no business logic (`[FRS-1.1.1, FRS-1.1.2, FRS-1.1.5]`).
- [x] `apps/api/src/repositories/auth.repository.ts`: `findLatestOtp`, `findOtpById`, `createOtp`, `invalidatePendingOtp`, `markOtpConsumed`, `markOtpInvalidated` (`[FRS-1.2.1, FRS-1.2.4a]`).
- [x] `apps/api/src/repositories/auth.repository.ts`: split the plan's single `incrementOtpAttemptsForUpdate` into `lockOtpRowForUpdate(tx, otpId)` (explicit `SELECT ... FOR UPDATE` per Phase 0 context7 finding) + `updateOtpAttempts(otpId, {attempts, status?})` — keeps the row-lock as a pure repository primitive while the mismatch/cap decision stays in the service (`AGENTS.md §5` layering: services own state-transition logic) (`[FRS-1.2.4, spec.md line 31]`).
- [x] `apps/api/src/repositories/auth.repository.ts`: `countRecentLoginAttempts`, `createLoginAttempt`, `deleteLoginAttemptsByEmail` (`[FRS-1.3.4]`).
- [x] `apps/api/src/repositories/auth.repository.ts`: `createRefreshSession`, `findRefreshSessionByHash`, `revokeRefreshSession`, `revokeActiveSessionsForDevice` (`[FRS-1.3.3, FRS-1.4.1]`).
- [x] `apps/api/src/services/token.service.ts`: `signAccessToken`/`verifyAccessToken` (`APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES`), `generateRefreshToken` (crypto-random, `REFRESH_TOKEN_BYTE_LENGTH`), `hashRefreshToken` (SHA-256) (`[FRS-1.3.2, FRS-1.3.3, FRS-1.3.5]`).
- [x] `apps/api/src/services/otp.service.ts`: `generateOtpCode`, `hashOtpCode` (bcrypt), `verifyOtpCodeHash`, `logOtpToConsole` — the sole OTP console-log surface (`[FRS-1.2.1, FRS-8.3]`).
- [x] `apps/api/src/services/auth.service.ts`: `register(input)` branching existing-verified/existing-unverified/absent exactly per spec, including the password-update-on-re-trigger rule (`[FRS-1.1.1–1.1.5]`).
- [x] `apps/api/src/services/auth.service.ts`: `verifyOtp(input)` — resolve latest OTP, transactional attempt-increment-or-consume, distinct `CONSUMED`/`INVALIDATED` terminal states. Uses a commit-then-throw pattern: the transaction always returns an outcome descriptor and commits (so attempt increments/invalidation persist), and the service throws the mapped `AppError` only after the transaction resolves (`[FRS-1.2.2, FRS-1.2.4, FRS-1.2.4a]`).
- [x] `apps/api/src/services/auth.service.ts`: `resendOtp(input)` — cooldown check, invalidate-and-regenerate (`[FRS-1.2.3]`).
- [x] `apps/api/src/services/auth.service.ts`: `login(input, { ipAddress, userAgent })` — wrong-password/correct-unverified/success branches, wrong-password-on-unverified still counts, same-device `RefreshSession` revoke-on-success (`[FRS-1.2.5, FRS-1.3.1, FRS-1.3.4 v2.1 decision]`).
- [x] `apps/api/src/services/auth.service.ts`: `refresh(rawCookieToken)` — hash/lookup/validate/rotate-on-use (`[FRS-1.3.3]`).
- [x] `apps/api/src/services/auth.service.ts`: `logout(rawCookieToken)` — idempotent single-session revoke, never errors on an already-gone session (`[FRS-1.4.1]`).
- [x] `apps/api/src/services/auth.service.ts`: `getMe(userId)` — read-only lookup for session hydration (`[spec.md "Session Hydration"]`).
- [x] `apps/api/src/middlewares/require-auth.middleware.ts`: parses `Authorization: Bearer`, calls `verifyAccessToken`, attaches `req.user`, else `401 UNAUTHORIZED` (never `403` for this case) (`[FRS §8 status code table]`).
- [x] `apps/api/src/middlewares/check-login-rate-limit.middleware.ts`: reads `req.body.email` (already parsed by global `express.json()`), queries `countRecentLoginAttempts`, short-circuits `429` before the controller/service run — mounted before the controller on the `login` route only (`[FRS-1.3.4]`).
- [x] `apps/api/src/middlewares/error.middleware.ts` (new): extract the inline handler out of `app.ts`, mapping `AppError` → the unified `{ success: false, error }` response (`[SDS §1.1]`).
- [x] `apps/api/src/controllers/auth.controller.ts`: `register`, `verifyOtp`, `resendOtp` handlers — `schema.parse` + service call + response shaping only (`[SDS §1.1]`).
- [x] `apps/api/src/controllers/auth.controller.ts`: `login` handler — parses body, reads `req.ip`/`req.get('user-agent')`, calls service, sets the `refreshToken` cookie (`HttpOnly+Secure+SameSite=Strict`) (`[FRS-1.3.5]`).
- [x] `apps/api/src/controllers/auth.controller.ts`: `refresh` handler — reads/rotates the cookie; `logout` handler — reads/clears the cookie, idempotent; `me` handler — reads `req.user` (`[FRS-1.3.3, FRS-1.4.1]`).
- [x] `apps/api/src/routers/auth.router.ts` (new): declare all 7 routes; attach `requireAuth` to `logout`/`me` only, `checkLoginRateLimit` to `login` only (`[FRS-8.6]`).
- [x] `apps/api/src/routers/index.ts`: mount `router.use(API_PATHS.BASE + API_PATHS.AUTH.ROOT, authRouter)` importing `API_PATHS` from `@shared/core/constants` — corrected `API_PATHS.AUTH.*` in Phase 1 from absolute (`/auth/register`) to mount-relative (`/register`) segments plus a new `ROOT: "/auth"` entry, to avoid a double `/auth/auth/...` path when `auth.router.ts` is mounted under `API_PATHS.BASE + "/auth"` (`[FRS-8.6]`).
- [x] `apps/api/package.json`: add pinned-exact `cookie-parser` dependency (version resolved in Phase 0); `apps/api/src/app.ts`: mount `cookie-parser` before the router, replace the inline error handler with `error.middleware.ts` (`[Rule 20, FRS-1.3.5]`).
- [x] `apps/api/package.json`: add pinned-exact `swagger-ui-express` + Zod-to-OpenAPI generator dependencies (versions resolved in Phase 0) (`[Rule 20, FRS-8.7]`).
- [x] `apps/api/src/docs/openapi.ts` (new): build the OpenAPI document from the 4 auth schemas + response DTOs; `apps/api/src/app.ts`: mount at `${API_PATHS.BASE}/docs` via `swaggerUi.serve`/`swaggerUi.setup` (`[FRS-8.7]`).
- [x] **Mandatory Phase 2 Checkpoint**: `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`. All green. Also ran an ad-hoc `tsx` import smoke test confirming `app.ts` boots without runtime errors.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `FRS-0.3.2, FRS-0.3.3`)

_Derived solely from `FRS-1.1–1.4`/`FRS-1.2.4a` numbered requirement text and `SDS.md` contracts — never from Acceptance Criteria wording. Runs strictly against isolated `notes_app_test` (`.env.test`), truncation guarded by `DATABASE_URL.includes('notes_app_test')`._

- [x] `apps/api/tests/unit/token.service.test.ts`: pure-function coverage of `signAccessToken`/`verifyAccessToken` expiry math, `generateRefreshToken` length/entropy, `hashRefreshToken` determinism — no DB (`[FRS-1.3.2, FRS-1.3.3]`).
- [x] `apps/api/tests/unit/otp.service.test.ts`: `generateOtpCode` format (6-digit, zero-padded), `hashOtpCode`/`verifyOtpCodeHash` round-trip — no DB (`[FRS-1.2.1]`).
- [x] `apps/api/tests/contract/auth.register.test.ts`: absent/verified/unverified-email branches, password-update-on-re-trigger, weak-password rejection, cooldown-not-yet-elapsed on re-trigger (`[FRS-1.1.1–1.1.5]`).
- [x] `apps/api/tests/contract/auth.verify-otp.test.ts`: correct code, wrong code (1st/2nd/3rd attempt boundary), expired, already-`CONSUMED` resubmission rejected, already-`INVALIDATED` rejected, cross-type isolation (`[FRS-1.2.2, FRS-1.2.4, FRS-1.2.4a]`).
- [x] `apps/api/tests/contract/auth.verify-otp.concurrency.test.ts`: concurrent mismatched-code requests against the same OTP row never exceed the 3-attempt cap (row-lock race test, per spec.md decision 2) (`[FRS-1.2.4]`).
- [x] `apps/api/tests/contract/auth.resend-otp.test.ts`: 60s cooldown boundary (just-under vs. just-over), invalidate-and-regenerate correctness (`[FRS-1.2.3]`).
- [x] `apps/api/tests/contract/auth.login.test.ts`: 4th/5th/6th wrong-password attempt boundary, 15-min-minus-1s window boundary, correct-password-unverified does NOT count, wrong-password-unverified DOES count, per-email isolation (`[FRS-1.3.4, FRS-1.2.5]`).
- [x] `apps/api/tests/contract/auth.login.session.test.ts`: same-device re-login revokes prior session (single live session per device), different-device login leaves other sessions untouched, refresh token absent from JSON body (`[FRS-1.3.5, SDS §3.2]`).
- [x] `apps/api/tests/contract/auth.refresh.test.ts`: valid rotation, expired/revoked/malformed token rejection, old token unusable after rotation (`[FRS-1.3.3]`).
- [x] `apps/api/tests/contract/auth.logout.test.ts`: revokes only the current session, idempotent on already-revoked/missing cookie, other devices unaffected (`[FRS-1.4.1]`).
- [x] `apps/api/tests/contract/auth.me.test.ts`: valid token hydration, missing/expired/malformed token → `401` (`[spec.md "Session Hydration"]`).
- [x] Added (not in original list, per Phase 2 reviewer finding): a `VALIDATION_ERROR`/400 regression test guarding the `error.middleware.ts` `ZodError` fix.
- [x] **Mandatory Phase 3 Checkpoint**: `pnpm turbo run test -- --coverage` — 57/57 green against `notes_app_test`, 97.14% statement / 100% function coverage on new `auth*` files (well above the 80% bar).

## Phase 4: OpenSpec Compliance Audit

- [x] Run `openspec validate` against the `specs/auth/spec.md` delta. Required two fixes: (1) added the missing `.openspec.yaml` manifest to the change folder (present in the archived `AB-1001` example, absent here), (2) rewrote `specs/auth/spec.md` from prose `- ADDED ...` bullets into the canonical `## ADDED Requirements` → `### Requirement:` → `#### Scenario:` delta format the CLI enforces (same content, restructured, per the `AB-1001` archived example). `openspec validate "AB-1002-auth-user-verification" --type change --strict` now passes: "Change 'AB-1002-auth-user-verification' is valid". Note: `openspec validate --changes` (batch mode) reports "No items found" even now — appears to be a CLI discovery quirk in this openspec version (1.5.0), not a project-side gap, since the same item validates cleanly by name.
- [ ] Run `/review AB-1002-auth-user-verification` (`reviewer` agent checks `@shared/core` usage, controller purity, token storage, `deletedAt`/status-code conventions).
- [ ] Confirm `openspec/changes/AB-1002-auth-user-verification/review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1002-auth-user-verification`.
