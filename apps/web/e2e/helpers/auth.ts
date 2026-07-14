import type { Page } from "@playwright/test";
import { API_PATHS } from "@shared/core/constants";

const NOTES_LIST_PATHNAME = `${API_PATHS.BASE}${API_PATHS.NOTES.ROOT}`;

/**
 * Captures the bearer access token from a real outgoing authenticated request via
 * `page.waitForRequest` (`[FRS-1.3.5]` — never read from storage, since none exists).
 * Caller MUST already be on the `/notes` active-tab view (`SortControl` visible):
 * toggling the sort-direction `<select>` forces a fresh `GET /api/v1/notes` request
 * without any full-page reload, which would otherwise discard the in-memory-only
 * access token (`useAuthStore`) and bounce the session to `/login`.
 *
 * Lives in `e2e/helpers/` (not inside any `*.spec.ts` file) because Playwright's test
 * loader forbids one spec file importing another
 * (`"test file ... should not import test file ..."`) — this is the single shared
 * location every spec (`notes-crud-trash.spec.ts`, `search.spec.ts`, `sharing.spec.ts`,
 * ...) imports it from.
 */
export async function captureAccessToken(page: Page): Promise<string> {
  const requestPromise = page.waitForRequest(
    (req) =>
      req.method() === "GET" &&
      new URL(req.url()).pathname === NOTES_LIST_PATHNAME,
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
