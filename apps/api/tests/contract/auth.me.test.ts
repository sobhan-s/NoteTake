import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  app,
  ROUTES,
  createVerifiedUser,
  loginTestUser,
} from "../helpers/auth.js";
import { resetTestDatabase } from "../helpers/db.js";
import {
  JWT_ACCESS_SECRET,
  JWT_ISSUER,
} from "../../src/constants/api.constants.js";
import { signAccessToken } from "../../src/services/token.service.js";

describe('[spec.md "Session Hydration"] GET /auth/me', () => {
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

  it("SHALL hydrate the current user's { id, email, isVerified } from a valid access token", async () => {
    const email = "me-valid@example.com";
    const { id: userId } = await createVerifiedUser(email);
    const login = await loginTestUser(email);

    const res = await request(app)
      .get(ROUTES.ME)
      .set("Authorization", `Bearer ${login.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({ id: userId, email, isVerified: true });
  });

  it("SHALL return 401 UNAUTHORIZED when no Authorization header is present", async () => {
    const res = await request(app).get(ROUTES.ME);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });

  it("SHALL return 401 UNAUTHORIZED for a malformed bearer token", async () => {
    const res = await request(app)
      .get(ROUTES.ME)
      .set("Authorization", "Bearer not-a-real-jwt");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });

  it("SHALL return 401 UNAUTHORIZED for an expired access token, never a 403", async () => {
    const expiredToken = jwt.sign(
      {
        userId: "22222222-2222-2222-2222-222222222222",
        email: "expired@example.com",
        isVerified: true,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      JWT_ACCESS_SECRET,
      { issuer: JWT_ISSUER },
    );

    const res = await request(app)
      .get(ROUTES.ME)
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });

  it('[spec.md "Session Hydration"] SHALL return 401 UNAUTHORIZED (never 500) for a well-formed, unexpired access token whose userId no longer resolves to a User row', async () => {
    // Access tokens are stateless JWTs (no DB FK), so a still-valid token can legitimately
    // outlive the underlying User row (e.g. deleted between issuance and this request).
    const ghostToken = signAccessToken({
      userId: "33333333-3333-3333-3333-333333333333",
      email: "ghost-user@example.com",
      isVerified: true,
    });

    const res = await request(app)
      .get(ROUTES.ME)
      .set("Authorization", `Bearer ${ghostToken}`);

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
    expect(res.body.error.code).toBe(API_ERROR_CODES.UNAUTHORIZED);
  });
});
