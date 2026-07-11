import type { Note } from "@prisma/client";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import type {
  CreateNoteInput,
  NoteResponseDto,
  UpdateNoteInput,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import * as noteRepository from "../repositories/note.repository.js";

function notFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

function toNoteResponseDto(note: Note): NoteResponseDto {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function isWithinStage1(deletedAt: Date | null): boolean {
  if (!deletedAt) return false;
  const stage1CutoffMs = APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - deletedAt.getTime() < stage1CutoffMs;
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponseDto> {
  const note = await noteRepository.createNote({
    userId,
    title: input.title,
    body: input.body,
  });
  return toNoteResponseDto(note);
}

export async function getNoteById(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const note = await noteRepository.findActiveNoteByIdForUser(noteId, userId);
  if (!note) notFound();
  return toNoteResponseDto(note);
}

export async function updateNote(
  userId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<NoteResponseDto> {
  const existing = await noteRepository.findActiveNoteByIdForUser(
    noteId,
    userId,
  );
  if (!existing) notFound();
  const updated = await noteRepository.updateNoteContent(noteId, {
    title: input.title,
    body: input.body,
  });
  return toNoteResponseDto(updated);
}

export async function softDeleteNote(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const existing = await noteRepository.findActiveNoteByIdForUser(
    noteId,
    userId,
  );
  if (!existing) notFound();
  const deleted = await noteRepository.softDeleteNote(noteId);
  return toNoteResponseDto(deleted);
}

export async function restoreNote(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const trashed = await noteRepository.findTrashedNoteByIdForUser(
    noteId,
    userId,
  );
  if (!trashed || !isWithinStage1(trashed.deletedAt)) notFound();
  const restored = await noteRepository.restoreNote(noteId);
  return toNoteResponseDto(restored);
}

export async function permanentDeleteNote(
  userId: string,
  noteId: string,
): Promise<{ id: string }> {
  const trashed = await noteRepository.findTrashedNoteByIdForUser(
    noteId,
    userId,
  );
  if (!trashed || !isWithinStage1(trashed.deletedAt)) notFound();
  await noteRepository.permanentlyDeleteNote(noteId);
  return { id: noteId };
}
