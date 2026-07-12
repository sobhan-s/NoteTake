import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { UI_COPY } from "@shared/core/constants";
import type { NoteResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { NotesList, type NotesListProps } from "@/components/notes/NotesList";

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderNotesList(props: NotesListProps): ReactElement {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotesList {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildNote(overrides: Partial<NoteResponseDto> = {}): NoteResponseDto {
  return {
    id: "note-1",
    title: "Trash Note",
    body: "<p>body</p>",
    deletedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
    ...overrides,
  };
}

describe("NotesList ([ADDED Scenario: Active list empty state / Permanently deleting a note requires confirmation])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should render the first-run empty state with UI_COPY.EMPTY_NOTES_LIST subtext and a CTA calling onCreateNote", async () => {
    const onCreateNote = vi.fn();
    const user = userEvent.setup();
    renderNotesList({
      variant: "active",
      notes: [],
      isLoading: false,
      isFiltered: false,
      onCreateNote,
    });

    expect(screen.getByText("No notes yet")).toBeDefined();
    expect(screen.getByText(UI_COPY.EMPTY_NOTES_LIST)).toBeDefined();

    const cta = screen.getByRole("button", { name: "Create your first note" });
    await user.click(cta);
    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });

  it("should render the distinct filtered-empty-state copy with NO CTA button when isFiltered is true", () => {
    renderNotesList({
      variant: "active",
      notes: [],
      isLoading: false,
      isFiltered: true,
      onCreateNote: vi.fn(),
    });

    expect(screen.getByText("No notes match the selected tags")).toBeDefined();
    expect(screen.queryByText(UI_COPY.EMPTY_NOTES_LIST)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create your first note" }),
    ).toBeNull();
  });

  it("should dismiss the permanent-delete confirm modal via Cancel and issue zero permanentDeleteNote calls", async () => {
    const permanentDeleteSpy = vi
      .spyOn(notesApi, "permanentDeleteNote")
      .mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderNotesList({
      variant: "trash",
      notes: [buildNote()],
      isLoading: false,
      isFiltered: false,
      onCreateNote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(screen.getByText("Permanent Delete Note")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("Permanent Delete Note")).toBeNull(),
    );
    expect(permanentDeleteSpy).not.toHaveBeenCalled();
  });

  it("should dismiss the permanent-delete confirm modal via Escape and issue zero permanentDeleteNote calls", async () => {
    const permanentDeleteSpy = vi
      .spyOn(notesApi, "permanentDeleteNote")
      .mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderNotesList({
      variant: "trash",
      notes: [buildNote()],
      isLoading: false,
      isFiltered: false,
      onCreateNote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(screen.getByText("Permanent Delete Note")).toBeDefined();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByText("Permanent Delete Note")).toBeNull(),
    );
    expect(permanentDeleteSpy).not.toHaveBeenCalled();
  });

  it("should dismiss the permanent-delete confirm modal via backdrop click and issue zero permanentDeleteNote calls", async () => {
    const permanentDeleteSpy = vi
      .spyOn(notesApi, "permanentDeleteNote")
      .mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderNotesList({
      variant: "trash",
      notes: [buildNote()],
      isLoading: false,
      isFiltered: false,
      onCreateNote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(screen.getByText("Permanent Delete Note")).toBeDefined();

    const overlay = document.querySelector(
      '[data-radix-popper-content-wrapper] , [class*="fixed inset-0"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);

    await waitFor(() =>
      expect(screen.queryByText("Permanent Delete Note")).toBeNull(),
    );
    expect(permanentDeleteSpy).not.toHaveBeenCalled();
  });

  it("should call permanentDeleteNote exactly once with { confirm: true } on explicit confirm", async () => {
    const permanentDeleteSpy = vi
      .spyOn(notesApi, "permanentDeleteNote")
      .mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderNotesList({
      variant: "trash",
      notes: [buildNote({ id: "note-1" })],
      isLoading: false,
      isFiltered: false,
      onCreateNote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    await user.click(screen.getByRole("button", { name: "Delete Forever" }));

    await waitFor(() => expect(permanentDeleteSpy).toHaveBeenCalledTimes(1));
    expect(permanentDeleteSpy).toHaveBeenCalledWith("note-1", {
      confirm: true,
    });
  });

  it("should dismiss the restore confirm modal via Cancel and issue zero restoreNote calls", async () => {
    const restoreSpy = vi
      .spyOn(notesApi, "restoreNote")
      .mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderNotesList({
      variant: "trash",
      notes: [buildNote()],
      isLoading: false,
      isFiltered: false,
      onCreateNote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByRole("heading", { name: "Restore Note" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Restore Note" }),
      ).toBeNull(),
    );
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it("should call restoreNote exactly once on explicit confirmation in the confirm modal", async () => {
    const restoreSpy = vi
      .spyOn(notesApi, "restoreNote")
      .mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderNotesList({
      variant: "trash",
      notes: [buildNote({ id: "note-1" })],
      isLoading: false,
      isFiltered: false,
      onCreateNote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Restore Note" }));

    await waitFor(() => expect(restoreSpy).toHaveBeenCalledTimes(1));
    expect(restoreSpy).toHaveBeenCalledWith("note-1", expect.any(Object));
  });
});
