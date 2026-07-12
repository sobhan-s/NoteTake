import { describe, it, expect } from "vitest";
import { API_ERROR_CODES } from "@shared/core/constants";
import { mapApiError } from "@/lib/errorMessages";

describe("mapApiError ([FRS-8.5, Centralized error mapping scenario])", () => {
  it("should map every known API_ERROR_CODES value to a safe, user-friendly message", () => {
    expect(mapApiError(API_ERROR_CODES.EMAIL_ALREADY_VERIFIED)).toBe(
      "This account is already verified. Try logging in instead.",
    );
    expect(mapApiError(API_ERROR_CODES.OTP_EXPIRED)).toBe(
      "This code has expired. Request a new one.",
    );
    expect(mapApiError(API_ERROR_CODES.OTP_INVALID)).toBe(
      "That code isn't correct. Please try again.",
    );
    expect(mapApiError(API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED)).toBe(
      "Too many incorrect attempts. Request a new code.",
    );
    expect(mapApiError(API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE)).toBe(
      "Please wait before requesting another code.",
    );
    expect(mapApiError(API_ERROR_CODES.INVALID_CREDENTIALS)).toBe(
      "Incorrect email or password.",
    );
    expect(mapApiError(API_ERROR_CODES.ACCOUNT_NOT_VERIFIED)).toBe(
      "Please verify your email before logging in.",
    );
    expect(mapApiError(API_ERROR_CODES.RATE_LIMIT_EXCEEDED)).toBe(
      "Too many attempts. Please wait before trying again.",
    );
    expect(mapApiError(API_ERROR_CODES.VALIDATION_ERROR)).toBe(
      "Please check the highlighted fields and try again.",
    );
  });

  it("should return generic fallback message for undefined or unmapped error codes", () => {
    expect(mapApiError(undefined)).toBe(
      "Something went wrong. Please try again.",
    );
    expect(mapApiError("UNKNOWN_RANDOM_CODE")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
