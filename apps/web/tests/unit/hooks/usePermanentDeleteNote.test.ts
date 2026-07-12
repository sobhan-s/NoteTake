import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import * as notesApi from "@/api/notes.api";
import { usePermanentDeleteNote } from "@/hooks/usePermanentDeleteNote";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

describe("usePermanentDeleteNote ([FRS-2.2.8] Permanent delete mutation, confirm: true contract)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call permanentDeleteNote(id, { confirm: true }), invalidate ['notes','trash'], and toast.success on 200 OK", async () => {
    const permanentDeleteSpy = vi
      .spyOn(notesApi, "permanentDeleteNote")
      .mockResolvedValue({ id: "note-1" });
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePermanentDeleteNote(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: "note-1", input: { confirm: true } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(permanentDeleteSpy).toHaveBeenCalledWith("note-1", {
      confirm: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "trash"],
    });
    expect(toast.success).toHaveBeenCalledWith(
      UI_COPY.PERMANENT_DELETE_SUCCESS,
      { duration: 3000 },
    );
  });

  it("should invalidate ['notes','trash'] and toast.error when the server returns 404 (already purged)", async () => {
    const notFoundError = {
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "NOTE_NOT_FOUND" } },
      },
    };
    vi.spyOn(notesApi, "permanentDeleteNote").mockRejectedValue(notFoundError);
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePermanentDeleteNote(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: "note-1", input: { confirm: true } });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "trash"],
    });
    expect(toast.error).toHaveBeenCalledWith(
      "This note is no longer available.",
      { duration: 5000 },
    );
  });
});
