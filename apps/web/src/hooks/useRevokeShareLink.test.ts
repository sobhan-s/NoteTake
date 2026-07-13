import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import * as shareApi from "@/api/share.api";
import { useRevokeShareLink } from "@/hooks/useRevokeShareLink";
import { mapApiError } from "@/lib/errorMessages";

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

// [Requirement: Revoke Share Link Requires Explicit Confirmation] `useRevokeShareLink` mutation behavior.
describe("useRevokeShareLink ([Requirement: Revoke Share Link Requires Explicit Confirmation])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("[Scenario: Owner confirms revoke] on success SHALL invalidate exactly the share/detail/list query keys and toast SHARE_LINK_REVOKED_SUCCESS for 3000ms", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "revokeShareLink").mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRevokeShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "share", "note-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "detail", "note-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "list"],
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(toast.success).toHaveBeenCalledWith(
      UI_COPY.SHARE_LINK_REVOKED_SUCCESS,
      { duration: 3000 },
    );
  });

  it('[Scenario: Revoke request fails] on failure SHALL invalidate ONLY ["notes","share",noteId] (re-fetch current state, no optimistic apply) and toast mapApiError(code) for 5000ms', async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "revokeShareLink").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "SHARE_LINK_NOT_FOUND" } },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRevokeShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeDefined();
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "share", "note-1"],
    });
    expect(toast.error).toHaveBeenCalledWith(
      mapApiError("SHARE_LINK_NOT_FOUND"),
      {
        duration: 5000,
      },
    );
  });

  it("[Scenario: Revoke request fails] on failure with no response payload (network error) SHALL still invalidate the share key and toast the generic mapApiError message", async () => {
    const queryClient = createTestQueryClient();
    vi.spyOn(shareApi, "revokeShareLink").mockRejectedValue({
      isAxiosError: true,
      message: "Network Error",
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRevokeShareLink("note-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeDefined();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notes", "share", "note-1"],
    });
    expect(toast.error).toHaveBeenCalledWith(mapApiError(undefined), {
      duration: 5000,
    });
  });
});
