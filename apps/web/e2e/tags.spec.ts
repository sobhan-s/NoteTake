import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import bcrypt from "bcrypt";
import { API_ERROR_CODES, API_PATHS } from "@shared/core/constants";
import { resetTestDatabase, prisma, setTestOtpCodeHash } from "./helpers/db.js";
import { captureAccessToken } from "./helpers/auth.js";
import { createNoteViaUi } from "./helpers/notes.js";

// Same fixed-port convention as `notes-crud-trash.spec.ts` — the Playwright
// `webServer` always boots `apps/api` here; direct API calls (used wherever no
// shipped UI affordance exists — see file-level note below) target it explicitly.
const API_ORIGIN = "http://localhost:3000";
const NOTES_ROOT = API_PATHS.NOTES.ROOT;
const TAGS_ROOT = API_PATHS.TAGS.ROOT;

function apiUrl(path: string): string {
  return `${API_ORIGIN}${API_PATHS.BASE}${path}`;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Registers, verifies (via the console-logged-OTP shortcut `setTestOtpCodeHash`),
 * and logs in a brand-new user through the real UI flow — identical mechanics to
 * `auth-journey.spec.ts` / `notes-crud-trash.spec.ts`. Lands on `/notes` (active
 * tab) on success.
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

/**
 * Drives the note editor's `TagCombobox` (`aria-label="Add a tag"`) through its
 * "create new tag" affordance — the single Fly Tag creation surface shipped today
 * (see the file-level note on the missing filter-bar combobox instance). Attaches
 * inline via `useNoteAutosave`'s explicit-save path with zero page navigation.
 */
async function createTagAndAttachViaUi(
  page: Page,
  tagName: string,
): Promise<void> {
  const combobox = page.getByLabel("Add a tag");
  await combobox.fill(tagName);
  await page
    .getByRole("button", { name: `Create new tag: '${tagName}'` })
    .click();
  await expect(
    page.getByLabel("Attached tags").getByText(tagName, { exact: true }),
  ).toBeVisible();
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

/**
 * Forces `NotesPage` to fully unmount and remount (via a round trip through
 * `/search`), so TanStack Query's zero-`staleTime` default refetches `useTags()`
 * against rows mutated directly via the API/`prisma` after the page's first mount
 * (identical technique to `notes-crud-trash.spec.ts`).
 */
async function remountNotesPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByRole("button", { name: "Active Notes" }).click();
  await expect(page).toHaveURL(/\/notes$/);
}

async function getTagNoteCount(
  request: APIRequestContext,
  token: string,
  tagId: string,
): Promise<number> {
  const res = await request.get(apiUrl(TAGS_ROOT), {
    headers: authHeader(token),
  });
  const found = (
    (await res.json()).data.tags as Array<{ id: string; noteCount: number }>
  ).find((t) => t.id === tagId);
  return found?.noteCount ?? -1;
}

test.describe("Tags & Fly Tag E2E Coverage ([FRS-3.1–3.4])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("[FRS-3.1, FRS-3.3] tag create (Fly Tag)/rename/recolor/delete scoped to the owning user; delete detaches from the note without deleting it", async ({
    page,
    request,
  }) => {
    const email = "tag-crud-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Note With A Tag",
      "Body content for tagging.",
    );
    const urlBeforeTagCreate = page.url();

    // Fly Tag creation: typed directly into the editor's combobox and attached
    // inline, with zero navigation to any separate tag-management surface (none
    // ships today — confirmed by inspecting apps/web/src, see file-level note).
    await createTagAndAttachViaUi(page, "Work");
    expect(page.url()).toBe(urlBeforeTagCreate);

    await returnToNotesList(page);
    const token = await captureAccessToken(page);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const tag = await prisma.tag.findFirstOrThrow({
      where: { userId: user.id, name: "Work" },
    });

    // Rename + recolor: no rename/recolor affordance ships in `apps/web/src`
    // today (grepped — zero components beyond `TagCombobox` create-only and
    // `TagFilterControl` toggle-only), so these are asserted via the real
    // `PATCH /api/v1/tags/:id` contract directly, using the token captured from
    // a real authenticated session (never a fabricated one).
    const renameRes = await request.patch(apiUrl(`${TAGS_ROOT}/${tag.id}`), {
      headers: authHeader(token),
      data: { name: "Deep Work", color: "#EF4444" },
    });
    expect(renameRes.status()).toBe(200);
    const renamed = (await renameRes.json()).data;
    expect(renamed.name).toBe("Deep Work");
    expect(renamed.color).toBe("#EF4444");

    // Reflected back to the owner: `TagFilterControl` (the only other surface
    // that reads tag names) shows the renamed tag on next fetch, never the
    // stale name.
    await remountNotesPage(page);
    await expect(
      page.getByRole("button", { name: "Deep Work", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Work", exact: true }),
    ).toHaveCount(0);

    // Delete detaches from the note without deleting it (FRS-3.3).
    const deleteRes = await request.delete(apiUrl(`${TAGS_ROOT}/${tag.id}`), {
      headers: authHeader(token),
    });
    expect(deleteRes.status()).toBe(200);
    expect((await deleteRes.json()).data).toEqual({ id: tag.id });

    const noteAfterTagDelete = await prisma.note.findUniqueOrThrow({
      where: { id: noteId },
    });
    expect(noteAfterTagDelete.title).toBe("Note With A Tag");
    expect(noteAfterTagDelete.body).toContain("Body content for tagging.");
    expect(noteAfterTagDelete.deletedAt).toBeNull();

    const remainingJoins = await prisma.noteTag.findMany({
      where: { noteId },
    });
    expect(remainingJoins).toHaveLength(0);

    await remountNotesPage(page);
    await expect(
      page.getByRole("button", { name: "Deep Work", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Note With A Tag", { exact: true }),
    ).toBeVisible();
  });

  test("[FRS-3.2] tag noteCount updates live across attach -> trash -> restore -> detach in one continuous session", async ({
    page,
    request,
  }) => {
    const email = "tag-count-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    await createNoteViaUi(page, "Countable Note", "Body for counting.");
    const noteId = new URL(page.url()).pathname.split("/").pop()!;
    await createTagAndAttachViaUi(page, "Lifecycle");

    await returnToNotesList(page);
    const token = await captureAccessToken(page);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const tag = await prisma.tag.findFirstOrThrow({
      where: { userId: user.id, name: "Lifecycle" },
    });

    // 1. Attach (already performed above via the editor) -> count 1.
    expect(await getTagNoteCount(request, token, tag.id)).toBe(1);

    // 2. Trash the note via the real UI trash action -> count 0.
    await page.getByRole("button", { name: "Move note to trash" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect.poll(() => getTagNoteCount(request, token, tag.id)).toBe(0);

    // 3. Restore via the real UI restore action -> count 1.
    await goToTrashTab(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Restore Note" }).click();
    await expect.poll(() => getTagNoteCount(request, token, tag.id)).toBe(1);

    // 4. Detach via a direct API call — no detach affordance ships in the
    // editor UI today (`TagCombobox`/`Badge` render attached tags with no
    // remove control) -> count 0.
    const detachRes = await request.patch(apiUrl(`${NOTES_ROOT}/${noteId}`), {
      headers: authHeader(token),
      data: { tagIds: [] },
    });
    expect(detachRes.status()).toBe(200);
    expect(await getTagNoteCount(request, token, tag.id)).toBe(0);
  });

  test("[FRS-3.4] duplicate tag name differing only by case is rejected 409 TAG_NAME_CONFLICT; cross-user tag delete is rejected 404 TAG_NOT_FOUND", async ({
    page,
    request,
  }) => {
    const email = "tag-conflict-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    // Note: driving this through `TagCombobox` itself would never surface a
    // 409 — the component silently swallows `TAG_NAME_CONFLICT` and attaches
    // the pre-existing tag instead (see `createAndAttach`'s catch branch in
    // `apps/web/src/components/editor/TagCombobox.tsx`). The 409 contract is
    // therefore only observable via a direct API call, exactly like the
    // invalid-`tagMode` case in `notes-crud-trash.spec.ts`.
    const firstRes = await request.post(apiUrl(TAGS_ROOT), {
      headers: authHeader(token),
      data: { name: "Work" },
    });
    expect(firstRes.status()).toBe(201);

    const duplicateRes = await request.post(apiUrl(TAGS_ROOT), {
      headers: authHeader(token),
      data: { name: "WORK" },
    });
    expect(duplicateRes.status()).toBe(409);
    expect((await duplicateRes.json()).error.code).toBe(
      API_ERROR_CODES.TAG_NAME_CONFLICT,
    );
    expect(await prisma.tag.count()).toBe(1);

    // Cross-user delete: seed User B's tag directly via `prisma.tag.create`,
    // never as a substitute for real authentication.
    const otherPasswordHash = await bcrypt.hash("OtherPassword123!", 12);
    const userB = await prisma.user.create({
      data: {
        email: "tag-conflict-userb@example.com",
        passwordHash: otherPasswordHash,
        isVerified: true,
      },
    });
    const tagB = await prisma.tag.create({
      data: { userId: userB.id, name: "User B Secret Tag" },
    });

    const crossDeleteRes = await request.delete(
      apiUrl(`${TAGS_ROOT}/${tagB.id}`),
      { headers: authHeader(token) },
    );
    expect(crossDeleteRes.status()).toBe(404);
    expect((await crossDeleteRes.json()).error.code).toBe(
      API_ERROR_CODES.TAG_NOT_FOUND,
    );

    const stillExists = await prisma.tag.findUniqueOrThrow({
      where: { id: tagB.id },
    });
    expect(stillExists.userId).toBe(userB.id);
  });
});
