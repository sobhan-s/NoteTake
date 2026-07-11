# Sequenced Tasks for AB-1003-auth-password-reset

Spec: `openspec/changes/AB-1003-auth-password-reset/specs/auth/spec.md`
Plan: `openspec/changes/AB-1003-auth-password-reset/plan.md`
Scope: `BACKEND` (AB-1002..AB-1009 range). No frontend, no Prisma migration (schema already supports `OtpType.PASSWORD_RESET` from AB-1002).

---

## Phase 1: Foundation & Shared Tier (`packages/shared` — Rule 11)

_All DTOs and Zod schemas belong in `packages/shared`; nothing downstream compiles without this phase._

- [x] `packages/shared/src/schemas/auth.schema.ts`: Extract inline password rule out of `registerSchema.password` into a standalone exported `passwordSchema`; rewire `registerSchema.password` to reuse it — no regex duplication (`[Rule 11, FRS-1.1.3]`).
- [x] `packages/shared/src/schemas/auth.schema.ts`: Narrow `verifyOtpSchema.type` and `resendOtpSchema.type` from `z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"])` to `z.literal("EMAIL_VERIFICATION")` (`[FRS-1.5.1]` scope-tightening decision).
- [x] `packages/shared/src/schemas/auth.schema.ts`: Add `forgotPasswordSchema` (`{ email }`, `.trim().toLowerCase().email()`) (`[FRS-1.5.1]`).
- [x] `packages/shared/src/schemas/auth.schema.ts`: Add `resetPasswordSchema` (`{ email, code: length OTP_LENGTH, newPassword: passwordSchema }`) (`[FRS-1.5.2, FRS-1.5.4]`).
- [x] `packages/shared/src/types/auth.type.ts`: Add `ForgotPasswordInput` and `ResetPasswordInput` via `z.infer` — never hand-written duplicates (`[Rule 11]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: Add `API_PATHS.AUTH.FORGOT_PASSWORD: '/forgot-password'` and `API_PATHS.AUTH.RESET_PASSWORD: '/reset-password'` (`[FRS-8.6]`).
- [x] Confirm `schemas/index.ts` and `types/index.ts` barrels are wildcard re-exports (`export * from "./auth.schema"` / `"./auth.type"`) and already cover the new exports with zero edits needed (`[packages/shared/CLAUDE.md]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/api`)

_Controllers strictly `z.parse` + call service, zero SQL/Zod definitions (`SDS §1.1`, `apps/api/CLAUDE.md`). Execute each item via the `/implement` Main Claude → Tester → Reviewer → Triage loop._

- [x] `apps/api/src/repositories/auth.repository.ts`: Add `revokeAllRefreshSessionsForUser(userId, db?)` directly after `revokeActiveSessionsForDevice`, using `refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now() } })` with no `userAgent` filter (`[FRS-1.5.6]`).
- [x] `apps/api/src/services/auth.service.ts`: Add `forgotPassword(input: ForgotPasswordInput)` — no-op-but-200 for nonexistent email, cooldown-blocked email, and existing-account-outside-cooldown all return the identical generic message; only the outside-cooldown branch invalidates prior pending `PASSWORD_RESET` OTP, creates a new one, and console-logs it (`[FRS-1.5.1, FRS-1.5.3]`).
- [x] `apps/api/src/services/auth.service.ts`: Add `resetPassword(input: ResetPasswordInput)` — pre-check + row-locked transaction (`lockOtpRowForUpdate`) mirroring `verifyOtp`'s concurrency pattern; success branch hashes `newPassword` via bcrypt (Tier 2 `BCRYPT_ROUNDS`) **before** the transaction, then atomically marks OTP `CONSUMED`, updates `User.passwordHash`, and calls `revokeAllRefreshSessionsForUser` (`[FRS-1.5.2, FRS-1.5.4, FRS-1.5.5, FRS-1.5.6]`).
- [x] `apps/api/src/services/auth.service.ts`: In `verifyOtp`, remove the now-always-true `if (input.type === "EMAIL_VERIFICATION")` guard around `markUserVerified` (pure type-narrowing cleanup, no behavior change) (`[FRS-1.5.1]` scope-tightening).
- [x] `apps/api/src/services/auth.service.ts`: Add `ForgotPasswordInput`, `ResetPasswordInput` to the existing `@shared/core/types` import block.
- [x] `apps/api/src/controllers/auth.controller.ts`: Add `forgotPassword` handler (`forgotPasswordSchema.parse(req.body)` → `authService.forgotPassword` → `{ success: true, data }`), zero SQL/Zod definitions (`[SDS §1.1, FRS-1.5.1]`).
- [x] `apps/api/src/controllers/auth.controller.ts`: Add `resetPassword` handler (`resetPasswordSchema.parse(req.body)` → `authService.resetPassword` → `{ success: true, data }`) (`[SDS §1.1, FRS-1.5.2]`).
- [x] `apps/api/src/routers/auth.router.ts`: Register `POST API_PATHS.AUTH.FORGOT_PASSWORD` and `POST API_PATHS.AUTH.RESET_PASSWORD`, unauthenticated, **not** behind `checkLoginRateLimit`, placed after `RESEND_OTP` and before `LOGIN` (`[FRS-8.6]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

_Tests derived solely from `FRS-1.5.1–1.5.6` requirement text and `SDS.md` contracts, against isolated `notes_app_test` — never copied/reworded from Acceptance Criteria bullets. Follows existing convention: `apps/api/tests/contract/auth.<feature>.test.ts`._

- [x] `apps/api/tests/contract/auth.forgot-password.test.ts`: nonexistent email → `200` generic message, zero OTP rows created (assert via DB, not just status); existing unverified/verified account outside cooldown → new `PASSWORD_RESET` OTP row created; existing account inside cooldown (`createdAt = now - (COOLDOWN_SECONDS - 1)s`) → `200`, no new/invalidated OTP row; cooldown boundary at exactly `COOLDOWN_SECONDS` old → treated as outside cooldown (`[FRS-1.5.1, FRS-1.5.3]`).
- [x] `apps/api/tests/contract/auth.reset-password.test.ts`: nonexistent email → `400 OTP_EXPIRED`; no OTP row → `400 OTP_EXPIRED`; `CONSUMED` row → `400 OTP_EXPIRED`; expired row (`expiresAt` 1ms past) → `400 OTP_EXPIRED`; `INVALIDATED` row → `429 OTP_MAX_ATTEMPTS_EXCEEDED` (`[FRS-1.5.2, FRS-1.5.4, FRS-1.5.5]`).
- [x] `apps/api/tests/contract/auth.reset-password.test.ts`: `attempts === OTP_MAX_ATTEMPTS - 1` + wrong code → flips to `INVALIDATED`, returns `429`; wrong code below cap → `400 OTP_INVALID` with correct `attemptsRemaining`, `attempts` incremented by exactly 1, password hash unchanged (`[FRS-1.5.5]`).
- [x] `apps/api/tests/contract/auth.reset-password.test.ts`: correct code → `200`, `passwordHash` changed, OTP `CONSUMED`, **all** seeded `RefreshSession` rows (2+ distinct `userAgent`s) get `revokedAt` set — assert both revoked, not just one (`[FRS-1.5.4, FRS-1.5.6]`).
- [x] `apps/api/tests/contract/auth.reset-password.concurrency.test.ts`: concurrent double-submit of the same correct code — exactly one request succeeds, the other observes the row already `CONSUMED` post-lock and gets `400 OTP_EXPIRED`; only one password-hash write occurs — follow the existing `auth.verify-otp.concurrency.test.ts` structure (`[FRS-1.5.4]`).
- [x] `apps/api/tests/contract/auth.verify-otp.test.ts` / `apps/api/tests/contract/auth.resend-otp.test.ts`: add regression cases — submitting `type: "PASSWORD_RESET"` → `400 VALIDATION_ERROR`, and the target OTP row is left completely untouched (`status`/`attempts` unchanged), proving the dead path is closed pre-service (`[FRS-1.5.1]` scope-tightening). (Also required rewriting a pre-existing stale assertion in `auth.verify-otp.test.ts` that predated the `type` literal narrowing — flagged by reviewer, corrected by test-writer.)
- [x] Run full existing `register`/`verify-otp`/`resend-otp`/`login` suites to confirm no regression from the `passwordSchema` extraction and `type` literal narrowing.
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — 74/74 tests green against `notes_app_test`, 96.65% overall coverage (auth.service.ts 95.26%, auth.repository.ts 100%, auth.controller.ts 100%, auth.router.ts 100%) — all ≥80% gate.

## Phase 4: OpenSpec Compliance Audit (`/review` — archiving reserved for `/pr`)

- [x] Run `openspec validate` against the spec delta (`openspec/changes/AB-1003-auth-password-reset/specs/auth/spec.md`). Fixed two `--strict` wording violations (MODIFIED requirements lacked SHALL/MUST verb) — now valid.
- [x] Run `/review AB-1003-auth-password-reset` (`reviewer` agent checks `@shared/core` sourcing, controller layering, token storage, no-enumeration behavior, and FRS-1.5.1–1.5.6 coverage). All 10 architecture/security checks ✅ PASSED; test-coverage gaps found and subsequently closed, re-verified ✅.
- [x] Confirm `openspec/changes/AB-1003-auth-password-reset/review-log.md` reports all ✅ before proceeding to `/pr AB-1003-auth-password-reset`. Confirmed — one non-blocking doc-sync item noted (docs/SDS.md stale text) for a future follow-up.
