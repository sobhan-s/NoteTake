import { Button } from "@/components/ui/Button";

export interface PaginationControlProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PaginationControl({
  page,
  totalPages,
  onPageChange,
}: PaginationControlProps) {
  const safeTotalPages = Math.max(totalPages, 1);

  return (
    <div className="flex items-center justify-center gap-4">
      <Button
        variant="outline"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        Previous
      </Button>
      <span className="text-sm text-zinc-500">
        Page {page} of {safeTotalPages}
      </span>
      <Button
        variant="outline"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= safeTotalPages}
      >
        Next
      </Button>
    </div>
  );
}
