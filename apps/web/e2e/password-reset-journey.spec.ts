import { test, expect } from "@playwright/test";
import { resetTestDatabase, prisma, setTestOtpCodeHash } from "./helpers/db.js";
import bcrypt from "bcrypt";

test.describe("Password Reset Journey ([FRS-1.5.1–1.5.6])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("forgot -> reset -> forced re-login journey", async ({ page }) => {
    const email = "resetuser@example.com";
    const oldPassword = "OldPassword123!";
    const newPassword = "NewPassword456!";

    // Seed verified user
    const passwordHash = await bcrypt.hash(oldPassword, 12);
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        isVerified: true,
      },
    });

    // 1. Forgot password request
    await page.goto("/forgot-password");
    await expect(page.locator("h1")).toHaveText("Forgot your password?");

    await page.fill('input[name="email"]', email);
    await page.locator('input[name="email"]').blur();

    const forgotSubmit = page.locator('button[type="submit"]');
    await expect(forgotSubmit).toBeEnabled();
    await forgotSubmit.click();

    // Should display success message or navigate to reset-password
    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.locator("h1")).toHaveText("Reset your password");

    // Retrieve reset OTP from DB and set known hash
    let otpId: string | undefined;
    await expect
      .poll(async () => {
        const otp = await prisma.otpCode.findFirst({
          where: { user: { email }, type: "PASSWORD_RESET" },
          orderBy: { createdAt: "desc" },
        });
        otpId = otp?.id;
        return otpId;
      })
      .not.toBeUndefined();

    const knownCode = await setTestOtpCodeHash(otpId!);

    // 2. Reset password
    await page.fill('input[name="code"]', knownCode);
    await page.locator('input[name="code"]').blur();
    await page.fill('input[name="newPassword"]', newPassword);
    await page.locator('input[name="newPassword"]').blur();
    await page.fill('input[name="confirmPassword"]', newPassword);
    await page.locator('input[name="confirmPassword"]').blur();

    const resetSubmit = page.locator('button:has-text("Reset password")');
    await expect(resetSubmit).toBeEnabled();
    await resetSubmit.click();

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/);

    // 3. Login with new password
    await page.fill('input[name="email"]', email);
    await page.locator('input[name="email"]').blur();
    await page.fill('input[name="password"]', newPassword);
    await page.locator('input[name="password"]').blur();

    const loginSubmit = page.locator('button[type="submit"]');
    await expect(loginSubmit).toBeEnabled();
    await loginSubmit.click();

    // Should successfully access /notes
    await expect(page).toHaveURL(/\/notes/);
    await expect(page.locator("h1")).toHaveText(`Welcome, ${email}`);
  });
});
