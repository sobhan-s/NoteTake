# Spec Delta: Auth — Register, Login, Logout, JWT + Refresh, Email Verification (`AB-1002`)

Domain: `auth`. Target: `FRS-1.1–1.4`, `FRS-1.2.4a`, `FRS-8.5`, `FRS-8.6`.

---

## ADDED Requirements

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

`POST /api/v1/auth/verify-otp` SHALL accept `{ userId | email, code, type }` validated by `verifyOtpSchema` (refined: at least one of `userId`/`email` required), resolving the latest OTP row for the user + `type` ordered by `createdAt DESC` (`FRS-1.2.1–1.2.5`, `FRS-1.2.4a`).

#### Scenario: Missing, expired, or already-consumed OTP is rejected generically

- **WHEN** no OTP row exists for the resolved user + type, or the latest row has `status !== 'PENDING'`, or `expiresAt < now()`
- **THEN** the service returns `400 Bad Request` `{ error: { code: 'OTP_EXPIRED' } }` with a "request a new one" message, never distinguishing expired from never-existed from already-`CONSUMED`

#### Scenario: OTP already at or past the attempt cap is rejected distinctly from expiry

- **WHEN** the latest OTP row has `status === 'INVALIDATED'` or `attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS`
- **THEN** the service returns `429 Too Many Requests` `{ error: { code: 'OTP_MAX_ATTEMPTS_EXCEEDED' } }`

#### Scenario: Code mismatch increments attempts atomically under concurrency

- **WHEN** the submitted code does not match the row's `codeHash`
- **THEN** the service increments `attempts` inside a transaction that row-locks the target `OtpCode` (`SELECT ... FOR UPDATE` or equivalent Prisma interactive transaction) to prevent a concurrent-request bypass of the 3-attempt cap; if the incremented `attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS` the same transaction additionally sets `status='INVALIDATED'` and the service returns `429`, otherwise it returns `400 Bad Request` with an attempts-remaining count — and in both cases the attempt-count write SHALL persist (commit) regardless of whether the overall request is reported as a failure

#### Scenario: Correct code consumes the OTP and verifies the account

- **WHEN** the submitted code matches the row's `codeHash` while `status === 'PENDING'` and not expired
- **THEN** the service sets `status='CONSUMED'` and `User.isVerified=true` in one transaction and returns `200 OK` `{ success: true, data: { message } }`; that OTP SHALL NOT be resubmittable even if `expiresAt` has not yet passed (`FRS-1.2.2`)

#### Scenario: CONSUMED and INVALIDATED are never conflated

- **WHEN** any code path queries or evaluates an OTP's terminal state
- **THEN** `CONSUMED` (entered correctly, single-use) and `INVALIDATED` (hit the attempt cap) remain strictly distinct, independently queryable `OtpStatus` values — no code path treats them interchangeably (`FRS-1.2.4a`)

### Requirement: Resend OTP

`POST /api/v1/auth/resend-otp` SHALL accept `{ userId | email, type }` validated by `resendOtpSchema`, enforcing the same `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` cooldown as the registration re-trigger flow (`FRS-1.2.3`).

#### Scenario: Resend outside the cooldown invalidates the old OTP and issues a new one

- **WHEN** the most recent OTP for the user + type is absent or older than `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS`
- **THEN** the service invalidates any still-`PENDING` prior OTP, generates and console-logs a new one, and returns `200 OK`

#### Scenario: Resend inside the cooldown is rejected

- **WHEN** the most recent OTP for the user + type is younger than `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS`
- **THEN** the service returns `429 Too Many Requests` `{ error: { code: 'RESEND_COOLDOWN_ACTIVE' } }` without invalidating or creating any OTP row

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

## Error Scenarios (verbatim from `FRS.md §1`, retained for traceability)

Duplicate verified email → rejected, no account created · Weak password → rejected, names violated rule · Register on existing-unverified email → re-triggers OTP for same account, no duplicate, no email-enumeration leak · Wrong password → generic rejection, doesn't reveal whether email exists · Correct credentials, unverified account → distinct "please verify" message · Rate-limited login → rejected without revealing unlock time · Expired/consumed/invalidated OTP → rejected, "request a new one" · Refresh with expired/revoked token → rejected, re-login required.

## Out of Scope Boundaries (binding for this delta)

- `FRS-1.5` forgot/reset password OTP flow — `AB-1003`.
- OAuth/social login, MFA beyond OTP, self-service account deletion — `FRS §1 Out of Scope`, `Master Out-of-Scope List`.
- Any React/frontend auth pages — `AB-1010`.
