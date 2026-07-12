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
  NOTE_PAGE_INVALID: "Page must be a positive integer",
  NOTE_LIMIT_INVALID: `Limit must be between 1 and ${APP_LIMITS.PAGE_SIZE_MAX}`,
  NOTE_SORT_FIELD_INVALID: "Sort must be one of: createdAt, updatedAt, title",
  NOTE_TAG_MODE_INVALID: "Tag mode must be ALL or ANY",
  NOTE_TAG_IDS_INVALID: "Each tagIds entry must be a valid UUID",
  TAG_NAME_REQUIRED: "Tag name is required",
  TAG_NAME_TOO_LONG: `Tag name must be ${APP_LIMITS.TAG_NAME_MAX_CHARS} characters or fewer`,
  TAG_COLOR_INVALID: "Color must be a valid hex code (e.g. #6B7280)",
  TAG_UPDATE_EMPTY: "At least one of name or color must be provided",
  TAG_NAME_CONFLICT: "A tag with this name already exists",
  SEARCH_QUERY_REQUIRED: "Search query is required",
  SHARE_EXPIRY_DAYS_INVALID: `Expiry must be between ${APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS} and ${APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS} days`,
} as const;
