import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UI_COPY } from "@shared/core/constants";
import type { SearchResultResponseDto } from "@shared/core/types";
import {
  SearchResultsList,
  type SearchResultsListProps,
} from "@/components/search/SearchResultsList";

function renderList(props: SearchResultsListProps) {
  return render(
    <MemoryRouter>
      <SearchResultsList {...props} />
    </MemoryRouter>,
  );
}

function buildResult(
  overrides: Partial<SearchResultResponseDto> = {},
): SearchResultResponseDto {
  return {
    id: "note-1",
    title: "Architecture Notes",
    snippet: "This is an [[[MARK]]]architecture[[[MARK_END]]] note.",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SearchResultsList ([Decision D6] pre-query prompt vs. zero-results empty state / [FRS-4.3, FRS-8.4] pagination gating)", () => {
  afterEach(() => {
    cleanup();
  });

  it("SHALL render the neutral pre-query prompt and issue zero network calls when hasQuery is false", () => {
    const onPageChange = vi.fn();
    renderList({
      hasQuery: false,
      isLoading: false,
      results: [],
      onPageChange,
    });

    expect(screen.getByText("Start typing to search your notes")).toBeDefined();
    expect(screen.queryByText(UI_COPY.EMPTY_SEARCH_RESULTS)).toBeNull();
    // The component takes no fetch dependency itself; asserting zero results/rows
    // rendered and the onPageChange callback untouched is the closest in-component
    // proxy for "zero network calls fired" — actual fetch guarding is owned by
    // useSearchNotes's `enabled` flag (covered separately).
    expect(onPageChange).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("SHALL render exactly 5 skeleton placeholder rows when isLoading is true", () => {
    const { container } = renderList({
      hasQuery: true,
      isLoading: true,
      results: [],
      onPageChange: vi.fn(),
    });

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
  });

  it("SHALL render the UI_COPY.EMPTY_SEARCH_RESULTS empty state with NO action/CTA button when results is empty and hasQuery is true", () => {
    renderList({
      hasQuery: true,
      isLoading: false,
      results: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      onPageChange: vi.fn(),
    });

    expect(screen.getByText(UI_COPY.EMPTY_SEARCH_RESULTS)).toBeDefined();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("SHALL render one row per result when results are non-empty", () => {
    renderList({
      hasQuery: true,
      isLoading: false,
      results: [
        buildResult({ id: "note-1", title: "First Note" }),
        buildResult({ id: "note-2", title: "Second Note" }),
      ],
      onPageChange: vi.fn(),
    });

    expect(screen.getByText("First Note")).toBeDefined();
    expect(screen.getByText("Second Note")).toBeDefined();
  });

  it("SHALL render PaginationControl when pagination.total > 0", () => {
    renderList({
      hasQuery: true,
      isLoading: false,
      results: [buildResult()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      onPageChange: vi.fn(),
    });

    expect(screen.getByText("Page 1 of 1")).toBeDefined();
  });

  it("SHALL NOT render PaginationControl when pagination is undefined", () => {
    renderList({
      hasQuery: true,
      isLoading: false,
      results: [buildResult()],
      onPageChange: vi.fn(),
    });

    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
  });

  it("SHALL NOT render PaginationControl when pagination.total is 0 even with non-empty results", () => {
    renderList({
      hasQuery: true,
      isLoading: false,
      results: [buildResult()],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      onPageChange: vi.fn(),
    });

    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
  });
});
