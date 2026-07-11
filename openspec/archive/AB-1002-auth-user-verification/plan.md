# Technical Implementation Plan: AB-1002 — Auth Register/Login/Logout/JWT+Refresh/Email Verification

Source: `openspec/changes/AB-1002-auth-user-verification/specs/auth/spec.md` (approved). Maps every `ADDED` scenario to exact files, in dependency order (`shared → repositories → services → middlewares → controllers → routers → app.ts`).

## 0. Current State (confirmed via graph + direct read)

- `packages/shared/src/{schemas,types,constants}/index.ts` are empty barrels (`export {}`) — greenfield, no auth DTOs exist yet.
- `apps/api/src/{controllers,middlewares,repositories,services}/` contain only `.gitkeep` — greenfield.
- `apps/api/src/routers/index.ts` is an empty `Router()` with nothing mounted; `app.ts` wires `cors → express.json → router → error handler`.
- DB schema already has `User`, `OtpCode` (`OtpType`, `OtpStatus` enums), `RefreshSession`, `LoginAttempt` models from `AB-1001` migration `20260710124549_init` — **no new Prisma migration needed** for this ticket.
- Dependencies already installed in `apps/api/package.json`: `bcrypt@6.0.0`, `jsonwebtoken@9.0.3`, `zod@3.25.76`, `@prisma/client@6.19.3`, `supertest@7.2.2`. **Not yet installed**: `swagger-ui-express` + an OpenAPI-from-Zod generator (needed for the `/api/v1/docs` decision) — add as a pinned exact version to `apps/api/package.json` during `/implement`, verified against `context7` first (`FRS-0.3.1`, `CLAUDE.md §1b`).

---

## 1. `packages/shared` — Single Source of Truth (`Rule 11`, `FRS-8.5`)

New files (each re-exported from its directory's `index.ts` barrel per `packages/shared/CLAUDE.md`):

- **`src/schemas/auth.schema.ts`**

  ```typescript
  export const registerSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z
      .string()
      .min(8)
      .regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])/),
  });
  export const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
  });
  export const verifyOtpSchema = z
    .object({
      userId: z.string().uuid().optional(),
      email: z.string().email().optional(),
      code: z.string().length(APP_LIMITS.OTP_LENGTH),
      type: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
    })
    .refine((d) => !!(d.userId || d.email), {
      message: "Either userId or email must be provided",
    });
  export const resendOtpSchema = z
    .object({
      userId: z.string().uuid().optional(),
      email: z.string().email().optional(),
      type: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
    })
    .refine((d) => !!(d.userId || d.email), {
      message: "Either userId or email must be provided",
    });
  ```

  (imports `APP_LIMITS` from `../constants` — intra-package import, not circular since constants has no schema deps.)

- **`src/types/auth.type.ts`**: `z.infer<typeof registerSchema>`, `LoginInput`, `VerifyOtpInput`, `ResendOtpInput`, plus hand-shaped response DTOs that mirror controller output exactly (`AuthUserDto = { id: string; email: string; isVerified: boolean }`, `LoginResponseDto = { accessToken: string; user: AuthUserDto }`, `RegisterResponseDto = { isReTriggered: boolean; userId: string }`, `MeResponseDto = { user: AuthUserDto }`).

- **`src/constants/app-limits.constant.ts`** — add (do not touch unrelated future-ticket constants):
  `OTP_LENGTH=6`, `OTP_EXPIRY_MINUTES=10`, `OTP_MAX_ATTEMPTS=3`, `OTP_RESEND_COOLDOWN_SECONDS=60`, `LOGIN_RATE_LIMIT_MAX_ATTEMPTS=5`, `LOGIN_RATE_LIMIT_WINDOW_MINUTES=15`, `ACCESS_TOKEN_EXPIRY_MINUTES=15`, `REFRESH_TOKEN_EXPIRY_DAYS=7`.
- **`src/constants/api-paths.constant.ts`** — `API_PATHS.BASE = "/api/v1"`, `API_PATHS.AUTH = { REGISTER, VERIFY_OTP, RESEND_OTP, LOGIN, REFRESH, LOGOUT, ME }` (relative segments, e.g. `/auth/register`).
- **`src/constants/api-error-codes.constant.ts`** — `API_ERROR_CODES.EMAIL_ALREADY_VERIFIED`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `RESEND_COOLDOWN_ACTIVE`, `INVALID_CREDENTIALS`, `ACCOUNT_NOT_VERIFIED`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED`.
- **`src/constants/validation-messages.constant.ts`** — user-facing strings referenced by Zod `.refine`/schema `message` fields (kept out of inline literals per `FRS-8.5`).
- Update `src/schemas/index.ts`, `src/types/index.ts`, `src/constants/index.ts` barrels to re-export the new files (never leave a file un-barreled).

---

## 2. `apps/api/src/constants` — Tier 2 Backend-Only (`AGENTS.md §5`)

- **`src/constants/api.constants.ts`** (new file): `BCRYPT_ROUNDS = 12`, `JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!`, `JWT_ISSUER = "notes-app"`, `REFRESH_TOKEN_BYTE_LENGTH = 64`. Read secrets from `process.env` (populated via `.env` / `.env.test`), never hardcode a literal secret string.

---

## 3. `apps/api/src/repositories/auth.repository.ts`

Prisma Client + raw queries only — no business logic (`AGENTS.md §5`):

- `findUserByEmail(email)`, `createUser({ email, passwordHash })`, `updateUserPasswordHash(userId, passwordHash)`, `markUserVerified(userId)` (used inside the verify-otp transaction, not standalone).
- `findLatestOtp(userId, type)`, `createOtp({ userId, type, codeHash, expiresAt })`, `invalidatePendingOtp(userId, type)`.
- `incrementOtpAttemptsForUpdate(otpId)` — SHALL use a Prisma interactive transaction (`prisma.$transaction(async (tx) => { ... })`) with `tx.otpCode.findUnique(... )` read inside the transaction followed by `tx.otpCode.update(...)`, relying on Prisma's default `ReadCommitted` + row-level lock behavior on the subsequent `UPDATE` to serialize concurrent attempt-increments on the same row (verify exact Prisma 6.x interactive-transaction locking semantics against `context7` before implementing — `FRS-0.3.1`). This is the mechanism backing spec line "row-level lock on the target `OtpCode` row."
- `markOtpConsumed(otpId)`, `markOtpInvalidated(otpId)`.
- `countRecentLoginAttempts(email, sinceDate)`, `createLoginAttempt({ email, ipAddress })`, `deleteLoginAttemptsByEmail(email)`.
- `createRefreshSession({ userId, tokenHash, userAgent, ipAddress, expiresAt })`, `findRefreshSessionByHash(tokenHash)`, `revokeRefreshSession(sessionId)`, `revokeActiveSessionsForDevice(userId, userAgent)` (used by login's same-device revoke decision).

---

## 4. `apps/api/src/services/` — Business Logic & Transactions

- **`src/services/token.service.ts`**: `signAccessToken(payload)` / `verifyAccessToken(token)` (wraps `jsonwebtoken`, `expiresIn` from `APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES`), `generateRefreshToken()` (crypto-random 64-byte hex via Node `crypto.randomBytes`), `hashRefreshToken(raw)` (SHA-256 via Node `crypto.createHash`).
- **`src/services/otp.service.ts`**: `generateOtpCode()` (6-digit, zero-padded), `hashOtpCode(code)` (bcrypt, same work factor as passwords), `verifyOtpCodeHash(code, hash)`, `logOtpToConsole(email, code, type)` (`FRS-8.3` — the only place an OTP value is ever surfaced).
- **`src/services/auth.service.ts`** — one exported async function per spec scenario, each orchestrating repository calls inside `prisma.$transaction` where the spec requires atomicity:
  - `register(input)` → branches on existing-user verified/unverified/absent exactly per spec §Registration; returns `{ status: 201|200, data }`.
  - `verifyOtp(input)` → resolves latest OTP, transactional attempt-increment-or-consume per spec §Email Verification.
  - `resendOtp(input)` → cooldown check + invalidate-and-regenerate.
  - `login(input, { ipAddress, userAgent })` → rate-limit precheck (delegated to middleware, but service still needs `ipAddress`/`userAgent` for session creation and the wrong-password-on-unverified counting rule), branches wrong-password / correct-unverified / success exactly per spec §Login, including same-device `RefreshSession` revoke-on-login.
  - `refresh(rawCookieToken)` → hash, lookup, validate, rotate.
  - `logout(rawCookieToken)` → idempotent single-session revoke.
  - `getMe(userId)` → read-only lookup for `GET /auth/me`.

---

## 5. `apps/api/src/middlewares/`

- **`src/middlewares/require-auth.middleware.ts`**: parses `Authorization: Bearer <token>`, calls `token.service.verifyAccessToken`, attaches `req.user`, else `401 UNAUTHORIZED`.
- **`src/middlewares/check-login-rate-limit.middleware.ts`**: reads `req.body.email` (post-Zod-parse, so mount **after** the controller's schema validation, or re-validate minimally — see Task-level note to resolve ordering during `/tasks`), queries `countRecentLoginAttempts`, short-circuits `429` before the controller calls `auth.service.login`.
- **`src/middlewares/error.middleware.ts`**: extract the existing inline error handler out of `app.ts` into its own middleware file (keeps `app.ts` a thin composition root), mapping thrown typed errors (e.g. a shared `AppError { statusCode, code, message }`) to the unified `{ success: false, error }` wrapper. A small `src/errors/app-error.ts` helper class is introduced for services to throw structured errors the controllers/error-middleware can translate into the correct HTTP status.

---

## 6. `apps/api/src/controllers/auth.controller.ts`

One handler per route; each does `schema.parse(req.body)` (or reads validated `req.user` for `/me`) then calls the matching `auth.service` function and shapes the unified response — zero SQL, zero Zod schema _definitions_ (imported only):

`register`, `verifyOtp`, `resendOtp`, `login` (also reads `req.ip` + `req.get('user-agent')` to pass through to the service, and sets the `refreshToken` cookie), `refresh` (reads/sets cookie), `logout` (reads/clears cookie), `me`.

---

## 7. `apps/api/src/routers/auth.router.ts` + wiring

- New `auth.router.ts`: declares the 7 routes, attaching `requireAuth` to `logout`/`me` only, and `checkLoginRateLimit` to `login` only.
- `apps/api/src/routers/index.ts`: mount `router.use(API_PATHS.BASE + "/auth", authRouter)` (import `API_PATHS` from `@shared/core/constants`).
- `apps/api/src/app.ts`: add `cookie-parser` (new pinned dependency — needed to read the `refreshToken` cookie; verify exact API via `context7` before use) before the router mount; replace the inline error handler with the new `error.middleware.ts`.

---

## 8. Swagger / OpenAPI (`FRS-8.7`, Clarifying Decision 3)

- Add `swagger-ui-express` (+ a Zod-to-OpenAPI generator, exact package TBD via `context7` lookup at implementation time — e.g. `@asteasolutions/zod-to-openapi`) as pinned exact-version dependencies.
- New `apps/api/src/docs/openapi.ts` builds the OpenAPI document from the 4 auth schemas + response DTOs; `app.ts` mounts it at `${API_PATHS.BASE}/docs` via `swaggerUi.serve`/`swaggerUi.setup`.

---

## 9. Test Strategy (executed by `test-writer.md`, not authored here)

- Unit (`vitest`): `token.service`, `otp.service` pure-function behavior (hashing, expiry math, code format) — no DB.
- Contract (`supertest` against `notes_app_test`, `.env.test`, `TRUNCATE ... CASCADE` guarded by `DATABASE_URL.includes('notes_app_test')` per `AGENTS.md §10`): full route-level coverage of every `ADDED` scenario in `spec.md`, deriving cases from `FRS-1.1–1.4`/`FRS-1.2.4a` text directly (not this plan's prose, not the FRS Acceptance Criteria bullets) — including the concurrency test for the OTP attempt-cap race (Decision 2) and the same-device session-revoke-on-login behavior (Decision 4).
- Coverage target: ≥80% on all new files under `apps/api/src/{services,repositories,controllers,middlewares}/auth*` and `packages/shared/src/{schemas,types,constants}/*auth*`.

---

## 10. Quality Gates (run in this order before `/review`)

1. `pnpm turbo run build` — 0 errors (`tsup` bundles `@shared/core` before `@apps/api` via `^build`).
2. `pnpm turbo run lint` — `--max-warnings 0`.
3. `pnpm turbo run typecheck` — `tsc --noEmit`, 0 errors.
4. `pnpm turbo run test -- --coverage` — all green against `notes_app_test`, ≥80% on new code.

## Open Items Deferred to `/tasks`

- Exact ordering of Zod-parse vs. rate-limit middleware on `POST /auth/login` (both need `email`; resolve as either "parse in middleware too" or "rate-limit middleware runs after controller-level parse via a small wrapper").
- Exact npm package name/version for the Zod→OpenAPI generator (context7-verified at implementation time).
- Exact `cookie-parser` version pin (context7-verified at implementation time).
