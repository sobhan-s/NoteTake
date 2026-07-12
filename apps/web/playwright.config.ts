import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dirname, "../../apps/api/.env.test") });

if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
  throw new Error(
    "FATAL SAFETY BREAK: Playwright booted without DATABASE_URL pointing at notes_app_test!",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @apps/api run dev",
      url: "http://localhost:3000/api/v1/docs",
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgresql://postgres:postgres@localhost:5432/notes_app_test?schema=public",
        PORT: "3000",
        JWT_ACCESS_SECRET: "test-jwt-access-secret",
        NODE_ENV: "e2e",
      },
      timeout: 30000,
    },
    {
      command: "pnpm --filter @apps/web run dev --port 5173",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
