import path from "node:path";
import dotenv from "dotenv";

// Belt-and-suspenders: vitest.config.ts already loads `.env.test` at config-evaluation
// time; this setupFile guarantees the same env vars are present in every test-file
// worker context too, regardless of vitest's pool implementation.
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
  throw new Error(
    "FATAL SAFETY BREAK: Test suite booted without DATABASE_URL pointing at notes_app_test!",
  );
}
