import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import {
  app,
  ROUTES,
  registerAndCaptureOtp,
  resendAndCaptureOtp,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.2.3] POST /auth/resend-otp", () => {
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

  it(`[FRS-1.2.3] SHALL return 429 RESEND_COOLDOWN_ACTIVE when the prior OTP is ${APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS - 1}s old (1 second inside the cooldown boundary)`, async () => {
    const email = "resend-cooldown-inside@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    await prisma.otpCode.update({
      where: { id: otp!.id },
      data: {
        createdAt: new Date(
          Date.now() - (APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS - 1) * 1000,
        ),
      },
    });

    const res = await request(app)
      .post(ROUTES.RESEND_OTP)
      .send({ email, type: "EMAIL_VERIFICATION" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE);

    const otpCount = await prisma.otpCode.count({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(otpCount).toBe(1);
  });

  it(`[FRS-1.2.3] SHALL return 200 and issue a new OTP when the prior OTP is ${APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS + 1}s old (1 second past the cooldown boundary)`, async () => {
    const email = "resend-cooldown-outside@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    await prisma.otpCode.update({
      where: { id: otp!.id },
      data: {
        createdAt: new Date(
          Date.now() - (APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000,
        ),
      },
    });

    const res = await request(app)
      .post(ROUTES.RESEND_OTP)
      .send({ email, type: "EMAIL_VERIFICATION" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("[FRS-1.2.3, spec.md line 34] SHALL invalidate the previous PENDING OTP and create exactly one new PENDING OTP on a successful resend", async () => {
    const email = "resend-invalidate-regenerate@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    const priorOtp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    await prisma.otpCode.update({
      where: { id: priorOtp!.id },
      data: {
        createdAt: new Date(
          Date.now() - (APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS + 5) * 1000,
        ),
      },
    });

    const { code: newCode } = await resendAndCaptureOtp(
      { email },
      "EMAIL_VERIFICATION",
    );

    const priorAfter = await prisma.otpCode.findUnique({
      where: { id: priorOtp!.id },
    });
    expect(priorAfter?.status).toBe("INVALIDATED");

    const pendingOtps = await prisma.otpCode.findMany({
      where: { userId, type: "EMAIL_VERIFICATION", status: "PENDING" },
    });
    expect(pendingOtps).toHaveLength(1);
    expect(pendingOtps[0]?.id).not.toBe(priorOtp!.id);
    expect(newCode).not.toBe("");

    // The newly issued code SHALL verify against the new PENDING row's hash, proving the
    // "regenerate" half of invalidate-and-regenerate actually issued a usable OTP.
    const verifyRes = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: newCode, type: "EMAIL_VERIFICATION" });
    expect(verifyRes.status).toBe(200);
  });

  it("[spec.md line 29 analogue for resend] SHALL return the same generic 400 OTP_EXPIRED shape for a nonexistent user/email as verify-otp does (no account-existence leak)", async () => {
    const res = await request(app).post(ROUTES.RESEND_OTP).send({
      email: "never-registered-resend@example.com",
      type: "EMAIL_VERIFICATION",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
  });
});
