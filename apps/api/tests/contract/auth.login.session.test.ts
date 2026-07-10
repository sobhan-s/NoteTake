import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createVerifiedUser,
  loginTestUser,
  DEFAULT_TEST_PASSWORD,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.3.5, SDS §3.2] POST /auth/login — session/device semantics & token storage", () => {
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

  it("[SDS §3.2] SHALL revoke the prior RefreshSession for the same (userId, userAgent) on same-device re-login, leaving at most one live session for that device", async () => {
    const email = "same-device@example.com";
    const { id: userId } = await createVerifiedUser(email);

    const first = await loginTestUser(email, DEFAULT_TEST_PASSWORD, "device-A");
    expect(first.status).toBe(200);
    const firstTokenHash = first.refreshTokenValue;
    expect(firstTokenHash).toBeTruthy();

    const second = await loginTestUser(
      email,
      DEFAULT_TEST_PASSWORD,
      "device-A",
    );
    expect(second.status).toBe(200);

    const sessions = await prisma.refreshSession.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.revokedAt).not.toBeNull();
    expect(sessions[1]?.revokedAt).toBeNull();

    const liveSessions = sessions.filter((s) => s.revokedAt === null);
    expect(liveSessions).toHaveLength(1);
  });

  it("[FRS-1.4.1 boundary, spec.md line 44] Login from a different device (different userAgent) SHALL leave the other device's active session untouched", async () => {
    const email = "different-device@example.com";
    const { id: userId } = await createVerifiedUser(email);

    await loginTestUser(email, DEFAULT_TEST_PASSWORD, "device-A");
    await loginTestUser(email, DEFAULT_TEST_PASSWORD, "device-B");

    const sessions = await prisma.refreshSession.findMany({
      where: { userId },
    });
    expect(sessions).toHaveLength(2);
    const deviceASession = sessions.find((s) => s.userAgent === "device-A");
    const deviceBSession = sessions.find((s) => s.userAgent === "device-B");

    expect(deviceASession?.revokedAt).toBeNull();
    expect(deviceBSession?.revokedAt).toBeNull();
  });

  it("[FRS-1.3.5] The raw refresh token SHALL NOT appear anywhere in the JSON response body — only in the Set-Cookie header", async () => {
    const email = "no-token-leak@example.com";
    await createVerifiedUser(email);

    const result = await loginTestUser(email);
    expect(result.status).toBe(200);
    expect(result.refreshTokenValue).toBeTruthy();

    const serializedBody = JSON.stringify(result.body);
    expect(serializedBody).not.toContain(result.refreshTokenValue);
    expect(
      Object.keys(result.body.data as Record<string, unknown>).sort(),
    ).toEqual(["accessToken", "user"]);
  });

  it("[FRS-1.3.5] The refreshToken cookie SHALL be set with HttpOnly, Secure, and SameSite=Strict flags", async () => {
    const email = "cookie-flags@example.com";
    await createVerifiedUser(email);

    const result = await loginTestUser(email);
    expect(result.setCookieHeader).toBeTruthy();
    expect(result.setCookieHeader).toMatch(/HttpOnly/i);
    expect(result.setCookieHeader).toMatch(/Secure/i);
    expect(result.setCookieHeader).toMatch(/SameSite=Strict/i);
  });
});
