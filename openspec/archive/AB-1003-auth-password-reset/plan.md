# Implementation Plan: Auth — Forgot Password + OTP Reset (AB-1003)

Spec: `openspec/changes/AB-1003-auth-password-reset/specs/auth/spec.md`
Target: `FRS-1.5.1–1.5.6`. Layering: `AGENTS.md §5` (`routers → controllers → services → repositories → shared`).

Build order follows the dependency direction: `packages/shared` first (nothing downstream compiles without it), then `repositories/`, then `services/`, then `controllers/`, then `routers/`, then tests.

---

## 1. `packages/shared` (single source of truth — build first)

### 1.1 `packages/shared/src/schemas/auth.schema.ts`

- Extract the inline password rule out of `registerSchema.password` into a standalone exported `passwordSchema`:
  ```ts
  export const passwordSchema = z
    .string()
    .min(8, VALIDATION_MESSAGES.PASSWORD_WEAK)
    .regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])/, VALIDATION_MESSAGES.PASSWORD_WEAK);
  ```
  `registerSchema.password` becomes `passwordSchema` (no behavior change — same regex/min, verified against existing register tests).
- Narrow the `type` field on `verifyOtpSchema` and `resendOtpSchema` from `z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"])` to `z.literal("EMAIL_VERIFICATION")`. `.refine` blocks are unchanged.
- Add two new schemas:
  ```ts
  export const forgotPasswordSchema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email(VALIDATION_MESSAGES.EMAIL_INVALID),
  });

  export const resetPasswordSchema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email(VALIDATION_MESSAGES.EMAIL_INVALID),
    code: z.string().length(APP_LIMITS.OTP_LENGTH),
    newPassword: passwordSchema,
  });
  ```

### 1.2 `packages/shared/src/types/auth.type.ts`

- Add `import type { forgotPasswordSchema, resetPasswordSchema } from "../schemas/auth.schema";`
- Add `export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;`
- Add `export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;`
- No new response DTO types needed — both endpoints return `{ message: string }`, same shape already used by `resendOtp`'s return type (inline, not a named DTO — stay consistent, don't introduce one).

### 1.3 `packages/shared/src/constants/api-paths.constant.ts`

- Add to `API_PATHS.AUTH`: `FORGOT_PASSWORD: "/forgot-password"` and `RESET_PASSWORD: "/reset-password"`.

### 1.4 Barrels

- Confirm `packages/shared/src/schemas/index.ts` (`export * from "./auth.schema"`) and the equivalent `types/index.ts` already re-export everything via wildcard — no barrel edit needed since both are already wildcard re-exports of the whole file (verified: `schemas/index.ts` is `export * from "./auth.schema"`).

### 1.5 No changes needed

- `APP_LIMITS`, `API_ERROR_CODES`, `VALIDATION_MESSAGES` — every value/code this delta needs (`OTP_LENGTH`, `OTP_EXPIRY_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `REFRESH_TOKEN_EXPIRY_DAYS`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `VALIDATION_ERROR`) already exists verbatim — confirmed by direct read, zero additions.

---

## 2. `apps/api/src/repositories/auth.repository.ts`

Add one new primitive, following the exact `Db = prisma` default-param pattern already used by every other function in this file:

```ts
export function revokeAllRefreshSessionsForUser(
  userId: string,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
```

Placed directly after `revokeActiveSessionsForDevice` (line ~176) to keep all `RefreshSession` revocation primitives adjacent. No changes to any existing function — `findLatestOtp`, `invalidatePendingOtp`, `createOtp`, `lockOtpRowForUpdate`, `updateOtpAttempts`, `markOtpConsumed` are all type-agnostic (`type: OtpType`) and reused as-is for `PASSWORD_RESET`.

---

## 3. `apps/api/src/services/auth.service.ts`

### 3.1 `forgotPassword(input: ForgotPasswordInput): Promise<{ message: string }>`

New exported function, placed after `resendOtp` and before `login`. Logic:

```ts
export async function forgotPassword(
  input: ForgotPasswordInput,
): Promise<{ message: string }> {
  const message =
    "If an account exists for this email, a reset code has been sent.";
  const user = await authRepository.findUserByEmail(input.email);
  if (!user) return { message };

  const latest = await authRepository.findLatestOtp(user.id, "PASSWORD_RESET");
  if (latest && otpCooldownRemaining(latest.createdAt)) return { message };

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);

  await prisma.$transaction(async (tx) => {
    await authRepository.invalidatePendingOtp(user.id, "PASSWORD_RESET", tx);
    await authRepository.createOtp(
      {
        userId: user.id,
        type: "PASSWORD_RESET",
        codeHash,
        expiresAt: new Date(
          Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
        ),
      },
      tx,
    );
  });
  logOtpToConsole(user.email, code, "PASSWORD_RESET");

  return { message };
}
```

Reuses `otpCooldownRemaining` (already defined at the top of the file) verbatim — no new helper. Never throws; every branch returns the same `message` literal, satisfying the no-enumeration requirement.

### 3.2 `resetPassword(input: ResetPasswordInput): Promise<{ message: string }>`

New exported function, placed directly after `forgotPassword`. Mirrors `verifyOtp`'s pre-check + row-locked-transaction structure exactly, but the success branch does password-update + revoke-all instead of mark-verified:

```ts
export async function resetPassword(
  input: ResetPasswordInput,
): Promise<{ message: string }> {
  const user = await authRepository.findUserByEmail(input.email);
  if (!user) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const latest = await authRepository.findLatestOtp(user.id, "PASSWORD_RESET");
  if (!latest) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }
  if (
    latest.status === "INVALIDATED" ||
    latest.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS
  ) {
    throw new AppError(
      429,
      API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
      "Maximum verification attempts exceeded. Please request a new code.",
    );
  }
  if (latest.status !== "PENDING" || latest.expiresAt < new Date()) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const newPasswordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    await authRepository.lockOtpRowForUpdate(tx, latest.id);
    const fresh = await authRepository.findOtpById(latest.id, tx);

    if (!fresh) return { outcome: "expired" as const };
    if (
      fresh.status === "INVALIDATED" ||
      fresh.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS
    ) {
      return { outcome: "max_attempts" as const };
    }
    if (fresh.status !== "PENDING" || fresh.expiresAt < new Date()) {
      return { outcome: "expired" as const };
    }

    const matches = await verifyOtpCodeHash(input.code, fresh.codeHash);
    if (!matches) {
      const newAttempts = fresh.attempts + 1;
      if (newAttempts >= APP_LIMITS.OTP_MAX_ATTEMPTS) {
        await authRepository.updateOtpAttempts(
          fresh.id,
          { attempts: newAttempts, status: "INVALIDATED" },
          tx,
        );
        return { outcome: "max_attempts" as const };
      }
      await authRepository.updateOtpAttempts(
        fresh.id,
        { attempts: newAttempts },
        tx,
      );
      return {
        outcome: "mismatch" as const,
        attemptsRemaining: APP_LIMITS.OTP_MAX_ATTEMPTS - newAttempts,
      };
    }

    await authRepository.markOtpConsumed(fresh.id, tx);
    await authRepository.updateUserPasswordHash(user.id, newPasswordHash, tx);
    await authRepository.revokeAllRefreshSessionsForUser(user.id, tx);
    return { outcome: "success" as const };
  });

  switch (result.outcome) {
    case "expired":
      throw new AppError(
        400,
        API_ERROR_CODES.OTP_EXPIRED,
        "OTP expired or invalid. Please request a new one.",
      );
    case "max_attempts":
      throw new AppError(
        429,
        API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
        "Maximum verification attempts exceeded. Please request a new code.",
      );
    case "mismatch":
      throw new AppError(
        400,
        API_ERROR_CODES.OTP_INVALID,
        `Invalid OTP code. Attempts remaining: ${result.attemptsRemaining}`,
      );
    case "success":
      return { message: "Password reset successfully. Please log in again." };
  }
}
```

Design notes carried over from spec review:

- `bcrypt.hash(newPassword, ...)` runs **before** the transaction (matches the `register` pattern of hashing outside `$transaction` — bcrypt is CPU-bound, not DB-bound, so it should never hold a DB transaction open).
- Nonexistent-email and missing/expired/consumed OTP both throw the exact same `400 OTP_EXPIRED` — no `if (!user)` special-casing beyond that, satisfying the "identical generic code" scenario.
- `resolveUser` (email-or-userId) is intentionally **not** reused here — `resetPasswordSchema` only ever carries `email`, never `userId`, so `authRepository.findUserByEmail` directly is correct and avoids importing dead-code branches.

### 3.3 `verifyOtp` — remove the now-impossible `PASSWORD_RESET` branch

- `input.type` is now typed as the literal `"EMAIL_VERIFICATION"` (via the narrowed `VerifyOtpInput`), so the line `if (input.type === "EMAIL_VERIFICATION") await authRepository.markUserVerified(user.id, tx);` becomes unconditional: `await authRepository.markUserVerified(user.id, tx);`. This is a pure type-narrowing cleanup, not a behavior change (the `if` was always true post-narrowing) — done to avoid a TS "condition is always true" reachability concern and dead code.
- `resendOtp` needs no code change — it is already generic over `input.type`; narrowing the type is sufficient.

### 3.4 New imports required in `auth.service.ts`

- Add `ForgotPasswordInput`, `ResetPasswordInput` to the existing `@shared/core/types` import block.

---

## 4. `apps/api/src/controllers/auth.controller.ts`

Add two handlers, following the exact shape of `resendOtp`'s handler (no cookie handling needed — reset/forgot never touch the refresh cookie):

```ts
export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const input = forgotPasswordSchema.parse(req.body);
  const data = await authService.forgotPassword(input);
  res.status(200).json({ success: true, data });
}

export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const input = resetPasswordSchema.parse(req.body);
  const data = await authService.resetPassword(input);
  res.status(200).json({ success: true, data });
}
```

Add `forgotPasswordSchema`, `resetPasswordSchema` to the existing `@shared/core/schemas` import block. No new imports otherwise — zero SQL, zero Zod definitions, matches `apps/api/CLAUDE.md` controller contract.

---

## 5. `apps/api/src/routers/auth.router.ts`

Add two routes, unauthenticated (matching `verify-otp`/`resend-otp`/`login`/`refresh` — no `requireAuth`), and **not** behind `checkLoginRateLimit` (that middleware is scoped to password-guessing on `/login`; this delta's cooldown/attempt-cap protection is handled entirely inside the OTP rows per spec's "Out of Scope" section):

```ts
router.post(API_PATHS.AUTH.FORGOT_PASSWORD, authController.forgotPassword);
router.post(API_PATHS.AUTH.RESET_PASSWORD, authController.resetPassword);
```

Placed after `RESEND_OTP` and before `LOGIN`, keeping the OTP-lifecycle routes grouped together.

---

## 6. Tests (`test-writer` — derived from FRS-1.5.1–1.5.6, not AC wording)

All against isolated `notes_app_test` (Supertest), per `FRS-0.3.3`. New file: `apps/api/src/__tests__/auth.password-reset.test.ts` (or wherever sibling `auth.*.test.ts` files already live — confirm exact existing test file naming convention before creating, do not invent a new convention).

Required coverage (one test per scenario in the spec, plus the boundary/concurrency cases FRS-0.3.2 mandates beyond AC wording):

- `forgot-password`: nonexistent email → `200` generic message, zero OTP rows created (assert via repository/db check, not just status code); existing unverified account outside cooldown → OTP row created with `type=PASSWORD_RESET`; existing verified account outside cooldown → same; existing account inside cooldown (create at `now - (COOLDOWN_SECONDS - 1)s`) → `200`, no new/invalidated OTP row; cooldown boundary at exactly `COOLDOWN_SECONDS` old → treated as outside cooldown (new OTP created) — the boundary itself, not just "inside"/"outside".
- `reset-password`: nonexistent email → `400 OTP_EXPIRED`; no OTP row at all → `400 OTP_EXPIRED`; `CONSUMED` row → `400 OTP_EXPIRED`; expired row (`expiresAt` 1ms in the past) → `400 OTP_EXPIRED`; `INVALIDATED` row → `429 OTP_MAX_ATTEMPTS_EXCEEDED`; `attempts === OTP_MAX_ATTEMPTS - 1` + wrong code → increments to cap, flips to `INVALIDATED`, returns `429` (the boundary the checklist won't spell out); wrong code below cap → `400 OTP_INVALID` with correct `attemptsRemaining`, `attempts` row incremented by exactly 1, password hash unchanged; correct code → `200`, `passwordHash` changed, OTP row `CONSUMED`, **all** `RefreshSession` rows for that user (seed 2+ sessions from different `userAgent`s) get `revokedAt` set — assert both sessions revoked, not just one, to prove this differs from `revokeActiveSessionsForDevice`; concurrent double-submit of the same correct code (two parallel requests) — exactly one succeeds, the other observes the row already `CONSUMED` post-lock and gets `400 OTP_EXPIRED`, and only one password-hash write occurs (row-lock correctness, mirrors the concurrency test pattern already used for `verify-otp` — locate and follow that existing test's structure).
- `verify-otp` / `resend-otp` regression: submitting `type: "PASSWORD_RESET"` to either endpoint → `400 VALIDATION_ERROR`, and — importantly — the OTP row is left completely untouched (`status` unchanged, `attempts` unchanged), proving the old dead-path is fully closed, not merely rejected at the HTTP layer after already mutating state.
- Existing `register`/`verify-otp`/`resend-otp`/`login` suites must still pass unmodified after the `passwordSchema` extraction and `type` literal narrowing (regression safety net, no new test needed — covered by the standard `pnpm turbo run test` run).

Coverage target: ≥80% on all new lines in `auth.service.ts`, `auth.repository.ts`, `auth.controller.ts`, `auth.router.ts`, `auth.schema.ts`, `auth.type.ts`, `api-paths.constant.ts` (per `CLAUDE.md §6`).

---

## 7. Explicit non-changes (confirm no drift during implementation)

- No Prisma schema/migration change — `OtpType.PASSWORD_RESET` and all `RefreshSession`/`OtpCode` columns already exist from AB-1002.
- No new `APP_LIMITS`, `API_ERROR_CODES`, or `VALIDATION_MESSAGES` entries.
- No frontend (`apps/web`) changes — out of scope, deferred to AB-1010.
- No changes to `token.service.ts`, `otp.service.ts`, `middlewares/` — every primitive this delta needs already exists and is type-agnostic.
- Access-token/refresh-cookie strategy (`FRS-1.3.5`) is untouched — neither new endpoint issues or reads tokens.

---

## 8. Quality Gates (must all pass before `/pr`, per `CLAUDE.md §6`)

1. `pnpm turbo run build` → 0 errors (`tsup` bundles `@shared/core` + `apps/api`).
2. `pnpm turbo run lint` → `--max-warnings 0`.
3. `pnpm turbo run typecheck` → 0 errors (`tsc --noEmit`).
4. `pnpm turbo run test -- --coverage` → all green against `notes_app_test`, ≥80% coverage on new code.

---

## 9. Rollout / Build Order Summary

1. `packages/shared`: schema + type + constant additions (§1) — commit/verify build passes standalone.
2. `apps/api` repository primitive (§2).
3. `apps/api` service functions + `verifyOtp` cleanup (§3).
4. `apps/api` controller handlers (§4).
5. `apps/api` router registrations (§5).
6. Tests (§6) — write alongside or immediately after each layer per `test-writer.md`, not batched at the end.
7. Run all four quality gates (§8).
