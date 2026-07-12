import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  CreateTagInput,
  TagListResponseDto,
  TagResponseDto,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

export async function listTags(): Promise<TagListResponseDto> {
  const response = await httpClient.get<ApiSuccessResponse<TagListResponseDto>>(
    API_PATHS.TAGS.ROOT,
  );
  return response.data.data;
}

export async function createTag(
  input: CreateTagInput,
): Promise<TagResponseDto> {
  const response = await httpClient.post<ApiSuccessResponse<TagResponseDto>>(
    API_PATHS.TAGS.ROOT,
    input,
  );
  return response.data.data;
}
