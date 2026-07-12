import type { Prisma, Tag } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "tag">;
export type TagWithNoteCount = Tag & { _count: { noteTags: number } };

const withActiveNoteCount = {
  _count: { select: { noteTags: { where: { note: { deletedAt: null } } } } },
} satisfies Prisma.TagInclude;

export function createTag(
  data: { userId: string; name: string; color: string },
  db: Db = prisma,
): Promise<TagWithNoteCount> {
  return db.tag.create({ data, include: withActiveNoteCount });
}

export function findTagsByIdsForUser(
  ids: string[],
  userId: string,
  db: Db = prisma,
): Promise<Tag[]> {
  return db.tag.findMany({ where: { id: { in: ids }, userId } });
}

export function findTagByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<Tag | null> {
  return db.tag.findFirst({ where: { id, userId } });
}

export function findTagByNameForUser(
  name: string,
  userId: string,
  db: Db = prisma,
): Promise<Tag | null> {
  return db.tag.findFirst({ where: { userId, name } });
}

export function listTagsForUser(
  userId: string,
  db: Db = prisma,
): Promise<TagWithNoteCount[]> {
  return db.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: withActiveNoteCount,
  });
}

export function updateTag(
  id: string,
  data: { name?: string; color?: string },
  db: Db = prisma,
): Promise<TagWithNoteCount> {
  return db.tag.update({ where: { id }, data, include: withActiveNoteCount });
}

export function deleteTag(id: string, db: Db = prisma): Promise<Tag> {
  return db.tag.delete({ where: { id } });
}
