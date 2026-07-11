import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { API_ERROR_CODES } from "@shared/core/constants";
import { app, ROUTES, DEFAULT_TEST_PASSWORD } from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.1] POST /auth/register", () => {
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

  it("[FRS-1.1.1, FRS-1.1.4] SHALL create an unverified User + PENDING EMAIL_VERIFICATION OtpCode and return 201 with isReTriggered=false when no account exists for the email", async () => {
    const email = "brand-new@example.com";
    const res = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password: DEFAULT_TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isReTriggered).toBe(false);
    expect(typeof res.body.data.userId).toBe("string");

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.isVerified).toBe(false);

    const otp = await prisma.otpCode.findFirst({
      where: { userId: user!.id, type: "EMAIL_VERIFICATION" },
    });
    expect(otp).not.toBeNull();
    expect(otp?.status).toBe("PENDING");
    expect(otp?.attempts).toBe(0);
  });

  it("[FRS-1.1.3] SHALL reject a password shorter than 8 characters or missing a digit/symbol with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email: "weakpass@example.com", password: "alllettersnodigit" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);

    const user = await prisma.user.findUnique({
      where: { email: "weakpass@example.com" },
    });
    expect(user).toBeNull();
  });

  it("[Regression guard: error.middleware.ts ZodError handling] SHALL return 400 VALIDATION_ERROR (never 500) for a malformed email, and the response SHALL still match the unified error wrapper shape", async () => {
    const res = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email: "not-an-email", password: DEFAULT_TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(res.body.error).toHaveProperty("message");
  });

  it("[FRS-1.1.2, spec.md line 22] SHALL return 409 EMAIL_ALREADY_VERIFIED, create no new user row, and generate no new OTP when the email already belongs to a verified account", async () => {
    const email = "already-verified@example.com";
    const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 12);
    const existing = await prisma.user.create({
      data: { email, passwordHash, isVerified: true },
    });
    const otpCountBefore = await prisma.otpCode.count({
      where: { userId: existing.id },
    });

    const res = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password: "AnotherStr0ng!Pass" });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.EMAIL_ALREADY_VERIFIED);

    const userCount = await prisma.user.count({ where: { email } });
    expect(userCount).toBe(1);
    const otpCountAfter = await prisma.otpCode.count({
      where: { userId: existing.id },
    });
    expect(otpCountAfter).toBe(otpCountBefore);
  });

  it("[FRS-1.1.5, spec.md line 23-24] SHALL re-trigger a fresh OTP, invalidate the prior PENDING one, update passwordHash, and return 200 (never 201) once the resend cooldown has elapsed for an unverified account", async () => {
    const email = "unverified-retrigger@example.com";
    const first = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password: DEFAULT_TEST_PASSWORD });
    expect(first.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    const priorOtp = await prisma.otpCode.findFirst({
      where: { userId: user!.id, type: "EMAIL_VERIFICATION" },
    });
    expect(priorOtp).not.toBeNull();

    // Simulate the resend cooldown having elapsed.
    await prisma.otpCode.update({
      where: { id: priorOtp!.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });

    const newPassword = "Br4nd!NewPassword";
    const second = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password: newPassword });

    expect(second.status).toBe(200);
    expect(second.body.data.isReTriggered).toBe(true);
    expect(second.body.data.userId).toBe(user!.id);

    const userCount = await prisma.user.count({ where: { email } });
    expect(userCount).toBe(1);

    const updatedUser = await prisma.user.findUnique({
      where: { id: user!.id },
    });
    await expect(
      bcrypt.compare(newPassword, updatedUser!.passwordHash),
    ).resolves.toBe(true);
    await expect(
      bcrypt.compare(DEFAULT_TEST_PASSWORD, updatedUser!.passwordHash),
    ).resolves.toBe(false);

    const invalidatedPriorOtp = await prisma.otpCode.findUnique({
      where: { id: priorOtp!.id },
    });
    expect(invalidatedPriorOtp?.status).toBe("INVALIDATED");

    const newOtp = await prisma.otpCode.findFirst({
      where: {
        userId: user!.id,
        type: "EMAIL_VERIFICATION",
        status: "PENDING",
      },
    });
    expect(newOtp).not.toBeNull();
    expect(newOtp?.id).not.toBe(priorOtp!.id);
  });

  it("[FRS-1.1.5, FRS-1.2.3] SHALL return 429 RESEND_COOLDOWN_ACTIVE and take no action when re-registering an unverified email before the cooldown elapses", async () => {
    const email = "unverified-cooldown@example.com";
    const first = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password: DEFAULT_TEST_PASSWORD });
    expect(first.status).toBe(201);

    const res = await request(app)
      .post(ROUTES.REGISTER)
      .send({ email, password: "DifferentStr0ng!Pass" });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE);

    const user = await prisma.user.findUnique({ where: { email } });
    await expect(
      bcrypt.compare(DEFAULT_TEST_PASSWORD, user!.passwordHash),
    ).resolves.toBe(true);
    const otpCount = await prisma.otpCode.count({
      where: { userId: user!.id },
    });
    expect(otpCount).toBe(1);
  });
});
