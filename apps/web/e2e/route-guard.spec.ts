import { test, expect } from "@playwright/test";
import { resetTestDatabase, prisma } from "./helpers/db.js";
import bcrypt from "bcrypt";

test.describe("Route Guard & Navigation ([Protected route guard & navigation scenario])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("unauthenticated /notes redirect + ?next= honored post-login", async ({
    page,
  }) => {
    const email = "guarduser@example.com";
    const password = "GuardPassword123!";

    // Seed verified user
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        isVerified: true,
      },
    });

    // 1. Visit protected /notes while unauthenticated
    await page.goto("/notes");

    // Should redirect to /login with next parameter
    await expect(page).toHaveURL(
      /\/login\?next=%2Fnotes|\/login\?next=\/notes/,
    );
    await expect(page.locator("h1")).toHaveText("Welcome back");

    // 2. Login
    await page.fill('input[name="email"]', email);
    await page.locator('input[name="email"]').blur();
    await page.fill('input[name="password"]', password);
    await page.locator('input[name="password"]').blur();

    const loginSubmit = page.locator('button[type="submit"]');
    await expect(loginSubmit).toBeEnabled();
    await loginSubmit.click();

    // 3. Should honor next parameter and land directly on /notes
    await expect(page).toHaveURL(/\/notes/);
    await expect(page.locator("h1")).toHaveText(`Welcome, ${email}`);
  });
});
