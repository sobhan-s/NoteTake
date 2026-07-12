import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "@/hooks/useDebounce";

const DELAY_MS = 300;

describe("useDebounce ([FRS-8.4, Decision D5] generic value-debouncing hook backing 300ms search debounce)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("SHALL return the initial value immediately on first render, before any timer elapses", () => {
    const { result } = renderHook(() => useDebounce("initial", DELAY_MS));
    expect(result.current).toBe("initial");
  });

  it("SHALL NOT commit a new value before delayMs - 1ms has elapsed since the value changed", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, DELAY_MS),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });

    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 1);
    });

    expect(result.current).toBe("a");
  });

  it("SHALL commit the new value at exactly delayMs after the value last changed", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, DELAY_MS),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });

    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });

    expect(result.current).toBe("b");
  });

  it("SHALL reset the timer on rapid successive value changes, never committing an intermediate value", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, DELAY_MS),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 50);
    });
    expect(result.current).toBe("a");

    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 50);
    });
    // Still "a" — the second keystroke reset the timer before it fired.
    expect(result.current).toBe("a");

    rerender({ value: "abcd" });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });

    // Only the final value is ever committed — "ab" and "abc" were never observed.
    expect(result.current).toBe("abcd");
  });
});
