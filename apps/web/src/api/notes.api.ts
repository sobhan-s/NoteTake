import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  CreateNoteInput,
  ListNotesQuery,
  ListTrashQuery,
  NoteResponseDto,
  PaginatedNotesResponseDto,
  PermanentDeleteInput,
  UpdateNoteInput,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

const NOTES_ROOT = API_PATHS.NOTES.ROOT;

export async function listNotes(
  params: Partial<ListNotesQuery>,
): Promise<PaginatedNotesResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<PaginatedNotesResponseDto>
  >(NOTES_ROOT, { params });
  return response.data.data;
}

export async function listTrash(
  params: Partial<ListTrashQuery>,
): Promise<PaginatedNotesResponseDto> {
  const response = await httpClient.get<
    ApiSuccessResponse<PaginatedNotesResponseDto>
  >(`${NOTES_ROOT}${API_PATHS.NOTES.TRASH}`, { params });
  return response.data.data;
}

export async function getNoteById(id: string): Promise<NoteResponseDto> {
  const response = await httpClient.get<ApiSuccessResponse<NoteResponseDto>>(
    `${NOTES_ROOT}/${id}`,
  );
  return response.data.data;
}

export async function createNote(
  input: CreateNoteInput,
): Promise<NoteResponseDto> {
  const response = await httpClient.post<ApiSuccessResponse<NoteResponseDto>>(
    NOTES_ROOT,
    input,
  );
  return response.data.data;
}

export async function updateNote(
  id: string,
  input: UpdateNoteInput,
): Promise<NoteResponseDto> {
  const response = await httpClient.patch<ApiSuccessResponse<NoteResponseDto>>(
    `${NOTES_ROOT}/${id}`,
    input,
  );
  return response.data.data;
}

export async function restoreNote(id: string): Promise<NoteResponseDto> {
  const response = await httpClient.post<ApiSuccessResponse<NoteResponseDto>>(
    `${NOTES_ROOT}/${id}${API_PATHS.NOTES.RESTORE}`,
  );
  return response.data.data;
}

export async function permanentDeleteNote(
  id: string,
  input: PermanentDeleteInput,
): Promise<{ id: string }> {
  const response = await httpClient.delete<ApiSuccessResponse<{ id: string }>>(
    `${NOTES_ROOT}/${id}${API_PATHS.NOTES.PERMANENT}`,
    { data: input },
  );
  return response.data.data;
}
