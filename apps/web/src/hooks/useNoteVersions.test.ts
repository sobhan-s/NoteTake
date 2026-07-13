import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { NoteVersionSummaryDto } from "@shared/core/types";
import * as noteVersionApi from "@/api/note-version.api";
import { useNoteVersions } from "@/hooks/useNoteVersions";

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

function buildVersions(): NoteVersionSummaryDto[] {
  return [
    {
      id: "v-2",
      titleSnapshot: "Newer",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "v-1",
      titleSnapshot: "Older",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
}

function build500Error() {
  return {
    isAxiosError: true,
    response: {
      status: 500,
      data: { success: false, error: { code: "INTERNAL_ERROR" } },
    },
  };
}

// [Requirement: Version History Drawer Fetches and Lists Versions on Open] `useNoteVersions` query behavior.
describe("useNoteVersions ([FRS-6.2, FRS-8.4] fresh fetch on every drawer open, no caching relied upon)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('SHALL call listNoteVersions with the exact noteId and key the query at ["notes","versions",noteId]', async () => {
    const queryClient = createTestQueryClient();
    const listSpy = vi
      .spyOn(noteVersionApi, "listNoteVersions")
      .mockResolvedValue(buildVersions());

    const { result } = renderHook(() => useNoteVersions("note-1", true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listSpy).toHaveBeenCalledWith("note-1");
    expect(queryClient.getQueryData(["notes", "versions", "note-1"])).toEqual(
      buildVersions(),
    );
  });

  it("[Scenario: enabled wired to drawer open] SHALL NOT fetch at all while `enabled` (the drawer's `open` prop) is false", async () => {
    const queryClient = createTestQueryClient();
    const listSpy = vi
      .spyOn(noteVersionApi, "listNoteVersions")
      .mockResolvedValue(buildVersions());

    renderHook(() => useNoteVersions("note-1", false), {
      wrapper: createWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("[FRS-8.4] staleTime:0 SHALL cause a fresh re-fetch every time the drawer re-opens (enabled toggles false -> true)", async () => {
    const queryClient = createTestQueryClient();
    const listSpy = vi
      .spyOn(noteVersionApi, "listNoteVersions")
      .mockResolvedValue(buildVersions());

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNoteVersions("note-1", enabled),
      { wrapper: createWrapper(queryClient), initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listSpy).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    rerender({ enabled: true });

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it("[Scenario: List fetch fails] SHALL surface a network/5xx error with retry:false, never re-invoking listNoteVersions after the initial failure", async () => {
    const queryClient = createTestQueryClient();
    const listSpy = vi
      .spyOn(noteVersionApi, "listNoteVersions")
      .mockRejectedValue(build500Error());

    const { result } = renderHook(() => useNoteVersions("note-1", true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listSpy).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});
