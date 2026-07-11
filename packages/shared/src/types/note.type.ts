import type { z } from "zod";
import type {
  createNoteSchema,
  permanentDeleteSchema,
  updateNoteSchema,
} from "../schemas/note.schema";

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type PermanentDeleteInput = z.infer<typeof permanentDeleteSchema>;

export type NoteResponseDto = {
  id: string;
  title: string;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
