import type { z } from "zod";
import type { createShareLinkSchema } from "../schemas/share.schema";

export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

export type ShareLinkResponseDto = {
  noteId: string;
  token: string;
  expiresAt: string;
  viewCount: number;
  createdAt: string;
};

export type PublicNoteResponseDto = {
  title: string;
  body: string;
  updatedAt: string;
};
