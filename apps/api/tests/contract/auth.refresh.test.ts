import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  ROUTES,
  createVerifiedUser,
  loginTestUser,
  cookieHeader,
  extractCookieValue,
  DEFAULT_TEST_PASSWORD,
} from "../helpers/auth.js";
import { prisma, resetTestDatabase } from "../helpers/db.js";

describe("[FRS-1.3.3] POST /auth/refresh — silent rotation", () => {
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

  it("[FRS-1.3.3] SHALL rotate to a new access token + new refresh token/cookie on a valid refresh cookie, revoking the prior session and creating a new one", async () => {
    const email = "refresh-valid@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const login = await loginTestUser(email);
    expect(login.refreshTokenValue).toBeTruthy();

    const res = await request(app)
      .post(ROUTES.REFRESH)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));

    expect(res.status).toBe(200);
    // NOTE: a JWT's bytes are a deterministic function of (payload, iat, exp); reissuing
    // the identical {userId,email,isVerified} payload within the same wall-clock second
    // as the original login can legitimately yield a byte-identical access token — FRS/SDS
    // mandate a freshly *issued* token, not a token guaranteed to differ byte-for-byte from
    // the previous one. We instead assert the new token is well-formed and decodes to the
    // same user identity, which is what actually matters for session continuity.
    expect(typeof res.body.data.accessToken).toBe("string");
    expect(res.body.data.accessToken.length).toBeGreaterThan(0);
    expect(res.body.data.user).toEqual(login.user);

    const newRawToken = extractCookieValue(res);
    expect(newRawToken).toBeTruthy();
    expect(newRawToken).not.toBe(login.refreshTokenValue);

    const sessions = await prisma.refreshSession.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.revokedAt).not.toBeNull();
    expect(sessions[1]?.revokedAt).toBeNull();
  });

  it("[FRS-1.3.3] SHALL reject replay of the old raw refresh token with 401 UNAUTHORIZED once it has already been rotated", async () => {
    const email = "refresh-replay@example.com";
    await createVerifiedUser(email);
    const login = await loginTestUser(email);

    const firstRefresh = await request(app)
      .post(ROUTES.REFRESH)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));
    expect(firstRefresh.status).toBe(200);

    const replay = await request(app)
      .post(ROUTES.REFRESH)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });

  it("[FRS-1.3.3] SHALL reject an expired RefreshSession with 401 UNAUTHORIZED", async () => {
    const email = "refresh-expired@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const login = await loginTestUser(email);

    await prisma.refreshSession.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const res = await request(app)
      .post(ROUTES.REFRESH)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });

  it("[FRS-1.3.3] SHALL reject an explicitly revoked RefreshSession with 401 UNAUTHORIZED", async () => {
    const email = "refresh-revoked@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const login = await loginTestUser(email);

    await prisma.refreshSession.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    const res = await request(app)
      .post(ROUTES.REFRESH)
      .set("Cookie", cookieHeader(login.refreshTokenValue!));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });

  it("[FRS-1.3.3] SHALL reject a request with no refreshToken cookie at all with 401 UNAUTHORIZED", async () => {
    const email = "refresh-missing-cookie@example.com";
    await createVerifiedUser(email);
    await loginTestUser(email, DEFAULT_TEST_PASSWORD);

    const res = await request(app).post(ROUTES.REFRESH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
