import { Button } from "@/components/ui/Button";

export interface ErrorFallbackProps {
  message: string;
  onRetry: () => void;
}

export function ErrorFallback({ message, onRetry }: ErrorFallbackProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-lg font-semibold text-zinc-900">
        Something went wrong
      </h2>
      <p className="max-w-sm text-sm text-zinc-500">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
