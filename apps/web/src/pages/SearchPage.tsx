import { useState } from "react";
import { Menu } from "lucide-react";
import { APP_LIMITS } from "@shared/core/constants";
import { useSearchNotes } from "@/hooks/useSearchNotes";
import { useDebounce } from "@/hooks/useDebounce";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";
import { useUiStore } from "@/store/useUiStore";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { Sheet } from "@/components/ui/Sheet";
import { SearchInput } from "@/components/search/SearchInput";
import { SearchResultsList } from "@/components/search/SearchResultsList";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { Button } from "@/components/ui/Button";
import { SEARCH_DEBOUNCE_MS } from "@/constants/ui.constant";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const isMobileSidebarOpen = useUiStore((state) => state.isMobileSidebarOpen);
  const openMobileSidebar = useUiStore((state) => state.openMobileSidebar);
  const closeMobileSidebar = useUiStore((state) => state.closeMobileSidebar);

  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  const searchQuery = useSearchNotes({
    q: trimmedQuery,
    page,
    limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
  });

  const isLoading = useMinLoadingTime(searchQuery.isLoading);

  function handleQueryChange(next: string): void {
    setQuery(next);
    setPage(1);
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <div className="hidden lg:flex lg:w-[260px] lg:flex-shrink-0 lg:border-r lg:border-zinc-200 lg:bg-white lg:p-4">
        <SidebarNav />
      </div>
      <Sheet
        open={isMobileSidebarOpen}
        onOpenChange={(open) =>
          open ? openMobileSidebar() : closeMobileSidebar()
        }
        title="Notes navigation"
      >
        <SidebarNav />
      </Sheet>
      <div className="flex w-full flex-1 flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="lg:hidden"
            onClick={openMobileSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="flex-1">
            <SearchInput value={query} onChange={handleQueryChange} />
          </div>
        </div>
        {searchQuery.isError ? (
          <ErrorFallback
            message="We couldn't run your search. Please try again."
            onRetry={() => searchQuery.refetch()}
          />
        ) : (
          <SearchResultsList
            hasQuery={trimmedQuery.length > 0}
            isLoading={isLoading}
            results={searchQuery.data?.results ?? []}
            pagination={searchQuery.data?.pagination}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
