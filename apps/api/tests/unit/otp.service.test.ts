import { describe, it, expect } from "vitest";
import { APP_LIMITS } from "@shared/core/constants";
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
} from "../../src/services/otp.service.js";

describe("[FRS-1.2.1] otp.service — generateOtpCode format", () => {
  it(`[FRS-1.2.1a] SHALL generate a numeric, zero-padded string of exactly APP_LIMITS.OTP_LENGTH (${APP_LIMITS.OTP_LENGTH}) digits`, () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateOtpCode();
      expect(code).toHaveLength(APP_LIMITS.OTP_LENGTH);
      expect(code).toMatch(/^[0-9]+$/);
    }
  });

  it("[FRS-1.2.1b] SHALL zero-pad codes below 10^(OTP_LENGTH-1) so the length invariant holds even for small random values", () => {
    // Regenerate until we observe a code with a leading zero (statistically near-certain
    // across enough draws) to prove padStart actually engages rather than merely
    // happening to never be exercised.
    const codes = Array.from({ length: 500 }, () => generateOtpCode());
    const hasLeadingZero = codes.some((c) => c.startsWith("0"));
    expect(hasLeadingZero).toBe(true);
    expect(codes.every((c) => c.length === APP_LIMITS.OTP_LENGTH)).toBe(true);
  });
});

describe("[FRS-1.2.2] otp.service — hashOtpCode / verifyOtpCodeHash round trip", () => {
  it("[FRS-1.2.2a] verifyOtpCodeHash SHALL return true for the exact code that was hashed", async () => {
    const code = generateOtpCode();
    const hash = await hashOtpCode(code);
    await expect(verifyOtpCodeHash(code, hash)).resolves.toBe(true);
  });

  it("[FRS-1.2.2b] verifyOtpCodeHash SHALL return false for any code that does not match the stored hash", async () => {
    const code = generateOtpCode();
    let wrongCode = generateOtpCode();
    while (wrongCode === code) {
      wrongCode = generateOtpCode();
    }
    const hash = await hashOtpCode(code);
    await expect(verifyOtpCodeHash(wrongCode, hash)).resolves.toBe(false);
  });

  it("[SDS §3.1] hashOtpCode SHALL never store the plaintext code itself as the hash value", async () => {
    const code = generateOtpCode();
    const hash = await hashOtpCode(code);
    expect(hash).not.toBe(code);
    expect(hash.startsWith("$2")).toBe(true); // bcrypt hash prefix
  });
});
