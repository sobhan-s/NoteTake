import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const createShareLinkSchema = z.object({
  expiresInDays: z.coerce
    .number()
    .int()
    .min(
      APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS,
      VALIDATION_MESSAGES.SHARE_EXPIRY_DAYS_INVALID,
    )
    .max(
      APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS,
      VALIDATION_MESSAGES.SHARE_EXPIRY_DAYS_INVALID,
    )
    .default(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS),
});
