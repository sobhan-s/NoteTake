import type { Prisma, ShareLink } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "shareLink">;

function activeWhere(noteId: string): Prisma.ShareLinkWhereInput {
  return { noteId, revokedAt: null, expiresAt: { gt: new Date() } };
}

export function findActiveShareLinkForNote(
  noteId: string,
  db: Db = prisma,
): Promise<ShareLink | null> {
  return db.shareLink.findFirst({ where: activeWhere(noteId) });
}

export function createShareLink(
  data: { noteId: string; token: string; expiresAt: Date },
  db: Db = prisma,
): Promise<ShareLink> {
  return db.shareLink.create({ data });
}

export function revokeShareLinkById(
  id: string,
  db: Db = prisma,
): Promise<ShareLink> {
  return db.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export function revokeActiveShareLinksForNote(
  noteId: string,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.shareLink.updateMany({
    where: activeWhere(noteId),
    data: { revokedAt: new Date() },
  });
}

type RawDb = Pick<Prisma.TransactionClient, "$queryRaw">;

type PublicShareRow = {
  view_count: number;
  expires_at: Date;
  note_id: string;
  title: string;
  body: string;
  updated_at: Date;
};

export async function consumePublicShareView(
  token: string,
  db: RawDb = prisma,
): Promise<PublicShareRow | null> {
  const rows = await db.$queryRaw<PublicShareRow[]>`
    UPDATE share_links sl
    SET view_count = view_count + 1
    FROM notes n
    WHERE sl.token = ${token}
      AND sl.note_id = n.id
      AND sl.revoked_at IS NULL
      AND sl.expires_at > NOW()
      AND n.deleted_at IS NULL
    RETURNING sl.view_count AS view_count, sl.expires_at AS expires_at,
              n.id AS note_id, n.title, n.body, n.updated_at AS updated_at
  `;
  return rows[0] ?? null;
}
