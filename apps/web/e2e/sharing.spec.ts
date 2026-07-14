import {
  test,
  expect,
  request as apiRequestFactory,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import {
  API_ERROR_CODES,
  API_PATHS,
  APP_LIMITS,
  UI_COPY,
} from "@shared/core/constants";
import {
  resetTestDatabase,
  prisma,
  setTestOtpCodeHash,
  backdateShareLinkExpiry,
} from "./helpers/db.js";
import { captureAccessToken } from "./helpers/auth.js";
import { createNoteViaUi } from "./helpers/notes.js";

// Matches the fixed port the Playwright `webServer` boots `apps/api` on
// (identical convention to `notes-crud-trash.spec.ts`) — direct API calls bypassing
// the frontend guard target it explicitly.
const API_ORIGIN = "http://localhost:3000";
const NOTES_ROOT = API_PATHS.NOTES.ROOT;
const SHARE_SUFFIX = API_PATHS.NOTES.SHARE;
const PUBLIC_SHARE_ROOT = `${API_PATHS.PUBLIC.ROOT}${API_PATHS.PUBLIC.SHARE}`;

// Arbitrary fan-out count for the concurrency assertion — not an FRS-mandated
// numeric limit (unlike `APP_LIMITS.*`), so it is a plain literal here.
const CONCURRENT_VIEW_REQUESTS = 10;

function apiUrl(path: string): string {
  return `${API_ORIGIN}${API_PATHS.BASE}${path}`;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Registers, verifies (via the console-logged-OTP shortcut `setTestOtpCodeHash`), and
 * logs in a brand-new user through the real UI flow — identical mechanics to
 * `auth-journey.spec.ts` / `notes-crud-trash.spec.ts`.
 */
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

/**
 * Creates a note directly via the real API (bypassing the editor UI) — used for
 * sharing-domain scenarios where the note's content itself is not under test, only
 * its share-link lifecycle, matching the plan's "pure HTTP-layer test" framing.
 */
async function createNoteViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
  bodyText: string,
): Promise<string> {
  const res = await request.post(apiUrl(NOTES_ROOT), {
    headers: authHeader(token),
    data: { title, body: bodyText },
  });
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

interface ShareLinkApiDto {
  noteId: string;
  token: string;
  expiresAt: string;
  viewCount: number;
  createdAt: string;
}

async function createShareLinkViaApi(
  request: APIRequestContext,
  token: string,
  noteId: string,
  expiresInDays?: number,
): Promise<ShareLinkApiDto> {
  const res = await request.post(
    apiUrl(`${NOTES_ROOT}/${noteId}${SHARE_SUFFIX}`),
    {
      headers: authHeader(token),
      data: expiresInDays === undefined ? {} : { expiresInDays },
    },
  );
  const body = (await res.json()) as { data: ShareLinkApiDto };
  return body.data;
}

async function getShareLinkViaApi(
  request: APIRequestContext,
  token: string,
  noteId: string,
): Promise<ShareLinkApiDto> {
  const res = await request.get(
    apiUrl(`${NOTES_ROOT}/${noteId}${SHARE_SUFFIX}`),
    { headers: authHeader(token) },
  );
  const body = (await res.json()) as { data: ShareLinkApiDto };
  return body.data;
}

test.describe("Sharing & Atomic View-Count E2E Coverage ([FRS-5])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("[FRS-5.2] default (7d) and custom (1-30d) expiry generate successfully via ShareModal; expiresInDays 0 or above max rejected via a direct API call", async ({
    page,
    request,
  }) => {
    const email = "share-expiry-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteAId = await createNoteViaUi(
      page,
      "Default Expiry Note",
      "Body for the default-expiry share link.",
    );

    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    const shareUrlInputA = page.locator("#share-link-url");
    await expect(shareUrlInputA).toHaveValue(/\/share\//);
    await page.getByRole("button", { name: "Close" }).click();

    await returnToNotesList(page);
    const tokenAfterNoteA = await captureAccessToken(page);

    const defaultLink = await getShareLinkViaApi(
      request,
      tokenAfterNoteA,
      noteAId,
    );
    const expectedDefaultExpiryMs =
      Date.now() + APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS * 86_400_000;
    expect(
      Math.abs(
        new Date(defaultLink.expiresAt).getTime() - expectedDefaultExpiryMs,
      ),
    ).toBeLessThan(300_000);

    const noteBId = await createNoteViaUi(
      page,
      "Custom Expiry Note",
      "Body for the custom-expiry share link.",
    );
    const customExpiryDays = APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS + 5;

    await page.getByRole("button", { name: "Share note" }).click();
    await page.locator("#share-expiry-days").fill(String(customExpiryDays));
    await page.getByRole("button", { name: "Create Link" }).click();
    const shareUrlInputB = page.locator("#share-link-url");
    await expect(shareUrlInputB).toHaveValue(/\/share\//);
    await page.getByRole("button", { name: "Close" }).click();

    await returnToNotesList(page);
    const tokenAfterNoteB = await captureAccessToken(page);

    const customLink = await getShareLinkViaApi(
      request,
      tokenAfterNoteB,
      noteBId,
    );
    const expectedCustomExpiryMs = Date.now() + customExpiryDays * 86_400_000;
    expect(
      Math.abs(
        new Date(customLink.expiresAt).getTime() - expectedCustomExpiryMs,
      ),
    ).toBeLessThan(300_000);

    const belowMinRes = await request.post(
      apiUrl(`${NOTES_ROOT}/${noteBId}${SHARE_SUFFIX}`),
      {
        headers: authHeader(tokenAfterNoteB),
        data: { expiresInDays: 0 },
      },
    );
    expect(belowMinRes.status()).toBe(400);
    expect((await belowMinRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );

    const aboveMaxRes = await request.post(
      apiUrl(`${NOTES_ROOT}/${noteBId}${SHARE_SUFFIX}`),
      {
        headers: authHeader(tokenAfterNoteB),
        data: { expiresInDays: APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS + 1 },
      },
    );
    expect(aboveMaxRes.status()).toBe(400);
    expect((await aboveMaxRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );
  });

  test('[FRS-5.3] manual revoke ("Revoke" -> ConfirmModal heading="Revoke Public Share Link" -> confirm) makes the public URL immediately render unavailable', async ({
    page,
    browser,
  }) => {
    const email = "share-revoke-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    await createNoteViaUi(
      page,
      "Revoke Me Note",
      "Body content that will be revoked.",
    );

    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    const shareUrlInput = page.locator("#share-link-url");
    await expect(shareUrlInput).toHaveValue(/\/share\//);
    const shareUrl = await shareUrlInput.inputValue();
    const shareToken = shareUrl.split("/share/")[1];

    await page.getByRole("button", { name: "Revoke" }).click();
    const confirmDialog = page.getByRole("dialog", {
      name: "Revoke Public Share Link",
    });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Revoke" }).click();
    await expect(confirmDialog).toHaveCount(0);

    // ShareModal's own query is invalidated on revoke success — it falls back to
    // the "generate a new link" form, proving no active link remains.
    await expect(page.locator("#share-expiry-days")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/share/${shareToken}`);
    await expect(
      anonPage.getByRole("heading", { name: "Link unavailable" }),
    ).toBeVisible();
    await expect(
      anonPage.getByText(UI_COPY.SHARE_LINK_UNAVAILABLE),
    ).toBeVisible();
    await anonContext.close();
  });

  test("[FRS-5.4] 10 concurrent unauthenticated public-share visits SHALL all be counted atomically (owner-visible viewCount equals exactly the fan-out count)", async ({
    page,
    request,
  }) => {
    const email = "share-concurrency-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    const noteId = await createNoteViaApi(
      request,
      token,
      "Concurrency Note",
      "Body visited concurrently by anonymous viewers.",
    );
    const link = await createShareLinkViaApi(request, token, noteId);

    const anonApiContext = await apiRequestFactory.newContext();
    try {
      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_VIEW_REQUESTS }, () =>
          anonApiContext.get(apiUrl(`${PUBLIC_SHARE_ROOT}/${link.token}`)),
        ),
      );
      for (const res of responses) {
        expect(res.status()).toBe(200);
      }
    } finally {
      await anonApiContext.dispose();
    }

    const afterViews = await getShareLinkViaApi(request, token, noteId);
    expect(afterViews.viewCount).toBe(CONCURRENT_VIEW_REQUESTS);
  });

  test("[FRS-5.6] POST /api/v1/notes/:id/share on an already-trashed note SHALL be rejected 404 NOTE_NOT_FOUND", async ({
    page,
    request,
  }) => {
    const email = "share-trashed-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    const noteId = await createNoteViaApi(
      request,
      token,
      "About To Be Trashed",
      "This note will be trashed before a share link is attempted.",
    );

    const trashRes = await request.delete(apiUrl(`${NOTES_ROOT}/${noteId}`), {
      headers: authHeader(token),
    });
    expect(trashRes.status()).toBe(200);

    const shareRes = await request.post(
      apiUrl(`${NOTES_ROOT}/${noteId}${SHARE_SUFFIX}`),
      { headers: authHeader(token), data: {} },
    );
    expect(shareRes.status()).toBe(404);
    expect((await shareRes.json()).error.code).toBe(
      API_ERROR_CODES.NOTE_NOT_FOUND,
    );
  });

  test('[FRS-5.6] expired (backdated), revoked (UI), and trashed share links SHALL render byte-identical "no longer available" content across separate fresh unauthenticated contexts', async ({
    page,
    browser,
    request,
  }) => {
    const email = "share-identical-unavailable-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    // Link 1: allowed to expire via the deterministic backdating helper.
    const expiredNoteId = await createNoteViaApi(
      request,
      token,
      "Expired Link Note",
      "Body for the expired share link.",
    );
    const expiredLink = await createShareLinkViaApi(
      request,
      token,
      expiredNoteId,
    );
    const expiredLinkRow = await prisma.shareLink.findUniqueOrThrow({
      where: { token: expiredLink.token },
    });
    await backdateShareLinkExpiry(expiredLinkRow.id, 1);

    // Link 2: manually revoked through the real ShareModal UI.
    await createNoteViaUi(
      page,
      "Revoked Link Note",
      "Body for the manually revoked share link.",
    );
    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    const revokedShareUrlInput = page.locator("#share-link-url");
    await expect(revokedShareUrlInput).toHaveValue(/\/share\//);
    const revokedShareUrl = await revokedShareUrlInput.inputValue();
    const revokedToken = revokedShareUrl.split("/share/")[1];

    await page.getByRole("button", { name: "Revoke" }).click();
    const confirmDialog = page.getByRole("dialog", {
      name: "Revoke Public Share Link",
    });
    await confirmDialog.getByRole("button", { name: "Revoke" }).click();
    await expect(confirmDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();

    // Link 3: orphaned by trashing its note.
    await returnToNotesList(page);
    const tokenForTrashLink = await captureAccessToken(page);
    const trashedNoteId = await createNoteViaApi(
      request,
      tokenForTrashLink,
      "Trashed Link Note",
      "Body for the note that will be trashed.",
    );
    const trashedLink = await createShareLinkViaApi(
      request,
      tokenForTrashLink,
      trashedNoteId,
    );
    const trashRes = await request.delete(
      apiUrl(`${NOTES_ROOT}/${trashedNoteId}`),
      { headers: authHeader(tokenForTrashLink) },
    );
    expect(trashRes.status()).toBe(200);

    async function renderedUnavailableText(
      shareToken: string,
    ): Promise<string> {
      const context = await browser.newContext();
      const anonPage = await context.newPage();
      await anonPage.goto(`/share/${shareToken}`);
      await expect(
        anonPage.getByRole("heading", { name: "Link unavailable" }),
      ).toBeVisible();
      const text = await anonPage.locator("body").innerText();
      await context.close();
      return text;
    }

    const expiredText = await renderedUnavailableText(expiredLink.token);
    const revokedText = await renderedUnavailableText(revokedToken);
    const trashedText = await renderedUnavailableText(trashedLink.token);

    expect(revokedText).toBe(expiredText);
    expect(trashedText).toBe(expiredText);
  });

  test("[FRS-5.5] an anonymous context on a valid share URL shows no edit control, no owner-identity text, and no navigation to any other note", async ({
    page,
    browser,
    request,
  }) => {
    const email = "share-readonly-owner@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    const noteId = await createNoteViaApi(
      request,
      token,
      "Read-Only Public Note",
      "Body that must render strictly read-only in the public view.",
    );
    const link = await createShareLinkViaApi(request, token, noteId);

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/share/${link.token}`);

    await expect(
      anonPage.getByRole("heading", { name: "Read-Only Public Note" }),
    ).toBeVisible();

    await expect(anonPage.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(anonPage.getByLabel("Note title")).toHaveCount(0);
    await expect(
      anonPage.getByRole("button", { name: "Share note" }),
    ).toHaveCount(0);
    await expect(
      anonPage.getByRole("button", { name: "Delete note" }),
    ).toHaveCount(0);
    await expect(
      anonPage.getByRole("button", { name: "Version history" }),
    ).toHaveCount(0);
    await expect(anonPage.getByRole("link")).toHaveCount(0);
    await expect(anonPage.getByText(email)).toHaveCount(0);

    await anonContext.close();
  });
});
