import { API_ERROR_CODES } from "@shared/core/constants";

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function mapApiError(code?: string): string {
  switch (code) {
    case API_ERROR_CODES.EMAIL_ALREADY_VERIFIED:
      return "This account is already verified. Try logging in instead.";
    case API_ERROR_CODES.OTP_EXPIRED:
      return "This code has expired. Request a new one.";
    case API_ERROR_CODES.OTP_INVALID:
      return "That code isn't correct. Please try again.";
    case API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED:
      return "Too many incorrect attempts. Request a new code.";
    case API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE:
      return "Please wait before requesting another code.";
    case API_ERROR_CODES.INVALID_CREDENTIALS:
      return "Incorrect email or password.";
    case API_ERROR_CODES.ACCOUNT_NOT_VERIFIED:
      return "Please verify your email before logging in.";
    case API_ERROR_CODES.RATE_LIMIT_EXCEEDED:
      return "Too many attempts. Please wait before trying again.";
    case API_ERROR_CODES.VALIDATION_ERROR:
      return "Please check the highlighted fields and try again.";
    case API_ERROR_CODES.NOTE_NOT_FOUND:
      return "This note is no longer available.";
    default:
      return GENERIC_ERROR_MESSAGE;
  }
}
