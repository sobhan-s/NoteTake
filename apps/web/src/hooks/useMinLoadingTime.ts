import { useEffect, useRef, useState } from "react";
import { MIN_LOADING_DISPLAY_MS } from "@/constants/ui.constant";

export function useMinLoadingTime(isLoading: boolean): boolean {
  const [holdLoading, setHoldLoading] = useState(isLoading);
  const loadingStartedAtRef = useRef<number | null>(
    isLoading ? Date.now() : null,
  );

  useEffect(() => {
    if (isLoading) {
      loadingStartedAtRef.current = Date.now();
      setHoldLoading(true);
      return;
    }

    const startedAt = loadingStartedAtRef.current;
    if (startedAt === null) {
      setHoldLoading(false);
      return;
    }

    const elapsed = Date.now() - startedAt;
    const remaining = MIN_LOADING_DISPLAY_MS - elapsed;

    if (remaining <= 0) {
      setHoldLoading(false);
      return;
    }

    const timeout = setTimeout(() => setHoldLoading(false), remaining);
    return () => clearTimeout(timeout);
  }, [isLoading]);

  return holdLoading;
}
