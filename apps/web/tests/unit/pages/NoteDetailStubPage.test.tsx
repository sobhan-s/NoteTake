import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NoteResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { NoteDetailStubPage } from "@/pages/NoteDetailStubPage";

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
    title: "My Note Title",
    body: "<p>Hello <b>World</b></p>",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
    ...overrides,
  };
}

function renderStubPage(initialPath: string) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/notes/:id" element={<NoteDetailStubPage />} />
          <Route path="/notes" element={<div>Notes List Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NoteDetailStubPage ([MODIFIED Scenario: card click destination D1 — minimal stub /notes/:id route])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should render the blank placeholder and NEVER call getNoteById when id is 'new'", async () => {
    const getNoteByIdSpy = vi
      .spyOn(notesApi, "getNoteById")
      .mockResolvedValue(buildNote());

    renderStubPage("/notes/new");

    expect(screen.getByText("New note")).toBeDefined();
    expect(screen.getByRole("link", { name: "← Back to notes" })).toBeDefined();

    // Give any accidental async fetch a chance to fire before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getNoteByIdSpy).not.toHaveBeenCalled();
  });

  it("should call getNoteById for a real id and render the note's title and stripped plain-text body", async () => {
    const getNoteByIdSpy = vi
      .spyOn(notesApi, "getNoteById")
      .mockResolvedValue(buildNote());

    renderStubPage("/notes/note-1");

    await waitFor(() =>
      expect(screen.getByText("My Note Title")).toBeDefined(),
    );
    expect(getNoteByIdSpy).toHaveBeenCalledWith("note-1");
    expect(screen.getByText("Hello World")).toBeDefined();
    expect(screen.getByRole("link", { name: "← Back to notes" })).toBeDefined();
  });

  it("should navigate back to /notes when the 'Back to notes' link is clicked", async () => {
    vi.spyOn(notesApi, "getNoteById").mockResolvedValue(buildNote());
    renderStubPage("/notes/note-1");

    await waitFor(() =>
      expect(screen.getByText("My Note Title")).toBeDefined(),
    );

    const backLink = screen.getByRole("link", { name: "← Back to notes" });
    expect(backLink.getAttribute("href")).toBe("/notes");
  });

  it("[FRS-2.2.5] should render ErrorFallback (never a raw stack trace) when getNoteById fails (e.g. a Stage-2/purged note)", async () => {
    vi.spyOn(notesApi, "getNoteById").mockRejectedValue(
      new Error("Request failed with status code 404"),
    );

    renderStubPage("/notes/purged-note");

    await waitFor(() =>
      expect(
        screen.getByText("This note is no longer available."),
      ).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });
});
