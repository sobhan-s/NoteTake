import { expect, type Page } from "@playwright/test";
import { prisma } from "./db.js";

// Bounded outer-retry ceiling for the full type-and-verify cycle (see the
// doc comment below) — not an FRS-mandated numeric limit (unlike
// `APP_LIMITS.*`), so it is a plain literal here.
const MAX_CREATE_NOTE_ATTEMPTS = 5;

/**
 * Creates a note through the real editor UI (title input + TipTap
 * contenteditable body), waiting for autosave's debounced `POST /api/v1/notes`
 * to fire and the app to navigate from `/notes/new` to `/notes/:id`. This
 * always yields exactly one initial `NoteVersion` snapshot server-side.
 *
 * React `StrictMode` (`apps/web/src/main.tsx`) double-invokes the freshly
 * mounted `NoteEditor`'s `useEditor` effect once in dev, which can very
 * occasionally replace the TipTap DOM node a beat after this page first
 * navigates to `/notes/new` — swallowing keystrokes typed in that narrow
 * window. Retrying the (idempotent — a failed attempt inserts zero
 * characters) type action until it verifiably lands in the DOM sidesteps
 * the simple case without weakening the assertion itself.
 *
 * That DOM-level retry alone is not sufficient, though: `NoteEditor.tsx`'s
 * own `useEffect(() => { if (hasNewerDraft && ...) autosave.triggerAutosave(
 * { title, body: editor.getHTML() }) }, [editor])` re-runs whenever the
 * StrictMode-driven editor-instance swap completes, and — if that swap
 * lands just after our keystrokes already updated the real (about-to-be-
 * destroyed) editor instance — reads `editor.getHTML()` off the *new*,
 * still-empty replacement instance. That silently overwrites the
 * already-correct in-memory body with an empty string and resets the
 * autosave debounce, with no further edit ever re-triggering a save. A
 * single post-typing DOM read can observe the correct text a moment before
 * this clobber occurs, so DOM verification alone cannot detect it — only
 * polling the *server-persisted* `Note.body` can. When that happens, this
 * function does not give up: it retries the full type-and-verify cycle
 * (the editor is stable by the second attempt, since the one-time
 * StrictMode swap has long since settled), up to `MAX_CREATE_NOTE_ATTEMPTS`
 * times, only returning once the server-persisted body verifiably contains
 * `bodyText`.
 *
 * Lives in `e2e/helpers/` (not inside any `*.spec.ts` file) because
 * Playwright's test loader forbids one spec file importing another
 * (`"test file ... should not import test file ..."`) — this is the single
 * shared location every spec (`notes-crud-trash.spec.ts`, `tags.spec.ts`,
 * `search.spec.ts`, `sharing.spec.ts`, `version-history.spec.ts`) imports it
 * from.
 */
export async function createNoteViaUi(
  page: Page,
  title: string,
  bodyText: string,
): Promise<string> {
  await page.getByRole("button", { name: "New Note" }).first().click();
  await expect(page).toHaveURL(/\/notes\/new$/);

  const titleInput = page.getByLabel("Note title");
  await titleInput.fill(title);

  const editorBody = page.locator('[contenteditable="true"]');
  await expect(editorBody).toBeVisible();

  let noteId: string | undefined;

  for (let attempt = 1; attempt <= MAX_CREATE_NOTE_ATTEMPTS; attempt++) {
    await expect
      .poll(
        async () => {
          await editorBody.click();
          await editorBody.pressSequentially(bodyText);
          return editorBody.innerText();
        },
        { timeout: 8000 },
      )
      .toContain(bodyText);

    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, {
      timeout: 10000,
    });

    const currentNoteId = new URL(page.url()).pathname.split("/").pop();
    if (!currentNoteId) {
      throw new Error("createNoteViaUi: could not extract note id from URL");
    }
    noteId = currentNoteId;

    try {
      await expect
        .poll(async () => {
          const persisted = await prisma.note.findUnique({
            where: { id: noteId },
          });
          return persisted?.body ?? "";
        })
        .toContain(bodyText);
      return noteId;
    } catch (error) {
      if (attempt === MAX_CREATE_NOTE_ATTEMPTS) {
        throw error;
      }
      // Server-persisted body was clobbered by the stale-editor-instance
      // race described above — the editor is stable by now, so the next
      // iteration's re-type reliably lands and persists.
    }
  }

  // Unreachable: the loop above always either returns or throws.
  throw new Error(
    `createNoteViaUi: body never persisted after ${MAX_CREATE_NOTE_ATTEMPTS} attempts`,
  );
}
