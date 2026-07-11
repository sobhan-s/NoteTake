import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { APP_LIMITS } from "@shared/core/constants";
import {
  JWT_ACCESS_SECRET,
  JWT_ISSUER,
  REFRESH_TOKEN_BYTE_LENGTH,
} from "../constants/api.constants.js";

export type AccessTokenPayload = {
  userId: string;
  email: string;
  isVerified: boolean;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: `${APP_LIMITS.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    issuer: JWT_ISSUER,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, JWT_ACCESS_SECRET, {
    issuer: JWT_ISSUER,
  }) as AccessTokenPayload;
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTE_LENGTH).toString("hex");
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
