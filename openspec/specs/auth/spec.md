# auth Specification

## Purpose

TBD - created by archiving change AB-1002-auth-user-verification. Update Purpose after archive.

## Requirements

### Requirement: Shared Auth Contracts

`packages/shared` SHALL be the single source of truth for this delta: `registerSchema`, `verifyOtpSchema`, `resendOtpSchema`, `loginSchema` Zod schemas in `src/schemas/auth.schema.ts`, each with a corresponding `z.infer` type in `src/types/auth.type.ts` — no hand-written duplicate interfaces. `APP_LIMITS` SHALL gain `OTP_LENGTH (6)`, `OTP_EXPIRY_MINUTES (10)`, `OTP_MAX_ATTEMPTS (3)`, `OTP_RESEND_COOLDOWN_SECONDS (60)`, `LOGIN_RATE_LIMIT_MAX_ATTEMPTS (5)`, `LOGIN_RATE_LIMIT_WINDOW_MINUTES (15)`, `ACCESS_TOKEN_EXPIRY_MINUTES (15)`, `REFRESH_TOKEN_EXPIRY_DAYS (7)`; every numeric value in this delta SHALL reference one of these named exports, never a literal (`FRS-8.5`). `API_ERROR_CODES` SHALL gain `EMAIL_ALREADY_VERIFIED`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `RESEND_COOLDOWN_ACTIVE`, `INVALID_CREDENTIALS`, `ACCOUNT_NOT_VERIFIED`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED`. `API_PATHS.AUTH` SHALL gain entries for `register`, `verify-otp`, `resend-otp`, `login`, `refresh`, `logout`, `me` under `/api/v1/auth`.

#### Scenario: Zod schemas and constants live only in packages/shared

- **WHEN** `apps/api` or `apps/web` needs the auth request shapes or numeric limits for this delta
- **THEN** they import `registerSchema`/`loginSchema`/`verifyOtpSchema`/`resendOtpSchema` from `@shared/core/schemas` and `APP_LIMITS`/`API_ERROR_CODES`/`API_PATHS` from `@shared/core/constants` — no duplicate schema, type, or numeric literal exists in either workspace

#### Scenario: Swagger docs cover all seven routes

- **WHEN** `GET /api/v1/docs` is requested
- **THEN** an OpenAPI document generated from the `packages/shared` auth schemas renders, covering `register`, `verify-otp`, `resend-otp`, `login`, `refresh`, `logout`, and `me` (`FRS-8.7`)

### Requirement: Registration

`POST /api/v1/auth/register` SHALL accept `{ email, password }` validated by `registerSchema` (email format; password ≥8 chars, ≥1 digit, ≥1 symbol per `FRS-1.1.3`), with email uniqueness enforced case-insensitively via `User.email @db.Citext` (`FRS-1.1.2`). Behavior SHALL branch on whether a `User` row already exists for the email, per `FRS-1.1.1–1.1.5`.

#### Scenario: New email creates an unverified account and sends an OTP

- **WHEN** no `User` row exists for the submitted email
- **THEN** the service creates `User(isVerified=false)`, hashes the password with bcrypt (Tier 2 constant, rounds=12), generates a 6-digit OTP (`type=EMAIL_VERIFICATION`, `expiresAt = now() + APP_LIMITS.OTP_EXPIRY_MINUTES`), console-logs the OTP (`FRS-8.3`, no real email), and returns `201 Created` `{ success: true, data: { isReTriggered: false, userId } }`

#### Scenario: Already-verified email is rejected without leaking account details

- **WHEN** a `User` row exists with `isVerified=true`
- **THEN** the service returns `409 Conflict` `{ success: false, error: { code: 'EMAIL_ALREADY_VERIFIED' } }`, creates no account, generates no OTP, and discloses no detail beyond confirming an account exists

#### Scenario: Existing unverified email re-triggers verification instead of duplicating

- **WHEN** a `User` row exists with `isVerified=false` and the most recent `EMAIL_VERIFICATION` OTP's `createdAt` is at least `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` old
- **THEN** the service invalidates any still-`PENDING` prior OTP for that user+type (`status=INVALIDATED`), updates `passwordHash` to the newly submitted password, generates and console-logs a fresh OTP, and returns `200 OK` `{ success: true, data: { isReTriggered: true, userId } }` — never `201`, never a second `User` row (`FRS-1.1.5`)

#### Scenario: Re-trigger blocked inside the resend cooldown

- **WHEN** a `User` row exists with `isVerified=false` and the most recent `EMAIL_VERIFICATION` OTP's `createdAt` is less than `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` old
- **THEN** the service returns `429 Too Many Requests` `{ error: { code: 'RESEND_COOLDOWN_ACTIVE' } }` and neither updates the password hash nor generates a new OTP

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

### Requirement: Login

`POST /api/v1/auth/login` SHALL accept `{ email, password }` validated by `loginSchema`, precede the service call with a `checkLoginRateLimit` middleware check, and branch on password correctness and verification state exactly per the `FRS-1.3.4` v2.1 decision (`FRS-1.3.1–1.3.5`).

#### Scenario: Rate limit blocks further attempts without disclosing unlock time

- **WHEN** `LoginAttempt` rows for the submitted email with `attemptedAt >= now() - APP_LIMITS.LOGIN_RATE_LIMIT_WINDOW_MINUTES` number `>= APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS`
- **THEN** `checkLoginRateLimit` returns `429 Too Many Requests` `{ error: { code: 'RATE_LIMIT_EXCEEDED' } }` before the controller/service runs, without revealing the remaining lockout time

#### Scenario: Wrong password counts toward the rate limit regardless of verification state

- **WHEN** the submitted password does not match the stored hash (including when no `User` row exists for the email)
- **THEN** the service inserts a `LoginAttempt{ email, ipAddress }` row and returns `401 Unauthorized` `{ error: { code: 'INVALID_CREDENTIALS' } }` — an identical generic message whether or not the email exists at all

#### Scenario: Correct password on an unverified account is rejected without counting as an attempt

- **WHEN** the submitted password matches the stored hash but `User.isVerified === false`
- **THEN** the service returns `403 Forbidden` `{ error: { code: 'ACCOUNT_NOT_VERIFIED' } }` and does **not** insert a `LoginAttempt` row (`FRS-1.3.4` v2.1 decision — a deterministic rejection, not a brute-force signal)

#### Scenario: Successful login rotates the session and issues fresh tokens

- **WHEN** the submitted password matches the stored hash and `User.isVerified === true`
- **THEN** the service deletes all `LoginAttempt` rows for that email, revokes any still-active `RefreshSession` matching `(userId, userAgent)` so at most one live session persists per device (`SDS §3.2`), issues a JWT access token (`{userId, email, isVerified}`, `APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES` expiry), generates a 64-byte random hex refresh token, SHA-256-hashes it into a new `RefreshSession.tokenHash` row (`expiresAt = now() + APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS`), sets it as an `HttpOnly+Secure+SameSite=Strict` cookie named `refreshToken`, and returns `200 OK` `{ success: true, data: { accessToken, user } }` — the raw refresh token SHALL NOT appear anywhere in the JSON response body (`FRS-1.3.5`)

### Requirement: Silent Refresh

`POST /api/v1/auth/refresh` SHALL read the `refreshToken` cookie (no request body), SHA-256-hash the raw value, and look up `RefreshSession` by `tokenHash`, rotating on every valid use (`FRS-1.3.3`, `FRS-1.3.5`).

#### Scenario: Invalid, expired, or revoked session is rejected and the cookie cleared

- **WHEN** no matching `RefreshSession` exists, or `revokedAt IS NOT NULL`, or `expiresAt < now()`
- **THEN** the service returns `401 Unauthorized` `{ error: { code: 'UNAUTHORIZED' } }` and the controller clears the `refreshToken` cookie

#### Scenario: Valid session rotates to a new access and refresh token

- **WHEN** the presented `refreshToken` cookie hashes to a live, unexpired, unrevoked `RefreshSession`
- **THEN** the service revokes that session (`revokedAt = now()`), issues a new access token, a new `RefreshSession` row, and a newly rotated cookie, and returns `200 OK` `{ success: true, data: { accessToken, user } }` — preventing replay of a stolen-then-superseded refresh token

### Requirement: Logout

`POST /api/v1/auth/logout` (authenticated) SHALL revoke only the `RefreshSession` matching the `refreshToken` cookie presented in the request, leaving other sessions/devices for the same user untouched (`FRS-1.4.1`).

#### Scenario: Logout revokes only the current session

- **WHEN** an authenticated request to `/api/v1/auth/logout` presents a valid `refreshToken` cookie
- **THEN** the service sets `revokedAt = now()` on only that `RefreshSession` row, the controller clears the cookie, and other active sessions/devices for the same user remain valid and untouched

#### Scenario: Logout is idempotent when the session is already gone

- **WHEN** the `refreshToken` cookie is absent, or already revoked, or already expired at logout time
- **THEN** the endpoint still returns `200 OK`, clears any stale cookie, and does not error

### Requirement: Session Hydration

`GET /api/v1/auth/me` (authenticated) SHALL validate the `Authorization: Bearer <token>` access token via `requireAuth`, look up the current `User` row, and return session state with no mutation — letting the frontend restore session state after a hard page refresh since the access token lives only in JS memory.

#### Scenario: Valid access token hydrates the current user

- **WHEN** a request to `/api/v1/auth/me` presents a valid, unexpired access token
- **THEN** the service returns `200 OK` `{ success: true, data: { user: { id, email, isVerified } } }` looked up by `req.user.userId`, performing no writes

#### Scenario: Invalid access token is rejected uniformly

- **WHEN** the access token on `/api/v1/auth/me` is missing, expired, or malformed
- **THEN** the endpoint returns `401 Unauthorized { code: 'UNAUTHORIZED' }`, identical to any other protected route, so the frontend's Axios interceptor can attempt one silent `/auth/refresh` before treating this as a full logout

### Requirement: Middleware and Layering

`requireAuth` SHALL validate the `Authorization: Bearer <token>` JWT and attach `req.user = {userId, email, isVerified}`, returning `401` (never `403`) on any missing/invalid/expired token. All seven routes in this delta SHALL be namespaced under `/api/v1/auth/*` and registered through the strict `router → controller → service → repository` layering (`AGENTS.md §5`), with controllers performing `schema.parse` only.

#### Scenario: requireAuth always returns 401, never 403, for token problems

- **WHEN** `requireAuth` processes a request with a missing, malformed, or expired access token
- **THEN** it returns `401 Unauthorized { code: 'UNAUTHORIZED' }` — `403` is reserved exclusively for the unverified-account case on `/login`, never used for a token problem (`FRS §8` status code table)

#### Scenario: Controllers contain zero SQL and zero schema definitions

- **WHEN** any of the seven auth routes is inspected in `apps/api/src/controllers/auth.controller.ts`
- **THEN** each handler only calls `schema.parse(req.body)` (schema imported from `@shared/core/schemas`, never defined inline) and a matching `auth.service` function, with zero raw SQL and zero business logic present

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
