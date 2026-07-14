import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcrypt";
import { API_ERROR_CODES, API_PATHS, APP_LIMITS } from "@shared/core/constants";
import { resetTestDatabase, prisma, setTestOtpCodeHash } from "./helpers/db.js";
import { captureAccessToken } from "./helpers/auth.js";
import { createNoteViaUi } from "./helpers/notes.js";

// The Playwright webServer in `playwright.config.ts` always boots `apps/api` on this
// fixed port — direct API calls (bypassing the frontend guard) target it explicitly,
// since Playwright's `request` fixture's own `baseURL` points at the Vite dev server.
const API_ORIGIN = "http://localhost:3000";
const SEARCH_ROOT = API_PATHS.SEARCH.ROOT;
const SEARCH_PATHNAME = `${API_PATHS.BASE}${SEARCH_ROOT}`;

function apiUrl(path: string): string {
  return `${API_ORIGIN}${API_PATHS.BASE}${path}`;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Registers, verifies (via the console-logged-OTP shortcut `setTestOtpCodeHash`), and
 * logs in a brand-new user through the real UI flow — identical mechanics to
 * `auth-journey.spec.ts` / `notes-crud-trash.spec.ts`. Lands on `/notes` (active tab)
 * on success.
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
 * Navigates from the currently-active notes/trash view to `/search` via the
 * `SidebarNav`'s "Search" entry — never a raw `page.goto`, so the in-memory-only
 * `useAuthStore` access token (`[FRS-1.3.5]`) survives the transition.
 */
async function goToSearchPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
}

test.describe("Full-Text Search E2E Coverage ([FRS-4.1–4.5, FRS-7.3])", () => {
  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test("[FRS-4.2, FRS-4.4, FRS-7.3] search returns only the caller's own matching note, with the matched keyword visibly wrapped in a <mark> highlight element in the rendered DOM (not raw JSON/sentinels)", async ({
    page,
  }) => {
    const emailA = "search-user-a@example.com";
    const emailB = "search-user-b@example.com";
    const password = "SecurePassword123!";
    const sharedKeyword = "archipelago";

    await registerVerifyLogin(page, emailA, password);

    const noteAId = await createNoteViaUi(
      page,
      "Alpha Travel Notes",
      `The old lighthouse keeper spoke of a remote ${sharedKeyword} hidden beyond the fog banks, where sailors rarely dared to venture.`,
    );

    // Fixture seeding only, per [Rule 10]/plan.md §4 — never used to fabricate a
    // logged-in session. User B's own note shares the exact same keyword.
    const passwordHashB = await bcrypt.hash("OtherPassword123!", 12);
    const userB = await prisma.user.create({
      data: {
        email: emailB,
        passwordHash: passwordHashB,
        isVerified: true,
      },
    });
    const noteB = await prisma.note.create({
      data: {
        userId: userB.id,
        title: "Beta Travel Notes",
        body: `User B also writes about a remote ${sharedKeyword} on the other side of the world.`,
      },
    });

    // Capture the bearer token now, while still on the `/notes` active-tab
    // view (`captureAccessToken`'s own precondition — it drives the
    // `SortControl` `<select>`, which only exists on that page). The rest of
    // this test then navigates to `/search` and never returns to `/notes`,
    // so the token is captured here and reused below for the direct-API
    // cross-check instead of calling `captureAccessToken` again from `/search`.
    await page.getByRole("link", { name: /Back to notes/ }).click();
    await expect(page).toHaveURL(/\/notes$/);
    const token = await captureAccessToken(page);

    await goToSearchPage(page);
    const searchInput = page.getByLabel("Search notes");
    await searchInput.fill(sharedKeyword);

    // Own-notes-only scope (FRS-4.4): User A's note appears, User B's never does.
    await expect(page.getByText("Alpha Travel Notes")).toBeVisible();
    await expect(page.getByText("Beta Travel Notes")).toHaveCount(0);

    // Rendered-DOM highlight assertion (FRS-4.2, FRS-7.3) — a real <mark> element,
    // not a raw-JSON/sentinel string, per apps/web/CLAUDE.md's XSS-safe splitting
    // contract (SnippetHighlight.tsx never uses dangerouslySetInnerHTML).
    const highlight = page.locator("mark", { hasText: sharedKeyword });
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveJSProperty("tagName", "MARK");

    // Confirm the raw ts_headline sentinels never leak into the rendered document —
    // proving client-side splitting occurred rather than a raw pass-through.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("[[[MARK]]]");
    expect(bodyText).not.toContain("[[[MARK_END]]]");

    // Direct-API cross-check: the same guarantee holds at the contract layer too —
    // the JSON snippet carries the raw sentinels (never HTML), the caller's note id
    // is present, User B's is absent. Reuses the token captured above (while still
    // on the `/notes` active-tab view) — see the comment there.
    const apiRes = await page.request.get(
      apiUrl(`${SEARCH_ROOT}?q=${encodeURIComponent(sharedKeyword)}`),
      { headers: authHeader(token) },
    );
    expect(apiRes.status()).toBe(200);
    const apiBody = (await apiRes.json()).data;
    const resultIds = apiBody.results.map((r: { id: string }) => r.id);
    expect(resultIds).toContain(noteAId);
    expect(resultIds).not.toContain(noteB.id);
    const matchedResult = apiBody.results.find(
      (r: { id: string }) => r.id === noteAId,
    );
    expect(matchedResult.snippet).toContain("[[[MARK]]]");
    expect(matchedResult.snippet).toContain("[[[MARK_END]]]");
  });

  test("[FRS-4.1] empty/whitespace-only query is rejected as a validation error (not 'match everything'); SQL-special-character query returns a safe result with no error/injection side-effect", async ({
    page,
  }) => {
    const email = "search-safety-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.note.create({
      data: {
        userId: user.id,
        title: "Should Never Match Everything",
        body: "This note must not surface for an empty or whitespace query.",
      },
    });

    const searchRequestUrls: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "GET" &&
        new URL(req.url()).pathname === SEARCH_PATHNAME
      ) {
        searchRequestUrls.push(req.url());
      }
    });

    await goToSearchPage(page);
    const searchInput = page.getByLabel("Search notes");

    // Whitespace-only query: the UI never treats it as "match everything" — it
    // renders the pre-search empty state and never even issues a network request
    // (TanStack Query's `enabled` guard short-circuits it), proving the created
    // note above is never returned.
    await searchInput.fill("   ");
    await expect(
      page.getByText("Start typing to search your notes"),
    ).toBeVisible();
    await expect(page.getByText("Should Never Match Everything")).toHaveCount(
      0,
    );
    expect(searchRequestUrls).toHaveLength(0);

    // Same value asserted as a genuine validation error via a direct API call
    // (bypassing the frontend's `enabled` guard entirely) — 400 VALIDATION_ERROR,
    // never a 200 "match everything" response.
    for (const rejectedQuery of ["", "   "]) {
      const res = await page.request.get(
        apiUrl(`${SEARCH_ROOT}?q=${encodeURIComponent(rejectedQuery)}`),
        { headers: authHeader(token) },
      );
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe(
        API_ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // SQL-special-character query: driven through the same UI input. Prisma's
    // parameterized `plainto_tsquery($2, ...)` construction (never string
    // concatenation) means this is treated as ordinary (non-matching) search text,
    // not raw SQL — no error toast, no crash, a syntactically valid empty result.
    await searchInput.fill("%_'--");
    await expect(page.getByText("No results")).toBeVisible();
    await expect(
      page.getByText("We couldn't run your search. Please try again."),
    ).toHaveCount(0);

    const specialCharRes = await page.request.get(
      apiUrl(`${SEARCH_ROOT}?q=${encodeURIComponent("%_'--")}`),
      { headers: authHeader(token) },
    );
    expect(specialCharRes.status()).toBe(200);
    const specialCharBody = (await specialCharRes.json()).data;
    expect(Array.isArray(specialCharBody.results)).toBe(true);
  });

  test("[FRS-4.3, FRS-8.4] every query change issues exactly one fresh GET /api/v1/search request; same page-size rules as the notes list", async ({
    page,
  }) => {
    const email = "search-spy-user@example.com";
    const password = "SecurePassword123!";
    await registerVerifyLogin(page, email, password);
    const token = await captureAccessToken(page);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.note.create({
      data: {
        userId: user.id,
        title: "Octopus Field Notes",
        body: "The octopus camouflaged itself against the reef within seconds.",
      },
    });

    // Boundary check first (pure API, no page-state dependency): search shares the
    // exact same page-size ceiling as the notes list (FRS-4.3 -> FRS-2.3.1).
    const overMaxRes = await page.request.get(
      apiUrl(`${SEARCH_ROOT}?q=octopus&limit=${APP_LIMITS.PAGE_SIZE_MAX + 1}`),
      { headers: authHeader(token) },
    );
    expect(overMaxRes.status()).toBe(400);
    expect((await overMaxRes.json()).error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );

    const defaultLimitRes = await page.request.get(
      apiUrl(`${SEARCH_ROOT}?q=octopus`),
      { headers: authHeader(token) },
    );
    expect(defaultLimitRes.status()).toBe(200);
    const defaultLimitBody = (await defaultLimitRes.json()).data;
    expect(defaultLimitBody.pagination.limit).toBe(
      APP_LIMITS.PAGE_SIZE_DEFAULT,
    );

    // Fresh-request-per-query-change spy (FRS-8.4) — never a client-side re-filter
    // of an already-fetched result set.
    const searchRequestUrls: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "GET" &&
        new URL(req.url()).pathname === SEARCH_PATHNAME
      ) {
        searchRequestUrls.push(req.url());
      }
    });

    await goToSearchPage(page);
    const searchInput = page.getByLabel("Search notes");

    await searchInput.fill("octopus");
    await expect.poll(() => searchRequestUrls.length).toBe(1);
    await expect(page.getByText("Octopus Field Notes")).toBeVisible();

    await searchInput.fill("reef");
    await expect.poll(() => searchRequestUrls.length).toBe(2);

    await searchInput.fill("nonexistentkeywordxyz");
    await expect.poll(() => searchRequestUrls.length).toBe(3);
    await expect(page.getByText("No results")).toBeVisible();

    // Every recorded request carried a distinct `q` value — proving each change
    // triggered its own fresh backend call rather than a shared/cached one.
    const queryValues = searchRequestUrls.map((url) =>
      new URL(url).searchParams.get("q"),
    );
    expect(new Set(queryValues).size).toBe(3);
  });
});
