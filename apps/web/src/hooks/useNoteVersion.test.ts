import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { NoteVersionResponseDto } from "@shared/core/types";
import * as noteVersionApi from "@/api/note-version.api";
import { useNoteVersion } from "@/hooks/useNoteVersion";

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

function buildVersion(
  overrides: Partial<NoteVersionResponseDto> = {},
): NoteVersionResponseDto {
  return {
    id: "v-1",
    noteId: "note-1",
    titleSnapshot: "Title Snapshot",
    bodySnapshot: "<p>Body Snapshot</p>",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function build404Error() {
  return {
    isAxiosError: true,
    response: {
      status: 404,
      data: { success: false, error: { code: "VERSION_NOT_FOUND" } },
    },
  };
}

// [Requirement: Selecting a Version Shows a Read-Only Preview (Split View)] `useNoteVersion` query behavior.
describe("useNoteVersion ([FRS-6.3] enabled gating and per-version fetch)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('SHALL call getNoteVersion with the exact noteId/versionId and key the query at ["notes","versions",noteId,versionId]', async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(noteVersionApi, "getNoteVersion")
      .mockResolvedValue(buildVersion());

    const { result } = renderHook(() => useNoteVersion("note-1", "v-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getSpy).toHaveBeenCalledWith("note-1", "v-1");
    expect(
      queryClient.getQueryData(["notes", "versions", "note-1", "v-1"]),
    ).toEqual(buildVersion());
  });

  it("[Scenario: enabled = versionId !== null] SHALL NOT fetch at all while versionId is null (no version selected)", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(noteVersionApi, "getNoteVersion")
      .mockResolvedValue(buildVersion());

    renderHook(() => useNoteVersion("note-1", null), {
      wrapper: createWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("[Scenario: enabled = versionId !== null] SHALL fetch as soon as versionId transitions from null to a real id", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(noteVersionApi, "getNoteVersion")
      .mockResolvedValue(buildVersion());

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string | null }) =>
        useNoteVersion("note-1", versionId),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { versionId: null as string | null },
      },
    );

    expect(getSpy).not.toHaveBeenCalled();

    rerender({ versionId: "v-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledWith("note-1", "v-1");
  });

  it("[Scenario: Selected version has been purged since the list was fetched] SHALL surface a 404 (VERSION_NOT_FOUND) error with response.status 404 for the caller to branch on", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(noteVersionApi, "getNoteVersion").mockRejectedValue(
      build404Error(),
    );

    const { result } = renderHook(
      () => useNoteVersion("note-1", "purged-version"),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as unknown as {
      response: { status: number };
    };
    expect(error.response.status).toBe(404);
  });

  it("[FRS-8.4] retry:false SHALL NOT re-invoke getNoteVersion after the initial failure, regardless of elapsed time", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(noteVersionApi, "getNoteVersion")
      .mockRejectedValue(build404Error());

    const { result } = renderHook(() => useNoteVersion("note-1", "v-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getSpy).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("[FRS-8.4] staleTime:0 SHALL cause a fresh re-fetch when versionId toggles from a value back to null and to a (possibly different) value", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(noteVersionApi, "getNoteVersion")
      .mockResolvedValue(buildVersion());

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string | null }) =>
        useNoteVersion("note-1", versionId),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { versionId: "v-1" as string | null },
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledTimes(1);

    rerender({ versionId: null });
    rerender({ versionId: "v-1" });

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });
});
