import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const searchNotesSchema = z.object({
  q: z.string().trim().min(1, VALIDATION_MESSAGES.SEARCH_QUERY_REQUIRED),
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
