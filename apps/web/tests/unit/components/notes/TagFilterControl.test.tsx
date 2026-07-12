import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APP_LIMITS } from "@shared/core/constants";
import type {
  ListNotesQuery,
  NoteResponseDto,
  PaginatedNotesResponseDto,
  TagListResponseDto,
} from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import * as tagsApi from "@/api/tags.api";
import { NotesPage } from "@/pages/NotesPage";

// [SDS §5.1] `TagFilterControl` itself only emits toggle/mode callbacks — the actual
// omission of tagIds/tagMode from the emitted GET /api/v1/notes query params happens one
// level up in `NotesPage.tsx` (it only spreads { tagIds, tagMode } into params when
// selectedTagIds.length > 0). These tests therefore exercise that composed behavior.

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildNote(id: string): NoteResponseDto {
  return {
    id,
    title: `Note ${id}`,
    body: "<p>body</p>",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
  };
}

function buildActivePage(): PaginatedNotesResponseDto {
  return {
    notes: [buildNote("active-1")],
    pagination: {
      page: 1,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      total: 1,
      totalPages: 1,
    },
  };
}

const TAGS_RESPONSE: TagListResponseDto = {
  tags: [
    {
      id: "tag-1",
      name: "Work",
      color: "#111111",
      noteCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "tag-2",
      name: "Personal",
      color: "#222222",
      noteCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

function renderNotesPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/notes"]}>
        <NotesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TagFilterControl composed with NotesPage ([ADDED Scenario: Changing the tag filter triggers a fresh server request])", () => {
  let listNotesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    listNotesSpy = vi
      .spyOn(notesApi, "listNotes")
      .mockResolvedValue(buildActivePage());
    vi.spyOn(notesApi, "listTrash").mockResolvedValue(buildActivePage());
    vi.spyOn(tagsApi, "listTags").mockResolvedValue(TAGS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should have NO tagIds key and NO tagMode key in the listNotes params when zero tags are ever selected", async () => {
    renderNotesPage();

    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));
    const params = listNotesSpy.mock.calls[0][0] as Partial<ListNotesQuery>;

    expect(params).not.toHaveProperty("tagIds");
    expect(params).not.toHaveProperty("tagMode");
  });

  it("should include BOTH tagIds and tagMode once a tag is selected via the filter control", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    const tagButton = await screen.findByRole("button", { name: "Work" });
    await user.click(tagButton);

    await waitFor(() => {
      const lastCall = listNotesSpy.mock.calls.at(
        -1,
      )?.[0] as Partial<ListNotesQuery>;
      expect(lastCall.tagIds).toBe("tag-1");
      expect(lastCall.tagMode).toBe("ALL");
    });
  });

  it("should omit tagIds/tagMode again once every selected tag is deselected", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    const tagButton = await screen.findByRole("button", { name: "Work" });
    await user.click(tagButton);
    await waitFor(() => {
      const lastCall = listNotesSpy.mock.calls.at(
        -1,
      )?.[0] as Partial<ListNotesQuery>;
      expect(lastCall.tagIds).toBe("tag-1");
    });

    await user.click(tagButton);

    await waitFor(() => {
      const lastCall = listNotesSpy.mock.calls.at(
        -1,
      )?.[0] as Partial<ListNotesQuery>;
      expect(lastCall).not.toHaveProperty("tagIds");
      expect(lastCall).not.toHaveProperty("tagMode");
    });
  });

  it("should serialize multiple selected tag ids as a comma-joined tagIds param", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Work" }));
    await user.click(await screen.findByRole("button", { name: "Personal" }));

    await waitFor(() => {
      const lastCall = listNotesSpy.mock.calls.at(
        -1,
      )?.[0] as Partial<ListNotesQuery>;
      expect(lastCall.tagIds).toBe("tag-1,tag-2");
    });
  });

  it("should switch tagMode to ANY when 'Match any' is clicked with 2+ tags selected, and send it with the next fetch", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Work" }));
    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await waitFor(() => {
      const lastCall = listNotesSpy.mock.calls.at(
        -1,
      )?.[0] as Partial<ListNotesQuery>;
      expect(lastCall.tagMode).toBe("ALL");
    });

    const matchAnyButton = screen.getByRole("button", { name: "Match any" });
    await user.click(matchAnyButton);

    await waitFor(() => {
      const lastCall = listNotesSpy.mock.calls.at(
        -1,
      )?.[0] as Partial<ListNotesQuery>;
      expect(lastCall.tagMode).toBe("ANY");
      expect(lastCall.tagIds).toBe("tag-1,tag-2");
      expect(lastCall.page).toBe(1);
    });
    expect(matchAnyButton.getAttribute("aria-pressed")).toBe("true");
  });
});
