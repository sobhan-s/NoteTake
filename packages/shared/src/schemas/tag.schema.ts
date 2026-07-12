import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

const tagColorSchema = z
  .string()
  .regex(
    /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/,
    VALIDATION_MESSAGES.TAG_COLOR_INVALID,
  );

export const createTagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.TAG_NAME_REQUIRED)
    .max(APP_LIMITS.TAG_NAME_MAX_CHARS, VALIDATION_MESSAGES.TAG_NAME_TOO_LONG),
  color: tagColorSchema.default(APP_LIMITS.TAG_DEFAULT_COLOR),
});

export const updateTagSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, VALIDATION_MESSAGES.TAG_NAME_REQUIRED)
      .max(APP_LIMITS.TAG_NAME_MAX_CHARS, VALIDATION_MESSAGES.TAG_NAME_TOO_LONG)
      .optional(),
    color: tagColorSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.color !== undefined, {
    message: VALIDATION_MESSAGES.TAG_UPDATE_EMPTY,
  });
