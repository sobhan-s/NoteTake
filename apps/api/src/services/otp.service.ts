import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { OtpType } from "@prisma/client";
import { APP_LIMITS } from "@shared/core/constants";
import { BCRYPT_ROUNDS } from "../constants/api.constants.js";

export function generateOtpCode(): string {
  const max = 10 ** APP_LIMITS.OTP_LENGTH;
  return crypto
    .randomInt(0, max)
    .toString()
    .padStart(APP_LIMITS.OTP_LENGTH, "0");
}

export function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export function verifyOtpCodeHash(
  code: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function logOtpToConsole(
  email: string,
  code: string,
  type: OtpType,
): void {
  console.log(`[OTP:${type}] ${email} -> ${code}`);
}
