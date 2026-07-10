import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import { app, ROUTES, registerAndCaptureOtp } from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.2] POST /auth/verify-otp", () => {
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

  it("[FRS-1.2.2] SHALL mark the User verified and the OtpCode CONSUMED, returning 200, when the correct code is submitted", async () => {
    const email = "verify-correct@example.com";
    const { userId, code } = await registerAndCaptureOtp(email);

    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code, type: "EMAIL_VERIFICATION" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.isVerified).toBe(true);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(otp?.status).toBe("CONSUMED");
  });

  it("[FRS-1.2.4] SHALL persist an incremented `attempts` and return 400 OTP_INVALID with an attempts-remaining message on the 1st wrong code", async () => {
    const email = "verify-wrong-1st@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: "000000", type: "EMAIL_VERIFICATION" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_INVALID);
    expect(res.body.error.message).toMatch(/attempts remaining/i);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(otp?.attempts).toBe(1);
    expect(otp?.status).toBe("PENDING");
  });

  it("[FRS-1.2.4] SHALL persist attempts=2 and still return 400 OTP_INVALID on the 2nd consecutive wrong code", async () => {
    const email = "verify-wrong-2nd@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: "000000", type: "EMAIL_VERIFICATION" });
    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: "111111", type: "EMAIL_VERIFICATION" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_INVALID);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(otp?.attempts).toBe(2);
    expect(otp?.status).toBe("PENDING");
  });

  it(`[FRS-1.2.4] SHALL invalidate the OTP and return 429 OTP_MAX_ATTEMPTS_EXCEEDED on the ${APP_LIMITS.OTP_MAX_ATTEMPTS}rd (cap-reaching) wrong code`, async () => {
    const email = "verify-wrong-3rd@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: "000000", type: "EMAIL_VERIFICATION" });
    await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: "111111", type: "EMAIL_VERIFICATION" });
    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code: "222222", type: "EMAIL_VERIFICATION" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(otp?.attempts).toBe(APP_LIMITS.OTP_MAX_ATTEMPTS);
    expect(otp?.status).toBe("INVALIDATED");
  });

  it("[FRS-1.2.2, FRS-1.2.4a] SHALL reject re-submission of the correct code once already CONSUMED, with 400 OTP_EXPIRED (never resurrectable)", async () => {
    const email = "verify-consumed-resubmit@example.com";
    const { code } = await registerAndCaptureOtp(email);

    const first = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code, type: "EMAIL_VERIFICATION" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code, type: "EMAIL_VERIFICATION" });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
  });

  it(`[FRS-1.2.4a] SHALL reject any code re-submitted after the OTP is already INVALIDATED, with 429 OTP_MAX_ATTEMPTS_EXCEEDED (distinct from CONSUMED's 400 OTP_EXPIRED)`, async () => {
    const email = "verify-invalidated-resubmit@example.com";
    const { code } = await registerAndCaptureOtp(email);

    for (let i = 0; i < APP_LIMITS.OTP_MAX_ATTEMPTS; i += 1) {
      await request(app)
        .post(ROUTES.VERIFY_OTP)
        .send({ email, code: "999999", type: "EMAIL_VERIFICATION" });
    }

    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code, type: "EMAIL_VERIFICATION" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED);
  });

  it("[spec.md line 29] SHALL return 400 OTP_EXPIRED for an OTP whose expiresAt has already passed, even with attempts remaining and status still PENDING", async () => {
    const email = "verify-expired@example.com";
    const { userId, code } = await registerAndCaptureOtp(email);

    const otp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    await prisma.otpCode.update({
      where: { id: otp!.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ email, code, type: "EMAIL_VERIFICATION" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.isVerified).toBe(false);
  });

  it("[spec.md line 29] SHALL return the exact same generic 400 OTP_EXPIRED shape for a nonexistent user/email as for a genuinely expired OTP (no distinguishing detail leaked)", async () => {
    const res = await request(app).post(ROUTES.VERIFY_OTP).send({
      email: "never-registered@example.com",
      code: "123456",
      type: "EMAIL_VERIFICATION",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);
    expect(res.body.error.message).toMatch(/request a new one/i);
  });

  it("[FRS-1.2.4a, verifyOtpSchema] SHALL accept `userId` (instead of `email`) as the identifier, and SHALL treat OtpType as an isolation key — a PASSWORD_RESET lookup for a user who only has an EMAIL_VERIFICATION OTP SHALL return the generic 400 OTP_EXPIRED", async () => {
    const email = "verify-cross-type-isolation@example.com";
    const { userId } = await registerAndCaptureOtp(email);

    const res = await request(app)
      .post(ROUTES.VERIFY_OTP)
      .send({ userId, code: "123456", type: "PASSWORD_RESET" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);

    // The EMAIL_VERIFICATION OTP for this user must remain untouched by the mismatched-type lookup.
    const emailVerificationOtp = await prisma.otpCode.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION" },
    });
    expect(emailVerificationOtp?.status).toBe("PENDING");
    expect(emailVerificationOtp?.attempts).toBe(0);
  });
});
