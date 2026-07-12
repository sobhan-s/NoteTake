import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { PaginatedNotesResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { useActiveNotes } from "@/hooks/useActiveNotes";

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

describe("useActiveNotes ([SDS §5.1] useActiveNotes(params) query-key-embeds-all-params pattern)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should embed the full params object passed in into the TanStack Query key", async () => {
    const listNotesSpy = vi
      .spyOn(notesApi, "listNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();
    const params = {
      page: 1,
      limit: 20,
      sort: "updatedAt" as const,
      order: "desc" as const,
    };

    renderHook(() => useActiveNotes(params), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(listNotesSpy).toHaveBeenCalledWith(params);
    });

    const cacheKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey);

    expect(cacheKeys).toContainEqual(["notes", "list", params]);
  });

  it("should issue a NEW call to listNotes when the sort param changes between renders, never reordering a cached array client-side", async () => {
    const listNotesSpy = vi
      .spyOn(notesApi, "listNotes")
      .mockResolvedValue(EMPTY_RESPONSE);
    const queryClient = createTestQueryClient();

    const { rerender } = renderHook(({ params }) => useActiveNotes(params), {
      wrapper: createWrapper(queryClient),
      initialProps: {
        params: {
          page: 1,
          limit: 20,
          sort: "updatedAt" as const,
          order: "desc" as const,
        },
      },
    });

    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(1));
    expect(listNotesSpy).toHaveBeenNthCalledWith(1, {
      page: 1,
      limit: 20,
      sort: "updatedAt",
      order: "desc",
    });

    rerender({
      params: {
        page: 1,
        limit: 20,
        sort: "title" as const,
        order: "desc" as const,
      },
    });

    await waitFor(() => expect(listNotesSpy).toHaveBeenCalledTimes(2));
    expect(listNotesSpy).toHaveBeenNthCalledWith(2, {
      page: 1,
      limit: 20,
      sort: "title",
      order: "desc",
    });
  });
});
