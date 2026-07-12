import type { NoteVersion, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "noteVersion">;
type RawDb = Pick<Prisma.TransactionClient, "$executeRaw">;

export function createVersion(
  data: { noteId: string; titleSnapshot: string; bodySnapshot: string },
  db: Db = prisma,
): Promise<NoteVersion> {
  return db.noteVersion.create({ data });
}

export function findLatestVersionForNote(
  noteId: string,
  db: Db = prisma,
): Promise<NoteVersion | null> {
  return db.noteVersion.findFirst({
    where: { noteId },
    orderBy: { createdAt: "desc" },
  });
}

export function listVersionsForNote(
  noteId: string,
  db: Db = prisma,
): Promise<NoteVersion[]> {
  return db.noteVersion.findMany({
    where: { noteId },
    orderBy: { createdAt: "desc" },
  });
}

export function findVersionByIdForNote(
  noteId: string,
  versionId: string,
  db: Db = prisma,
): Promise<NoteVersion | null> {
  return db.noteVersion.findFirst({ where: { id: versionId, noteId } });
}

export function purgeOldVersions(
  cutoff: Date,
  db: RawDb = prisma,
): Promise<number> {
  return db.$executeRaw`
    DELETE FROM note_versions
    WHERE created_at < ${cutoff}
      AND id NOT IN (
        SELECT DISTINCT ON (note_id) id
        FROM note_versions
        ORDER BY note_id, created_at DESC
      )
  `;
}
