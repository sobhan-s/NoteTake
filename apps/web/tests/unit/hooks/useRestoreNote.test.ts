import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import type {
  NoteResponseDto,
  PaginatedNotesResponseDto,
} from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { useRestoreNote } from "@/hooks/useRestoreNote";

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

function buildNote(id: string): NoteResponseDto {
  return {
    id,
    title: `Note ${id}`,
    body: "<p>body</p>",
    deletedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
  };
}

const TRASH_PARAMS = { page: 1, limit: 20 };

describe("useRestoreNote ([Trash restore mutation scenario, SDS §5.2])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call restoreNote(id), invalidate ['notes','trash'] and ['notes','list'], and toast.success on 200 OK", async () => {
    const restoreNoteSpy = vi
      .spyOn(notesApi, "restoreNote")
      .mockResolvedValue(buildNote("note-1"));
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRestoreNote(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate("note-1");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(restoreNoteSpy.mock.calls[0][0]).toBe("note-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "trash"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["notes", "list"] });
    expect(toast.success).toHaveBeenCalledWith(UI_COPY.TRASH_RESTORE_SUCCESS, {
      duration: 3000,
    });
  });

  it("should optimistically remove the note from cached ['notes','trash'] pages on a 404 response, without a full invalidate/refetch", async () => {
    const notFoundError = {
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "NOTE_NOT_FOUND" } },
      },
    };
    vi.spyOn(notesApi, "restoreNote").mockRejectedValue(notFoundError);
    const queryClient = createTestQueryClient();

    const seededTrash: PaginatedNotesResponseDto = {
      notes: [buildNote("note-1"), buildNote("note-2")],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    };
    queryClient.setQueryData(["notes", "trash", TRASH_PARAMS], seededTrash);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRestoreNote(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate("note-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<PaginatedNotesResponseDto>([
      "notes",
      "trash",
      TRASH_PARAMS,
    ]);
    expect(cached?.notes.map((note) => note.id)).toEqual(["note-2"]);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "This note is no longer available.",
      { duration: 5000 },
    );
  });

  it("should NOT remove any cached note when the error is not a 404 (e.g. 500), but SHALL still toast.error", async () => {
    const serverError = {
      isAxiosError: true,
      response: {
        status: 500,
        data: { success: false, error: { code: "INTERNAL_ERROR" } },
      },
    };
    vi.spyOn(notesApi, "restoreNote").mockRejectedValue(serverError);
    const queryClient = createTestQueryClient();

    const seededTrash: PaginatedNotesResponseDto = {
      notes: [buildNote("note-1")],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    queryClient.setQueryData(["notes", "trash", TRASH_PARAMS], seededTrash);

    const { result } = renderHook(() => useRestoreNote(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate("note-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<PaginatedNotesResponseDto>([
      "notes",
      "trash",
      TRASH_PARAMS,
    ]);
    expect(cached?.notes.map((note) => note.id)).toEqual(["note-1"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Something went wrong. Please try again.",
      { duration: 5000 },
    );
  });
});
