import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APP_LIMITS } from "@shared/core/constants";
import type {
  ListNotesQuery,
  ListTrashQuery,
  NoteResponseDto,
  PaginatedNotesResponseDto,
  TagListResponseDto,
} from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import * as tagsApi from "@/api/tags.api";
import { NotesPage } from "@/pages/NotesPage";

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

function buildActivePage(page: number): PaginatedNotesResponseDto {
  return {
    notes: [buildNote(`active-${page}`)],
    pagination: {
      page,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      total: 40,
      totalPages: 2,
    },
  };
}

function buildTrashPage(page: number): PaginatedNotesResponseDto {
  return {
    notes: [buildNote(`trash-${page}`)],
    pagination: {
      page,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      total: 21,
      totalPages: 2,
    },
  };
}

const EMPTY_ACTIVE_PAGE: PaginatedNotesResponseDto = {
  notes: [],
  pagination: {
    page: 1,
    limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
    total: 0,
    totalPages: 0,
  },
};

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
        <Routes>
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/notes/:id" element={<div>Note detail stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NotesPage ([ADDED Scenarios: Changing sort/tag filter/pagination triggers a fresh server request, Trash tab loads Stage-1 trashed notes only])", () => {
  let listNotesSpy: ReturnType<typeof vi.spyOn>;
  let listTrashSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    listNotesSpy = vi
      .spyOn(notesApi, "listNotes")
      .mockImplementation((params: Partial<ListNotesQuery>) =>
        Promise.resolve(buildActivePage(params.page ?? 1)),
      );
    listTrashSpy = vi
      .spyOn(notesApi, "listTrash")
      .mockImplementation((params: Partial<ListTrashQuery>) =>
        Promise.resolve(buildTrashPage(params.page ?? 1)),
      );
    vi.spyOn(tagsApi, "listTags").mockResolvedValue(TAGS_RESPONSE);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should call listNotes with the filterNotesSchema defaults (sort=updatedAt, order=desc, page=1) on initial Active tab load", async () => {
    renderNotesPage();

    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));
    expect(listNotesSpy.mock.calls[0][0]).toEqual({
      page: 1,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      sort: "updatedAt",
      order: "desc",
    });
  });

  it("should issue a new listNotes call and reset page to 1 when the sort control changes, after a prior page change", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 }),
    );
    const callsBeforeSortChange = listNotesSpy.mock.calls.length;

    const sortSelect = screen.getByLabelText("Sort by");
    await user.selectOptions(sortSelect, "title");

    await waitFor(() =>
      expect(listNotesSpy.mock.calls.length).toBeGreaterThan(
        callsBeforeSortChange,
      ),
    );
    expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 1,
      sort: "title",
    });
  });

  it("should issue a new listNotes call and reset page to 1 when the sort direction control changes, after a prior page change", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 }),
    );
    const callsBeforeOrderChange = listNotesSpy.mock.calls.length;

    const orderSelect = screen.getByLabelText("Sort direction");
    await user.selectOptions(orderSelect, "asc");

    await waitFor(() =>
      expect(listNotesSpy.mock.calls.length).toBeGreaterThan(
        callsBeforeOrderChange,
      ),
    );
    expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 1,
      sort: "updatedAt",
      order: "asc",
    });
  });

  it("should issue a new listNotes call, serialize tagIds/tagMode, and reset page to 1 when a tag filter is toggled, after a prior page change", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 }),
    );

    const tagButton = await screen.findByRole("button", { name: "Work" });
    await user.click(tagButton);

    await waitFor(() => {
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        page: 1,
        tagIds: "tag-1",
        tagMode: "ALL",
      });
    });
  });

  it("should omit tagIds/tagMode entirely when zero tags are selected", async () => {
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    const firstCallParams = listNotesSpy.mock
      .calls[0][0] as Partial<ListNotesQuery>;
    expect(firstCallParams).not.toHaveProperty("tagIds");
    expect(firstCallParams).not.toHaveProperty("tagMode");
  });

  it("should preserve other active sort/order params when page changes via PaginationControl 'Next'", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    const sortSelect = screen.getByLabelText("Sort by");
    await user.selectOptions(sortSelect, "createdAt");
    await waitFor(() =>
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        sort: "createdAt",
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        page: 2,
        sort: "createdAt",
        order: "desc",
      });
    });
  });

  it("should preserve other active sort/order params when page changes via PaginationControl 'Previous'", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 }),
    );

    await user.click(screen.getByRole("button", { name: "Previous" }));

    await waitFor(() => {
      expect(listNotesSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        page: 1,
        sort: "updatedAt",
        order: "desc",
      });
    });
  });

  it("should render zero SortControl/TagFilterControl elements and call listTrash with only page/limit when the Trash tab is active", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "Trash" }));

    await waitFor(() => expect(listTrashSpy).toHaveBeenCalledTimes(1));
    expect(listTrashSpy.mock.calls[0][0]).toEqual({
      page: 1,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
    });
    expect(screen.queryByLabelText("Sort by")).toBeNull();
    expect(screen.queryByRole("button", { name: "Work" })).toBeNull();
  });

  it("should track its OWN page state for the Trash tab, independent of the Active tab's page", async () => {
    const user = userEvent.setup();
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "Trash" }));
    await waitFor(() => expect(listTrashSpy).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(listTrashSpy.mock.calls.at(-1)?.[0]).toEqual({
        page: 2,
        limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      }),
    );
  });

  it("should render a full-page ErrorFallback with a Retry action on a listNotes failure, and refetch on Retry click", async () => {
    listNotesSpy.mockReset();
    listNotesSpy
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValue(buildActivePage(1));

    const user = userEvent.setup();
    renderNotesPage();

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't load your notes. Please try again."),
      ).toBeDefined(),
    );

    const retryButton = screen.getByRole("button", { name: "Retry" });
    await user.click(retryButton);

    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(2));
  });

  it("should navigate to /notes/new when the first-run empty-state CTA is clicked", async () => {
    listNotesSpy.mockReset();
    listNotesSpy.mockResolvedValue(EMPTY_ACTIVE_PAGE);

    const user = userEvent.setup();
    renderNotesPage();

    const cta = await screen.findByRole("button", {
      name: "Create your first note",
    });
    await user.click(cta);

    await waitFor(() =>
      expect(screen.getByText("Note detail stub")).toBeDefined(),
    );
  });

  it("should render a persistent sidebar wrapper alongside a mobile Sheet-navigation trigger (breakpoint CSS itself is not evaluated in jsdom)", async () => {
    renderNotesPage();
    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));

    expect(screen.getAllByText("Active Notes").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeDefined();
  });
});
