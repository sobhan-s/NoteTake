import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcrypt";
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
  backdateNoteDeletedAt,
} from "./helpers/db.js";
import { captureAccessToken } from "./helpers/auth.js";
import { createNoteViaUi } from "./helpers/notes.js";

// The Playwright webServer in `playwright.config.ts` always boots `apps/api` on this
// fixed port — direct API calls (bypassing the frontend guard) target it explicitly,
// since Playwright's `request` fixture's own `baseURL` points at the Vite dev server.
const API_ORIGIN = "http://localhost:3000";
const NOTES_ROOT = API_PATHS.NOTES.ROOT;

function apiUrl(path: string): string {
  return `${API_ORIGIN}${API_PATHS.BASE}${path}`;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Registers, verifies (via the console-logged-OTP shortcut `setTestOtpCodeHash`), and
 * logs in a brand-new user through the real UI flow — identical mechanics to
 * `auth-journey.spec.ts`. Lands on `/notes` (active tab) on success.
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

/**
 * Forces `NotesPage` to fully unmount and remount (via a round trip through
 * `/search`), so TanStack Query's zero-`staleTime` default refetches `useTags()`
 * against rows seeded directly via `prisma` after the page's first mount.
 */
async function remountNotesPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByRole("button", { name: "Active Notes" }).click();
  await expect(page).toHaveURL(/\/notes$/);
}

test.describe("Notes CRUD & Two-Stage Trash E2E Coverage ([FRS-2.1, FRS-2.2])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("[FRS-2.1.6] create/update reflect persisted title/body via the UI; over-cap title/body rejected via a direct API call bypassing the frontend guard", async ({
    page,
    request,
  }) => {
    const email = "caps-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Original Title",
      "Original body content.",
    );

    const titleInput = page.getByLabel("Note title");
    await expect(titleInput).toHaveValue("Original Title");

    await titleInput.fill("Updated Title");
    await titleInput.blur();

    await expect
      .poll(async () => {
        const persisted = await prisma.note.findUnique({
          where: { id: noteId },
        });
        return persisted?.title;
      })
      .toBe("Updated Title");

    // Round-trip through the UI to prove the update is server-persisted, not just
    // held in uncommitted local component state.
    await returnToNotesList(page);
    await expect(
      page.getByText("Updated Title", { exact: true }),
    ).toBeVisible();
    await page.getByText("Updated Title", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));
    await expect(page.getByLabel("Note title")).toHaveValue("Updated Title");

    await returnToNotesList(page);
    const token = await captureAccessToken(page);

    const overCapTitleRes = await request.patch(
      apiUrl(`${NOTES_ROOT}/${noteId}`),
      {
        headers: authHeader(token),
        data: { title: "A".repeat(APP_LIMITS.NOTE_TITLE_MAX_CHARS + 1) },
      },
    );
    expect(overCapTitleRes.status()).toBe(400);
    expect((await overCapTitleRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );

    const overCapBodyRes = await request.patch(
      apiUrl(`${NOTES_ROOT}/${noteId}`),
      {
        headers: authHeader(token),
        data: { body: "A".repeat(APP_LIMITS.NOTE_BODY_MAX_CHARS + 1) },
      },
    );
    expect(overCapBodyRes.status()).toBe(400);
    expect((await overCapBodyRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );

    const unchanged = await prisma.note.findUniqueOrThrow({
      where: { id: noteId },
    });
    expect(unchanged.title).toBe("Updated Title");
  });

  test("[FRS-2.1.5] empty or whitespace-only title rejected on both create and update; nothing persisted", async ({
    page,
    request,
  }) => {
    const email = "empty-title@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    for (const title of ["", "   "]) {
      const createRes = await request.post(apiUrl(NOTES_ROOT), {
        headers: authHeader(token),
        data: { title, body: "Some body" },
      });
      expect(createRes.status()).toBe(400);
      expect((await createRes.json()).error.code).toBe(
        API_ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const countAfterCreateAttempts = await prisma.note.count();
    expect(countAfterCreateAttempts).toBe(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const note = await prisma.note.create({
      data: { userId: user.id, title: "Keep Me", body: "Keep body" },
    });

    for (const title of ["", "   "]) {
      const updateRes = await request.patch(
        apiUrl(`${NOTES_ROOT}/${note.id}`),
        {
          headers: authHeader(token),
          data: { title },
        },
      );
      expect(updateRes.status()).toBe(400);
      expect((await updateRes.json()).error.code).toBe(
        API_ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const unchangedNote = await prisma.note.findUniqueOrThrow({
      where: { id: note.id },
    });
    expect(unchangedNote.title).toBe("Keep Me");
  });

  test("[FRS-2.1.2] cross-user GET/PATCH/DELETE on another user's note id returns 404 NOTE_NOT_FOUND, never 403", async ({
    page,
    request,
  }) => {
    const email = "user-a-idor@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    const otherPasswordHash = await bcrypt.hash("OtherPassword123!", 12);
    const userB = await prisma.user.create({
      data: {
        email: "user-b-idor@example.com",
        passwordHash: otherPasswordHash,
        isVerified: true,
      },
    });
    const noteB = await prisma.note.create({
      data: { userId: userB.id, title: "User B Secret", body: "Secret body" },
    });

    const getRes = await request.get(apiUrl(`${NOTES_ROOT}/${noteB.id}`), {
      headers: authHeader(token),
    });
    expect(getRes.status()).toBe(404);
    expect((await getRes.json()).error.code).toBe(
      API_ERROR_CODES.NOTE_NOT_FOUND,
    );

    const patchRes = await request.patch(apiUrl(`${NOTES_ROOT}/${noteB.id}`), {
      headers: authHeader(token),
      data: { title: "Hijacked Title" },
    });
    expect(patchRes.status()).toBe(404);
    expect((await patchRes.json()).error.code).toBe(
      API_ERROR_CODES.NOTE_NOT_FOUND,
    );

    const deleteRes = await request.delete(
      apiUrl(`${NOTES_ROOT}/${noteB.id}`),
      { headers: authHeader(token) },
    );
    expect(deleteRes.status()).toBe(404);
    expect((await deleteRes.json()).error.code).toBe(
      API_ERROR_CODES.NOTE_NOT_FOUND,
    );

    const stillOwnedByB = await prisma.note.findUniqueOrThrow({
      where: { id: noteB.id },
    });
    expect(stillOwnedByB.userId).toBe(userB.id);
    expect(stillOwnedByB.title).toBe("User B Secret");
    expect(stillOwnedByB.deletedAt).toBeNull();
  });

  test("[FRS-2.2.1, FRS-2.2.2, FRS-2.2.3] Stage 1 delete disappears from active list and appears in Trash; direct edit rejected 404; Restore returns it unchanged", async ({
    page,
    request,
  }) => {
    const email = "stage1-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Trash Me Please",
      "Body content that must survive a restore.",
    );
    await returnToNotesList(page);

    await page.getByRole("button", { name: "Move note to trash" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();

    await expect(
      page.getByText("Trash Me Please", { exact: true }),
    ).toHaveCount(0);

    await goToTrashTab(page);
    await expect(
      page.getByText("Trash Me Please", { exact: true }),
    ).toBeVisible();

    const token = await (async () => {
      await goToActiveTab(page);
      return captureAccessToken(page);
    })();

    const directEditRes = await request.patch(
      apiUrl(`${NOTES_ROOT}/${noteId}`),
      {
        headers: authHeader(token),
        data: { title: "Should Not Apply" },
      },
    );
    expect(directEditRes.status()).toBe(404);
    expect((await directEditRes.json()).error.code).toBe(
      API_ERROR_CODES.NOTE_NOT_FOUND,
    );

    await goToTrashTab(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Restore Note" }).click();

    await goToActiveTab(page);
    await expect(
      page.getByText("Trash Me Please", { exact: true }),
    ).toBeVisible();

    const restored = await prisma.note.findUniqueOrThrow({
      where: { id: noteId },
    });
    expect(restored.title).toBe("Trash Me Please");
    expect(restored.deletedAt).toBeNull();
  });

  test("[FRS-2.2.5, FRS-2.2.6] Stage 2 (backdated 31+ days): invisible in Trash, restore 404s, row still audit-retained in the DB", async ({
    page,
    request,
  }) => {
    const email = "stage2-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Stage Two Note",
      "This note will be backdated past Stage 1.",
    );
    await returnToNotesList(page);
    const token = await captureAccessToken(page);

    const trashRes = await request.delete(apiUrl(`${NOTES_ROOT}/${noteId}`), {
      headers: authHeader(token),
    });
    expect(trashRes.status()).toBe(200);

    await backdateNoteDeletedAt(noteId, APP_LIMITS.TRASH_STAGE_1_DAYS + 1);

    await goToTrashTab(page);
    await expect(page.getByText("Stage Two Note", { exact: true })).toHaveCount(
      0,
    );

    const restoreRes = await request.post(
      apiUrl(`${NOTES_ROOT}/${noteId}${API_PATHS.NOTES.RESTORE}`),
      { headers: authHeader(token) },
    );
    expect(restoreRes.status()).toBe(404);
    expect((await restoreRes.json()).error.code).toBe(
      API_ERROR_CODES.NOTE_NOT_FOUND,
    );

    const stillInDb = await prisma.note.findUniqueOrThrow({
      where: { id: noteId },
    });
    expect(stillInDb.deletedAt).not.toBeNull();
    expect(stillInDb.title).toBe("Stage Two Note");
  });

  test("[FRS-2.2.8] Delete Forever requires explicit confirmation with Cancel default-focused, then immediately and permanently removes the note", async ({
    page,
  }) => {
    const email = "delete-forever-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    await createNoteViaUi(
      page,
      "Permanently Doomed Note",
      "This will be deleted forever.",
    );
    await returnToNotesList(page);

    await page.getByRole("button", { name: "Move note to trash" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();

    await goToTrashTab(page);
    await page.getByRole("button", { name: "Delete forever" }).click();

    await expect(
      page.getByRole("heading", { name: "Permanent Delete Note" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.getByRole("button", { name: "Delete Forever" }).click();

    await expect(
      page.getByText("Permanently Doomed Note", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);
  });

  test("[FRS-2.2.4] trashing a note breaks its share link live (viewCount frozen); restore does not resurrect the old token; a new link produces a different token", async ({
    page,
    browser,
  }) => {
    const email = "share-breaks-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    await createNoteViaUi(
      page,
      "Shared Then Trashed Note",
      "Content that will be shared and then trashed.",
    );

    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    const shareUrlInput = page.locator("#share-link-url");
    await expect(shareUrlInput).toHaveValue(/\/share\//);
    const firstShareUrl = await shareUrlInput.inputValue();
    const firstToken = firstShareUrl.split("/share/")[1];
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Delete note" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/notes$/);

    const firstContext = await browser.newContext();
    const firstAnonPage = await firstContext.newPage();
    await firstAnonPage.goto(`/share/${firstToken}`);
    await expect(
      firstAnonPage.getByRole("heading", { name: "Link unavailable" }),
    ).toBeVisible();
    await expect(
      firstAnonPage.getByText(UI_COPY.SHARE_LINK_UNAVAILABLE),
    ).toBeVisible();
    await firstContext.close();

    const linkAfterTrashVisit = await prisma.shareLink.findUniqueOrThrow({
      where: { token: firstToken },
    });
    expect(linkAfterTrashVisit.viewCount).toBe(0);

    await goToTrashTab(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Restore Note" }).click();
    await goToActiveTab(page);
    await expect(
      page.getByText("Shared Then Trashed Note", { exact: true }),
    ).toBeVisible();

    const secondContext = await browser.newContext();
    const secondAnonPage = await secondContext.newPage();
    await secondAnonPage.goto(`/share/${firstToken}`);
    await expect(
      secondAnonPage.getByRole("heading", { name: "Link unavailable" }),
    ).toBeVisible();
    await secondContext.close();

    await page.getByText("Shared Then Trashed Note", { exact: true }).click();
    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    const secondShareUrlInput = page.locator("#share-link-url");
    await expect(secondShareUrlInput).toHaveValue(/\/share\//);
    const secondShareUrl = await secondShareUrlInput.inputValue();
    const secondToken = secondShareUrl.split("/share/")[1];

    expect(secondToken).not.toBe(firstToken);
  });
});

test.describe("Pagination, Sorting, and Tag-Filter E2E Coverage ([FRS-2.3])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("[FRS-2.3.1, FRS-2.3.4] default/max page size and stable createdAt-desc tiebreaker across repeated + paginated calls; over-max limit rejected", async ({
    page,
    request,
  }) => {
    const email = "pagination-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = await captureAccessToken(page);

    const totalNotes = APP_LIMITS.PAGE_SIZE_DEFAULT + 1;
    const now = Date.now();
    const created = await prisma.note.createManyAndReturn({
      data: Array.from({ length: totalNotes }, (_, index) => ({
        userId: user.id,
        title: "Tied Title",
        body: `Body ${index}`,
        createdAt: new Date(now - index * 1000),
        updatedAt: new Date(now - index * 1000),
      })),
    });
    const sortedByCreatedAtDesc = [...created].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const expectedPage1Ids = sortedByCreatedAtDesc
      .slice(0, APP_LIMITS.PAGE_SIZE_DEFAULT)
      .map((n) => n.id);
    const expectedPage2Ids = sortedByCreatedAtDesc
      .slice(APP_LIMITS.PAGE_SIZE_DEFAULT)
      .map((n) => n.id);

    const listUrl = (pageNum: number): string =>
      apiUrl(
        `${NOTES_ROOT}?sort=title&order=desc&page=${pageNum}&limit=${APP_LIMITS.PAGE_SIZE_DEFAULT}`,
      );

    const page1Res = await request.get(listUrl(1), {
      headers: authHeader(token),
    });
    expect(page1Res.status()).toBe(200);
    const page1Body = (await page1Res.json()).data;
    expect(page1Body.notes).toHaveLength(APP_LIMITS.PAGE_SIZE_DEFAULT);
    expect(page1Body.pagination.total).toBe(totalNotes);
    expect(page1Body.pagination.totalPages).toBe(2);
    expect(page1Body.notes.map((n: { id: string }) => n.id)).toEqual(
      expectedPage1Ids,
    );

    const page1RepeatRes = await request.get(listUrl(1), {
      headers: authHeader(token),
    });
    const page1RepeatBody = (await page1RepeatRes.json()).data;
    expect(page1RepeatBody.notes.map((n: { id: string }) => n.id)).toEqual(
      page1Body.notes.map((n: { id: string }) => n.id),
    );

    const page2Res = await request.get(listUrl(2), {
      headers: authHeader(token),
    });
    const page2Body = (await page2Res.json()).data;
    expect(page2Body.notes).toHaveLength(1);
    expect(page2Body.notes.map((n: { id: string }) => n.id)).toEqual(
      expectedPage2Ids,
    );

    const overMaxRes = await request.get(
      apiUrl(`${NOTES_ROOT}?limit=${APP_LIMITS.PAGE_SIZE_MAX + 1}`),
      { headers: authHeader(token) },
    );
    expect(overMaxRes.status()).toBe(400);
    expect((await overMaxRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );
  });

  test("[FRS-2.3.3] tagMode defaults to ALL with no explicit param; explicit ANY switches to OR semantics; invalid tagMode rejected via direct API only", async ({
    page,
    request,
  }) => {
    const email = "tagmode-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = await captureAccessToken(page);

    const tagAlpha = await prisma.tag.create({
      data: { userId: user.id, name: "Alpha" },
    });
    const tagBeta = await prisma.tag.create({
      data: { userId: user.id, name: "Beta" },
    });

    const noteAlphaOnly = await prisma.note.create({
      data: {
        userId: user.id,
        title: "Alpha Only Note",
        body: "x",
        noteTags: { create: [{ tagId: tagAlpha.id }] },
      },
    });
    const noteBetaOnly = await prisma.note.create({
      data: {
        userId: user.id,
        title: "Beta Only Note",
        body: "x",
        noteTags: { create: [{ tagId: tagBeta.id }] },
      },
    });
    const noteBoth = await prisma.note.create({
      data: {
        userId: user.id,
        title: "Both Tags Note",
        body: "x",
        noteTags: {
          create: [{ tagId: tagAlpha.id }, { tagId: tagBeta.id }],
        },
      },
    });

    const bothTagIds = `${tagAlpha.id},${tagBeta.id}`;

    const defaultRes = await request.get(
      apiUrl(`${NOTES_ROOT}?tagIds=${bothTagIds}`),
      { headers: authHeader(token) },
    );
    const defaultBody = (await defaultRes.json()).data;
    expect(defaultBody.notes.map((n: { id: string }) => n.id).sort()).toEqual(
      [noteBoth.id].sort(),
    );

    const anyRes = await request.get(
      apiUrl(`${NOTES_ROOT}?tagIds=${bothTagIds}&tagMode=ANY`),
      { headers: authHeader(token) },
    );
    const anyBody = (await anyRes.json()).data;
    expect(anyBody.notes.map((n: { id: string }) => n.id).sort()).toEqual(
      [noteAlphaOnly.id, noteBetaOnly.id, noteBoth.id].sort(),
    );

    const invalidModeRes = await request.get(
      apiUrl(`${NOTES_ROOT}?tagIds=${tagAlpha.id}&tagMode=SOMETHING`),
      { headers: authHeader(token) },
    );
    expect(invalidModeRes.status()).toBe(400);
    expect((await invalidModeRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );

    // UI: prove the same semantics are reachable through TagFilterControl.
    await remountNotesPage(page);
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    await page.getByRole("button", { name: "Beta", exact: true }).click();

    await expect(
      page.getByText("Both Tags Note", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Alpha Only Note", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Beta Only Note", { exact: true })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "Match any" }).click();
    await expect(
      page.getByText("Alpha Only Note", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Beta Only Note", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Both Tags Note", { exact: true }),
    ).toBeVisible();
  });

  test("[FRS-8.4] every sort field/direction/tag-filter change on the notes list issues exactly one fresh GET /api/v1/notes request", async ({
    page,
  }) => {
    const email = "spy-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.tag.create({ data: { userId: user.id, name: "Spy Tag" } });

    const notesListRequestUrls: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "GET" &&
        new URL(req.url()).pathname === `${API_PATHS.BASE}${NOTES_ROOT}`
      ) {
        notesListRequestUrls.push(req.url());
      }
    });

    await remountNotesPage(page);
    await expect
      .poll(() => notesListRequestUrls.length)
      .toBeGreaterThanOrEqual(1);
    const baseline = notesListRequestUrls.length;

    await page.selectOption("#notes-sort-field", "title");
    await expect.poll(() => notesListRequestUrls.length).toBe(baseline + 1);

    await page.selectOption("#notes-sort-order", "asc");
    await expect.poll(() => notesListRequestUrls.length).toBe(baseline + 2);

    await page.getByRole("button", { name: "Spy Tag", exact: true }).click();
    await expect.poll(() => notesListRequestUrls.length).toBe(baseline + 3);

    await page.getByRole("button", { name: "Spy Tag", exact: true }).click();
    await expect.poll(() => notesListRequestUrls.length).toBe(baseline + 4);
  });
});
