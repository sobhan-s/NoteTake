import type { z } from "zod";
import type { searchNotesSchema } from "../schemas/search.schema";

export type SearchNotesQuery = z.infer<typeof searchNotesSchema>;

export type SearchResultResponseDto = {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
};

export type PaginatedSearchResponseDto = {
  results: SearchResultResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
