import crypto from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { vi } from "vitest";
import type { OtpStatus, OtpType } from "@prisma/client";
import { API_PATHS, APP_LIMITS } from "@shared/core/constants";
import app from "../../src/app.js";
import { BCRYPT_ROUNDS } from "../../src/constants/api.constants.js";
import { hashOtpCode } from "../../src/services/otp.service.js";
import { prisma } from "./db.js";

export { app };

const AUTH_BASE = `${API_PATHS.BASE}${API_PATHS.AUTH.ROOT}`;

export const ROUTES = {
  REGISTER: `${AUTH_BASE}${API_PATHS.AUTH.REGISTER}`,
  VERIFY_OTP: `${AUTH_BASE}${API_PATHS.AUTH.VERIFY_OTP}`,
  RESEND_OTP: `${AUTH_BASE}${API_PATHS.AUTH.RESEND_OTP}`,
  FORGOT_PASSWORD: `${AUTH_BASE}${API_PATHS.AUTH.FORGOT_PASSWORD}`,
  RESET_PASSWORD: `${AUTH_BASE}${API_PATHS.AUTH.RESET_PASSWORD}`,
  LOGIN: `${AUTH_BASE}${API_PATHS.AUTH.LOGIN}`,
  REFRESH: `${AUTH_BASE}${API_PATHS.AUTH.REFRESH}`,
  LOGOUT: `${AUTH_BASE}${API_PATHS.AUTH.LOGOUT}`,
  ME: `${AUTH_BASE}${API_PATHS.AUTH.ME}`,
} as const;

export const DEFAULT_TEST_PASSWORD = "Str0ng!Pass";

/** Creates a User row directly (bypassing the OTP flow) for tests that only need a
 * ready-made account — e.g. login/session/refresh/logout/me suites. */
export async function createVerifiedUser(
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
): Promise<{ id: string; email: string }> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, passwordHash, isVerified: true },
  });
  return { id: user.id, email: user.email };
}

export async function createUnverifiedUser(
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
): Promise<{ id: string; email: string }> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, passwordHash, isVerified: false },
  });
  return { id: user.id, email: user.email };
}

export type LoginResult = {
  status: number;
  accessToken?: string;
  user?: { id: string; email: string; isVerified: boolean };
  setCookieHeader?: string;
  refreshTokenValue?: string;
  body: Record<string, unknown>;
};

/** Extracts the full raw `Set-Cookie: refreshToken=...` header string (for asserting
 * HttpOnly/Secure/SameSite flags) matching the given cookie name. */
export function findSetCookie(
  res: request.Response,
  name = "refreshToken",
): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as
    string[] | string | undefined;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr.find((c) => c.startsWith(`${name}=`));
}

/** Extracts just the cookie's value (for replaying it as a request `Cookie` header). */
export function extractCookieValue(
  res: request.Response,
  name = "refreshToken",
): string | undefined {
  const cookie = findSetCookie(res, name);
  const match = cookie ? /^([^=]+)=([^;]+)/.exec(cookie) : null;
  return match?.[2];
}

export function cookieHeader(value: string, name = "refreshToken"): string {
  return `${name}=${value}`;
}

/** Performs a real POST /auth/login through supertest and normalizes the result. */
export async function loginTestUser(
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
  userAgent = "vitest-agent",
): Promise<LoginResult & { rawResponse: request.Response }> {
  const res = await request(app)
    .post(ROUTES.LOGIN)
    .set("User-Agent", userAgent)
    .send({ email, password });

  const data = (res.body as { data?: Record<string, unknown> }).data;
  return {
    status: res.status,
    accessToken: data?.accessToken as string | undefined,
    user: data?.user as LoginResult["user"],
    setCookieHeader: findSetCookie(res),
    refreshTokenValue: extractCookieValue(res),
    body: res.body as Record<string, unknown>,
    rawResponse: res,
  };
}

/** Registers a user via the real HTTP endpoint and captures the console-logged plaintext
 * OTP code (the only place the raw code is ever surfaced — FRS-8.3) so verify-otp/resend-otp
 * suites can exercise the real bcrypt-hashed compare path instead of reading the DB hash. */
export async function registerAndCaptureOtp(
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
): Promise<{
  userId: string;
  code: string;
  status: number;
  body: Record<string, unknown>;
}> {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const res = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password });
    const body = res.body as { data?: { userId?: string } };
    const call = logSpy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes(email),
    );
    const match = call ? /-> (\d+)$/.exec(String(call[0])) : null;
    if (!match) {
      throw new Error(
        `No OTP console log captured for ${email}: ${JSON.stringify(logSpy.mock.calls)}`,
      );
    }
    return {
      userId: body.data?.userId ?? "",
      code: match[1],
      status: res.status,
      body: res.body as Record<string, unknown>,
    };
  } finally {
    logSpy.mockRestore();
  }
}

/** Same idea as `registerAndCaptureOtp` but for the resend-otp endpoint. */
export async function resendAndCaptureOtp(
  target: { userId?: string; email?: string },
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" = "EMAIL_VERIFICATION",
): Promise<{ code: string; status: number; body: Record<string, unknown> }> {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const res = await request(app)
      .post(ROUTES.RESEND_OTP)
      .send({ ...target, type });
    const emailNeedle = target.email ?? "";
    const call = logSpy.mock.calls.find(
      (args) =>
        typeof args[0] === "string" &&
        (emailNeedle ? args[0].includes(emailNeedle) : true),
    );
    const match = call ? /-> (\d+)$/.exec(String(call[0])) : null;
    return {
      code: match ? match[1] : "",
      status: res.status,
      body: res.body as Record<string, unknown>,
    };
  } finally {
    logSpy.mockRestore();
  }
}

/** Same idea as `resendAndCaptureOtp` but for the forgot-password endpoint (`AB-1003`).
 * Because `forgotPassword` never throws and always returns the identical generic `200`
 * regardless of branch, an empty `code` (no console log observed) is itself meaningful
 * signal that the no-op/cooldown-blocked branch was taken rather than the OTP-issuing one. */
export async function forgotPasswordAndCaptureOtp(
  email: string,
): Promise<{ code: string; status: number; body: Record<string, unknown> }> {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const res = await request(app).post(ROUTES.FORGOT_PASSWORD).send({ email });
    const call = logSpy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes(email),
    );
    const match = call ? /-> (\d+)$/.exec(String(call[0])) : null;
    return {
      code: match ? match[1] : "",
      status: res.status,
      body: res.body as Record<string, unknown>,
    };
  } finally {
    logSpy.mockRestore();
  }
}

/** Directly seeds an `OtpCode` row (bypassing the HTTP layer entirely) so `reset-password`
 * contract/concurrency suites can construct exact `status`/`attempts`/`expiresAt`/`createdAt`
 * fixtures (e.g. `INVALIDATED`, `CONSUMED`, one-attempt-from-cap, expired-by-1ms) that would
 * otherwise require many chained real requests to reach. Reuses the real `hashOtpCode` from
 * `otp.service.ts` so the seeded row's `codeHash` verifies against `code` exactly the way a
 * genuinely-issued OTP would. */
export async function seedOtp(
  userId: string,
  code: string,
  overrides: {
    type?: OtpType;
    status?: OtpStatus;
    attempts?: number;
    expiresAt?: Date;
    createdAt?: Date;
  } = {},
): Promise<{ id: string }> {
  const codeHash = await hashOtpCode(code);
  const otp = await prisma.otpCode.create({
    data: {
      userId,
      type: overrides.type ?? "PASSWORD_RESET",
      codeHash,
      status: overrides.status ?? "PENDING",
      attempts: overrides.attempts ?? 0,
      expiresAt:
        overrides.expiresAt ??
        new Date(Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000),
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
  return { id: otp.id };
}

/** Directly seeds a `RefreshSession` row for a given `userId`/`userAgent` pair so
 * `reset-password` (all-devices revocation) tests can prove multiple distinct-device
 * sessions are affected, unlike login's single-device `revokeActiveSessionsForDevice`. */
export async function seedRefreshSession(
  userId: string,
  userAgent: string,
): Promise<{ id: string }> {
  const session = await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: crypto.randomUUID(),
      userAgent,
      expiresAt: new Date(
        Date.now() + APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ),
    },
  });
  return { id: session.id };
}
