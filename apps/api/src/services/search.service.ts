import type {
  PaginatedSearchResponseDto,
  SearchNotesQuery,
} from "@shared/core/types";
import * as noteRepository from "../repositories/note.repository.js";

function toPagination(
  page: number,
  limit: number,
  total: number,
): PaginatedSearchResponseDto["pagination"] {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

export async function searchNotes(
  userId: string,
  query: SearchNotesQuery,
): Promise<PaginatedSearchResponseDto> {
  const tagIds = query.tagIds ? query.tagIds.split(",") : undefined;
  const baseParams = {
    userId,
    query: query.q,
    tagIds,
    tagMode: query.tagMode,
  };
  const [rows, total] = await Promise.all([
    noteRepository.searchNotesForUser({
      ...baseParams,
      page: query.page,
      limit: query.limit,
    }),
    noteRepository.countSearchNotesForUser(baseParams),
  ]);
  return {
    results: rows.map((row) => ({
      id: row.id,
      title: row.title,
      snippet: row.snippet,
      updatedAt: row.updated_at.toISOString(),
    })),
    pagination: toPagination(query.page, query.limit, total),
  };
}
