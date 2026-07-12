import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  TagListResponseDto,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

export async function listTags(): Promise<TagListResponseDto> {
  const response = await httpClient.get<ApiSuccessResponse<TagListResponseDto>>(
    API_PATHS.TAGS.ROOT,
  );
  return response.data.data;
}
