import { test, expect, type Page, type Locator } from "@playwright/test";
import { UI_COPY } from "@shared/core/constants";
import { resetTestDatabase, prisma, setTestOtpCodeHash } from "./helpers/db.js";
import { createNoteViaUi } from "./helpers/notes.js";

async function registerVerifyLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/register");
  await page.fill('input[name="email"]', email);
  await page.locator('input[name="email"]').blur();
  await page.fill('input[name="password"]', password);
  await page.locator('input[name="password"]').blur();

  const registerSubmit = page.locator('button[type="submit"]');
  await expect(registerSubmit).toBeEnabled();
  await registerSubmit.click();

  await expect(page).toHaveURL(/\/verify-otp/);

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

  await page.fill('input[name="code"]', knownCode);
  await page.locator('input[name="code"]').blur();
  const verifySubmit = page.locator('button:has-text("Verify")');
  await expect(verifySubmit).toBeEnabled();
  await verifySubmit.click();

  await expect(page).toHaveURL(/\/login/);

  await page.fill('input[name="email"]', email);
  await page.locator('input[name="email"]').blur();
  await page.fill('input[name="password"]', password);
  await page.locator('input[name="password"]').blur();
  const loginSubmit = page.locator('button[type="submit"]');
  await expect(loginSubmit).toBeEnabled();
  await loginSubmit.click();

  await expect(page).toHaveURL(/\/notes$/);
}

async function returnToNotesList(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Back to notes/ }).click();
  await expect(page).toHaveURL(/\/notes$/);
}

async function goToTrashTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Trash" }).click();
  await expect(page.getByRole("tab", { name: "Trash" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function goToActiveTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Active" }).click();
  await expect(page.getByRole("tab", { name: "Active" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function openVersionHistoryDrawer(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Version history" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("listitem").first()).toBeVisible();
  return dialog;
}

test.describe("Full Continuous User Journey E2E Coverage ([FRS-2.1–FRS-2.3, FRS-3, FRS-4, FRS-5, FRS-6, FRS-7])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("single continuous authenticated user journey through register, create, tag, autosave, version history, search, share, trash, restore, and permanent delete", async ({
    page,
    browser,
  }) => {
    const email = "journey-user@example.com";
    const password = "SecurePassword123!";

    // 1. Register -> OTP-verify -> Login
    await registerVerifyLogin(page, email, password);

    // 2. Create note
    const noteId = await createNoteViaUi(
      page,
      "Journey Note",
      "First journey version body.",
    );

    // 3. Attach Fly Tag
    const combobox = page.getByLabel("Add a tag");
    await combobox.fill("JourneyTag");
    await page
      .getByRole("button", { name: "Create new tag: 'JourneyTag'" })
      .click();
    await expect(
      page.getByLabel("Attached tags").getByText("JourneyTag", { exact: true }),
    ).toBeVisible();

    // 4. Observe autosave "Saved" indicator
    await expect(page.getByText(UI_COPY.AUTOSAVE_SAVED)).toBeVisible();

    // 5. Explicit save (`Ctrl+S`)
    const editorBody = page.locator('[contenteditable="true"]');
    await editorBody.click();
    await page.keyboard.press("Control+S");

    // 6. Open Version History drawer and confirm versions exist
    const dialog = await openVersionHistoryDrawer(page);
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 7. Search by keyword and see it highlighted
    await returnToNotesList(page);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search$/);
    await page.getByLabel("Search notes").fill("journey");
    await expect(page.getByText("Journey Note")).toBeVisible();
    await expect(
      page.locator("mark", { hasText: "journey" }).first(),
    ).toBeVisible();

    // Reopen the note from the search result
    await page.getByText("Journey Note", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));

    // 8. Generate a share link and confirm read-only public rendering
    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    const shareUrlInput = page.locator("#share-link-url");
    await expect(shareUrlInput).toHaveValue(/\/share\//);
    const shareUrl = await shareUrlInput.inputValue();
    const token = shareUrl.split("/share/")[1]!;
    await page.getByRole("button", { name: "Close" }).click();

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/share/${token}`);
    await expect(
      anonPage.getByRole("heading", { name: "Journey Note" }),
    ).toBeVisible();
    await expect(
      anonPage.getByText("First journey version body."),
    ).toBeVisible();
    await expect(anonPage.locator('[contenteditable="true"]')).toHaveCount(0);
    await anonContext.close();

    // 9. Trash the note and confirm the share link breaks immediately
    await page.getByRole("button", { name: "Delete note" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/notes$/);

    const anonContextAfterTrash = await browser.newContext();
    const anonPageAfterTrash = await anonContextAfterTrash.newPage();
    await anonPageAfterTrash.goto(`/share/${token}`);
    await expect(
      anonPageAfterTrash.getByRole("heading", { name: "Link unavailable" }),
    ).toBeVisible();
    await expect(
      anonPageAfterTrash.getByText(UI_COPY.SHARE_LINK_UNAVAILABLE),
    ).toBeVisible();
    await anonContextAfterTrash.close();

    // 10. Restore from Trash
    await goToTrashTab(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Restore Note" }).click();
    await goToActiveTab(page);
    await expect(page.getByText("Journey Note", { exact: true })).toBeVisible();

    // 11. Edit again (second version)
    await page.getByText("Journey Note", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));
    await editorBody.click();
    await editorBody.pressSequentially(" Second journey version edit.");
    await page.keyboard.press("Control+S");

    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }), {
        timeout: 8000,
      })
      .toBe(3);

    // 12. Restore the first version and confirm content reverts while the second version remains queryable
    const dialogAfterSecondEdit = await openVersionHistoryDrawer(page);
    const listItems = dialogAfterSecondEdit.getByRole("listitem");
    // Select the older checkpoint version (nth(1)) which carries the real initial body
    await listItems.nth(1).click();
    await expect(
      dialogAfterSecondEdit.getByRole("button", {
        name: "Restore this version",
      }),
    ).toBeVisible();
    await dialogAfterSecondEdit
      .getByRole("button", { name: "Restore this version" })
      .click();

    const confirmRestoreDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Restore Version" });
    await confirmRestoreDialog
      .getByRole("button", { name: "Restore", exact: true })
      .click();

    await expect(page.getByText(UI_COPY.VERSION_RESTORE_SUCCESS)).toBeVisible();
    await expect(editorBody).toContainText("First journey version body.");
    await expect(editorBody).not.toContainText("Second journey version edit.");

    // Verify the version history still retains the second edit snapshot (nth(1) in newest-first list after restore appended a copy at nth(0))
    const dialogAfterRestore = await openVersionHistoryDrawer(page);
    await dialogAfterRestore.getByRole("listitem").nth(1).click();
    await expect(
      dialogAfterRestore.getByText(UI_COPY.VERSION_UNAVAILABLE),
    ).toHaveCount(0);
    await expect(
      dialogAfterRestore.getByText("Second journey version edit."),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // 13. Permanently delete a separate throwaway note with explicit confirmation
    await returnToNotesList(page);
    await createNoteViaUi(
      page,
      "Throwaway Note",
      "Will be permanently deleted.",
    );
    await returnToNotesList(page);

    const throwawayCard = page
      .locator("div.rounded-lg.border")
      .filter({ has: page.getByRole("heading", { name: "Throwaway Note" }) });
    await throwawayCard
      .getByRole("button", { name: "Move note to trash" })
      .click();
    await page.getByRole("button", { name: "Move to Trash" }).click();

    await goToTrashTab(page);
    const throwawayTrashCard = page
      .locator("div.rounded-lg.border")
      .filter({ has: page.getByRole("heading", { name: "Throwaway Note" }) });
    await throwawayTrashCard
      .getByRole("button", { name: "Delete forever" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Permanent Delete Note" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.getByRole("button", { name: "Delete Forever" }).click();
    await expect(page.getByText("Throwaway Note", { exact: true })).toHaveCount(
      0,
    );

    // 14. Log out
    await goToActiveTab(page);
    await page.click('button:has-text("Logout")');
    await expect(page).toHaveURL(/\/login/);
  });
});
