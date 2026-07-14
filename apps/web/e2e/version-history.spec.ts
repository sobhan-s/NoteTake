import { test, expect, type Page, type Locator } from "@playwright/test";
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
  backdateNoteVersionCreatedAt,
} from "./helpers/db.js";
import { createNoteViaUi } from "./helpers/notes.js";

// Mirrors the fixed-port convention already established in
// `notes-crud-trash.spec.ts` — the Playwright `webServer` always boots
// `apps/api` here, independent of the `request` fixture's own `baseURL`
// (which targets the Vite dev server for page navigation).
const API_ORIGIN = "http://localhost:3000";
const NOTES_ROOT = API_PATHS.NOTES.ROOT;
const VERSIONS_SEGMENT = API_PATHS.NOTES.VERSIONS;

function apiUrl(path: string): string {
  return `${API_ORIGIN}${API_PATHS.BASE}${path}`;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function versionsPath(noteId: string): string {
  return `${NOTES_ROOT}/${noteId}${VERSIONS_SEGMENT}`;
}

/**
 * Registers, verifies (via the console-logged-OTP shortcut `setTestOtpCodeHash`),
 * and logs in a brand-new user through the real UI flow — identical mechanics to
 * `auth-journey.spec.ts` / `notes-crud-trash.spec.ts`. Lands on `/notes` (active
 * tab) on success. Deliberately duplicated here (rather than imported from
 * `notes-crud-trash.spec.ts`) because importing another `*.spec.ts` module would
 * re-register that file's own `test.describe` blocks against *this* file's suite.
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

  await loginOnly(page, email, password);
}

/** Real login-only flow, for the second tab in the cross-context scenario
 * where the user is already registered/verified from the first tab. */
async function loginOnly(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
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
 * Captures the bearer access token from a real outgoing authenticated request
 * (`[FRS-1.3.5]` — never read from storage, since none exists). Caller MUST
 * already be on the `/notes` active-tab view (`SortControl` visible).
 */
async function captureAccessToken(page: Page): Promise<string> {
  const notesListPathname = `${API_PATHS.BASE}${NOTES_ROOT}`;
  const requestPromise = page.waitForRequest(
    (req) =>
      req.method() === "GET" &&
      new URL(req.url()).pathname === notesListPathname,
  );

  const orderSelect = page.locator("#notes-sort-order");
  const currentOrder = await orderSelect.inputValue();
  await orderSelect.selectOption(currentOrder === "asc" ? "desc" : "asc");

  const capturedRequest = await requestPromise;
  const header = capturedRequest.headers()["authorization"];
  if (!header) {
    throw new Error(
      "captureAccessToken: no Authorization header found on GET /api/v1/notes",
    );
  }
  return header.replace(/^Bearer\s+/i, "");
}

async function returnToNotesList(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Back to notes/ }).click();
  await expect(page).toHaveURL(/\/notes$/);
}

/** Explicit save via the real `Ctrl+S` keyboard shortcut, per `[FRS-6.1]`. */
async function explicitSaveWithBodyEdit(
  page: Page,
  noteId: string,
  appendText: string,
  expectedVersionCountAfter: number,
): Promise<void> {
  const editorBody = page.locator('[contenteditable="true"]');
  await editorBody.click();
  await editorBody.pressSequentially(appendText);
  await page.keyboard.press("Control+S");

  await expect
    .poll(async () => prisma.noteVersion.count({ where: { noteId } }), {
      timeout: 8000,
    })
    .toBe(expectedVersionCountAfter);
}

/** Types into the body without ever pressing Ctrl+S, waiting for the
 * debounced autosave PATCH to actually land server-side. */
async function autosaveEditAndWaitForPersist(
  page: Page,
  noteId: string,
  appendText: string,
): Promise<void> {
  const editorBody = page.locator('[contenteditable="true"]');
  await editorBody.click();
  await editorBody.pressSequentially(appendText);

  await expect
    .poll(
      async () => {
        const note = await prisma.note.findUnique({ where: { id: noteId } });
        return note?.body ?? "";
      },
      { timeout: 8000 },
    )
    .toContain(appendText);
}

async function openVersionHistoryDrawer(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Version history" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("listitem").first()).toBeVisible();
  return dialog;
}

test.describe("Version History E2E Coverage ([FRS-6.1–6.5])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("[FRS-6.1] two explicit Ctrl+S saves each create a version immediately; two autosave-eligible edits inside the same throttle window produce at most one additional version", async ({
    page,
  }) => {
    const email = "explicit-vs-autosave@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Explicit Save Note",
      "Version one body.",
    );

    // Note creation itself always snapshots version 1 server-side.
    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }))
      .toBe(1);

    // Two explicit Ctrl+S saves within 5 minutes — both bypass the throttle.
    await explicitSaveWithBodyEdit(page, noteId, " Explicit edit one.", 2);
    await explicitSaveWithBodyEdit(page, noteId, " Explicit edit two.", 3);

    const explicitDialog = await openVersionHistoryDrawer(page);
    await expect(explicitDialog.getByRole("listitem")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const versionCountBeforeAutosave = 3;

    // Two autosave-eligible (debounced, non-explicit) edits, both landing well
    // inside the same `VERSION_SNAPSHOT_THROTTLE_MINUTES` window as the version
    // just created above — per FRS-6.1 this SHALL NOT double-snapshot.
    await autosaveEditAndWaitForPersist(page, noteId, " Auto edit one.");
    await autosaveEditAndWaitForPersist(page, noteId, " Auto edit two.");

    const versionCountAfterAutosave = await prisma.noteVersion.count({
      where: { noteId },
    });

    // FRS-6.1 ceiling: at most 1 additional version for the 2 throttled edits
    // (strictly fewer than the 2 versions the 2 explicit saves produced above).
    expect(versionCountAfterAutosave).toBeLessThanOrEqual(
      versionCountBeforeAutosave + 1,
    );
    // Actual observed throttle behavior for edits landing inside the window
    // immediately following a fresh explicit save: zero additional versions.
    expect(versionCountAfterAutosave).toBe(versionCountBeforeAutosave);

    const autosaveDialog = await openVersionHistoryDrawer(page);
    await expect(autosaveDialog.getByRole("listitem")).toHaveCount(
      versionCountAfterAutosave,
    );
  });

  test("[FRS-6.2, FRS-6.3, FRS-6.4, FRS-7.4] drawer renders newest-first; older-entry preview is read-only before any mutating control; confirmed restore updates the editor and is append-only", async ({
    page,
  }) => {
    const email = "reverse-chrono-restore@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Version Alpha",
      "Alpha body content.",
    );
    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }))
      .toBe(1);

    // Version 1 was snapshotted at creation with whatever `title`/`body` the
    // `POST` payload carried at that instant — commonly an empty body, since
    // the title's own debounced autosave fires before the (slower) body text
    // finishes being typed/persisted. A body-only autosave PATCH landing
    // inside `VERSION_SNAPSHOT_THROTTLE_MINUTES` never creates/updates any
    // `NoteVersion` row (no "merge into latest snapshot" path exists), so
    // version 1 would otherwise stay stuck with an empty-body snapshot
    // forever. Force one explicit Ctrl+S save right now — after
    // `createNoteViaUi`'s own poll already confirmed the real body landed
    // server-side — to create a clean checkpoint version 2, still titled
    // "Version Alpha" but correctly carrying "Alpha body content.".
    await page.keyboard.press("Control+S");
    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }))
      .toBe(2);

    // Explicit "title change" save — FRS-6.1's other named explicit-save
    // trigger besides Ctrl+S — produces version 3 (the new live version).
    const titleInput = page.getByLabel("Note title");
    await titleInput.fill("Version Beta");
    await titleInput.blur();
    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }))
      .toBe(3);

    const dialog = await openVersionHistoryDrawer(page);
    const items = dialog.getByRole("listitem");
    await expect(items).toHaveCount(3);
    // Newest-first (`[FRS-6.2]`): version 3 ("Version Beta"), version 2
    // ("Version Alpha", real body — the explicit-save checkpoint), version 1
    // ("Version Alpha", empty body — never selected by this test).
    await expect(items.nth(0)).toContainText("Version Beta");
    await expect(items.nth(1)).toContainText("Version Alpha");

    // Select the older entry deterministically by position — `hasText`
    // filtering alone is ambiguous here since both version 1 and version 2
    // share the same "Version Alpha" `titleSnapshot`. `nth(1)` is version 2,
    // the checkpoint carrying the real body.
    await items.nth(1).click();

    // Full read-only preview renders before any mutating control is reachable
    // (`[FRS-6.3, FRS-7.4]`) — no toolbar buttons (Bold/Italic/etc.) exist in
    // this preview pane, only the single gated "Restore this version" entry
    // point, which itself requires a further confirm step.
    await expect(
      dialog.getByRole("heading", { name: "Version Alpha" }),
    ).toBeVisible();
    await expect(dialog.getByText("Alpha body content.")).toBeVisible();
    const restoreTrigger = dialog.getByRole("button", {
      name: "Restore this version",
    });
    await expect(restoreTrigger).toBeVisible();

    // Nothing is mutated merely by previewing or clicking the trigger — only
    // the subsequent explicit confirm applies the change.
    await restoreTrigger.click();
    const noteBeforeConfirm = await prisma.note.findUniqueOrThrow({
      where: { id: noteId },
    });
    expect(noteBeforeConfirm.title).toBe("Version Beta");

    const confirmDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Restore Version" });
    await expect(
      confirmDialog.getByRole("heading", { name: "Restore Version" }),
    ).toBeVisible();
    await confirmDialog
      .getByRole("button", { name: "Restore", exact: true })
      .click();

    await expect(page.getByText(UI_COPY.VERSION_RESTORE_SUCCESS)).toBeVisible();

    // Editor reflects the restored content (`[FRS-6.4]`).
    await expect(page.getByLabel("Note title")).toHaveValue("Version Alpha");
    await expect(page.locator('[contenteditable="true"]')).toContainText(
      "Alpha body content.",
    );

    // Append-only: a new version is appended at the top; prior list length is
    // `original + 1`, never `original` (`[FRS-6.4]`).
    const reopenedDialog = await openVersionHistoryDrawer(page);
    const reopenedItems = reopenedDialog.getByRole("listitem");
    await expect(reopenedItems).toHaveCount(4);

    // Every version that existed before the restore remains individually
    // viewable — spot-check the "Version Beta" entry and (below) the
    // "Version Alpha" entries, confirming no "unavailable" state renders.
    await reopenedItems.filter({ hasText: "Version Beta" }).click();
    await expect(
      reopenedDialog.getByText(UI_COPY.VERSION_UNAVAILABLE),
    ).toHaveCount(0);
    await expect(
      reopenedDialog.getByRole("heading", { name: "Version Beta" }),
    ).toBeVisible();
    await reopenedDialog
      .getByRole("button", { name: "← Back to list" })
      .click();

    const originalAlphaEntries = reopenedItems.filter({
      hasText: "Version Alpha",
    });
    // 2 pre-existing "Version Alpha" entries (version 1 empty-body + version 2
    // real-body checkpoint) + 1 restore-created copy = 3.
    await expect(originalAlphaEntries).toHaveCount(3);
    await originalAlphaEntries.first().click();
    await expect(
      reopenedDialog.getByText(UI_COPY.VERSION_UNAVAILABLE),
    ).toHaveCount(0);
    await expect(reopenedDialog.getByText("Alpha body content.")).toBeVisible();
  });

  test("[FRS-6.5] a non-latest version backdated past VERSION_RETENTION_DAYS and purged renders unavailable; the live version and other fresh versions remain viewable", async ({
    page,
    request,
  }) => {
    const email = "purge-boundary@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Purge Boundary Note",
      "Body version A.",
    );
    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }))
      .toBe(1);

    // Version B becomes the live/latest version via an explicit Ctrl+S save.
    await explicitSaveWithBodyEdit(page, noteId, " Body version B (live).", 2);

    const versions = await prisma.noteVersion.findMany({
      where: { noteId },
      orderBy: { createdAt: "desc" },
    });
    const versionBLive = versions[0]!;
    const versionAOlder = versions[1]!;

    // Back-date the non-latest version only — never the row with the
    // greatest `createdAt` for this noteId (`[FRS-6.5]` live-version
    // exemption; see `backdateNoteVersionCreatedAt`'s doc comment).
    await backdateNoteVersionCreatedAt(
      versionAOlder.id,
      APP_LIMITS.VERSION_RETENTION_DAYS + 1,
    );

    // The nightly cleanup job (`apps/api/src/jobs/cleanup.job.ts`) is the only
    // mechanism that ever physically removes a purge-eligible version — the
    // read path itself performs no age check (confirmed against
    // `note-version.service.ts`/`note-version.repository.ts`). This ticket's
    // own Out-of-Scope explicitly forbids invoking `cleanup.job.ts` from
    // Playwright, so the guaranteed post-purge DB state (already proven
    // correct at the supertest layer by `cleanup.versions-purge.test.ts`) is
    // reproduced directly here via `prisma`, without running the job itself.
    await prisma.noteVersion.delete({ where: { id: versionAOlder.id } });

    await returnToNotesList(page);
    const token = await captureAccessToken(page);

    const staleRes = await request.get(
      apiUrl(`${versionsPath(noteId)}/${versionAOlder.id}`),
      { headers: authHeader(token) },
    );
    expect(staleRes.status()).toBe(404);
    expect((await staleRes.json()).error.code).toBe(
      API_ERROR_CODES.VERSION_NOT_FOUND,
    );

    const liveRes = await request.get(
      apiUrl(`${versionsPath(noteId)}/${versionBLive.id}`),
      { headers: authHeader(token) },
    );
    expect(liveRes.status()).toBe(200);
    expect((await liveRes.json()).data.bodySnapshot).toContain(
      "Body version B (live).",
    );

    // UI-level confirmation: the purged version no longer appears in the
    // list at all, and the live version remains fully viewable.
    await page.getByText("Purge Boundary Note", { exact: true }).click();
    const dialog = await openVersionHistoryDrawer(page);
    await expect(dialog.getByRole("listitem")).toHaveCount(1);
    await dialog.getByRole("listitem").first().click();
    await expect(dialog.getByText(UI_COPY.VERSION_UNAVAILABLE)).toHaveCount(0);
    await expect(dialog.getByText("Body version B (live).")).toBeVisible();
  });

  test("[FRS-6 Error Scenarios] restoring a version on a since-trashed note from a second authenticated tab is rejected 404 and surfaced via the mapApiError toast path", async ({
    page,
    browser,
  }) => {
    const email = "cross-tab-restore@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);

    const noteId = await createNoteViaUi(
      page,
      "Cross Tab Note",
      "Original body.",
    );
    await expect
      .poll(async () => prisma.noteVersion.count({ where: { noteId } }))
      .toBe(1);

    // A second version so there is an older, non-live entry to select and
    // attempt to restore from tab B.
    await explicitSaveWithBodyEdit(page, noteId, " Original body edited.", 2);
    await returnToNotesList(page);

    // Tab B: same user, a second real (re-)authenticated session/context —
    // sharing the underlying user/session data server-side, per plan.md's
    // explicitly-sanctioned "re-authenticate both tabs" approach.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await loginOnly(pageB, email, password);

    await pageB.getByText("Cross Tab Note", { exact: true }).click();
    await expect(pageB).toHaveURL(new RegExp(`/notes/${noteId}$`));

    const dialogB = await openVersionHistoryDrawer(pageB);
    const olderEntry = dialogB
      .getByRole("listitem")
      .filter({ hasText: "Cross Tab Note" })
      .last();
    await olderEntry.click();
    await expect(
      dialogB.getByRole("button", { name: "Restore this version" }),
    ).toBeVisible();

    // Tab A: trash the note while tab B's stale preview is still open.
    await page.getByText("Cross Tab Note", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));
    await page.getByRole("button", { name: "Delete note" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/notes$/);

    await expect
      .poll(async () => {
        const note = await prisma.note.findUniqueOrThrow({
          where: { id: noteId },
        });
        return note.deletedAt;
      })
      .not.toBeNull();

    // Tab B: attempt to restore the still-open preview's version.
    await dialogB.getByRole("button", { name: "Restore this version" }).click();
    const confirmDialogB = pageB
      .getByRole("dialog")
      .filter({ hasText: "Restore Version" });
    await confirmDialogB
      .getByRole("button", { name: "Restore", exact: true })
      .click();

    // Rejected 404 NOTE_NOT_FOUND, surfaced via `mapApiError`'s toast path
    // (never a silent failure).
    await expect(
      pageB.getByText("This note is no longer available."),
    ).toBeVisible();

    const noteRow = await prisma.note.findUniqueOrThrow({
      where: { id: noteId },
    });
    expect(noteRow.deletedAt).not.toBeNull();
    expect(await prisma.noteVersion.count({ where: { noteId } })).toBe(2);

    await contextB.close();
  });
});
