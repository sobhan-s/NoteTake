import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import {
  app,
  ROUTES,
  createVerifiedUser,
  seedOtp,
  seedRefreshSession,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

const NEW_PASSWORD = "N3w!Passw0rd";

describe("[FRS-1.5.2, FRS-1.5.4, FRS-1.5.5, FRS-1.5.6] POST /auth/reset-password", () => {
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

  it("[FRS-1.5.2] SHALL return 400 OTP_EXPIRED for a nonexistent email", async () => {
    const res = await request(app).post(ROUTES.RESET_PASSWORD).send({
      email: "reset-nonexistent@example.com",
      code: "123456",
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
  });

  it("[FRS-1.5.2] SHALL return 400 OTP_EXPIRED when the user has no PASSWORD_RESET OtpCode row at all", async () => {
    const email = "reset-no-otp@example.com";
    await createVerifiedUser(email);

    const res = await request(app).post(ROUTES.RESET_PASSWORD).send({
      email,
      code: "123456",
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
  });

  it("[FRS-1.5.2, FRS-1.5.4] SHALL return 400 OTP_EXPIRED when the latest PASSWORD_RESET row is already CONSUMED", async () => {
    const email = "reset-consumed@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const code = "654321";
    await seedOtp(userId, code, { status: "CONSUMED" });

    const res = await request(app)
      .post(ROUTES.RESET_PASSWORD)
      .send({ email, code, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
  });

  it("[FRS-1.5.2] SHALL return 400 OTP_EXPIRED when the latest PASSWORD_RESET row's expiresAt has already passed by 1ms", async () => {
    const email = "reset-expired@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const code = "654321";
    await seedOtp(userId, code, {
      expiresAt: new Date(Date.now() - 1),
    });

    const res = await request(app)
      .post(ROUTES.RESET_PASSWORD)
      .send({ email, code, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
  });

  it("[FRS-1.5.5] SHALL return 429 OTP_MAX_ATTEMPTS_EXCEEDED (distinct from expiry) when the latest PASSWORD_RESET row is already INVALIDATED", async () => {
    const email = "reset-invalidated@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const code = "654321";
    await seedOtp(userId, code, { status: "INVALIDATED" });

    const res = await request(app)
      .post(ROUTES.RESET_PASSWORD)
      .send({ email, code, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED);
  });

  it(`[FRS-1.5.5] SHALL flip the row to INVALIDATED and return 429 on the ${APP_LIMITS.OTP_MAX_ATTEMPTS}rd (cap-reaching) wrong code`, async () => {
    const email = "reset-wrong-cap@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const code = "654321";
    const { id: otpId } = await seedOtp(userId, code, {
      attempts: APP_LIMITS.OTP_MAX_ATTEMPTS - 1,
    });

    const res = await request(app)
      .post(ROUTES.RESET_PASSWORD)
      .send({ email, code: "000000", newPassword: NEW_PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED);

    const otpAfter = await prisma.otpCode.findUnique({ where: { id: otpId } });
    expect(otpAfter?.status).toBe("INVALIDATED");
    expect(otpAfter?.attempts).toBe(APP_LIMITS.OTP_MAX_ATTEMPTS);
  });

  it("[FRS-1.5.5] SHALL increment attempts by exactly 1, return 400 OTP_INVALID with the correct attemptsRemaining count, and leave passwordHash untouched on a below-cap wrong code", async () => {
    const email = "reset-wrong-below-cap@example.com";
    const { id: userId, email: userEmail } = await createVerifiedUser(email);
    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const code = "654321";
    const { id: otpId } = await seedOtp(userId, code, { attempts: 0 });

    const res = await request(app)
      .post(ROUTES.RESET_PASSWORD)
      .send({ email: userEmail, code: "000000", newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_INVALID);
    const expectedAttemptsRemaining = APP_LIMITS.OTP_MAX_ATTEMPTS - 1;
    expect(res.body.error.message).toContain(
      `Attempts remaining: ${expectedAttemptsRemaining}`,
    );

    const otpAfter = await prisma.otpCode.findUnique({ where: { id: otpId } });
    expect(otpAfter?.attempts).toBe(1);
    expect(otpAfter?.status).toBe("PENDING");

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(userAfter.passwordHash).toBe(userBefore.passwordHash);
  });

  it("[FRS-1.5.4, FRS-1.5.6] SHALL atomically change passwordHash, mark the OTP CONSUMED, and revoke every RefreshSession for the user (not just one device) on the correct code", async () => {
    const email = "reset-success@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const code = "654321";
    const { id: otpId } = await seedOtp(userId, code);
    const { id: sessionOneId } = await seedRefreshSession(
      userId,
      "vitest-device-one",
    );
    const { id: sessionTwoId } = await seedRefreshSession(
      userId,
      "vitest-device-two",
    );

    const res = await request(app)
      .post(ROUTES.RESET_PASSWORD)
      .send({ email, code, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(userAfter.passwordHash).not.toBe(userBefore.passwordHash);

    const otpAfter = await prisma.otpCode.findUnique({ where: { id: otpId } });
    expect(otpAfter?.status).toBe("CONSUMED");

    const sessionOneAfter = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: sessionOneId },
    });
    const sessionTwoAfter = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: sessionTwoId },
    });
    expect(sessionOneAfter.revokedAt).not.toBeNull();
    expect(sessionTwoAfter.revokedAt).not.toBeNull();
  });
});
