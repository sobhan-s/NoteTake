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

function buildTagFilter(
  tagIds: string[] | undefined,
  tagMode: "ALL" | "ANY",
): Prisma.NoteWhereInput {
  if (!tagIds || tagIds.length === 0) return {};
  return tagMode === "ALL"
    ? { AND: tagIds.map((tagId) => ({ noteTags: { some: { tagId } } })) }
    : { noteTags: { some: { tagId: { in: tagIds } } } };
}

type ListActiveNotesParams = {
  userId: string;
  page: number;
  limit: number;
  sort: "createdAt" | "updatedAt" | "title";
  order: "asc" | "desc";
  tagIds?: string[];
  tagMode: "ALL" | "ANY";
};

export function listActiveNotesForUser(
  params: ListActiveNotesParams,
  db: Db = prisma,
): Promise<Note[]> {
  const { userId, page, limit, sort, order, tagIds, tagMode } = params;
  return db.note.findMany({
    where: { userId, deletedAt: null, ...buildTagFilter(tagIds, tagMode) },
    orderBy: [{ [sort]: order }, { createdAt: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  });
}

export function countActiveNotesForUser(
  params: Pick<ListActiveNotesParams, "userId" | "tagIds" | "tagMode">,
  db: Db = prisma,
): Promise<number> {
  const { userId, tagIds, tagMode } = params;
  return db.note.count({
    where: { userId, deletedAt: null, ...buildTagFilter(tagIds, tagMode) },
  });
}

export function listTrashedNotesForUser(
  params: { userId: string; page: number; limit: number; stage1Cutoff: Date },
  db: Db = prisma,
): Promise<Note[]> {
  const { userId, page, limit, stage1Cutoff } = params;
  return db.note.findMany({
    where: { userId, deletedAt: { not: null, gte: stage1Cutoff } },
    orderBy: { deletedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export function countTrashedNotesForUser(
  params: { userId: string; stage1Cutoff: Date },
  db: Db = prisma,
): Promise<number> {
  return db.note.count({
    where: {
      userId: params.userId,
      deletedAt: { not: null, gte: params.stage1Cutoff },
    },
  });
}
