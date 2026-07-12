import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NoteResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { useUiStore } from "@/store/useUiStore";
import { NoteEditorPage } from "@/pages/NoteEditorPage";

vi.mock("@tiptap/react", () => ({
  useEditor: () => null,
  EditorContent: () => <textarea aria-label="Note body" />,
}));

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
    title: "Test Note",
    body: "<p>Test body</p>",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
    tags: [],
    ...overrides,
  };
}

function renderPage(initialRoute = "/notes/note-1") {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/notes/:id" element={<NoteEditorPage />} />
          <Route path="/notes" element={<div>Notes List Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// [FRS-7.5] Responsive layout & skeleton / error rendering for NoteEditorPage.
describe("NoteEditorPage ([FRS-7.5] breakpoint layout and lifecycle)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUiStore.setState({ isMobileSidebarOpen: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("[FRS-7.5] SHALL render persistent SidebarNav container on desktop (hidden lg:flex)", async () => {
    vi.spyOn(notesApi, "getNoteById").mockResolvedValue(buildNote());

    renderPage();

    await screen.findByLabelText("Note title");
    expect(screen.getByText("← Back to notes")).toBeDefined();

    const openNavigationButton = screen.getByRole("button", {
      name: "Open navigation",
    });
    expect(openNavigationButton.className).toContain("lg:hidden");
  });

  it("[FRS-7.5] SHALL open Sheet mobile sidebar when clicking menu button (< 1024px)", async () => {
    vi.spyOn(notesApi, "getNoteById").mockResolvedValue(buildNote());
    const user = userEvent.setup();

    renderPage();

    await screen.findByLabelText("Note title");
    const openNavigationButton = screen.getByRole("button", {
      name: "Open navigation",
    });
    await user.click(openNavigationButton);

    expect(useUiStore.getState().isMobileSidebarOpen).toBe(true);
  });

  it("[Error Scenario] SHALL render ErrorFallback when note query fails or note is trashed (404)", async () => {
    vi.spyOn(notesApi, "getNoteById").mockRejectedValue(
      new Error("Note not found"),
    );

    renderPage();

    expect(
      await screen.findByText("This note is no longer available."),
    ).toBeDefined();
  });
});
