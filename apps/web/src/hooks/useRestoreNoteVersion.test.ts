import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { NoteResponseDto } from "@shared/core/types";
import * as noteVersionApi from "@/api/note-version.api";
import { useRestoreNoteVersion } from "@/hooks/useRestoreNoteVersion";

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

function buildNoteResponse(
  overrides: Partial<NoteResponseDto> = {},
): NoteResponseDto {
  return {
    id: "note-1",
    title: "Restored Title",
    body: "<p>Restored body</p>",
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    hasActiveShareLink: false,
    tags: [],
    ...overrides,
  };
}

// [Requirement: Confirmed Restore Applies the Server's Authoritative Content and Closes the Drawer]
// `useRestoreNoteVersion` mutation behavior.
describe("useRestoreNoteVersion ([FRS-6.4] restore mutation cache side effects)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("[FRS-6.4] SHALL call restoreNoteVersion with the exact noteId and mutate-call versionId", async () => {
    const queryClient = createTestQueryClient();
    const restoreSpy = vi
      .spyOn(noteVersionApi, "restoreNoteVersion")
      .mockResolvedValue(buildNoteResponse());

    const { result } = renderHook(() => useRestoreNoteVersion("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync("v-9");
    });

    expect(restoreSpy).toHaveBeenCalledWith("note-1", "v-9");
  });

  it('[FRS-6.4] on success SHALL set ["notes","detail",noteId] query data directly to the returned NoteResponseDto', async () => {
    const queryClient = createTestQueryClient();
    const restoredNote = buildNoteResponse({ title: "Restored via mutation" });
    vi.spyOn(noteVersionApi, "restoreNoteVersion").mockResolvedValue(
      restoredNote,
    );

    const { result } = renderHook(() => useRestoreNoteVersion("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync("v-9");
    });

    expect(queryClient.getQueryData(["notes", "detail", "note-1"])).toEqual(
      restoredNote,
    );
  });

  it('[FRS-6.4] on success SHALL invalidate exactly ["notes","detail",noteId], ["notes","list"], and ["notes","versions",noteId] (3 invalidations, no more)', async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(noteVersionApi, "restoreNoteVersion").mockResolvedValue(
      buildNoteResponse(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRestoreNoteVersion("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync("v-9");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "detail", "note-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "list"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "versions", "note-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  it("[Scenario: Restore fails] on failure SHALL NOT set any query data or invalidate any query key (component owns onError side effects)", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(noteVersionApi, "restoreNoteVersion").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "NOTE_NOT_FOUND" } },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    const { result } = renderHook(() => useRestoreNoteVersion("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.mutateAsync("v-9")).rejects.toBeDefined();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
