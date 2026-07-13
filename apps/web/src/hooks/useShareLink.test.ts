import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { ShareLinkResponseDto } from "@shared/core/types";
import * as shareApi from "@/api/share.api";
import { useShareLink } from "@/hooks/useShareLink";

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
    token: "abc123token",
    expiresAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
    viewCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function build404Error() {
  return {
    isAxiosError: true,
    response: {
      status: 404,
      data: { success: false, error: { code: "SHARE_LINK_NOT_FOUND" } },
    },
  };
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

// [Requirement: Share Modal Fetches Current Link State on Open] `useShareLink` query behavior.
describe("useShareLink ([Requirement: Share Modal Fetches Current Link State on Open], [FRS-8.4] no client-side derivation)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('SHALL call getShareLink with the exact noteId and key the query at ["notes","share",noteId]', async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(shareApi, "getShareLink")
      .mockResolvedValue(buildShareLink());

    const { result } = renderHook(() => useShareLink("note-1", true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getSpy).toHaveBeenCalledWith("note-1");
    expect(queryClient.getQueryData(["notes", "share", "note-1"])).toEqual(
      buildShareLink(),
    );
  });

  it("[Scenario: Modal opens for a note with no active link] SHALL NOT fetch at all while `enabled` is false", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(shareApi, "getShareLink")
      .mockResolvedValue(buildShareLink());

    renderHook(() => useShareLink("note-1", false), {
      wrapper: createWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("[Scenario: Modal opens for a note with no active link] SHALL surface a 404 (SHARE_LINK_NOT_FOUND) error with response.status 404 for the caller to branch on", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "getShareLink").mockRejectedValue(build404Error());

    const { result } = renderHook(() => useShareLink("note-1", true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as unknown as {
      response: { status: number };
    };
    expect(error.response.status).toBe(404);
  });

  it("[Scenario: Modal fetch fails on open] SHALL surface a network/5xx error with a response.status distinctly different from 404", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "getShareLink").mockRejectedValue(build500Error());

    const { result } = renderHook(() => useShareLink("note-1", true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as unknown as {
      response: { status: number };
    };
    expect(error.response.status).toBe(500);
    expect(error.response.status).not.toBe(404);
  });

  it("[FRS-8.4] retry:false SHALL NOT re-invoke getShareLink after the initial failure, regardless of elapsed time", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(shareApi, "getShareLink")
      .mockRejectedValue(build500Error());

    const { result } = renderHook(() => useShareLink("note-1", true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getSpy).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("[Requirement: Share Modal Fetches Current Link State on Open] staleTime:0 SHALL cause a fresh re-fetch when `enabled` toggles from true to false and back to true", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(shareApi, "getShareLink")
      .mockResolvedValue(buildShareLink());

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useShareLink("note-1", enabled),
      { wrapper: createWrapper(queryClient), initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    rerender({ enabled: true });

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });
});
