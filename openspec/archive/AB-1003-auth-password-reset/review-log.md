# Review Log: AB-1003-auth-password-reset

Sole tracking log for reviewer findings and action items during `/implement`. `fix-bundles` are not used per project convention.

---

## Review: AB-1003 Auth — Forgot Password + OTP Reset (post Phase 2)

Reviewed: `packages/shared/src/schemas/auth.schema.ts`, `types/auth.type.ts`,
`constants/api-paths.constant.ts`, `apps/api/src/repositories/auth.repository.ts`,
`services/auth.service.ts`, `controllers/auth.controller.ts`, `routers/auth.router.ts`,
against `spec.md`, `plan.md`, `docs/FRS.md` §1.5, `docs/SDS.md` §3.1/3.2/§7, `AGENTS.md`.

### 1. Shared contract / single source of truth (Rule 11)

✅ PASSED — `passwordSchema` extracted once, reused verbatim by `registerSchema.password` and `resetPasswordSchema.newPassword`. Zero duplicated regex.
✅ PASSED — `forgotPasswordSchema`/`resetPasswordSchema` defined only in `packages/shared`; types inferred via `z.infer`, not hand-duplicated.
✅ PASSED — `API_PATHS.AUTH.FORGOT_PASSWORD`/`RESET_PASSWORD` added; barrels are wildcard re-exports, no drift.

### 2. Layer isolation (AGENTS.md §5, apps/api/CLAUDE.md)

✅ PASSED — Controller handlers contain only `schema.parse` + service call + `{ success: true, data }`. Zero SQL, zero Zod definitions.
✅ PASSED — Router only declares routes. Repository function is a single `updateMany` call, no business logic.

### 3. No email enumeration (FRS-1.5.1, FRS-1.5.3)

✅ PASSED — All three branches of `forgotPassword` return the identical generic message; no throw, no shape difference.
⚠️ DRIFTED (doc-only) — `docs/SDS.md` §3.2/§7 still documents `forgot-password` returning `{ success: true, userId, message }` (pre-AB-1003 `[BUG-4 Fix]` text). Implementation correctly omits `userId` per the no-enumeration decision in `spec.md` — this is a stale-doc gap, not a code defect. Recommend updating `docs/SDS.md` in a follow-up.
📋 FRS GAP (doc-only) — `docs/SDS.md` §3.2 still describes `verifyOtp` as handling `PASSWORD_RESET`; stale relative to this ticket's MODIFIED Requirements.

### 4. OTP terminal-state correctness (FRS-1.2.4a, FRS-1.5.4, FRS-1.5.5)

✅ PASSED — All four states (nonexistent/missing/expired, INVALIDATED/cap, mismatch, success) map to the exact spec'd status codes. Row-lock + re-fetch inside `$transaction` closes the TOCTOU race, mirroring `verifyOtp`'s existing pattern.

### 5. Session revocation scope (FRS-1.5.6)

✅ PASSED — `revokeAllRefreshSessionsForUser` has no `userAgent` filter (unlike `revokeActiveSessionsForDevice`), and runs inside the same transaction as the password hash update and OTP consumption.

### 6. Token storage (FRS-1.3.5)

✅ PASSED — Neither new function touches access/refresh token issuance or the refresh cookie.

### 7. bcrypt placement

✅ PASSED — `bcrypt.hash` runs before `$transaction`, matching plan.md §3.2.

### 8. Scope-tightening correctness (FRS-1.5.1 decision)

✅ PASSED — `verifyOtpSchema`/`resendOtpSchema.type` narrowed to `z.literal("EMAIL_VERIFICATION")`. `verifyOtp`'s guard cleanup is behavior-neutral.

### 9. No hardcoded numerics (FRS-8.5)

✅ PASSED — All OTP/bcrypt constants referenced from `APP_LIMITS`/Tier-2 constants.

### 10. API response shape (AGENTS.md §6)

✅ PASSED — Both endpoints return `{ success: true, data }`; failures rely on `AppError` + centralized handler.

### 11. Test Coverage Gaps — CRITICAL (pre-existing at time of this review, Phase 3 in progress)

❌ MISSING — No dedicated test file existed yet for `forgot-password`/`reset-password` at review time (test-writer invoked concurrently to close this).
❌ REGRESSION BROKEN — `apps/api/tests/contract/auth.verify-otp.test.ts` (existing test, ~lines 171-186) asserts `400 OTP_EXPIRED` for a `{ type: "PASSWORD_RESET" }` payload to `/verify-otp`. Under the narrowed `verifyOtpSchema` (`z.literal("EMAIL_VERIFICATION")`), this payload now fails `.parse()` pre-service and the error middleware returns `400 VALIDATION_ERROR` instead — this existing test now asserts stale behavior and must be corrected to match `spec.md`'s MODIFIED Requirements (lines 104-111). **Action**: test-writer to fix this test as part of Phase 3, per spec-first authority (spec.md > reviewer > test > code) — the test is wrong, not the implementation.
❌ MISSING — `resend-otp` regression test for `type: "PASSWORD_RESET"` → `400 VALIDATION_ERROR` (plan.md §6) not yet present at review time.

### Verdict (at time of this review)

No `[SEC]`-severity issues. Implementation is FRS/SDS-compliant. Two action items before task completion: (1) fix the now-stale `auth.verify-otp.test.ts` regression assertion, (2) complete Phase 3 test coverage for the new endpoints (in progress). Doc-sync items on `docs/SDS.md` are non-blocking and can be addressed separately.

---

## Re-Verification: Test-Coverage Gap Closure (post test-writer pass)

Scope: targeted re-check of the three gaps flagged above (§11) — not a full re-run of the 10-point review, which already passed.

### Gap 1 — New endpoint test files: real scenario coverage, not just status checks

✅ PASSED — `auth.forgot-password.test.ts` (6 tests), `auth.reset-password.test.ts` (8 tests), `auth.reset-password.concurrency.test.ts` (1 test) all assert real DB state (row status/attempts/passwordHash/revokedAt), not just HTTP status codes. Cooldown boundary (±1s), attempt-cap boundary, dual-session revocation, and concurrent double-submit (via `bcrypt.compare` on both candidate passwords) all genuinely exercised.

### Gap 2 — Stale `auth.verify-otp.test.ts` assertion

✅ PASSED — Confirmed the old `400 OTP_EXPIRED` assertion for a `PASSWORD_RESET`-typed payload no longer exists anywhere in the file; it was replaced (not supplemented) with a correct `400 VALIDATION_ERROR` assertion plus an OTP-row-untouched check.

### Gap 3 — `resend-otp` regression test

✅ PASSED — Present at lines 129-148, asserts `400 VALIDATION_ERROR` and proves via DB that the OTP row is untouched and no new row was created.

### Gap 4 — Test derivation (FRS-0.3.2)

✅ PASSED — No test name/assertion is a reworded AC checklist bullet; tests cover boundaries/concurrency/cross-type-isolation the checklist never enumerated.

### Gap 5 — Test DB isolation

✅ PASSED — All new/modified files use the identical `notes_app_test` safety-break guard + `resetTestDatabase()` truncation convention as existing sibling tests.

### Verdict

**ALL PREVIOUSLY-FLAGGED GAPS CLOSED — TASK 3 CONFIRMED COMPLETE.** No `[SEC]` findings.

### Outstanding non-blocking item

`docs/SDS.md` §3.2/§7 still document `forgot-password` returning `{ success: true, userId, message }` and describe `verifyOtp` as handling `PASSWORD_RESET` — both stale relative to this ticket's approved spec.md decisions. Recommend a follow-up doc-sync pass; does not block `/pr` for this ticket.

---
