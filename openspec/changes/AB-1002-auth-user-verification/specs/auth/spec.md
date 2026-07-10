# Spec Delta: Auth — Register, Login, Logout, JWT + Refresh, Email Verification (`AB-1002`)

Domain: `auth`. Target: `FRS-1.1–1.4`, `FRS-1.2.4a`, `FRS-8.5`, `FRS-8.6`.

---

## ADDED Scenarios

### Shared Contracts (`packages/shared`)

- ADDED `registerSchema`, `verifyOtpSchema`, `resendOtpSchema`, `loginSchema` Zod schemas in `packages/shared/src/schemas/auth.schema.ts`, each with a corresponding `z.infer` type in `src/types/auth.type.ts` — no hand-written duplicate interfaces (`CLAUDE.md` shared package rule).
- ADDED `APP_LIMITS` entries: `OTP_LENGTH (6)`, `OTP_EXPIRY_MINUTES (10)`, `OTP_MAX_ATTEMPTS (3)`, `OTP_RESEND_COOLDOWN_SECONDS (60)`, `LOGIN_RATE_LIMIT_MAX_ATTEMPTS (5)`, `LOGIN_RATE_LIMIT_WINDOW_MINUTES (15)`, `ACCESS_TOKEN_EXPIRY_MINUTES (15)`, `REFRESH_TOKEN_EXPIRY_DAYS (7)` in `packages/shared/src/constants/index.ts` — every numeric value in this spec SHALL reference one of these named exports, never a literal (`FRS-8.5`).
- ADDED `API_ERROR_CODES` entries: `EMAIL_ALREADY_VERIFIED`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `RESEND_COOLDOWN_ACTIVE`, `INVALID_CREDENTIALS`, `ACCOUNT_NOT_VERIFIED`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED`.
- ADDED `API_PATHS.AUTH` entries for `/api/v1/auth/register`, `/verify-otp`, `/resend-otp`, `/login`, `/refresh`, `/logout`, `/me`.
- ADDED `/api/v1/docs` (Swagger UI, `swagger-ui-express` + OpenAPI doc generated from the `packages/shared` Zod schemas above) mounted in `apps/api/src/app.ts`, covering all 7 routes in this delta (`FRS-8.7`).

### Registration (`FRS-1.1.1–1.1.5`)

- ADDED `POST /api/v1/auth/register` SHALL accept `{ email, password }` validated by `registerSchema` (email format; password ≥8 chars, ≥1 digit, ≥1 symbol per `FRS-1.1.3`).
- ADDED Email uniqueness SHALL be enforced case-insensitively via `User.email @db.Citext` (`FRS-1.1.2`).
- ADDED If no `User` row exists for the email: create `User(isVerified=false)`, hash password with bcrypt (Tier 2 constant, rounds=12), generate a 6-digit OTP (`type=EMAIL_VERIFICATION`, `expiresAt = now() + APP_LIMITS.OTP_EXPIRY_MINUTES`), console-log the OTP (`FRS-8.3`, no real email), and return `201 Created` `{ success: true, data: { isReTriggered: false, userId } }`.
- ADDED If a `User` row exists with `isVerified=true`: return `409 Conflict` `{ success: false, error: { code: 'EMAIL_ALREADY_VERIFIED' } }`. No account created, no OTP generated, no distinguishing detail beyond this generic conflict (no email-enumeration leak beyond confirming _an_ account exists — matches FRS Error Scenarios wording).
- ADDED If a `User` row exists with `isVerified=false`: SHALL check the most recent `EMAIL_VERIFICATION` OTP's `createdAt`. If less than `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` old, return `429 Too Many Requests` `{ error: { code: 'RESEND_COOLDOWN_ACTIVE' } }`. Otherwise: invalidate any still-`PENDING` prior OTP for that user+type (set `status=INVALIDATED`), generate a fresh OTP, console-log it, and return `200 OK` `{ success: true, data: { isReTriggered: true, userId } }` — never `201`, never a second `User` row (`FRS-1.1.5`).
- ADDED Registering with an already-`isVerified=false` email and a _new_ password SHALL update `passwordHash` on the existing row as part of the re-trigger flow (a user who forgot they'd started registering may retry with a corrected password before ever verifying).

### Email Verification (`FRS-1.2.1–1.2.5`, `FRS-1.2.4a`)

- ADDED `POST /api/v1/auth/verify-otp` SHALL accept `{ userId | email, code, type }` validated by `verifyOtpSchema` (refined: exactly one of `userId`/`email` required).
- ADDED Resolve the latest OTP row for the user + `type` ordered by `createdAt DESC`. If none exists, or `status !== 'PENDING'`, or `expiresAt < now()`: return `400 Bad Request` `{ error: { code: 'OTP_EXPIRED' } }` with message "request a new one" (never distinguishes expired vs. never-existed).
- ADDED If `status === 'INVALIDATED'` or `attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS`: return `429 Too Many Requests` `{ error: { code: 'OTP_MAX_ATTEMPTS_EXCEEDED' } }`.
- ADDED On code mismatch: increment `attempts` inside the same transaction that read the row (row-level lock via `SELECT ... FOR UPDATE` or Prisma interactive transaction) to prevent a concurrency bypass of the 3-attempt cap. If the incremented `attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS`, additionally set `status='INVALIDATED'` in the same transaction and return `429`; otherwise return `400 Bad Request` with attempts-remaining count.
- ADDED On code match: set `status='CONSUMED'`, `User.isVerified=true` in one transaction; return `200 OK` `{ success: true, data: { message } }`. A `CONSUMED` OTP SHALL NOT be resubmittable even if `expiresAt` has not yet passed (`FRS-1.2.2`).
- ADDED `CONSUMED` and `INVALIDATED` are modeled as strictly distinct, independently queryable terminal `OtpStatus` values — no code path SHALL treat them interchangeably (`FRS-1.2.4a`).
- ADDED `POST /api/v1/auth/resend-otp` SHALL accept `{ userId | email, type }`, enforce the same `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` cooldown as registration re-trigger, invalidate the previous `PENDING` OTP, generate + console-log a new one, and return `200 OK`.
- ADDED A login attempt (`FRS-1.3` flow) against a correct-password, `isVerified=false` account SHALL return `403 Forbidden` `{ error: { code: 'ACCOUNT_NOT_VERIFIED' } }` — a message distinct from `INVALID_CREDENTIALS` (`FRS-1.2.5`).

### Login (`FRS-1.3.1–1.3.5`)

- ADDED `POST /api/v1/auth/login` SHALL accept `{ email, password }` validated by `loginSchema`.
- ADDED Rate-limit precheck (`checkLoginRateLimit` middleware): count `LoginAttempt` rows for `email` with `attemptedAt >= now() - APP_LIMITS.LOGIN_RATE_LIMIT_WINDOW_MINUTES`. If count `>= APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS`, return `429 Too Many Requests` `{ error: { code: 'RATE_LIMIT_EXCEEDED' } }` without disclosing remaining lockout time (`FRS-1.3.4`).
- ADDED On wrong password (any verification state): insert a `LoginAttempt{ email, ipAddress }` row, then return `401 Unauthorized` `{ error: { code: 'INVALID_CREDENTIALS' } }` — identical generic message whether or not the email exists at all (no email-enumeration leak).
- ADDED On correct password + `isVerified=false`: return `403 Forbidden` `{ error: { code: 'ACCOUNT_NOT_VERIFIED' } }` WITHOUT inserting a `LoginAttempt` row (`FRS-1.3.4` v2.1 decision — deterministic rejection, not a brute-force signal).
- ADDED On correct password + `isVerified=false` but the _submitted password is wrong_: this is a wrong-password case — SHALL insert a `LoginAttempt` row (counts toward rate limit) per the v2.1 decision's second clause.
- ADDED On success: delete all `LoginAttempt` rows for that email (reset counter); revoke any still-active `RefreshSession` matching `(userId, userAgent)` (`revokedAt = now()`) so at most one live session persists per device/browser (`SDS §3.2`); issue a JWT access token (`{userId, email, isVerified}`, `APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES` expiry), generate a 64-byte random hex refresh token, SHA-256-hash it into a new `RefreshSession.tokenHash` row (`expiresAt = now() + APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS`), set it as an `HttpOnly+Secure+SameSite=Strict` cookie named `refreshToken`, and return `200 OK` `{ success: true, data: { accessToken, user } }`. The raw refresh token SHALL NOT appear anywhere in the JSON response body (`FRS-1.3.5`). Revoking the same-device session on login is distinct from `FRS-1.4.1`'s guarantee that explicit _logout_ never touches other devices — a different device/`userAgent` logging in is unaffected.

### Silent Refresh (`FRS-1.3.3`, `FRS-1.3.5`)

- ADDED `POST /api/v1/auth/refresh` reads the `refreshToken` cookie (no request body). SHA-256-hash the raw value and look up `RefreshSession` by `tokenHash`.
- ADDED If no matching session, or `revokedAt IS NOT NULL`, or `expiresAt < now()`: return `401 Unauthorized` `{ error: { code: 'UNAUTHORIZED' } }` and clear the cookie.
- ADDED On a valid session: revoke it (`revokedAt = now()`), issue a new access token + new `RefreshSession` row + new rotated cookie, and return `200 OK` `{ success: true, data: { accessToken, user } }` (rotation-on-use, preventing replay of a stolen-then-superseded refresh token).

### Logout (`FRS-1.4.1`)

- ADDED `POST /api/v1/auth/logout` (authenticated) SHALL revoke only the `RefreshSession` matching the `refreshToken` cookie presented in the request (`revokedAt = now()`), clear the cookie, and return `200 OK`. Other active sessions/devices for the same user SHALL remain valid and untouched.
- ADDED If the `refreshToken` cookie is absent or already revoked/expired at logout time: still return `200 OK` (idempotent) and clear any stale cookie — logout SHALL NOT error just because the session was already gone.

### Session Hydration (`GET /api/v1/auth/me`)

- ADDED `GET /api/v1/auth/me` (authenticated) SHALL validate the `Authorization: Bearer <token>` access token via `requireAuth`, look up the current `User` row by `req.user.userId`, and return `200 OK` `{ success: true, data: { user: { id, email, isVerified } } }`. This endpoint exists solely to let the frontend (`AB-1010`) restore session state after a hard page refresh (the access token lives only in JS memory); it performs no mutation.
- ADDED An invalid/expired/missing access token on `/me` SHALL return `401 Unauthorized { code: 'UNAUTHORIZED' }`, same as any other protected route — the frontend's Axios interceptor is expected to attempt one silent `/auth/refresh` before treating this as a full logout.

### Middleware & Cross-Cutting

- ADDED `requireAuth` middleware validates the `Authorization: Bearer <token>` JWT, attaches `req.user = {userId, email, isVerified}`, and returns `401 Unauthorized { code: 'UNAUTHORIZED' }` on missing/invalid/expired token — never a 403 for this case (403 is reserved for the unverified-account case, `FRS §8 status code table`).
- ADDED All seven routes above (`register`, `verify-otp`, `resend-otp`, `login`, `refresh`, `logout`, `me`) are namespaced under `/api/v1/auth/*` and registered via `apps/api/src/routers/auth.router.ts` → `auth.controller.ts` → `auth.service.ts` → `auth.repository.ts`, matching the strict layering (`AGENTS.md §5`). Controllers perform `schema.parse` only; zero SQL/business logic in `controllers/` or `routers/`.
- ADDED `/api/v1/docs` (Swagger UI) mounted in `apps/api/src/app.ts`, rendering an OpenAPI document generated from the `packages/shared` auth schemas, covering all 7 routes in this delta (`FRS-8.7`).

## Error Scenarios (verbatim from `FRS.md §1`, retained for traceability)

Duplicate verified email → rejected, no account created · Weak password → rejected, names violated rule · Register on existing-unverified email → re-triggers OTP for same account, no duplicate, no email-enumeration leak · Wrong password → generic rejection, doesn't reveal whether email exists · Correct credentials, unverified account → distinct "please verify" message · Rate-limited login → rejected without revealing unlock time · Expired/consumed/invalidated OTP → rejected, "request a new one" · Refresh with expired/revoked token → rejected, re-login required.

## Out of Scope Boundaries (binding for this delta)

- `FRS-1.5` forgot/reset password OTP flow — `AB-1003`.
- OAuth/social login, MFA beyond OTP, self-service account deletion — `FRS §1 Out of Scope`, `Master Out-of-Scope List`.
- Any React/frontend auth pages — `AB-1010`.
