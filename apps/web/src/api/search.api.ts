import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  PaginatedSearchResponseDto,
  SearchNotesQuery,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

export async function searchNotes(
  params: Partial<SearchNotesQuery>,
): Promise<PaginatedSearchResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<PaginatedSearchResponseDto>
  >(API_PATHS.SEARCH.ROOT, { params });
  return response.data.data;
}
