import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { ShareLinkResponseDto } from "@shared/core/types";
import * as shareApi from "@/api/share.api";
import { useGenerateShareLink } from "@/hooks/useGenerateShareLink";

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

function buildShareLink(
  overrides: Partial<ShareLinkResponseDto> = {},
): ShareLinkResponseDto {
  return {
    noteId: "note-1",
    token: "new-token",
    expiresAt: new Date("2026-02-08T00:00:00.000Z").toISOString(),
    viewCount: 0,
    createdAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

// [Requirement: Generate Share Link From the Modal] `useGenerateShareLink` mutation behavior.
describe("useGenerateShareLink ([Requirement: Generate Share Link From the Modal])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("[Scenario: Owner submits a valid expiry] SHALL call createShareLink with the noteId and { expiresInDays } payload", async () => {
    const queryClient = createTestQueryClient();
    const createSpy = vi
      .spyOn(shareApi, "createShareLink")
      .mockResolvedValue(buildShareLink());

    const { result } = renderHook(() => useGenerateShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ expiresInDays: 14 });
    });

    expect(createSpy).toHaveBeenCalledWith("note-1", { expiresInDays: 14 });
  });

  it('[Scenario: Owner submits a valid expiry] on success SHALL set ["notes","share",noteId] query data to the returned link directly (no re-fetch needed)', async () => {
    const queryClient = createTestQueryClient();
    const link = buildShareLink({ token: "freshly-created", viewCount: 0 });
    vi.spyOn(shareApi, "createShareLink").mockResolvedValue(link);

    const { result } = renderHook(() => useGenerateShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ expiresInDays: 7 });
    });

    expect(queryClient.getQueryData(["notes", "share", "note-1"])).toEqual(
      link,
    );
  });

  it('[Scenario: Owner submits a valid expiry] on success SHALL invalidate exactly ["notes","detail",noteId] and ["notes","list"] so hasActiveShareLink badges update with no caching lag', async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "createShareLink").mockResolvedValue(buildShareLink());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useGenerateShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ expiresInDays: 7 });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "detail", "note-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "list"],
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("[Scenario: Generate request fails] on failure SHALL NOT set share query data or invalidate any query key", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "createShareLink").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "NOTE_NOT_FOUND" } },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    const { result } = renderHook(() => useGenerateShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ expiresInDays: 7 }),
      ).rejects.toBeDefined();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
