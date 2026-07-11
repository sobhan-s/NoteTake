import { APP_LIMITS } from "./app-limits.constant";

export const VALIDATION_MESSAGES = {
  EMAIL_INVALID: "Enter a valid email address",
  PASSWORD_WEAK:
    "Password must be at least 8 characters and include at least one number and one symbol",
  OTP_IDENTIFIER_REQUIRED: "Either userId or email must be provided",
  NOTE_TITLE_REQUIRED: "Title is required",
  NOTE_TITLE_TOO_LONG: `Title must be ${APP_LIMITS.NOTE_TITLE_MAX_CHARS} characters or fewer`,
  NOTE_BODY_TOO_LONG: `Body must be ${APP_LIMITS.NOTE_BODY_MAX_CHARS} characters or fewer`,
  NOTE_UPDATE_EMPTY: "At least one of title or body must be provided",
} as const;
