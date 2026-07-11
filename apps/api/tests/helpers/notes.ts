import type { Note } from "@prisma/client";
import { API_PATHS } from "@shared/core/constants";
import { app, createVerifiedUser, loginTestUser } from "./auth.js";
import { prisma } from "./db.js";

export { app };

const NOTES_BASE = `${API_PATHS.BASE}${API_PATHS.NOTES.ROOT}`;

export const ROUTES = {
  NOTES_ROOT: NOTES_BASE,
  noteById: (id: string): string => `${NOTES_BASE}/${id}`,
  restore: (id: string): string =>
    `${NOTES_BASE}/${id}${API_PATHS.NOTES.RESTORE}`,
  permanent: (id: string): string =>
    `${NOTES_BASE}/${id}${API_PATHS.NOTES.PERMANENT}`,
} as const;

/** Directly seeds a `Note` row via Prisma (bypassing the HTTP layer entirely) so
 * contract/unit suites can construct exact fixtures — active, Stage-1-trashed at any
 * age, or Stage-2-trashed at any age — that would otherwise require chained real
 * requests plus manual clock manipulation to reach. `deletedAt` is settable directly
 * (no DB default) so callers can place a note precisely on either side of the
 * 30-day/60-day boundaries. */
export async function createNoteDirect(
  userId: string,
  overrides: {
    title?: string;
    body?: string;
    deletedAt?: Date | null;
  } = {},
): Promise<Note> {
  return prisma.note.create({
    data: {
      userId,
      title: overrides.title ?? "Fixture Note Title",
      body: overrides.body ?? "Fixture note body content.",
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

/** Returns a `Date` exactly `days` days (plus optional extra `ms`) in the past —
 * used to place fixture notes precisely at/around the Stage-1/Stage-2 boundaries. */
export function daysAgo(days: number, extraMs = 0): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - extraMs);
}

/** Registers+logs-in a fresh verified user via the real HTTP auth endpoints and
 * returns the bearer access token, mirroring the `createVerifiedUser` +
 * `loginTestUser` composition already used inline by `auth.me.test.ts`, so every
 * notes contract suite can obtain an authenticated caller in one call. */
export async function createAuthedUser(
  email: string,
): Promise<{ userId: string; accessToken: string }> {
  const { id: userId } = await createVerifiedUser(email);
  const login = await loginTestUser(email);
  if (!login.accessToken) {
    throw new Error(`Failed to obtain access token for ${email}`);
  }
  return { userId, accessToken: login.accessToken };
}
