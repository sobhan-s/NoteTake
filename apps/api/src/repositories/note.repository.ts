import type { Note, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "note">;

export type NoteWithShareLinks = Note & { shareLinks: { id: string }[] };

const ACTIVE_SHARE_LINK_INCLUDE = {
  shareLinks: {
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.NoteInclude;

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
): Promise<NoteWithShareLinks | null> {
  return db.note.findFirst({
    where: { id, userId, deletedAt: null },
    include: ACTIVE_SHARE_LINK_INCLUDE,
  });
}

export function findTrashedNoteByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<NoteWithShareLinks | null> {
  return db.note.findFirst({
    where: { id, userId, deletedAt: { not: null } },
    include: ACTIVE_SHARE_LINK_INCLUDE,
  });
}

export function updateNoteContent(
  id: string,
  data: { title?: string; body?: string },
  db: Db = prisma,
): Promise<NoteWithShareLinks> {
  return db.note.update({
    where: { id },
    data,
    include: ACTIVE_SHARE_LINK_INCLUDE,
  });
}

export function softDeleteNote(
  id: string,
  db: Db = prisma,
): Promise<NoteWithShareLinks> {
  return db.note.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: ACTIVE_SHARE_LINK_INCLUDE,
  });
}

export function restoreNote(
  id: string,
  db: Db = prisma,
): Promise<NoteWithShareLinks> {
  return db.note.update({
    where: { id },
    data: { deletedAt: null },
    include: ACTIVE_SHARE_LINK_INCLUDE,
  });
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
): Promise<NoteWithShareLinks[]> {
  const { userId, page, limit, sort, order, tagIds, tagMode } = params;
  return db.note.findMany({
    where: { userId, deletedAt: null, ...buildTagFilter(tagIds, tagMode) },
    orderBy: [{ [sort]: order }, { createdAt: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
    include: ACTIVE_SHARE_LINK_INCLUDE,
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
): Promise<NoteWithShareLinks[]> {
  const { userId, page, limit, stage1Cutoff } = params;
  return db.note.findMany({
    where: { userId, deletedAt: { not: null, gte: stage1Cutoff } },
    orderBy: { deletedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
    include: ACTIVE_SHARE_LINK_INCLUDE,
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

function buildSearchTagFilterSql(
  tagIds: string[] | undefined,
  tagMode: "ALL" | "ANY",
  placeholderIndex: number,
): string {
  if (!tagIds || tagIds.length === 0) return "";
  return tagMode === "ALL"
    ? `AND NOT EXISTS (
         SELECT 1 FROM unnest($${placeholderIndex}::uuid[]) AS required(tag_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = required.tag_id
         )
       )`
    : `AND EXISTS (
         SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ANY($${placeholderIndex}::uuid[])
       )`;
}

type RawDb = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

type SearchRow = {
  id: string;
  title: string;
  updated_at: Date;
  snippet: string;
};

type SearchNotesParams = {
  userId: string;
  query: string;
  page: number;
  limit: number;
  tagIds?: string[];
  tagMode: "ALL" | "ANY";
};

export function searchNotesForUser(
  params: SearchNotesParams,
  db: RawDb = prisma,
): Promise<SearchRow[]> {
  const { userId, query, page, limit, tagIds, tagMode } = params;
  const offset = (page - 1) * limit;
  const tagClause = buildSearchTagFilterSql(tagIds, tagMode, 5);
  const args: unknown[] = [userId, query, limit, offset];
  if (tagIds && tagIds.length > 0) args.push(tagIds);
  return db.$queryRawUnsafe<SearchRow[]>(
    `SELECT n.id, n.title, n.updated_at,
            ts_headline('english', n.body, plainto_tsquery('english', $2),
                        'StartSel=[[[MARK]]], StopSel=[[[MARK_END]]], MaxWords=35, MinWords=15') AS snippet
     FROM notes n
     WHERE n.user_id = $1::uuid AND n.deleted_at IS NULL
       AND n.search_vector @@ plainto_tsquery('english', $2)
       ${tagClause}
     ORDER BY ts_rank(n.search_vector, plainto_tsquery('english', $2)) DESC, n.updated_at DESC
     LIMIT $3 OFFSET $4`,
    ...args,
  );
}

export async function countSearchNotesForUser(
  params: Omit<SearchNotesParams, "page" | "limit">,
  db: RawDb = prisma,
): Promise<number> {
  const { userId, query, tagIds, tagMode } = params;
  const tagClause = buildSearchTagFilterSql(tagIds, tagMode, 3);
  const args: unknown[] = [userId, query];
  if (tagIds && tagIds.length > 0) args.push(tagIds);
  const rows = await db.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count
     FROM notes n
     WHERE n.user_id = $1::uuid AND n.deleted_at IS NULL
       AND n.search_vector @@ plainto_tsquery('english', $2)
       ${tagClause}`,
    ...args,
  );
  return rows[0]?.count ?? 0;
}
