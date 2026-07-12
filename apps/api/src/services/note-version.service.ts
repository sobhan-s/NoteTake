import type { NoteVersion } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import type {
  NoteResponseDto,
  NoteVersionResponseDto,
  NoteVersionSummaryDto,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import { prisma } from "../lib/prisma-client.js";
import * as noteVersionRepository from "../repositories/note-version.repository.js";
import * as noteRepository from "../repositories/note.repository.js";
import { toNoteResponseDto } from "./note.service.js";

function noteNotFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

function versionNotFound(): never {
  throw new AppError(
    404,
    API_ERROR_CODES.VERSION_NOT_FOUND,
    "Version not found",
  );
}

async function assertOwnedActiveNote(
  userId: string,
  noteId: string,
): Promise<void> {
  const note = await noteRepository.findActiveNoteByIdForUser(noteId, userId);
  if (!note) noteNotFound();
}

function toSummaryDto(v: NoteVersion): NoteVersionSummaryDto {
  return {
    id: v.id,
    titleSnapshot: v.titleSnapshot,
    createdAt: v.createdAt.toISOString(),
  };
}

function toVersionResponseDto(v: NoteVersion): NoteVersionResponseDto {
  return {
    id: v.id,
    noteId: v.noteId,
    titleSnapshot: v.titleSnapshot,
    bodySnapshot: v.bodySnapshot,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function listVersions(
  userId: string,
  noteId: string,
): Promise<{ versions: NoteVersionSummaryDto[] }> {
  await assertOwnedActiveNote(userId, noteId);
  const versions = await noteVersionRepository.listVersionsForNote(noteId);
  return { versions: versions.map(toSummaryDto) };
}

export async function getVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteVersionResponseDto> {
  await assertOwnedActiveNote(userId, noteId);
  const version = await noteVersionRepository.findVersionByIdForNote(
    noteId,
    versionId,
  );
  if (!version) versionNotFound();
  return toVersionResponseDto(version);
}

export async function restoreVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteResponseDto> {
  await assertOwnedActiveNote(userId, noteId);
  const version = await noteVersionRepository.findVersionByIdForNote(
    noteId,
    versionId,
  );
  if (!version) versionNotFound();
  const restored = await prisma.$transaction(async (tx) => {
    const note = await noteRepository.updateNoteContent(
      noteId,
      { title: version.titleSnapshot, body: version.bodySnapshot },
      tx,
    );
    await noteVersionRepository.createVersion(
      {
        noteId,
        titleSnapshot: version.titleSnapshot,
        bodySnapshot: version.bodySnapshot,
      },
      tx,
    );
    return note;
  });
  return toNoteResponseDto(restored);
}
