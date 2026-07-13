import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { PublicNoteResponseDto } from "@shared/core/types";
import * as shareApi from "@/api/share.api";
import { usePublicShareNote } from "@/hooks/usePublicShareNote";

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

function buildPublicNote(
  overrides: Partial<PublicNoteResponseDto> = {},
): PublicNoteResponseDto {
  return {
    title: "Public Title",
    body: "<p>Public body</p>",
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

// [Requirement: Public Share Page Fetches and Renders Read-Only Content] `usePublicShareNote` query behavior.
describe("usePublicShareNote ([Requirement: Public Share Page Fetches and Renders Read-Only Content])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('SHALL call getPublicShareNote with the exact token and key the query at ["public","share",token]', async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi
      .spyOn(shareApi, "getPublicShareNote")
      .mockResolvedValue(buildPublicNote());

    const { result } = renderHook(() => usePublicShareNote("token-abc"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getSpy).toHaveBeenCalledWith("token-abc");
    expect(queryClient.getQueryData(["public", "share", "token-abc"])).toEqual(
      buildPublicNote(),
    );
  });

  it("[Scenario: Invalid link (any cause)] SHALL surface the rejection with response.status 404 without retrying (retry:false)", async () => {
    const queryClient = createTestQueryClient();
    const getSpy = vi.spyOn(shareApi, "getPublicShareNote").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "SHARE_LINK_UNAVAILABLE" } },
      },
    });

    const { result } = renderHook(() => usePublicShareNote("bad-token"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getSpy).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("a distinct token SHALL key an entirely separate cache entry from a previously-fetched token", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "getPublicShareNote").mockImplementation((token) =>
      Promise.resolve(buildPublicNote({ title: `Title for ${token}` })),
    );

    const { result, rerender } = renderHook(
      ({ token }: { token: string }) => usePublicShareNote(token),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { token: "token-a" },
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Title for token-a");

    rerender({ token: "token-b" });

    await waitFor(() =>
      expect(result.current.data?.title).toBe("Title for token-b"),
    );
    expect(queryClient.getQueryData(["public", "share", "token-a"])).toEqual(
      buildPublicNote({ title: "Title for token-a" }),
    );
  });
});
