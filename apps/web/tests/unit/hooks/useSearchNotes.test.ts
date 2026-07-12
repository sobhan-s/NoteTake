import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { PaginatedSearchResponseDto } from "@shared/core/types";
import * as searchApi from "@/api/search.api";
import { useSearchNotes } from "@/hooks/useSearchNotes";

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const EMPTY_RESPONSE: PaginatedSearchResponseDto = {
  results: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

describe("useSearchNotes ([Decision D6] client-side guard against ever sending an empty/whitespace query)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SHALL leave the query disabled (queryFn never invoked) when q is an empty string", async () => {
    const searchNotesSpy = vi
      .spyOn(searchApi, "searchNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () => useSearchNotes({ q: "", page: 1, limit: 20 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isFetching).toBe(false);
    // Give any microtask queue a chance to flush before asserting zero calls.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(searchNotesSpy).not.toHaveBeenCalled();
  });

  it("SHALL leave the query disabled (queryFn never invoked) when q is whitespace-only", async () => {
    const searchNotesSpy = vi
      .spyOn(searchApi, "searchNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();

    renderHook(() => useSearchNotes({ q: "   ", page: 1, limit: 20 }), {
      wrapper: createWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(searchNotesSpy).not.toHaveBeenCalled();
  });

  it("SHALL leave the query disabled (queryFn never invoked) when q is entirely omitted from params", async () => {
    const searchNotesSpy = vi
      .spyOn(searchApi, "searchNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();

    renderHook(() => useSearchNotes({ page: 1, limit: 20 }), {
      wrapper: createWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(searchNotesSpy).not.toHaveBeenCalled();
  });

  it("SHALL fire searchNotes with the exact trimmed q/page/limit params for a genuine non-empty query", async () => {
    const searchNotesSpy = vi
      .spyOn(searchApi, "searchNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();
    const params = { q: "architecture", page: 2, limit: 20 };

    renderHook(() => useSearchNotes(params), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(searchNotesSpy).toHaveBeenCalledTimes(1));
    expect(searchNotesSpy).toHaveBeenCalledWith(params);
  });

  it("SHALL embed the exact params object in the query key as ['search', 'list', params]", async () => {
    vi.spyOn(searchApi, "searchNotes").mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();
    const params = { q: "architecture", page: 1, limit: 20 };

    renderHook(() => useSearchNotes(params), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      const cacheKeys = queryClient
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey);
      expect(cacheKeys).toContainEqual(["search", "list", params]);
    });
  });

  it("SHALL re-fire searchNotes with new params (never reusing the prior cached page) when params change", async () => {
    const searchNotesSpy = vi
      .spyOn(searchApi, "searchNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();

    const { rerender } = renderHook(({ params }) => useSearchNotes(params), {
      wrapper: createWrapper(queryClient),
      initialProps: { params: { q: "architecture", page: 1, limit: 20 } },
    });

    await waitFor(() => expect(searchNotesSpy).toHaveBeenCalledTimes(1));

    rerender({ params: { q: "architecture", page: 2, limit: 20 } });

    await waitFor(() => expect(searchNotesSpy).toHaveBeenCalledTimes(2));
    expect(searchNotesSpy).toHaveBeenNthCalledWith(2, {
      q: "architecture",
      page: 2,
      limit: 20,
    });
  });
});
