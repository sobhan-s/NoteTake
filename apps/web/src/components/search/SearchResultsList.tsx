import { Search } from "lucide-react";
import { UI_COPY } from "@shared/core/constants";
import type {
  PaginatedSearchResponseDto,
  SearchResultResponseDto,
} from "@shared/core/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchResultRow } from "@/components/search/SearchResultRow";
import { PaginationControl } from "@/components/notes/PaginationControl";

const SKELETON_ROW_COUNT = 5;

export interface SearchResultsListProps {
  hasQuery: boolean;
  isLoading: boolean;
  results: SearchResultResponseDto[];
  pagination?: PaginatedSearchResponseDto["pagination"];
  onPageChange: (page: number) => void;
}

export function SearchResultsList({
  hasQuery,
  isLoading,
  results,
  pagination,
  onPageChange,
}: SearchResultsListProps) {
  if (!hasQuery) {
    return (
      <EmptyState
        icon={Search}
        heading="Start typing to search your notes"
        subtext="Results will appear here as you type."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <EmptyState
        icon={Search}
        heading="No results"
        subtext={UI_COPY.EMPTY_SEARCH_RESULTS}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {results.map((result) => (
          <SearchResultRow key={result.id} result={result} />
        ))}
      </div>
      {pagination && pagination.total > 0 ? (
        <PaginationControl
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={onPageChange}
        />
      ) : null}
    </>
  );
}
