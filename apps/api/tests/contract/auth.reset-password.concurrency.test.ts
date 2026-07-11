import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { API_ERROR_CODES } from "@shared/core/constants";
import { app, ROUTES, createVerifiedUser, seedOtp } from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.5.4] POST /auth/reset-password — concurrent same-code double-submit race", () => {
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

  it("[FRS-1.5.4] SHALL let exactly one of two concurrent requests with the same correct code succeed (200), the other observing the row already CONSUMED post-lock (400 OTP_EXPIRED), with only one password-hash write taking effect", async () => {
    const email = "reset-concurrency@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const code = "135790";
    const { id: otpId } = await seedOtp(userId, code);

    const requests = [
      request(app)
        .post(ROUTES.RESET_PASSWORD)
        .send({ email, code, newPassword: "First!Pass9" }),
      request(app)
        .post(ROUTES.RESET_PASSWORD)
        .send({ email, code, newPassword: "Second!Pass9" }),
    ];

    const [first, second] = await Promise.all(requests);

    // No request should ever crash the server (500) regardless of the race.
    expect([first.status, second.status].every((s) => s !== 500)).toBe(true);

    const successes = [first, second].filter((res) => res.status === 200);
    const failures = [first, second].filter((res) => res.status === 400);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.body.error.code).toBe(API_ERROR_CODES.OTP_EXPIRED);

    const otpAfter = await prisma.otpCode.findUnique({ where: { id: otpId } });
    expect(otpAfter?.status).toBe("CONSUMED");

    // Only one of the two candidate password hashes may have actually taken effect —
    // the loser's write must never have landed.
    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const matchesFirst = await bcrypt.compare(
      "First!Pass9",
      userAfter.passwordHash,
    );
    const matchesSecond = await bcrypt.compare(
      "Second!Pass9",
      userAfter.passwordHash,
    );
    expect(matchesFirst !== matchesSecond).toBe(true);
  });
});
