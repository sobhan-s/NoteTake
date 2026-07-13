import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import type {
  NoteResponseDto,
  NoteVersionResponseDto,
  NoteVersionSummaryDto,
} from "@shared/core/types";
import * as noteVersionApi from "@/api/note-version.api";
import { mapApiError } from "@/lib/errorMessages";
import { VersionHistoryDrawer } from "@/components/versions/VersionHistoryDrawer";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Lightweight TipTap double mirroring the pattern used by ShareViewPage.test.tsx: exposes
// just enough of the real read-only `Editor`/`EditorContent` surface (commands.setContent/
// getHTML) for a rendering assertion, without requiring a real ProseMirror DOM under jsdom.
vi.mock("@tiptap/react", () => ({
  useEditor: (options: { content?: string }) => {
    const ref = useRef<{
      commands: { setContent: (next: string) => void };
      getHTML: () => string;
    } | null>(null);
    if (!ref.current) {
      let html = options.content ?? "";
      ref.current = {
        commands: {
          setContent: (next: string) => {
            html = next;
          },
        },
        getHTML: () => html,
      };
    }
    return ref.current;
  },
  EditorContent: ({ editor }: { editor: { getHTML: () => string } | null }) => (
    <div
      data-testid="version-preview-body"
      dangerouslySetInnerHTML={{ __html: editor?.getHTML() ?? "" }}
    />
  ),
}));

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildVersionSummary(
  overrides: Partial<NoteVersionSummaryDto> = {},
): NoteVersionSummaryDto {
  return {
    id: "v-1",
    titleSnapshot: "Version Title",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildVersionResponse(
  overrides: Partial<NoteVersionResponseDto> = {},
): NoteVersionResponseDto {
  return {
    id: "v-1",
    noteId: "note-1",
    titleSnapshot: "Version Title",
    bodySnapshot: "<p>Version body content</p>",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildNoteResponse(
  overrides: Partial<NoteResponseDto> = {},
): NoteResponseDto {
  return {
    id: "note-1",
    title: "Restored Title",
    body: "<p>Restored body</p>",
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    hasActiveShareLink: false,
    tags: [],
    ...overrides,
  };
}

function build404Error(code: "VERSION_NOT_FOUND" | "NOTE_NOT_FOUND") {
  return {
    isAxiosError: true,
    response: {
      status: 404,
      data: { success: false, error: { code } },
    },
  };
}

function build500Error() {
  return {
    isAxiosError: true,
    response: {
      status: 500,
      data: { success: false, error: { code: "INTERNAL_ERROR" } },
    },
  };
}

function renderDrawer(overrides: {
  onOpenChange?: (open: boolean) => void;
  onRestored?: (restoredNote: NoteResponseDto) => void;
}) {
  const queryClient = createTestQueryClient();
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onRestored = overrides.onRestored ?? vi.fn();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <VersionHistoryDrawer
        noteId="note-1"
        open={true}
        onOpenChange={onOpenChange}
        onRestored={onRestored}
      />
    </QueryClientProvider>,
  );
  return { ...result, onOpenChange, onRestored };
}

async function findConfirmDialog(): Promise<HTMLElement> {
  const dialog = (await screen.findAllByRole("dialog")).find((d) =>
    within(d).queryByText("Restore Version"),
  );
  if (!dialog) throw new Error("Restore confirmation dialog not found");
  return dialog;
}

async function selectFirstVersionRow(): Promise<void> {
  const row = await screen.findByRole("button", { name: /Version Title/ });
  fireEvent.click(row);
}

// [Requirement: Version History Drawer Fetches and Lists Versions on Open, Selecting a Version
//  Shows a Read-Only Preview (Split View), Restore Requires Explicit Confirmation, Confirmed
//  Restore Applies the Server's Authoritative Content and Closes the Drawer] `VersionHistoryDrawer`.
describe("VersionHistoryDrawer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("[Scenario: Drawer opens successfully] SHALL render each version's titleSnapshot and formatted createdAt in the exact array order returned, no client-side re-sort", async () => {
    const versions = [
      buildVersionSummary({
        id: "v-newest",
        titleSnapshot: "Third Entry",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      buildVersionSummary({
        id: "v-middle",
        titleSnapshot: "First Entry",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      buildVersionSummary({
        id: "v-oldest",
        titleSnapshot: "Second Entry",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue(versions);

    renderDrawer({});

    const listItems = await screen.findAllByRole("listitem");
    expect(listItems).toHaveLength(3);
    expect(
      listItems.map((li) => (li.textContent ?? "").includes("Third Entry")),
    ).toEqual([true, false, false]);
    expect(
      listItems.map((li) => (li.textContent ?? "").includes("First Entry")),
    ).toEqual([false, true, false]);
    expect(
      listItems.map((li) => (li.textContent ?? "").includes("Second Entry")),
    ).toEqual([false, false, true]);
  });

  it("[Scenario: Drawer opens for a note with zero versions (defensive)] SHALL render UI_COPY.EMPTY_VERSION_HISTORY instead of a blank panel", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([]);

    renderDrawer({});

    expect(
      await screen.findByText(UI_COPY.EMPTY_VERSION_HISTORY),
    ).toBeDefined();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("[Scenario: List fetch fails] SHALL render an inline retry affordance on a network/5xx error, and Retry SHALL re-invoke the list fetch", async () => {
    const listSpy = vi
      .spyOn(noteVersionApi, "listNoteVersions")
      .mockRejectedValue(build500Error());

    renderDrawer({});

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    fireEvent.click(retryButton);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it("[Scenario: Loading state respects minimum display timer] SHALL show a skeleton placeholder while the version list fetch is in flight", async () => {
    let resolveFetch!: (value: NoteVersionSummaryDto[]) => void;
    const pending = new Promise<NoteVersionSummaryDto[]>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(noteVersionApi, "listNoteVersions").mockReturnValue(pending);

    renderDrawer({});

    expect(
      document.body.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    resolveFetch([buildVersionSummary()]);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
  });

  it("[Scenario: Owner selects a version] clicking a version row SHALL call getNoteVersion and render the back control, formatted createdAt, titleSnapshot heading, read-only body, and a Restore button", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1", titleSnapshot: "Version Title" }),
    ]);
    const getSpy = vi.spyOn(noteVersionApi, "getNoteVersion").mockResolvedValue(
      buildVersionResponse({
        id: "v-1",
        titleSnapshot: "Version Title",
        bodySnapshot: "<p>Version body content</p>",
      }),
    );

    renderDrawer({});
    await selectFirstVersionRow();

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith("note-1", "v-1"));
    expect(screen.getByRole("button", { name: /Back to list/ })).toBeDefined();
    // `useMinLoadingTime` holds the skeleton for a real 200ms after the fetch resolves
    // (docs/ux.md §1), so these assertions poll via `findBy*` rather than a synchronous `getBy*`.
    expect(
      await screen.findByRole("heading", { name: "Version Title" }),
    ).toBeDefined();
    expect(screen.getByTestId("version-preview-body").innerHTML).toContain(
      "Version body content",
    );
    expect(
      screen.getByRole("button", { name: "Restore this version" }),
    ).toBeDefined();
  });

  it("[Scenario: Owner navigates back to the list] clicking '← Back to list' SHALL show the list again without re-fetching it", async () => {
    const listSpy = vi
      .spyOn(noteVersionApi, "listNoteVersions")
      .mockResolvedValue([buildVersionSummary({ id: "v-1" })]);
    vi.spyOn(noteVersionApi, "getNoteVersion").mockResolvedValue(
      buildVersionResponse({ id: "v-1" }),
    );

    renderDrawer({});
    await selectFirstVersionRow();
    await screen.findByRole("heading", { name: "Version Title" });
    expect(listSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Back to list/ }));

    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("[Scenario: Selected version has been purged since the list was fetched] a 404 (VERSION_NOT_FOUND) SHALL render UI_COPY.VERSION_UNAVAILABLE with a back control still available and no Restore button", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    vi.spyOn(noteVersionApi, "getNoteVersion").mockRejectedValue(
      build404Error("VERSION_NOT_FOUND"),
    );

    renderDrawer({});
    await selectFirstVersionRow();

    expect(await screen.findByText(UI_COPY.VERSION_UNAVAILABLE)).toBeDefined();
    expect(screen.getByRole("button", { name: /Back to list/ })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Restore this version" }),
    ).toBeNull();
  });

  it("[Scenario: Preview fetch fails (network/5xx)] SHALL render an inline retry affordance distinct from the permanent VERSION_UNAVAILABLE state", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    const getSpy = vi
      .spyOn(noteVersionApi, "getNoteVersion")
      .mockRejectedValue(build500Error());

    renderDrawer({});
    await selectFirstVersionRow();

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText(UI_COPY.VERSION_UNAVAILABLE)).toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(retryButton);
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it("[Scenario: Preview loading state respects minimum display timer] SHALL show a skeleton placeholder while the per-version fetch is in flight", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    let resolveFetch!: (value: NoteVersionResponseDto) => void;
    const pending = new Promise<NoteVersionResponseDto>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(noteVersionApi, "getNoteVersion").mockReturnValue(pending);

    renderDrawer({});
    await selectFirstVersionRow();

    expect(
      document.body.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Version Title" })).toBeNull();

    resolveFetch(buildVersionResponse({ id: "v-1" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Version Title" }),
      ).toBeDefined(),
    );
  });

  it('[Scenario: Owner clicks "Restore this version"] SHALL open a ConfirmModal with heading "Restore Version" and the exact VERSION_RESTORE_CONFIRM body', async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    vi.spyOn(noteVersionApi, "getNoteVersion").mockResolvedValue(
      buildVersionResponse({ id: "v-1" }),
    );

    renderDrawer({});
    await selectFirstVersionRow();
    await screen.findByRole("button", { name: "Restore this version" });

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );

    const confirmDialog = await findConfirmDialog();
    expect(
      within(confirmDialog).getByText(UI_COPY.VERSION_RESTORE_CONFIRM),
    ).toBeDefined();
  });

  it("[Scenario: Owner cancels the confirmation] SHALL send no restore request and leave the preview pane unchanged", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    vi.spyOn(noteVersionApi, "getNoteVersion").mockResolvedValue(
      buildVersionResponse({ id: "v-1", titleSnapshot: "Version Title" }),
    );
    const restoreSpy = vi.spyOn(noteVersionApi, "restoreNoteVersion");

    renderDrawer({});
    await selectFirstVersionRow();
    await screen.findByRole("button", { name: "Restore this version" });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    await findConfirmDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("Restore Version")).toBeNull(),
    );
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Version Title" }),
    ).toBeDefined();
  });

  it("[Scenario: Restore succeeds] confirming SHALL call restoreNoteVersion, invoke onRestored, close the drawer, and toast VERSION_RESTORE_SUCCESS for 3000ms", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    vi.spyOn(noteVersionApi, "getNoteVersion").mockResolvedValue(
      buildVersionResponse({ id: "v-1" }),
    );
    const restoredNote = buildNoteResponse({ title: "Restored Title" });
    const restoreSpy = vi
      .spyOn(noteVersionApi, "restoreNoteVersion")
      .mockResolvedValue(restoredNote);

    const { onOpenChange, onRestored } = renderDrawer({});
    await selectFirstVersionRow();
    await screen.findByRole("button", { name: "Restore this version" });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    const confirmDialog = await findConfirmDialog();

    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Restore" }),
    );

    await waitFor(() =>
      expect(restoreSpy).toHaveBeenCalledWith("note-1", "v-1"),
    );
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restoredNote));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith(
      UI_COPY.VERSION_RESTORE_SUCCESS,
      { duration: 3000 },
    );
  });

  it("[Scenario: Restore fails because the note was trashed in another tab] a 404 (NOTE_NOT_FOUND) SHALL toast an error via mapApiError and leave the preview pane and editor content unchanged (no partial apply)", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    vi.spyOn(noteVersionApi, "getNoteVersion").mockResolvedValue(
      buildVersionResponse({ id: "v-1", titleSnapshot: "Version Title" }),
    );
    vi.spyOn(noteVersionApi, "restoreNoteVersion").mockRejectedValue(
      build404Error("NOTE_NOT_FOUND"),
    );

    const { onOpenChange, onRestored } = renderDrawer({});
    await selectFirstVersionRow();
    await screen.findByRole("button", { name: "Restore this version" });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    const confirmDialog = await findConfirmDialog();
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Restore" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(mapApiError("NOTE_NOT_FOUND"), {
        duration: 5000,
      }),
    );
    expect(onRestored).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("heading", { name: "Version Title" }),
    ).toBeDefined();
    expect(screen.queryByText(UI_COPY.VERSION_UNAVAILABLE)).toBeNull();
  });

  it("[Scenario: Restore fails because the version was purged in another tab] a 404 (VERSION_NOT_FOUND) SHALL toast an error via mapApiError and re-render the preview pane in its VERSION_UNAVAILABLE state", async () => {
    vi.spyOn(noteVersionApi, "listNoteVersions").mockResolvedValue([
      buildVersionSummary({ id: "v-1" }),
    ]);
    vi.spyOn(noteVersionApi, "getNoteVersion")
      .mockResolvedValueOnce(
        buildVersionResponse({ id: "v-1", titleSnapshot: "Version Title" }),
      )
      .mockRejectedValue(build404Error("VERSION_NOT_FOUND"));
    vi.spyOn(noteVersionApi, "restoreNoteVersion").mockRejectedValue(
      build404Error("VERSION_NOT_FOUND"),
    );

    const { onRestored } = renderDrawer({});
    await selectFirstVersionRow();
    await screen.findByRole("button", { name: "Restore this version" });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    const confirmDialog = await findConfirmDialog();
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Restore" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        mapApiError("VERSION_NOT_FOUND"),
        { duration: 5000 },
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(UI_COPY.VERSION_UNAVAILABLE)).toBeDefined(),
    );
    expect(onRestored).not.toHaveBeenCalled();
  });
});
