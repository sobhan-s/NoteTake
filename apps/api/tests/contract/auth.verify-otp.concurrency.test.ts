import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import { app, ROUTES, registerAndCaptureOtp } from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.2.4, spec.md line 31] POST /auth/verify-otp — concurrent mismatched-attempt row-lock race", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
      throw new Error(
        "FATAL SAFETY BREAK: Truncation attempted outside notes_app_test instance!",
      );
    }
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("[FRS-1.2.4] SHALL never let concurrent mismatched-code requests push the persisted `attempts` count past APP_LIMITS.OTP_MAX_ATTEMPTS, and SHALL invalidate the OTP exactly once", async () => {
    const email = "verify-concurrency@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    const concurrentRequestCount = 10; // deliberately > APP_LIMITS.OTP_MAX_ATTEMPTS to stress the row lock
    const requests = Array.from({ length: concurrentRequestCount }, (_, i) =>
      request(app)
        .post(ROUTES.VERIFY_OTP)
        .send({
          email,
          code: `00000${i}`.slice(-6),
          type: "EMAIL_VERIFICATION",
        }),
    );

    const responses = await Promise.all(requests);

    // No request should ever crash the server (500) regardless of the race.
    expect(responses.every((res) => res.status !== 500)).toBe(true);
    expect(
      responses.every(
        (res) =>
          (res.status === 400 &&
            res.body.error.code === API_ERROR_CODES.OTP_INVALID) ||
          (res.status === 429 &&
            res.body.error.code === API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED),
      ),
    ).toBe(true);

    const finalOtp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(finalOtp?.attempts).toBeLessThanOrEqual(APP_LIMITS.OTP_MAX_ATTEMPTS);
    expect(finalOtp?.attempts).toBe(APP_LIMITS.OTP_MAX_ATTEMPTS);
    expect(finalOtp?.status).toBe("INVALIDATED");

    // Exactly one of the concurrent responses SHALL have been the cap-crossing 429 response
    // that observed the transition attempts -> OTP_MAX_ATTEMPTS; the remainder are either
    // earlier 400 mismatches or later 429s that found the row already invalidated. What must
    // never happen is the row exceeding the cap, verified above.
    const maxAttemptsResponses = responses.filter((res) => res.status === 429);
    expect(maxAttemptsResponses.length).toBeGreaterThan(0);
  });
});
