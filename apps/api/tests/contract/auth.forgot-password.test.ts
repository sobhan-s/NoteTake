import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { APP_LIMITS } from "@shared/core/constants";
import {
  app,
  ROUTES,
  createUnverifiedUser,
  createVerifiedUser,
  forgotPasswordAndCaptureOtp,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.5.1, FRS-1.5.3] POST /auth/forgot-password", () => {
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

  it("[FRS-1.5.1] SHALL return 200 with the generic message and create zero OtpCode rows when no User row exists for the submitted email", async () => {
    const email = "forgot-nonexistent@example.com";

    const res = await request(app).post(ROUTES.FORGOT_PASSWORD).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(
      /if an account exists for this email/i,
    );

    // No User row exists for this email, so no OtpCode row may reference it via the join.
    const otpCountForEmail = await prisma.otpCode.count({
      where: { user: { email } },
    });
    expect(otpCountForEmail).toBe(0);
  });

  it("[FRS-1.5.3] SHALL create a new PENDING PASSWORD_RESET OtpCode row for an existing unverified account with no prior reset OTP", async () => {
    const email = "forgot-unverified@example.com";
    const { id: userId } = await createUnverifiedUser(email);

    const { code, status } = await forgotPasswordAndCaptureOtp(email);

    expect(status).toBe(200);
    expect(code).not.toBe("");

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "PASSWORD_RESET" },
    });
    expect(otp?.status).toBe("PENDING");
  });

  it("[FRS-1.5.3] SHALL create a new PENDING PASSWORD_RESET OtpCode row for an existing verified account with no prior reset OTP (verified accounts are eligible too)", async () => {
    const email = "forgot-verified@example.com";
    const { id: userId } = await createVerifiedUser(email);

    const { code, status } = await forgotPasswordAndCaptureOtp(email);

    expect(status).toBe(200);
    expect(code).not.toBe("");

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "PASSWORD_RESET" },
    });
    expect(otp?.status).toBe("PENDING");
  });

  it(`[FRS-1.5.1] SHALL silently throttle (still 200, no new/invalidated row) when the prior PASSWORD_RESET OTP is ${APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS - 1}s old (1 second inside the cooldown boundary)`, async () => {
    const email = "forgot-cooldown-inside@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const priorOtp = await prisma.otpCode.create({
      data: {
        userId,
        type: "PASSWORD_RESET",
        codeHash: "irrelevant-hash",
        expiresAt: new Date(
          Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
        ),
        createdAt: new Date(
          Date.now() - (APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS - 1) * 1000,
        ),
      },
    });

    const { code, status } = await forgotPasswordAndCaptureOtp(email);

    expect(status).toBe(200);
    expect(code).toBe("");

    const otpsAfter = await prisma.otpCode.findMany({
      where: { userId, type: "PASSWORD_RESET" },
    });
    expect(otpsAfter).toHaveLength(1);
    expect(otpsAfter[0]?.id).toBe(priorOtp.id);
    expect(otpsAfter[0]?.status).toBe("PENDING");
  });

  it(`[FRS-1.5.3] SHALL treat a prior PASSWORD_RESET OTP exactly ${APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS}s old as OUTSIDE the cooldown boundary and issue a fresh OTP`, async () => {
    const email = "forgot-cooldown-boundary@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const priorOtp = await prisma.otpCode.create({
      data: {
        userId,
        type: "PASSWORD_RESET",
        codeHash: "irrelevant-hash",
        expiresAt: new Date(
          Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
        ),
        createdAt: new Date(
          Date.now() - APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS * 1000,
        ),
      },
    });

    const { code, status } = await forgotPasswordAndCaptureOtp(email);

    expect(status).toBe(200);
    expect(code).not.toBe("");

    const priorAfter = await prisma.otpCode.findUnique({
      where: { id: priorOtp.id },
    });
    expect(priorAfter?.status).toBe("INVALIDATED");

    const pendingOtps = await prisma.otpCode.findMany({
      where: { userId, type: "PASSWORD_RESET", status: "PENDING" },
    });
    expect(pendingOtps).toHaveLength(1);
    expect(pendingOtps[0]?.id).not.toBe(priorOtp.id);
  });
});
