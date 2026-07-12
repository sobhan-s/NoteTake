import type { Prisma } from "@prisma/client";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import type {
  CreateNoteInput,
  ListNotesQuery,
  ListTrashQuery,
  NoteResponseDto,
  PaginatedNotesResponseDto,
  UpdateNoteInput,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import { prisma } from "../lib/prisma-client.js";
import * as noteVersionRepository from "../repositories/note-version.repository.js";
import * as noteRepository from "../repositories/note.repository.js";
import type { NoteWithShareLinks } from "../repositories/note.repository.js";
import * as shareRepository from "../repositories/share.repository.js";

function notFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

export function toNoteResponseDto(note: NoteWithShareLinks): NoteResponseDto {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    hasActiveShareLink: note.shareLinks.length > 0,
  };
}

function isWithinStage1(deletedAt: Date | null): boolean {
  if (!deletedAt) return false;
  const stage1CutoffMs = APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - deletedAt.getTime() < stage1CutoffMs;
}

function toPagination(
  page: number,
  limit: number,
  total: number,
): PaginatedNotesResponseDto["pagination"] {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

async function shouldSnapshot(
  noteId: string,
  isExplicitSave: boolean,
  db: Prisma.TransactionClient,
): Promise<boolean> {
  if (isExplicitSave) return true;
  const latest = await noteVersionRepository.findLatestVersionForNote(
    noteId,
    db,
  );
  if (!latest) return true;
  const throttleMs = APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES * 60 * 1000;
  return Date.now() - latest.createdAt.getTime() >= throttleMs;
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponseDto> {
  const note = await prisma.$transaction(async (tx) => {
    const created = await noteRepository.createNote(
      { userId, title: input.title, body: input.body },
      tx,
    );
    await noteVersionRepository.createVersion(
      {
        noteId: created.id,
        titleSnapshot: created.title,
        bodySnapshot: created.body,
      },
      tx,
    );
    return created;
  });
  return toNoteResponseDto({ ...note, shareLinks: [] });
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
  const updated = await prisma.$transaction(async (tx) => {
    const note = await noteRepository.updateNoteContent(
      noteId,
      { title: input.title, body: input.body },
      tx,
    );
    if (await shouldSnapshot(noteId, input.isExplicitSave, tx)) {
      await noteVersionRepository.createVersion(
        { noteId, titleSnapshot: note.title, bodySnapshot: note.body },
        tx,
      );
    }
    return note;
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
  const deleted = await prisma.$transaction(async (tx) => {
    const note = await noteRepository.softDeleteNote(noteId, tx);
    await shareRepository.revokeActiveShareLinksForNote(noteId, tx);
    return note;
  });
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

export async function listNotes(
  userId: string,
  query: ListNotesQuery,
): Promise<PaginatedNotesResponseDto> {
  const tagIds = query.tagIds ? query.tagIds.split(",") : undefined;
  const params = {
    userId,
    page: query.page,
    limit: query.limit,
    sort: query.sort,
    order: query.order,
    tagIds,
    tagMode: query.tagMode,
  };
  const [notes, total] = await Promise.all([
    noteRepository.listActiveNotesForUser(params),
    noteRepository.countActiveNotesForUser(params),
  ]);
  return {
    notes: notes.map(toNoteResponseDto),
    pagination: toPagination(query.page, query.limit, total),
  };
}

export async function listTrash(
  userId: string,
  query: ListTrashQuery,
): Promise<PaginatedNotesResponseDto> {
  const stage1Cutoff = new Date(
    Date.now() - APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000,
  );
  const params = { userId, page: query.page, limit: query.limit, stage1Cutoff };
  const [notes, total] = await Promise.all([
    noteRepository.listTrashedNotesForUser(params),
    noteRepository.countTrashedNotesForUser(params),
  ]);
  return {
    notes: notes.map(toNoteResponseDto),
    pagination: toPagination(query.page, query.limit, total),
  };
}
