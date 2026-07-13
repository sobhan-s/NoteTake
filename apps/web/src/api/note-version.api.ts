import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  NoteResponseDto,
  NoteVersionResponseDto,
  NoteVersionSummaryDto,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

const versionsUrl = (noteId: string) =>
  `${API_PATHS.NOTES.ROOT}/${noteId}${API_PATHS.NOTES.VERSIONS}`;

export async function listNoteVersions(
  noteId: string,
): Promise<NoteVersionSummaryDto[]> {
  const response = await httpClient.get<
    ApiSuccessResponse<{ versions: NoteVersionSummaryDto[] }>
  >(versionsUrl(noteId));
  return response.data.data.versions;
}

export async function getNoteVersion(
  noteId: string,
  versionId: string,
): Promise<NoteVersionResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<NoteVersionResponseDto>
  >(`${versionsUrl(noteId)}/${versionId}`);
  return response.data.data;
}

export async function restoreNoteVersion(
  noteId: string,
  versionId: string,
): Promise<NoteResponseDto> {
  const response = await httpClient.post<ApiSuccessResponse<NoteResponseDto>>(
    `${versionsUrl(noteId)}/${versionId}${API_PATHS.NOTES.RESTORE}`,
  );
  return response.data.data;
}
