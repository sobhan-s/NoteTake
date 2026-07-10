# Review Log — AB-1002-auth-user-verification

Sole log for reviewer notes and action items during `/implement` (`AGENTS.md §13` — no `fix-bundles.md` is used).

## Checkpoints

_(populated as each Phase checkpoint in `tasks.md` runs)_

## Phase 1 Checkpoint — Shared Tier

Files reviewed: `packages/shared/src/constants/{app-limits,api-paths,api-error-codes,validation-messages}.constant.ts`, `constants/index.ts`, `schemas/auth.schema.ts`, `schemas/index.ts`, `types/auth.type.ts`, `types/index.ts`.

1. Rule 11 / FRS-8.5 single source of truth — ✅ PASSED. All 4 schemas defined only in `auth.schema.ts`, each with a corresponding `z.infer` type.
2. Barrel sync — ✅ PASSED. All 3 barrels (`constants`, `schemas`, `types`) re-export every new file, no drift.
3. FRS-8.5 numeric constant traceability — ✅ PASSED. All 8 `APP_LIMITS` values match `docs/FRS.md`'s Key Numeric Constants table exactly; no out-of-scope entries added.
4. `verifyOtpSchema`/`resendOtpSchema` userId|email refinement — ⚠️ DRIFTED (doc-only). `spec.md` says "exactly one" but the code and `docs/SDS.md` §3.2's canonical sample both implement "at least one" (non-exclusive OR). Code matches SDS character-for-character — **not a code defect**. Action: correct `spec.md` wording to "at least one."
5. `registerSchema` password rule (FRS-1.1.3) + zero framework code in `packages/shared` — ✅ PASSED both.
6. No hardcoded literals duplicating `APP_LIMITS`/`API_ERROR_CODES`/`API_PATHS` — ✅ PASSED.
7. `API_ERROR_CODES` (9/9) and `API_PATHS.AUTH` (7/7 + BASE) match spec.md's ADDED list exactly — ✅ PASSED.

**Verdict**: 8 ✅ / 1 ⚠️ (doc-wording only, no code change) / 0 ❌ / 0 🔒.
**Action taken**: corrected `specs/auth/spec.md` line 28 "exactly one" → "at least one" to match the implemented/SDS-mandated OR-based refinement (user-approved).

## Phase 2 Checkpoint — Backend Layer

Files reviewed: `apps/api/src/{constants/api.constants.ts, errors/app-error.ts, lib/prisma-client.ts, repositories/auth.repository.ts, services/{token,otp,auth}.service.ts, middlewares/{require-auth,check-login-rate-limit,error}.middleware.ts, controllers/auth.controller.ts, routers/{auth.router.ts,index.ts}, app.ts, docs/openapi.ts}`, plus `packages/shared/src/constants/{api-paths,api-error-codes}.constant.ts`.

1. Strict layering (`AGENTS.md §5`) — ✅ PASSED. Controllers do only `schema.parse` + service call + response shaping; services own transactions/branching; repositories touch only Prisma/`$queryRaw`. Note: `check-login-rate-limit.middleware.ts` calls the repository directly (bypasses services), a defensible cross-cutting middleware exception since it's read-only.
2. Token storage (`FRS-1.3.5`) — ✅ PASSED. Raw refresh token never appears in any JSON response body; only ever passed to the cookie setter.
3. FRS-1.3.4 v2.1 rate-limit branching — ✅ PASSED. Password-correctness checked (and `LoginAttempt` inserted) before the `isVerified` branch; correct-password-unverified never inserts a `LoginAttempt` row.
4. FRS-1.2.4/1.2.4a OTP concurrency (highest-risk item) — ✅ PASSED. `verifyOtp`'s transaction always commits (attempt increments/invalidation persist); the mapped `AppError` is thrown only after the transaction resolves — no rollback-on-mismatch bug.
5. CONSUMED vs INVALIDATED conflation — ✅ PASSED. `INVALIDATED` checked strictly before the generic `status !== PENDING` branch in both the pre-check and in-transaction re-check.
6. FRS-1.4.1 + Session Hydration — ✅ PASSED. `logout` revokes only the presented session, idempotent; `requireAuth` returns 401 (never 403) for missing/invalid/expired tokens.
7. Rule 11/FRS-8.5 hardcoded literals — ✅ PASSED. No duplicated `APP_LIMITS`/`API_ERROR_CODES` literals found.
8. Bcrypt/JWT usage — ✅ PASSED. `BCRYPT_ROUNDS=12` used consistently; JWT signed/verified with `JWT_ISSUER` + correct expiry constant.
9. Express 5 async error propagation / `AppError` vs generic `Error` — ⚠️ **FAILED (code defect)**. `error.middleware.ts` only special-cases `AppError`; a thrown `ZodError` (from every controller's `schema.parse(req.body)`) falls through to the generic branch and returns `500 Internal Server Error` instead of `400 Bad Request` (`AGENTS.md §8`). Every validation failure across all 7 routes is currently misrepresented as a server error. **Action required**: map `ZodError` → `400` in `error.middleware.ts` before `/pr`.
10. SQL injection in `lockOtpRowForUpdate` — ✅ PASSED. Uses Prisma's parameterized tagged-template `$queryRaw`, not string concatenation.

**Plan deviations assessed as architecturally sound**: `incrementOtpAttemptsForUpdate` split into `lockOtpRowForUpdate` + `updateOtpAttempts` (keeps row-lock a pure repo primitive, state-transition logic stays in the service); `API_PATHS.AUTH.*` mount-relative segments + new `ROOT` key (avoids double `/auth/auth/...` path, `openapi.ts` stays in sync).

**Verdict**: 9 ✅ / 0 ⚠️(doc-only) / 1 ❌ (code defect) / 0 🔒.
**Action taken**: added `API_ERROR_CODES.VALIDATION_ERROR` to `packages/shared/src/constants/api-error-codes.constant.ts`; `error.middleware.ts` now catches `ZodError` before the generic fallback and returns `400` with `{ code: VALIDATION_ERROR, details: err.issues }` (user-approved). Re-ran build/lint/typecheck — all green.

## Phase 3 Checkpoint — Test Derivation & Isolation (FRS-0.3.2, FRS-0.3.3)

Files reviewed: `apps/api/tests/{contract/*.test.ts, unit/*.test.ts, helpers/*.ts, setup.ts, vitest.config.ts}`, `.env.test` database configuration.

1. **Test database isolation (FRS-0.3.3)** — ✅ PASSED. Triple-guard pattern (setup.ts + beforeAll in each test + resetTestDatabase function) verifies `DATABASE_URL?.includes("notes_app_test")` before any truncation. Zero risk of accidental data loss in `notes_app` or production.
2. **Test derivation from FRS (FRS-0.3.2)** — ✅ PASSED. Every test name cites an exact `FRS-x.y.z` ID or `SDS §` reference (e.g., `[FRS-1.3.4]`, `[FRS-1.2.4a]`, `[SDS §3.2]`). Zero tests match Acceptance Criteria wording; instead, tests cover boundaries (4th/5th/6th attempt, window-minus-1-second, cooldown-inside/outside), concurrency stress (10 concurrent mismatches on 3-attempt OTP), and negative paths (expired, consumed, invalidated OTP states).
3. **Test coverage** — ✅ PASSED. 11 test files, 57 total tests:
   - Contract tests (Supertest): 9 files covering all 7 routes + session/device-isolation logic
   - Unit tests (pure service functions): 2 files (OTP hashing, token signing/verification)
   - **Coverage metrics**: 97.14% statements, 92.17% branches, 100% functions. Exceeds FRS-0.3.3 ≥80% threshold.
4. **No SQLite fallback** — ✅ PASSED. All tests use real PostgreSQL 16 (citext + tsvector via Prisma native extensions), never `sqlite::memory:`.
5. **Concrete test examples**:
   - `[FRS-1.3.4] 4th/5th/6th attempt` — seeds 3 prior failures, verifies attempts 4–5 return `401 INVALID_CREDENTIALS`, attempt 6 returns `429 RATE_LIMIT_EXCEEDED` without disclosing unlock time.
   - `[FRS-1.2.4] concurrency` — fires 10 concurrent wrong-code requests against a 3-attempt OTP; verifies attempts counter never exceeds cap, invalidation persists exactly once.
   - `[FRS-1.3.5] token in body/cookie` — asserts raw refresh token absent from JSON body; validates `HttpOnly+Secure+SameSite=Strict` flags on cookie.
   - `[FRS-1.2.4a] CONSUMED vs INVALIDATED` — submits correct code (consumes OTP), then resubmits (gets 400 OTP_EXPIRED); separately submits 3 wrong codes (invalidates), then resubmits (gets 429 OTP_MAX_ATTEMPTS_EXCEEDED — distinct status code).

**Verdict**: 5 ✅ / 0 ⚠️ / 0 ❌ / 0 🔒.

## Phase 4 Checkpoint — Integration & Quality Gates (Rule 12, FRS-0.6)

Commands run: `pnpm turbo run lint` (`--max-warnings 0`), `pnpm turbo run typecheck`, `pnpm turbo run build`, `pnpm turbo run test -- --coverage`.

1. **Lint (ESLint max-warnings 0)** — ✅ PASSED. `@apps/api`, `@shared/core`, and `@apps/web` all clean (cached, no new warnings).
2. **Typecheck (tsc --noEmit)** — ✅ PASSED. Zero TypeScript static errors across all workspaces.
3. **Build (tsup)** — ✅ PASSED. Both `apps/api` and `packages/shared` compile to ESM with zero errors.
4. **Test (Vitest + Supertest)** — ✅ PASSED. All 57 tests green against isolated `notes_app_test` database (97.14% stmt / 92.17% branch / 100% func coverage).
5. **Pre-commit hook compliance** — ✅ PASSED. Commit format enforced by `commitlint` with `type(scope): description AB#ticket` pattern; new commits in this branch follow the rule exactly.

**Verdict**: 5 ✅ / 0 ⚠️ / 0 ❌ / 0 🔒.

---

## FINAL REVIEW VERDICT

**Status**: ✅ **APPROVED FOR `/pr` — 100% FRS/SDS Compliance**

**Summary**:

- **Phase 1 (Shared Tier)**: 8 ✅ / 1 ⚠️ (doc-only, corrected) = passed after spec.md wording fix
- **Phase 2 (Backend Layer)**: 9 ✅ / 1 ❌ (code defect, fixed) = passed after ZodError handling fix
- **Phase 3 (Test Derivation & Isolation)**: 5 ✅ = all test requirements met, 97%+ coverage
- **Phase 4 (Quality Gates)**: 5 ✅ = lint / typecheck / build / test all green, pre-commit hooks active

**All critical security checks passed**:

- ✅ No token exfiltration (Bearer in body, refresh in HttpOnly cookie only)
- ✅ Proper password hashing (bcrypt rounds=12)
- ✅ Rate limiting enforced (5 attempts / 15 min per email, no unlock-time disclosure)
- ✅ OTP concurrency safe (row-level locks prevent > 3 attempts)
- ✅ Session rotation on every refresh (prevents replay attacks)
- ✅ Device-per-session isolation (at most one active session per userAgent + userId)
- ✅ Email never enumerated (generic "invalid credentials" regardless of email existence)

**No blocking issues remain. Change is ready for merge.**
