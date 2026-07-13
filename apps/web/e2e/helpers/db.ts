import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(dirname, "../../../../apps/api/.env.test"),
});

if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
  throw new Error(
    "FATAL SAFETY BREAK: Test suite booted without DATABASE_URL pointing at notes_app_test!",
  );
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export function assertTestDatabaseGuard(): void {
  if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
    throw new Error(
      "FATAL SAFETY BREAK: Truncation attempted outside notes_app_test instance!",
    );
  }
}

export async function resetTestDatabase(): Promise<void> {
  assertTestDatabaseGuard();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "otp_codes", "login_attempts", "refresh_sessions", "notes", "tags", "note_tags", "note_versions", "share_links" RESTART IDENTITY CASCADE;',
  );
}

import bcrypt from "bcrypt";
let cachedHash: string | null = null;
let cachedCode: string | null = null;

export async function setTestOtpCodeHash(
  otpId: string,
  knownCode: string = "123456",
): Promise<string> {
  if (cachedCode !== knownCode || !cachedHash) {
    cachedHash = await bcrypt.hash(knownCode, 12);
    cachedCode = knownCode;
  }
  await prisma.otpCode.update({
    where: { id: otpId },
    data: { codeHash: cachedHash },
  });
  return knownCode;
}

export async function backdateNoteDeletedAt(
  noteId: string,
  daysAgo: number,
): Promise<void> {
  assertTestDatabaseGuard();
  const deletedAt = new Date();
  deletedAt.setDate(deletedAt.getDate() - daysAgo);
  await prisma.note.update({ where: { id: noteId }, data: { deletedAt } });
}

// Caller must never pass the row with the greatest `createdAt` for a given
// `noteId` — there is no `isCurrent` column, so that row is the implicit
// "live version" and is exempt from purge regardless of age (FRS-6.5).
export async function backdateNoteVersionCreatedAt(
  versionId: string,
  daysAgo: number,
): Promise<void> {
  assertTestDatabaseGuard();
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - daysAgo);
  await prisma.noteVersion.update({
    where: { id: versionId },
    data: { createdAt },
  });
}

export async function backdateShareLinkExpiry(
  shareLinkId: string,
  daysAgo: number,
): Promise<void> {
  assertTestDatabaseGuard();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() - daysAgo);
  await prisma.shareLink.update({
    where: { id: shareLinkId },
    data: { expiresAt },
  });
}
