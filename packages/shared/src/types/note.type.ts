import type { z } from "zod";
import type {
  createNoteSchema,
  listNotesSchema,
  listTrashSchema,
  permanentDeleteSchema,
  updateNoteSchema,
} from "../schemas/note.schema";

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type PermanentDeleteInput = z.infer<typeof permanentDeleteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesSchema>;
export type ListTrashQuery = z.infer<typeof listTrashSchema>;

export type NoteResponseDto = {
  id: string;
  title: string;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasActiveShareLink: boolean;
};

export type PaginatedNotesResponseDto = {
  notes: NoteResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type NoteVersionSummaryDto = {
  id: string;
  titleSnapshot: string;
  createdAt: string;
};

export type NoteVersionResponseDto = {
  id: string;
  noteId: string;
  titleSnapshot: string;
  bodySnapshot: string;
  createdAt: string;
};
