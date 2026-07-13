import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NoteResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import * as tagsApi from "@/api/tags.api";
import { useUiStore } from "@/store/useUiStore";
import { AUTOSAVE_DEBOUNCE_MS } from "@/constants/ui.constant";
import { NoteEditor } from "@/components/editor/NoteEditor";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// `ShareModal` itself (fetching/generating/revoking/copying) is exercised in full by
// apps/web/src/components/sharing/ShareModal.test.tsx; here it's stubbed so `NoteEditor`
// tests exercise only the toolbar-button-to-modal wiring (props + mount condition).
vi.mock("@/components/sharing/ShareModal", () => ({
  ShareModal: ({
    noteId,
    open,
    onOpenChange,
  }: {
    noteId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div
      data-testid="share-modal-stub"
      data-note-id={noteId}
      data-open={String(open)}
    >
      <button type="button" onClick={() => onOpenChange(false)}>
        Close Mock Modal
      </button>
    </div>
  ),
}));

// `VersionHistoryDrawer` itself (list/preview/confirm/restore flow) is exercised in full by
// apps/web/src/components/versions/VersionHistoryDrawer.test.tsx; here it's stubbed so
// `NoteEditor` tests exercise only the toolbar-button-to-drawer wiring (props + mount
// condition) and the `onRestored` callback's effect on NoteEditor's own local state.
vi.mock("@/components/versions/VersionHistoryDrawer", () => ({
  VersionHistoryDrawer: ({
    noteId,
    open,
    onOpenChange,
    onRestored,
  }: {
    noteId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRestored: (restoredNote: NoteResponseDto) => void;
  }) => (
    <div
      data-testid="version-history-drawer-stub"
      data-note-id={noteId}
      data-open={String(open)}
    >
      <button type="button" onClick={() => onOpenChange(false)}>
        Close Mock Drawer
      </button>
      <button
        type="button"
        onClick={() =>
          onRestored({
            id: noteId,
            title: "Restored Title From Version",
            body: "<p>Restored body from version</p>",
            deletedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-05T00:00:00.000Z",
            hasActiveShareLink: false,
            tags: [
              { id: "tag-restored", name: "Restored Tag", color: "#123456" },
            ],
          })
        }
      >
        Trigger Mock Restore
      </button>
    </div>
  ),
}));

// Lightweight TipTap double: exposes just enough of the real `Editor`/`EditorContent`
// surface (getHTML/getText/chain().run(), commands.setContent, an onUpdate callback) for
// these component tests, without requiring a real ProseMirror/contentEditable DOM under
// jsdom. `commands.setContent` mirrors the restore flow's direct-content-set requirement
// (Requirement: Confirmed Restore Applies the Server's Authoritative Content) without
// itself firing `onUpdate` (matching TipTap's non-emitting `setContent` default).
vi.mock("@tiptap/react", () => ({
  useEditor: (options: {
    content?: string;
    onUpdate?: (arg: { editor: unknown }) => void;
  }) => {
    const ref = useRef<{
      getHTML: () => string;
      getText: () => string;
      chain: () => Record<string, () => unknown>;
      commands: { setContent: (next: string) => void };
      __setHtml: (next: string) => void;
    } | null>(null);
    if (!ref.current) {
      let html = options.content ?? "";
      const chainStub: Record<string, () => unknown> = {};
      const chain = (): Record<string, () => unknown> => chainStub;
      chainStub.focus = chain;
      chainStub.toggleBold = chain;
      chainStub.toggleItalic = chain;
      chainStub.toggleUnderline = chain;
      chainStub.setLink = chain;
      chainStub.run = () => undefined;
      ref.current = {
        getHTML: () => html,
        getText: () => html.replace(/<[^>]*>/g, ""),
        chain,
        commands: {
          setContent: (next: string) => {
            html = next;
          },
        },
        __setHtml: (next: string) => {
          html = next;
          options.onUpdate?.({ editor: ref.current });
        },
      };
    }
    return ref.current;
  },
  EditorContent: ({ editor }: { editor: ReturnType<typeof _useRefEditor> }) => (
    <textarea
      aria-label="Note body"
      value={editor?.getHTML() ?? ""}
      onChange={(event) => editor?.__setHtml(event.target.value)}
    />
  ),
}));

// Type helper only used for the mock's prop typing above.
function _useRefEditor(): {
  getHTML: () => string;
  getText: () => string;
  __setHtml: (next: string) => void;
} | null {
  return null;
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildNote(overrides: Partial<NoteResponseDto> = {}): NoteResponseDto {
  return {
    id: "note-1",
    title: "Existing Title",
    body: "<p>Existing body</p>",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
    tags: [],
    ...overrides,
  };
}

function renderEditor(props: {
  noteId: string | null;
  note?: NoteResponseDto;
  onCreated?: (newId: string) => void;
}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NoteEditor
        noteId={props.noteId}
        note={props.note}
        onCreated={props.onCreated ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// [FRS-2.1.2, FRS-2.1.3, FRS-6.1, FRS-7.1, FRS-7.2, FRS-3.1] `NoteEditor` component behavior.
describe("NoteEditor ([Decision D4] new-note first-keystroke provisioning, [Decision D5] explicit-save triggers, [FRS-3.1] Fly Tag attach)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({ tags: [] });
    useUiStore.setState({ drafts: {}, isMobileSidebarOpen: false });
    window.localStorage.removeItem("note-editor-drafts");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.removeItem("note-editor-drafts");
  });

  it("[Decision D4] SHALL call createNote after the debounce following the first body keystroke on /notes/new, and invoke onCreated with the new id", async () => {
    const createSpy = vi
      .spyOn(notesApi, "createNote")
      .mockResolvedValue(
        buildNote({ id: "new-note-id", updatedAt: "2026-01-01T00:00:00.000Z" }),
      );
    const onCreated = vi.fn();

    renderEditor({ noteId: null, note: undefined, onCreated });

    const body = screen.getByLabelText("Note body");
    fireEvent.change(body, { target: { value: "<p>First keystroke</p>" } });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0]).toEqual({
      title: "",
      body: "<p>First keystroke</p>",
      tagIds: undefined,
    });
    expect(onCreated).toHaveBeenCalledWith("new-note-id");
  });

  it("[Decision D5] SHALL NOT send a PATCH before a POST has succeeded for a brand-new note (no note id yet)", async () => {
    vi.spyOn(notesApi, "createNote").mockResolvedValue(buildNote());
    const updateSpy = vi.spyOn(notesApi, "updateNote");

    renderEditor({ noteId: null });

    const body = screen.getByLabelText("Note body");
    fireEvent.change(body, { target: { value: "<p>Typing</p>" } });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("[Decision D5] Ctrl+S SHALL trigger an immediate explicit PATCH bypassing the debounce", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    renderEditor({ noteId: "note-1", note: buildNote() });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![1]).toMatchObject({ isExplicitSave: true });
  });

  it("[Decision D5] Cmd+S (metaKey) SHALL also trigger an immediate explicit PATCH", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    renderEditor({ noteId: "note-1", note: buildNote() });

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![1]).toMatchObject({ isExplicitSave: true });
  });

  it("[Decision D5] title blur with an UNCHANGED title SHALL NOT issue any PATCH call", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    renderEditor({
      noteId: "note-1",
      note: buildNote({ title: "Same Title" }),
    });

    const titleInput = screen.getByLabelText("Note title");
    fireEvent.focus(titleInput);
    fireEvent.blur(titleInput);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("[Decision D5] title blur with a CHANGED title SHALL immediately fire an explicit PATCH", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    renderEditor({ noteId: "note-1", note: buildNote({ title: "Old Title" }) });

    const titleInput = screen.getByLabelText("Note title");
    fireEvent.change(titleInput, { target: { value: "New Title" } });
    fireEvent.blur(titleInput);

    await vi.advanceTimersByTimeAsync(0);

    expect(updateSpy).toHaveBeenCalledWith("note-1", {
      title: "New Title",
      isExplicitSave: true,
    });
  });

  it("[FRS-3.1, Backend Additions] handleAttachTag SHALL result in a PATCH payload with isExplicitSave: false (no forced version snapshot)", async () => {
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({
      tags: [
        {
          id: "tag-work",
          name: "Work",
          color: "#111111",
          noteCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    renderEditor({ noteId: "note-1", note: buildNote({ tags: [] }) });

    const tagInput = screen.getByLabelText("Add a tag");
    fireEvent.change(tagInput, { target: { value: "Work" } });
    fireEvent.focus(tagInput);

    await vi.advanceTimersByTimeAsync(0);
    const option = screen.getByRole("button", { name: "Work" });
    fireEvent.mouseDown(option);

    await vi.advanceTimersByTimeAsync(0);

    expect(updateSpy).toHaveBeenCalledWith("note-1", {
      tagIds: ["tag-work"],
      isExplicitSave: false,
    });
  });

  it("[Decision D6] SHALL restore editor content from a persisted draft newer than the fetched note's updatedAt, instead of the fetched note content", async () => {
    const note = buildNote({
      id: "note-1",
      title: "Server Title",
      body: "<p>Server body</p>",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    useUiStore.getState().setDraft("note-1", {
      title: "Draft Title",
      body: "<p>Draft body</p>",
      savedAt: new Date("2026-01-01T00:05:00.000Z").getTime(),
    });
    vi.spyOn(notesApi, "updateNote").mockResolvedValue(buildNote());

    renderEditor({ noteId: "note-1", note });

    const titleInput = screen.getByLabelText("Note title") as HTMLInputElement;
    const body = screen.getByLabelText("Note body") as HTMLTextAreaElement;

    expect(titleInput.value).toBe("Draft Title");
    expect(body.value).toBe("<p>Draft body</p>");
  });

  it("[Decision D6] SHALL initialize from the fetched note content when no persisted draft is newer than updatedAt", async () => {
    const note = buildNote({
      id: "note-1",
      title: "Server Title",
      body: "<p>Server body</p>",
      updatedAt: "2026-01-01T00:05:00.000Z",
    });
    useUiStore.getState().setDraft("note-1", {
      title: "Stale Draft Title",
      body: "<p>Stale draft body</p>",
      savedAt: new Date("2026-01-01T00:00:00.000Z").getTime(),
    });

    renderEditor({ noteId: "note-1", note });

    const titleInput = screen.getByLabelText("Note title") as HTMLInputElement;
    const body = screen.getByLabelText("Note body") as HTMLTextAreaElement;

    expect(titleInput.value).toBe("Server Title");
    expect(body.value).toBe("<p>Server body</p>");
  });

  it("[Decision D5, FRS-6.1] SHALL NOT trigger debounced PATCH when typing in title on an existing note; SHALL only trigger explicit save on blur", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    renderEditor({ noteId: "note-1", note: buildNote({ title: "Old Title" }) });

    const titleInput = screen.getByLabelText("Note title");
    fireEvent.change(titleInput, { target: { value: "New Title" } });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(updateSpy).not.toHaveBeenCalled();

    fireEvent.blur(titleInput);
    await vi.advanceTimersByTimeAsync(0);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![1]).toMatchObject({
      title: "New Title",
      isExplicitSave: true,
    });
  });

  it("[FRS-3.1] SHALL render attached tags as badges within the NoteEditor", async () => {
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({
      tags: [
        {
          id: "tag-1",
          name: "Urgent",
          color: "#ef4444",
          noteCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    renderEditor({
      noteId: "note-1",
      note: buildNote({
        tags: [{ id: "tag-1", name: "Urgent", color: "#ef4444" }],
      }),
    });

    const badge = screen.getByText("Urgent");
    expect(badge).toBeDefined();
    expect(screen.getByLabelText("Attached tags")).toBeDefined();
  });

  it("[Scenario: Share button on an existing (already-saved) note] the 'Share note' toolbar button SHALL be enabled (not aria-disabled) when noteId is a real id", async () => {
    renderEditor({ noteId: "note-1", note: buildNote() });

    const shareButton = screen.getByRole("button", {
      name: "Share note",
    }) as HTMLButtonElement;
    expect(shareButton.disabled).toBe(false);
    expect(shareButton.getAttribute("aria-disabled")).toBe("false");
  });

  it("[Scenario: Share button on an unsaved new note] the 'Share note' toolbar button SHALL be disabled and aria-disabled when noteId is null, and ShareModal SHALL NOT be mounted", async () => {
    renderEditor({ noteId: null });

    const shareButton = screen.getByRole("button", {
      name: "Share note",
    }) as HTMLButtonElement;
    expect(shareButton.disabled).toBe(true);
    expect(shareButton.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByTestId("share-modal-stub")).toBeNull();
  });

  it("[Scenario: Share button on an existing (already-saved) note] clicking 'Share note' SHALL mount ShareModal open with the current noteId wired through", async () => {
    renderEditor({ noteId: "note-1", note: buildNote() });

    const shareButton = screen.getByRole("button", { name: "Share note" });
    fireEvent.click(shareButton);

    const modalStub = screen.getByTestId("share-modal-stub");
    expect(modalStub.getAttribute("data-open")).toBe("true");
    expect(modalStub.getAttribute("data-note-id")).toBe("note-1");
  });

  it("[Requirement: Share Toolbar Entry Point] ShareModal's onOpenChange callback SHALL close it (open becomes false) when invoked", async () => {
    renderEditor({ noteId: "note-1", note: buildNote() });

    fireEvent.click(screen.getByRole("button", { name: "Share note" }));
    expect(
      screen.getByTestId("share-modal-stub").getAttribute("data-open"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close Mock Modal" }));

    expect(
      screen.getByTestId("share-modal-stub").getAttribute("data-open"),
    ).toBe("false");
  });

  it("[Scenario: Version History button on an unsaved new note] the 'Version history' toolbar button SHALL be disabled and aria-disabled when noteId is null, with no click handler firing and VersionHistoryDrawer NOT mounted", async () => {
    renderEditor({ noteId: null });

    const versionHistoryButton = screen.getByRole("button", {
      name: "Version history",
    }) as HTMLButtonElement;
    expect(versionHistoryButton.disabled).toBe(true);
    expect(versionHistoryButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(versionHistoryButton);
    expect(screen.queryByTestId("version-history-drawer-stub")).toBeNull();
  });

  it("[Scenario: Version History button on an existing (already-saved) note] the 'Version history' toolbar button SHALL be enabled (not aria-disabled), and clicking it SHALL mount VersionHistoryDrawer open with the current noteId wired through", async () => {
    renderEditor({ noteId: "note-1", note: buildNote() });

    const versionHistoryButton = screen.getByRole("button", {
      name: "Version history",
    }) as HTMLButtonElement;
    expect(versionHistoryButton.disabled).toBe(false);
    expect(versionHistoryButton.getAttribute("aria-disabled")).toBe("false");
    expect(
      screen
        .getByTestId("version-history-drawer-stub")
        .getAttribute("data-open"),
    ).toBe("false");

    fireEvent.click(versionHistoryButton);

    const drawerStub = screen.getByTestId("version-history-drawer-stub");
    expect(drawerStub.getAttribute("data-open")).toBe("true");
    expect(drawerStub.getAttribute("data-note-id")).toBe("note-1");
  });

  it("[Requirement: Version History Toolbar Entry Point] VersionHistoryDrawer's onOpenChange callback SHALL close it (open becomes false) when invoked", async () => {
    renderEditor({ noteId: "note-1", note: buildNote() });

    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    expect(
      screen
        .getByTestId("version-history-drawer-stub")
        .getAttribute("data-open"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close Mock Drawer" }));

    expect(
      screen
        .getByTestId("version-history-drawer-stub")
        .getAttribute("data-open"),
    ).toBe("false");
  });

  it("[Requirement: Confirmed Restore Applies the Server's Authoritative Content and Closes the Drawer] VersionHistoryDrawer's onRestored callback SHALL apply the restored title/body/tags to editor state and clear the Zustand draft for this note", async () => {
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({
      tags: [
        {
          id: "tag-restored",
          name: "Restored Tag",
          color: "#123456",
          noteCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    useUiStore.getState().setDraft("note-1", {
      title: "Unsaved Draft Title",
      body: "<p>Unsaved draft body</p>",
      savedAt: Date.now(),
    });

    renderEditor({
      noteId: "note-1",
      note: buildNote({ title: "Old Title", body: "<p>Old body</p>" }),
    });

    // Let the real `useTags` query resolve (mirrors the [FRS-3.1] Fly Tag attach test's own
    // `vi.advanceTimersByTimeAsync(0)` flush pattern) so `allTags` is populated before the
    // restored tagIds are applied, since `NoteEditor` derives attached-tag badges from
    // `tagsData ?? note?.tags`.
    await vi.advanceTimersByTimeAsync(0);

    expect(useUiStore.getState().drafts["note-1"]).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Trigger Mock Restore" }),
    );

    const titleInput = screen.getByLabelText("Note title") as HTMLInputElement;
    const body = screen.getByLabelText("Note body") as HTMLTextAreaElement;

    expect(titleInput.value).toBe("Restored Title From Version");
    expect(body.value).toBe("<p>Restored body from version</p>");
    expect(screen.getByText("Restored Tag")).toBeDefined();
    expect(useUiStore.getState().drafts["note-1"]).toBeUndefined();
  });
});
