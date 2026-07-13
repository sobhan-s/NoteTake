import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  CreateShareLinkInput,
  PublicNoteResponseDto,
  ShareLinkResponseDto,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

const shareUrl = (noteId: string) =>
  `${API_PATHS.NOTES.ROOT}/${noteId}${API_PATHS.NOTES.SHARE}`;

export async function getShareLink(
  noteId: string,
): Promise<ShareLinkResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<ShareLinkResponseDto>
  >(shareUrl(noteId));
  return response.data.data;
}

export async function createShareLink(
  noteId: string,
  input: CreateShareLinkInput,
): Promise<ShareLinkResponseDto> {
  const response = await httpClient.post<
    ApiSuccessResponse<ShareLinkResponseDto>
  >(shareUrl(noteId), input);
  return response.data.data;
}

export async function revokeShareLink(noteId: string): Promise<void> {
  await httpClient.delete(shareUrl(noteId));
}

export async function getPublicShareNote(
  token: string,
): Promise<PublicNoteResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<PublicNoteResponseDto>
  >(`${API_PATHS.PUBLIC.ROOT}${API_PATHS.PUBLIC.SHARE}/${token}`);
  return response.data.data;
}
