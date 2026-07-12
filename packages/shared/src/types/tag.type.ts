import type { z } from "zod";
import type { createTagSchema, updateTagSchema } from "../schemas/tag.schema";

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export type TagResponseDto = {
  id: string;
  name: string;
  color: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TagListResponseDto = {
  tags: TagResponseDto[];
};

export type TagSummaryDto = {
  id: string;
  name: string;
  color: string;
};
