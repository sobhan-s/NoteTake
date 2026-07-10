import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import {
  app,
  ROUTES,
  createVerifiedUser,
  loginTestUser,
  cookieHeader,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.4.1] POST /auth/logout", () => {
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

  it("[FRS-1.4.1] SHALL revoke only the RefreshSession matching the presented cookie, leaving other devices' sessions for the same user untouched", async () => {
    const email = "logout-multi-device@example.com";
    const { id: userId } = await createVerifiedUser(email);

    const loginA = await loginTestUser(email, undefined, "device-A");
    await loginTestUser(email, undefined, "device-B");

    const res = await request(app)
      .post(ROUTES.LOGOUT)
      .set("Authorization", `Bearer ${loginA.accessToken}`)
      .set("Cookie", cookieHeader(loginA.refreshTokenValue!));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const sessions = await prisma.refreshSession.findMany({
      where: { userId },
    });
    const deviceASession = sessions.find((s) => s.userAgent === "device-A");
    const deviceBSession = sessions.find((s) => s.userAgent === "device-B");

    expect(deviceASession?.revokedAt).not.toBeNull();
    expect(deviceBSession?.revokedAt).toBeNull();
  });

  it("[FRS-1.4.1] SHALL be idempotent (200, no error) when the refreshToken cookie is absent from the request", async () => {
    const email = "logout-missing-cookie@example.com";
    await createVerifiedUser(email);
    const login = await loginTestUser(email);

    const res = await request(app)
      .post(ROUTES.LOGOUT)
      .set("Authorization", `Bearer ${login.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("[FRS-1.4.1] SHALL be idempotent (200, no error) when the presented refreshToken cookie has already been revoked", async () => {
    const email = "logout-already-revoked@example.com";
    await createVerifiedUser(email);
    const login = await loginTestUser(email);

    const first = await request(app)
      .post(ROUTES.LOGOUT)
      .set("Authorization", `Bearer ${login.accessToken}`)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(ROUTES.LOGOUT)
      .set("Authorization", `Bearer ${login.accessToken}`)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));

    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
  });
});
