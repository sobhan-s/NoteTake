export const VALIDATION_MESSAGES = {
  EMAIL_INVALID: "Enter a valid email address",
  PASSWORD_WEAK:
    "Password must be at least 8 characters and include at least one number and one symbol",
  OTP_IDENTIFIER_REQUIRED: "Either userId or email must be provided",
} as const;
