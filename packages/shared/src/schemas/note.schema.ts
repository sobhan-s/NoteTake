import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const createNoteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.NOTE_TITLE_REQUIRED)
    .max(
      APP_LIMITS.NOTE_TITLE_MAX_CHARS,
      VALIDATION_MESSAGES.NOTE_TITLE_TOO_LONG,
    ),
  body: z
    .string()
    .max(
      APP_LIMITS.NOTE_BODY_MAX_CHARS,
      VALIDATION_MESSAGES.NOTE_BODY_TOO_LONG,
    ),
});

export const updateNoteSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, VALIDATION_MESSAGES.NOTE_TITLE_REQUIRED)
      .max(
        APP_LIMITS.NOTE_TITLE_MAX_CHARS,
        VALIDATION_MESSAGES.NOTE_TITLE_TOO_LONG,
      )
      .optional(),
    body: z
      .string()
      .max(
        APP_LIMITS.NOTE_BODY_MAX_CHARS,
        VALIDATION_MESSAGES.NOTE_BODY_TOO_LONG,
      )
      .optional(),
  })
  .refine((data) => data.title !== undefined || data.body !== undefined, {
    message: VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY,
  });

export const permanentDeleteSchema = z.object({
  confirm: z.literal(true),
});
