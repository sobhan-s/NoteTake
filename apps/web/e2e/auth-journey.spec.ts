import { test, expect } from "@playwright/test";
import { resetTestDatabase, prisma, setTestOtpCodeHash } from "./helpers/db.js";

test.describe("Auth Journey ([FRS-1.1–1.4])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("full register -> verify -> login -> /notes -> logout journey", async ({
    page,
  }) => {
    const email = "journey@example.com";
    const password = "SecurePassword123!";

    // 1. Register
    await page.goto("/register");
    await expect(page.locator("h1")).toHaveText("Create your account");

    await page.fill('input[name="email"]', email);
    await page.locator('input[name="email"]').blur();
    await page.fill('input[name="password"]', password);
    await page.locator('input[name="password"]').blur();

    const registerSubmit = page.locator('button[type="submit"]');
    await expect(registerSubmit).toBeEnabled();
    await registerSubmit.click();

    // Should navigate to /verify-otp
    await expect(page).toHaveURL(/\/verify-otp/);
    await expect(page.locator("h1")).toHaveText("Verify your email");

    // Retrieve OTP record created by backend and set known hash
    let otpId: string | undefined;
    await expect
      .poll(async () => {
        const otp = await prisma.otpCode.findFirst({
          where: { user: { email } },
          orderBy: { createdAt: "desc" },
        });
        otpId = otp?.id;
        return otpId;
      })
      .not.toBeUndefined();

    const knownCode = await setTestOtpCodeHash(otpId!);

    // 2. Verify OTP
    await page.fill('input[name="code"]', knownCode);
    await page.locator('input[name="code"]').blur();

    const verifySubmit = page.locator('button:has-text("Verify")');
    await expect(verifySubmit).toBeEnabled();
    await verifySubmit.click();

    // Should navigate to /login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("h1")).toHaveText("Welcome back");

    // 3. Login
    await page.fill('input[name="email"]', email);
    await page.locator('input[name="email"]').blur();
    await page.fill('input[name="password"]', password);
    await page.locator('input[name="password"]').blur();

    const loginSubmit = page.locator('button[type="submit"]');
    await expect(loginSubmit).toBeEnabled();
    await loginSubmit.click();

    // Should navigate to /notes
    await expect(page).toHaveURL(/\/notes/);
    await expect(page.locator("h1")).toHaveText(`Welcome, ${email}`);

    // 4. Logout
    await page.click('button:has-text("Logout")');

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/);
  });
});
