import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { APP_LIMITS } from "@shared/core/constants";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenPayload,
} from "../../src/services/token.service.js";
import {
  JWT_ACCESS_SECRET,
  JWT_ISSUER,
  REFRESH_TOKEN_BYTE_LENGTH,
} from "../../src/constants/api.constants.js";

const payload: AccessTokenPayload = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "unit-test@example.com",
  isVerified: true,
};

describe("[FRS-1.3.2] token.service — access token sign/verify round trip", () => {
  it("[FRS-1.3.2a] signAccessToken SHALL embed userId/email/isVerified and verifyAccessToken SHALL return them unchanged", () => {
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);

    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.isVerified).toBe(payload.isVerified);
  });

  it("[FRS-1.3.2b] signAccessToken SHALL set exp - iat to exactly APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES (in seconds)", () => {
    const token = signAccessToken(payload);
    const decoded = jwt.decode(token) as { iat: number; exp: number };

    const expectedLifetimeSeconds = APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES * 60;
    expect(decoded.exp - decoded.iat).toBe(expectedLifetimeSeconds);
  });

  it("[FRS-8.6/SDS §3.1] signAccessToken SHALL stamp the configured JWT_ISSUER, and verifyAccessToken SHALL reject a token signed under a different issuer", () => {
    const token = signAccessToken(payload);
    const decoded = jwt.decode(token) as { iss: string };
    expect(decoded.iss).toBe(JWT_ISSUER);

    const foreignIssuerToken = jwt.sign(payload, JWT_ACCESS_SECRET, {
      expiresIn: "15m",
      issuer: "some-other-issuer",
    });
    expect(() => verifyAccessToken(foreignIssuerToken)).toThrow();
  });

  it("[SDS §3.1] verifyAccessToken SHALL reject a token signed with a different secret", () => {
    const foreignSecretToken = jwt.sign(payload, "wrong-secret", {
      expiresIn: "15m",
      issuer: JWT_ISSUER,
    });
    expect(() => verifyAccessToken(foreignSecretToken)).toThrow();
  });

  it("[FRS-1.3.2c] verifyAccessToken SHALL reject an already-expired token", () => {
    const expiredToken = jwt.sign(
      { ...payload, exp: Math.floor(Date.now() / 1000) - 60 },
      JWT_ACCESS_SECRET,
      { issuer: JWT_ISSUER },
    );
    expect(() => verifyAccessToken(expiredToken)).toThrow();
  });
});

describe("[FRS-1.3.3] token.service — refresh token generation & hashing", () => {
  it("[FRS-1.3.3a] generateRefreshToken SHALL produce a hex string of exactly REFRESH_TOKEN_BYTE_LENGTH*2 characters (64 bytes -> 128 hex chars)", () => {
    const raw = generateRefreshToken();
    expect(raw).toMatch(/^[0-9a-f]+$/);
    expect(raw).toHaveLength(REFRESH_TOKEN_BYTE_LENGTH * 2);
  });

  it("[FRS-1.3.3b] generateRefreshToken SHALL produce cryptographically distinct values across calls (entropy check)", () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateRefreshToken()),
    );
    expect(tokens.size).toBe(20);
  });

  it("[FRS-1.3.3c] hashRefreshToken SHALL be deterministic: identical input yields an identical SHA-256 hex digest", () => {
    const raw = generateRefreshToken();
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
    expect(hashRefreshToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[FRS-1.3.3d] hashRefreshToken SHALL produce different digests for different inputs", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });
});
