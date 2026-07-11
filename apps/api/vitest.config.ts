import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Load `.env.test` BEFORE any test file (or the src modules they import) evaluate
// `process.env.DATABASE_URL` / `process.env.JWT_ACCESS_SECRET` at import time
// (e.g. apps/api/src/constants/api.constants.ts reads JWT_ACCESS_SECRET eagerly).
dotenv.config({ path: path.resolve(dirname, ".env.test") });

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // FRS-0.3.3 / Rule 10: contract suites truncate shared tables in notes_app_test between
    // tests. Running test files in parallel workers would race on the same tables, so all
    // suites in this workspace execute serially (one file at a time).
    fileParallelism: false,
    setupFiles: [path.resolve(dirname, "tests/setup.ts")],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/services/auth.service.ts",
        "src/services/token.service.ts",
        "src/services/otp.service.ts",
        "src/repositories/auth.repository.ts",
        "src/controllers/auth.controller.ts",
        "src/routers/auth.router.ts",
        "src/middlewares/require-auth.middleware.ts",
        "src/middlewares/check-login-rate-limit.middleware.ts",
        "src/middlewares/error.middleware.ts",
        "src/services/note.service.ts",
        "src/repositories/note.repository.ts",
        "src/controllers/note.controller.ts",
        "src/routers/note.router.ts",
        "src/jobs/cleanup.job.ts",
      ],
    },
  },
});
