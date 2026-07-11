import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import {
  app,
  ROUTES,
  createVerifiedUser,
  createUnverifiedUser,
  DEFAULT_TEST_PASSWORD,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const WRONG_PASSWORD = "TotallyWr0ng!Pass";

describe("[FRS-1.3.4] POST /auth/login — rate limiting & login-attempt accounting", () => {
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

  it(`[FRS-1.3.4] SHALL still process the 4th and 5th consecutive wrong-password attempts (each inserting a LoginAttempt row and returning 401), then reject the 6th attempt within the window with 429 RATE_LIMIT_EXCEEDED without disclosing unlock time`, async () => {
    const email = "rate-limit-boundary@example.com";
    await createVerifiedUser(email);

    // Seed 3 prior failures directly so we can exercise the 4th/5th/6th precisely.
    await prisma.loginAttempt.createMany({
      data: Array.from(
        { length: APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 2 },
        () => ({
          email,
          ipAddress: "127.0.0.1",
        }),
      ),
    });

    const fourth = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email, password: WRONG_PASSWORD });
    expect(fourth.status).toBe(401);
    expect(fourth.body.error.code).toBe(API_ERROR_CODES.INVALID_CREDENTIALS);

    const fifth = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email, password: WRONG_PASSWORD });
    expect(fifth.status).toBe(401);
    expect(fifth.body.error.code).toBe(API_ERROR_CODES.INVALID_CREDENTIALS);

    const countAfterFifth = await prisma.loginAttempt.count({
      where: { email },
    });
    expect(countAfterFifth).toBe(APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS);

    const sixth = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email, password: DEFAULT_TEST_PASSWORD });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe(API_ERROR_CODES.RATE_LIMIT_EXCEEDED);
    expect(sixth.body.error).not.toHaveProperty("retryAfter");
    expect(sixth.body.error).not.toHaveProperty("unlockAt");
    expect(String(sixth.body.error.message)).not.toMatch(/\d/);

    // The 6th (blocked) request must never have been evaluated against credentials at all.
    const countAfterSixth = await prisma.loginAttempt.count({
      where: { email },
    });
    expect(countAfterSixth).toBe(APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  });

  it("[FRS-1.3.4] SHALL NOT count LoginAttempt rows older than LOGIN_RATE_LIMIT_WINDOW_MINUTES against the current window (window-minus-1-second boundary)", async () => {
    const email = "window-boundary@example.com";
    await createVerifiedUser(email);

    const justOutsideWindowMs =
      (APP_LIMITS.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 + 1) * 1000;
    await prisma.loginAttempt.createMany({
      data: Array.from(
        { length: APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS },
        () => ({
          email,
          ipAddress: "127.0.0.1",
          attemptedAt: new Date(Date.now() - justOutsideWindowMs),
        }),
      ),
    });

    const res = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email, password: WRONG_PASSWORD });

    // Stale attempts outside the window must not trigger the rate limit.
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it("[FRS-1.3.4 v2.1 decision] correct-password-but-unverified SHALL return 403 ACCOUNT_NOT_VERIFIED and SHALL NOT insert a LoginAttempt row", async () => {
    const email = "unverified-correct-password@example.com";
    await createUnverifiedUser(email, DEFAULT_TEST_PASSWORD);

    const res = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email, password: DEFAULT_TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.ACCOUNT_NOT_VERIFIED);

    const count = await prisma.loginAttempt.count({ where: { email } });
    expect(count).toBe(0);
  });

  it("[FRS-1.3.4 v2.1 decision] wrong-password-on-unverified SHALL insert a LoginAttempt row (counts toward the rate limit) and return 401 INVALID_CREDENTIALS", async () => {
    const email = "unverified-wrong-password@example.com";
    await createUnverifiedUser(email, DEFAULT_TEST_PASSWORD);

    const res = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email, password: WRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.INVALID_CREDENTIALS);

    const count = await prisma.loginAttempt.count({ where: { email } });
    expect(count).toBe(1);
  });

  it("[FRS-1.3.4] SHALL isolate rate-limit counters per email — locking out one email SHALL NOT block a different email", async () => {
    const lockedEmail = "isolation-locked@example.com";
    const otherEmail = "isolation-other@example.com";
    await createVerifiedUser(lockedEmail);
    await createVerifiedUser(otherEmail);

    await prisma.loginAttempt.createMany({
      data: Array.from(
        { length: APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS },
        () => ({
          email: lockedEmail,
          ipAddress: "127.0.0.1",
        }),
      ),
    });

    const lockedRes = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email: lockedEmail, password: DEFAULT_TEST_PASSWORD });
    expect(lockedRes.status).toBe(429);

    const otherRes = await request(app)
      .post(ROUTES.LOGIN)
      .send({ email: otherEmail, password: DEFAULT_TEST_PASSWORD });
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.data.user.email).toBe(otherEmail);
  });

  it("[SDS §1.1, checkLoginRateLimit] SHALL pass a request with a missing/non-string email straight through to the controller (no rate-limit lookup), letting loginSchema.parse reject it as 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post(ROUTES.LOGIN)
      .send({ password: DEFAULT_TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(429);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });
});
