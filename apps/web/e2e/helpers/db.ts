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
