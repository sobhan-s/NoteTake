import type { Note, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "note">;

export function createNote(
  data: { userId: string; title: string; body: string },
  db: Db = prisma,
): Promise<Note> {
  return db.note.create({ data });
}

export function findActiveNoteByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<Note | null> {
  return db.note.findFirst({ where: { id, userId, deletedAt: null } });
}

export function findTrashedNoteByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<Note | null> {
  return db.note.findFirst({
    where: { id, userId, deletedAt: { not: null } },
  });
}

export function updateNoteContent(
  id: string,
  data: { title?: string; body?: string },
  db: Db = prisma,
): Promise<Note> {
  return db.note.update({ where: { id }, data });
}

export function softDeleteNote(id: string, db: Db = prisma): Promise<Note> {
  return db.note.update({ where: { id }, data: { deletedAt: new Date() } });
}

export function restoreNote(id: string, db: Db = prisma): Promise<Note> {
  return db.note.update({ where: { id }, data: { deletedAt: null } });
}

export function permanentlyDeleteNote(
  id: string,
  db: Db = prisma,
): Promise<Note> {
  return db.note.delete({ where: { id } });
}

export function purgeStage2Notes(
  stage2Cutoff: Date,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.note.deleteMany({
    where: { deletedAt: { not: null, lt: stage2Cutoff } },
  });
}
