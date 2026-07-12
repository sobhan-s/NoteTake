import * as crypto from "node:crypto";
import { Prisma, type ShareLink } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import type {
  CreateShareLinkInput,
  PublicNoteResponseDto,
  ShareLinkResponseDto,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import * as noteRepository from "../repositories/note.repository.js";
import * as shareRepository from "../repositories/share.repository.js";

function noteNotFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

function shareLinkNotFound(): never {
  throw new AppError(
    404,
    API_ERROR_CODES.SHARE_LINK_NOT_FOUND,
    "Share link not found",
  );
}

function shareLinkUnavailable(): never {
  throw new AppError(
    404,
    API_ERROR_CODES.SHARE_LINK_UNAVAILABLE,
    "This shared note is no longer available",
  );
}

function toShareLinkResponseDto(link: ShareLink): ShareLinkResponseDto {
  return {
    noteId: link.noteId,
    token: link.token,
    expiresAt: link.expiresAt.toISOString(),
    viewCount: link.viewCount,
    createdAt: link.createdAt.toISOString(),
  };
}

async function assertOwnedActiveNote(
  userId: string,
  noteId: string,
): Promise<void> {
  const note = await noteRepository.findActiveNoteByIdForUser(noteId, userId);
  if (!note) noteNotFound();
}

async function createShareLinkWithRetry(
  noteId: string,
  expiresAt: Date,
  attemptsLeft = 3,
): Promise<ShareLink> {
  const token = crypto.randomBytes(32).toString("hex");
  try {
    return await shareRepository.createShareLink({ noteId, token, expiresAt });
  } catch (err) {
    const isTokenCollision =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002";
    if (isTokenCollision && attemptsLeft > 1) {
      return createShareLinkWithRetry(noteId, expiresAt, attemptsLeft - 1);
    }
    throw err;
  }
}

export async function getOrCreateShareLink(
  userId: string,
  noteId: string,
  input: CreateShareLinkInput,
): Promise<{ dto: ShareLinkResponseDto; created: boolean }> {
  await assertOwnedActiveNote(userId, noteId);
  const existing = await shareRepository.findActiveShareLinkForNote(noteId);
  if (existing)
    return { dto: toShareLinkResponseDto(existing), created: false };
  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  );
  const created = await createShareLinkWithRetry(noteId, expiresAt);
  return { dto: toShareLinkResponseDto(created), created: true };
}

export async function getActiveShareLink(
  userId: string,
  noteId: string,
): Promise<ShareLinkResponseDto> {
  await assertOwnedActiveNote(userId, noteId);
  const link = await shareRepository.findActiveShareLinkForNote(noteId);
  if (!link) shareLinkNotFound();
  return toShareLinkResponseDto(link);
}

export async function revokeShareLink(
  userId: string,
  noteId: string,
): Promise<{ noteId: string }> {
  await assertOwnedActiveNote(userId, noteId);
  const link = await shareRepository.findActiveShareLinkForNote(noteId);
  if (!link) shareLinkNotFound();
  await shareRepository.revokeShareLinkById(link.id);
  return { noteId };
}

export async function getPublicNoteByToken(
  token: string,
): Promise<PublicNoteResponseDto> {
  const row = await shareRepository.consumePublicShareView(token);
  if (!row) shareLinkUnavailable();
  return {
    title: row.title,
    body: row.body,
    updatedAt: row.updated_at.toISOString(),
  };
}
