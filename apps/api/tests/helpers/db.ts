import { prisma } from "../../src/lib/prisma-client.js";

export { prisma };

/**
 * [Rule 10 / FRS-0.3.3] Runtime safety break — every truncation call re-verifies the
 * active connection string targets the isolated `notes_app_test` database. This guard
 * is duplicated (not just centralized here) inside every contract test file's own
 * `beforeAll`, per the binding template in `AGENTS.md §10` / test-writer rules.
 */
function assertTestDatabaseGuard(): void {
  if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
    throw new Error(
      "FATAL SAFETY BREAK: Truncation attempted outside notes_app_test instance!",
    );
  }
}

/**
 * Truncates every table touched by the AB-1002 auth suites (and their FK-cascaded
 * children) so each test starts from deterministic empty state. Never call this
 * outside the notes_app_test instance.
 */
export async function resetTestDatabase(): Promise<void> {
  assertTestDatabaseGuard();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "otp_codes", "login_attempts", "refresh_sessions", "notes", "tags", "note_tags", "note_versions", "share_links" RESTART IDENTITY CASCADE;',
  );
}
