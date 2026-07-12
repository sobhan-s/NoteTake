import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";
import { MIN_LOADING_DISPLAY_MS } from "@/constants/ui.constant";

describe("useMinLoadingTime [docs/ux.md §1, FRS-8.4 Active notes list loads with default params scenario]", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should hold true immediately when isLoading is true initially", () => {
    const { result } = renderHook(() => useMinLoadingTime(true));
    expect(result.current).toBe(true);
  });

  it("should hold true for at least MIN_LOADING_DISPLAY_MS when isLoading flips to false faster than the minimum duration", () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useMinLoadingTime(loading),
      {
        initialProps: { loading: true },
      },
    );

    expect(result.current).toBe(true);

    const initialStep = Math.floor(MIN_LOADING_DISPLAY_MS / 4);

    // Advance time by a fraction of MIN_LOADING_DISPLAY_MS
    act(() => {
      vi.advanceTimersByTime(initialStep);
    });

    // Flip query isLoading to false
    rerender({ loading: false });

    // Should STILL be true because MIN_LOADING_DISPLAY_MS total has not elapsed yet
    expect(result.current).toBe(true);

    // Advance to 1ms before MIN_LOADING_DISPLAY_MS elapsed
    act(() => {
      vi.advanceTimersByTime(MIN_LOADING_DISPLAY_MS - 1 - initialStep);
    });
    expect(result.current).toBe(true);

    // Advance past the MIN_LOADING_DISPLAY_MS threshold
    act(() => {
      vi.advanceTimersByTime(2);
    });

    expect(result.current).toBe(false);
  });

  it("should transition to false immediately if the query duration already exceeded MIN_LOADING_DISPLAY_MS", () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useMinLoadingTime(loading),
      {
        initialProps: { loading: true },
      },
    );

    expect(result.current).toBe(true);

    // Advance time exceeding MIN_LOADING_DISPLAY_MS
    act(() => {
      vi.advanceTimersByTime(MIN_LOADING_DISPLAY_MS + 100);
    });

    // Now flip query isLoading to false
    rerender({ loading: false });

    // Should drop to false immediately without extra timer delays
    expect(result.current).toBe(false);
  });

  it("should return false immediately when isLoading starts as false", () => {
    const { result } = renderHook(() => useMinLoadingTime(false));
    expect(result.current).toBe(false);
  });
});
