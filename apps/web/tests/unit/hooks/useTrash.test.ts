import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { PaginatedNotesResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { useTrash } from "@/hooks/useTrash";

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

const EMPTY_RESPONSE: PaginatedNotesResponseDto = {
  notes: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

describe("useTrash ([SDS §5.2] Trash query passes no sort/limit override, only page/limit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call listTrash with an object containing only page/limit keys — never sort/order/tagIds/tagMode", async () => {
    const listTrashSpy = vi
      .spyOn(notesApi, "listTrash")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();
    const params = { page: 1, limit: 20 };

    renderHook(() => useTrash(params), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(listTrashSpy).toHaveBeenCalledTimes(1));

    const calledWith = listTrashSpy.mock.calls[0][0];
    expect(Object.keys(calledWith).sort()).toEqual(["limit", "page"]);
    expect(calledWith).not.toHaveProperty("sort");
    expect(calledWith).not.toHaveProperty("order");
    expect(calledWith).not.toHaveProperty("tagIds");
    expect(calledWith).not.toHaveProperty("tagMode");
  });

  it("should key the query as ['notes', 'trash', params] and refetch on page change", async () => {
    const listTrashSpy = vi
      .spyOn(notesApi, "listTrash")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();

    const { rerender } = renderHook(({ params }) => useTrash(params), {
      wrapper: createWrapper(queryClient),
      initialProps: { params: { page: 1, limit: 20 } },
    });

    await waitFor(() => expect(listTrashSpy).toHaveBeenCalledTimes(1));

    const cacheKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey);
    expect(cacheKeys).toContainEqual([
      "notes",
      "trash",
      { page: 1, limit: 20 },
    ]);

    rerender({ params: { page: 2, limit: 20 } });

    await waitFor(() => expect(listTrashSpy).toHaveBeenCalledTimes(2));
    expect(listTrashSpy).toHaveBeenNthCalledWith(2, { page: 2, limit: 20 });
  });
});
