# Spec Delta: Auth — Forgot Password + OTP Reset (`AB-1003`)

Domain: `auth`. Target: `FRS-1.5.1–1.5.6`. Architectural mapping: `SDS §2.1` (`User`, `OtpCode`, `RefreshSession` tables), `SDS §1.2` (3-tier constants), `SDS §1.4` (quality gates), `AGENTS.md §5` (`router → controller → service → repository → shared` layering), `AGENTS.md §7` (auth token strategy — unaffected by this delta).

## Executive Summary

Adds a self-contained "forgot password" flow: `POST /api/v1/auth/forgot-password` (request a reset code by email, no account-existence leak) and `POST /api/v1/auth/reset-password` (submit code + new password together, one atomic call). Both reuse the generic OTP infrastructure already built for email verification (`otp.service.ts`, `authRepository.findLatestOtp/invalidatePendingOtp/createOtp/updateOtpAttempts/markOtpConsumed/lockOtpRowForUpdate`) — no new OTP storage or hashing mechanism is introduced.

**Design decisions locked in for this delta (confirmed with project owner):**

- **No email enumeration**: `forgot-password` always returns `200 OK` with an identical generic message, regardless of whether the email exists, whether the account is verified, or whether a resend cooldown is currently active. All three cases are indistinguishable no-ops from the caller's point of view; only when an account exists **and** is outside the cooldown does a real OTP get created and console-logged. This is a deliberate divergence from the sibling `resend-otp` endpoint (which does return `429 RESEND_COOLDOWN_ACTIVE`) because `resend-otp` is only reachable with a known `userId`/`email` mid-registration, whereas `forgot-password` is a fully anonymous public entry point.
- **One-step reset**: `reset-password` accepts `{ email, code, newPassword }` in a single call and atomically verifies the code, updates the password hash, consumes the OTP, and revokes all refresh sessions. There is no separate "verify code" step and no intermediate reset-ticket token.
- **Unverified accounts are eligible**: an account with `isVerified=false` can request and complete a password reset — resetting a password never grants login access on its own (`FRS-1.1.4` still gates login on `isVerified`), so there is no security reason to block it.
- **Password strength reused verbatim**: `newPassword` is validated by the exact same rule as `registerSchema.password` (`FRS-1.1.3`) via a single exported `passwordSchema`, not a re-typed regex (`Rule 11`).
- **Scope tightening on existing endpoints**: because `reset-password` now owns the entire `PASSWORD_RESET` OTP lifecycle end-to-end, `verify-otp` and `resend-otp` are narrowed to `EMAIL_VERIFICATION` only. Previously, `verifyOtpSchema`/`resendOtpSchema` accepted a `type: 'PASSWORD_RESET'` value that AB-1002 never wired to any password-changing side effect — calling `/verify-otp` with `type: 'PASSWORD_RESET'` would silently burn the OTP (mark it `CONSUMED`) without ever changing the password, permanently locking the user out of that code with no corresponding benefit. Removing that dead/dangerous path is part of this delta, not a separate ticket, since it is a direct consequence of where the `PASSWORD_RESET` state machine now lives.

## Out of Scope

- Any dedicated IP-based rate limiter on `forgot-password` beyond the existing per-account `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` cooldown and `APP_LIMITS.OTP_MAX_ATTEMPTS` cap — no `LoginAttempt`-style table for this flow.
- Constant-time response timing to defeat enumeration-via-latency (only response body/status are normalized).
- Any reset-ticket/short-lived-token intermediate step (explicitly rejected in favor of the one-step shape above).
- Frontend UI (`AB-1010`).
- OAuth/social login, MFA beyond OTP, account deletion — already globally out of scope per `docs/FRS.md` §1 "Out of Scope (Auth)".

---

## ADDED Requirements

### Requirement: Shared Password Reset Contracts

`packages/shared` SHALL gain `forgotPasswordSchema` and `resetPasswordSchema` in `src/schemas/auth.schema.ts`, with corresponding `z.infer` types `ForgotPasswordInput`/`ResetPasswordInput` in `src/types/auth.type.ts`. The password-strength rule currently inlined in `registerSchema.password` SHALL be extracted into a standalone exported `passwordSchema` and reused by both `registerSchema` and `resetPasswordSchema.newPassword` — no duplicated regex (`Rule 11`, `FRS-1.1.3`). `API_PATHS.AUTH` SHALL gain `FORGOT_PASSWORD: '/forgot-password'` and `RESET_PASSWORD: '/reset-password'`. No new `APP_LIMITS` or `API_ERROR_CODES` entries are required — this delta reuses `OTP_LENGTH`, `OTP_EXPIRY_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `REFRESH_TOKEN_EXPIRY_DAYS`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, and `VALIDATION_ERROR` verbatim.

#### Scenario: forgotPasswordSchema accepts only a normalized email

- **WHEN** `apps/api` or `apps/web` needs to validate a forgot-password request
- **THEN** they import `forgotPasswordSchema` from `@shared/core/schemas`, which accepts `{ email }` with the same `.trim().toLowerCase().email(...)` normalization already used by `loginSchema`/`registerSchema` — no duplicate email validation logic

#### Scenario: resetPasswordSchema reuses the shared password rule

- **WHEN** `apps/api` or `apps/web` needs to validate a reset-password request
- **THEN** they import `resetPasswordSchema` from `@shared/core/schemas`, which accepts `{ email, code, newPassword }` where `code` is exactly `APP_LIMITS.OTP_LENGTH` characters and `newPassword` is validated by the same exported `passwordSchema` instance `registerSchema` uses — never a re-declared regex

### Requirement: Forgot Password (Request Reset)

`POST /api/v1/auth/forgot-password` SHALL accept `{ email }` validated by `forgotPasswordSchema`, and SHALL return an identical `200 OK` response for every outcome — nonexistent account, existing account (verified or not), and cooldown-blocked account are all indistinguishable to the caller (`FRS-1.5.1`, `FRS-1.5.3`).

#### Scenario: Nonexistent email is a silent no-op that still returns 200

- **WHEN** no `User` row exists for the submitted email
- **THEN** the service performs no database write, generates no OTP, logs nothing to the console, and returns `200 OK` `{ success: true, data: { message } }` with the same generic message used for every other outcome of this endpoint

#### Scenario: Existing account outside the cooldown gets a fresh OTP

- **WHEN** a `User` row exists (regardless of `isVerified`) and the most recent `PASSWORD_RESET` OTP's `createdAt` is absent or at least `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` old
- **THEN** the service invalidates any still-`PENDING` prior `PASSWORD_RESET` OTP for that user (`status=INVALIDATED`), generates a new 6-digit OTP (`type=PASSWORD_RESET`, `expiresAt = now() + APP_LIMITS.OTP_EXPIRY_MINUTES`), console-logs it (`FRS-8.3`), and returns the same generic `200 OK` message as every other outcome

#### Scenario: Existing account inside the cooldown is silently throttled, not disclosed

- **WHEN** a `User` row exists and the most recent `PASSWORD_RESET` OTP's `createdAt` is less than `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` old
- **THEN** the service neither invalidates the existing OTP nor creates a new one nor logs anything, and still returns the identical generic `200 OK` — never a `429`, so a caller cannot distinguish "just requested" from "no account" from "brand new request"

### Requirement: Reset Password (Verify + Set New Password)

`POST /api/v1/auth/reset-password` SHALL accept `{ email, code, newPassword }` validated by `resetPasswordSchema`, and SHALL atomically verify the `PASSWORD_RESET` OTP and update the password in one transaction — mirroring the concurrency-safe row-lock pattern already used by `verify-otp` (`FRS-1.5.2`, `FRS-1.5.4`, `FRS-1.5.5`, `FRS-1.5.6`).

#### Scenario: Nonexistent email is rejected with the same generic code as a bad OTP

- **WHEN** no `User` row exists for the submitted email
- **THEN** the service returns `400 Bad Request` `{ error: { code: 'OTP_EXPIRED' } }` — identical to the "missing/expired/consumed" case below, disclosing nothing about account existence

#### Scenario: Missing, expired, or already-consumed OTP is rejected generically

- **WHEN** the resolved user has no `PASSWORD_RESET` OTP row, or the latest row has `status !== 'PENDING'`, or `expiresAt < now()`
- **THEN** the service returns `400 Bad Request` `{ error: { code: 'OTP_EXPIRED' } }` with a "request a new one" message, never distinguishing expired from never-existed from already-`CONSUMED`

#### Scenario: OTP already at or past the attempt cap is rejected distinctly from expiry

- **WHEN** the latest `PASSWORD_RESET` OTP row has `status === 'INVALIDATED'` or `attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS`
- **THEN** the service returns `429 Too Many Requests` `{ error: { code: 'OTP_MAX_ATTEMPTS_EXCEEDED' } }` without touching `passwordHash` or any `RefreshSession` row

#### Scenario: Code mismatch increments attempts atomically under concurrency

- **WHEN** the submitted `code` does not match the row's `codeHash`
- **THEN** the service row-locks the target `OtpCode` (`SELECT ... FOR UPDATE`, same mechanism as `verify-otp`) and increments `attempts` inside that transaction; if the incremented value reaches `APP_LIMITS.OTP_MAX_ATTEMPTS` the same transaction also sets `status='INVALIDATED'` and the service returns `429 OTP_MAX_ATTEMPTS_EXCEEDED`, otherwise it returns `400 Bad Request { code: 'OTP_INVALID' }` with an attempts-remaining count — in both cases the password hash is left untouched and no `RefreshSession` is revoked (`FRS-1.5.5`)

#### Scenario: Correct code atomically resets the password, consumes the OTP, and revokes every session

- **WHEN** the submitted `code` matches the row's `codeHash` while `status === 'PENDING'` and not expired
- **THEN** in one transaction the service hashes `newPassword` with bcrypt (Tier 2 `BCRYPT_ROUNDS`), updates `User.passwordHash`, sets the OTP `status='CONSUMED'`, and revokes every `RefreshSession` for that user where `revokedAt IS NULL` (not scoped to one device, unlike login's same-device revocation) — then returns `200 OK` `{ success: true, data: { message } }`. The OTP SHALL NOT be resubmittable even if `expiresAt` has not yet passed (`FRS-1.5.4`), and every other logged-in device for that user is force-logged-out on its next request (`FRS-1.5.6`)

### Requirement: Revoke All Sessions Repository Primitive

`apps/api/src/repositories/auth.repository.ts` SHALL gain `revokeAllRefreshSessionsForUser(userId, db?)`, distinct from the existing device-scoped `revokeActiveSessionsForDevice` used at login (`SDS §2.1` `RefreshSession`).

#### Scenario: Revocation targets every session for the user, not one device

- **WHEN** `resetPassword`'s transaction calls `revokeAllRefreshSessionsForUser(userId, tx)`
- **THEN** it runs `refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now() } })` with no `userAgent` filter — every device session for that user ends up revoked, regardless of which device originated the reset request

---

## MODIFIED Requirements

### Requirement: Email Verification

`POST /api/v1/auth/verify-otp` SHALL accept only `type: 'EMAIL_VERIFICATION'`, narrowed from the prior `type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'` — `PASSWORD_RESET` OTP verification now lives exclusively in `reset-password` above.

#### Scenario: A PASSWORD_RESET type value is rejected as a validation error, not processed

- **WHEN** a request to `/api/v1/auth/verify-otp` submits `type: 'PASSWORD_RESET'`
- **THEN** `verifyOtpSchema.parse` throws before the service layer runs, and the controller surfaces `400 Bad Request { error: { code: 'VALIDATION_ERROR' } }` — the endpoint never reaches, locks, or mutates a `PASSWORD_RESET` `OtpCode` row

### Requirement: Resend OTP

`POST /api/v1/auth/resend-otp` SHALL accept only `type: 'EMAIL_VERIFICATION'`, narrowed from the prior `type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'` — requesting a new `PASSWORD_RESET` code now happens exclusively via repeated calls to `forgot-password` above (which, unlike this endpoint, never discloses cooldown state).

#### Scenario: A PASSWORD_RESET type value is rejected as a validation error, not processed

- **WHEN** a request to `/api/v1/auth/resend-otp` submits `type: 'PASSWORD_RESET'`
- **THEN** `resendOtpSchema.parse` throws before the service layer runs, and the controller surfaces `400 Bad Request { error: { code: 'VALIDATION_ERROR' } }`
