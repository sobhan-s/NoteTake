import { UI_COPY } from "@shared/core/constants";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { AutosaveStatus } from "@/hooks/useNoteAutosave";

export interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  onRetry: () => void;
}

export function AutosaveIndicator({ status, onRetry }: AutosaveIndicatorProps) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-yellow-300 bg-[#fef08a] px-3 py-1 text-xs font-medium text-zinc-900">
        <span>{UI_COPY.AUTOSAVE_ERROR}</span>
        <Button
          type="button"
          variant="outline"
          className="h-6 min-w-0 px-2 py-0 text-xs"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        status === "saving" && "border-zinc-200 bg-zinc-100 text-zinc-600",
        status === "saved" && "border-green-200 bg-green-50 text-green-700",
      )}
    >
      {status === "saving" ? (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
            aria-hidden="true"
          />
          <span>{UI_COPY.AUTOSAVE_SAVING}</span>
        </span>
      ) : (
        UI_COPY.AUTOSAVE_SAVED
      )}
    </div>
  );
}
