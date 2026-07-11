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

export const listNotesSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, VALIDATION_MESSAGES.NOTE_PAGE_INVALID)
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
    .max(APP_LIMITS.PAGE_SIZE_MAX, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
    .default(APP_LIMITS.PAGE_SIZE_DEFAULT),
  sort: z
    .enum(["updatedAt", "createdAt", "title"], {
      errorMap: () => ({
        message: VALIDATION_MESSAGES.NOTE_SORT_FIELD_INVALID,
      }),
    })
    .default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  tagIds: z
    .string()
    .optional()
    .refine(
      (val) =>
        val === undefined ||
        val.split(",").every((id) => z.string().uuid().safeParse(id).success),
      { message: VALIDATION_MESSAGES.NOTE_TAG_IDS_INVALID },
    ),
  tagMode: z
    .enum(["ALL", "ANY"], {
      errorMap: () => ({ message: VALIDATION_MESSAGES.NOTE_TAG_MODE_INVALID }),
    })
    .default("ALL"),
});

export const listTrashSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, VALIDATION_MESSAGES.NOTE_PAGE_INVALID)
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
    .max(APP_LIMITS.PAGE_SIZE_MAX, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
    .default(APP_LIMITS.PAGE_SIZE_DEFAULT),
});
