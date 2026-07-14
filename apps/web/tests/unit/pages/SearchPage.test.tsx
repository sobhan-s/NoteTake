import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APP_LIMITS } from "@shared/core/constants";
import type { PaginatedSearchResponseDto } from "@shared/core/types";
import * as searchApi from "@/api/search.api";
import { useAuthStore } from "@/store/useAuthStore";
import { useUiStore } from "@/store/useUiStore";
import {
  SEARCH_DEBOUNCE_MS,
  MIN_LOADING_DISPLAY_MS,
} from "@/constants/ui.constant";
import { SearchPage } from "@/pages/SearchPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildPage(
  page: number,
  overrides: Partial<PaginatedSearchResponseDto> = {},
): PaginatedSearchResponseDto {
  return {
    results: [
      {
        id: `note-page-${page}`,
        title: `Result on page ${page}`,
        snippet: `A [[[MARK]]]match[[[MARK_END]]] on page ${page}.`,
        updatedAt: new Date().toISOString(),
      },
    ],
    pagination: {
      page,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
      total: 40,
      totalPages: 2,
    },
    ...overrides,
  };
}

function renderSearchPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/search"]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/notes/:id" element={<div>Note detail stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderProtectedSearchPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/search"]}>
        <Routes>
          <Route
            path="/search"
            element={
              <ProtectedRoute>
                <SearchPage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login Page Stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function advanceDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

// useMinLoadingTime holds the skeleton state for MIN_LOADING_DISPLAY_MS after a
// query settles; advance past that hold so settled results/errors are visible.
async function settleMinLoadingHold(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MIN_LOADING_DISPLAY_MS);
  });
}

describe("SearchPage ([FRS-8.4, Decision D5, D6] debounced query lifecycle, pagination, and error recovery)", () => {
  let searchNotesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    useUiStore.setState({ isMobileSidebarOpen: false });
    searchNotesSpy = vi.spyOn(searchApi, "searchNotes");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useUiStore.setState({ isMobileSidebarOpen: false });
  });

  it("[Decision D6] SHALL issue zero search requests while the input is empty, on initial render", async () => {
    searchNotesSpy.mockResolvedValue(buildPage(1));
    renderSearchPage();

    await advanceDebounce();

    expect(searchNotesSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Start typing to search your notes")).toBeDefined();
  });

  it("[FRS-8.4, Decision D5] rapid successive keystrokes SHALL coalesce into exactly one fresh search request, sent with page=1", async () => {
    searchNotesSpy.mockResolvedValue(buildPage(1));
    renderSearchPage();

    const input = screen.getByLabelText("Search notes");

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ar" } });
    fireEvent.change(input, { target: { value: "arc" } });

    await advanceDebounce();
    await flushMicrotasks();

    expect(searchNotesSpy).toHaveBeenCalledTimes(1);
    expect(searchNotesSpy).toHaveBeenCalledWith({
      q: "arc",
      page: 1,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
    });
  });

  it("[FRS-4.3, FRS-8.4] changing the page SHALL issue a fresh backend request for the same query and render that page's own results, never a reused/re-sliced prior array", async () => {
    searchNotesSpy
      .mockResolvedValueOnce(buildPage(1))
      .mockResolvedValueOnce(buildPage(2));
    renderSearchPage();

    const input = screen.getByLabelText("Search notes");
    fireEvent.change(input, { target: { value: "arch" } });
    await advanceDebounce();
    await flushMicrotasks();
    await settleMinLoadingHold();

    expect(searchNotesSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Result on page 1")).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleMinLoadingHold();

    expect(searchNotesSpy).toHaveBeenCalledTimes(2);
    expect(searchNotesSpy).toHaveBeenNthCalledWith(2, {
      q: "arch",
      page: 2,
      limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
    });

    expect(screen.getByText("Result on page 2")).toBeDefined();
    expect(screen.queryByText("Result on page 1")).toBeNull();
  });

  it("[Error Scenario] a request failure SHALL render ErrorFallback with a working retry action and render zero stale/partial results underneath", async () => {
    searchNotesSpy
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce(buildPage(1));
    renderSearchPage();

    const input = screen.getByLabelText("Search notes");
    fireEvent.change(input, { target: { value: "arch" } });
    await advanceDebounce();
    await flushMicrotasks();

    expect(
      screen.getByText("We couldn't run your search. Please try again."),
    ).toBeDefined();
    expect(screen.queryByText(/Result on page/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleMinLoadingHold();

    expect(searchNotesSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Result on page 1")).toBeDefined();
    expect(
      screen.queryByText("We couldn't run your search. Please try again."),
    ).toBeNull();
  });

  it("[docs/ux.md §6] unauthenticated visitor rendering the protected /search route SHALL be redirected to /login without firing a search request (ProtectedRoute guard unchanged)", async () => {
    useAuthStore.getState().reset();
    searchNotesSpy.mockResolvedValue(buildPage(1));
    const axiosPostSpy = vi
      .spyOn(axios, "post")
      .mockRejectedValue(new Error("No session"));

    renderProtectedSearchPage();
    await flushMicrotasks();

    expect(screen.getByText("Login Page Stub")).toBeDefined();
    expect(screen.queryByLabelText("Search notes")).toBeNull();

    await advanceDebounce();
    expect(searchNotesSpy).not.toHaveBeenCalled();
    axiosPostSpy.mockRestore();
  });
});
