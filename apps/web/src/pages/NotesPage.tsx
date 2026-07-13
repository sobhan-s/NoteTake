import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Plus } from "lucide-react";
import { APP_LIMITS } from "@shared/core/constants";
import type { ListNotesQuery } from "@shared/core/types";
import { useActiveNotes } from "@/hooks/useActiveNotes";
import { useTrash } from "@/hooks/useTrash";
import { useTags } from "@/hooks/useTags";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";
import { useUiStore } from "@/store/useUiStore";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { Sheet } from "@/components/ui/Sheet";
import { NotesTabs } from "@/components/notes/NotesTabs";
import type { NotesTab } from "@/components/notes/NotesTabs";
import { SortControl } from "@/components/notes/SortControl";
import { TagFilterControl } from "@/components/notes/TagFilterControl";
import { NotesList } from "@/components/notes/NotesList";
import { PaginationControl } from "@/components/notes/PaginationControl";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { Button } from "@/components/ui/Button";

interface ActiveFilterState {
  page: number;
  sort: ListNotesQuery["sort"];
  order: ListNotesQuery["order"];
  selectedTagIds: string[];
  tagMode: "ALL" | "ANY";
}

const INITIAL_ACTIVE_FILTER_STATE: ActiveFilterState = {
  page: 1,
  sort: "updatedAt",
  order: "desc",
  selectedTagIds: [],
  tagMode: "ALL",
};

export function NotesPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<NotesTab>("active");
  const [filters, setFilters] = useState<ActiveFilterState>(
    INITIAL_ACTIVE_FILTER_STATE,
  );
  const [trashPage, setTrashPage] = useState(1);
  const isMobileSidebarOpen = useUiStore((state) => state.isMobileSidebarOpen);
  const openMobileSidebar = useUiStore((state) => state.openMobileSidebar);
  const closeMobileSidebar = useUiStore((state) => state.closeMobileSidebar);

  const activeParams: Partial<ListNotesQuery> = {
    page: filters.page,
    limit: APP_LIMITS.PAGE_SIZE_DEFAULT,
    sort: filters.sort,
    order: filters.order,
    ...(filters.selectedTagIds.length > 0
      ? {
          tagIds: filters.selectedTagIds.join(","),
          tagMode: filters.tagMode,
        }
      : {}),
  };

  const trashParams = { page: trashPage, limit: APP_LIMITS.PAGE_SIZE_DEFAULT };

  const activeNotesQuery = useActiveNotes(activeParams);
  const trashQuery = useTrash(trashParams);
  const tagsQuery = useTags();

  const isMinLoadingActive = useMinLoadingTime(activeNotesQuery.isLoading);
  const isMinLoadingTrash = useMinLoadingTime(trashQuery.isLoading);

  const currentQuery = activeTab === "active" ? activeNotesQuery : trashQuery;
  const isLoading =
    activeTab === "active" ? isMinLoadingActive : isMinLoadingTrash;

  function handleTabChange(tab: NotesTab): void {
    setActiveTab(tab);
    closeMobileSidebar();
  }

  function handleSortChange(next: {
    sort: ListNotesQuery["sort"];
    order: ListNotesQuery["order"];
  }): void {
    setFilters((prev) => ({ ...prev, ...next, page: 1 }));
  }

  function handleToggleTag(tagId: string): void {
    setFilters((prev) => {
      const isSelected = prev.selectedTagIds.includes(tagId);
      return {
        ...prev,
        page: 1,
        selectedTagIds: isSelected
          ? prev.selectedTagIds.filter((selectedId) => selectedId !== tagId)
          : [...prev.selectedTagIds, tagId],
      };
    });
  }

  function handleTagModeChange(mode: "ALL" | "ANY"): void {
    setFilters((prev) => ({ ...prev, tagMode: mode, page: 1 }));
  }

  function handlePageChange(page: number): void {
    if (activeTab === "active") {
      setFilters((prev) => ({ ...prev, page }));
    } else {
      setTrashPage(page);
    }
  }

  function handleCreateNote(): void {
    navigate("/notes/new");
  }

  const notes = currentQuery.data?.notes ?? [];
  const pagination = currentQuery.data?.pagination;

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <div className="hidden lg:flex lg:w-[260px] lg:flex-shrink-0 lg:border-r lg:border-zinc-200 lg:bg-white lg:p-4">
        <SidebarNav activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
      <Sheet
        open={isMobileSidebarOpen}
        onOpenChange={(open) =>
          open ? openMobileSidebar() : closeMobileSidebar()
        }
        title="Notes navigation"
      >
        <SidebarNav activeTab={activeTab} onTabChange={handleTabChange} />
      </Sheet>
      <div className="flex w-full flex-1 flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="lg:hidden"
              onClick={openMobileSidebar}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
            <NotesTabs activeTab={activeTab} onTabChange={handleTabChange} />
          </div>
          {activeTab === "active" ? (
            <Button
              onClick={handleCreateNote}
              className="h-9 gap-1.5 px-3 py-1.5 text-xs font-medium"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Note
            </Button>
          ) : null}
        </div>
        {activeTab === "active" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TagFilterControl
              tags={tagsQuery.data?.tags ?? []}
              selectedTagIds={filters.selectedTagIds}
              tagMode={filters.tagMode}
              onToggleTag={handleToggleTag}
              onTagModeChange={handleTagModeChange}
            />
            <SortControl
              sort={filters.sort}
              order={filters.order}
              onChange={handleSortChange}
            />
          </div>
        ) : null}
        {currentQuery.isError ? (
          <ErrorFallback
            message="We couldn't load your notes. Please try again."
            onRetry={() => currentQuery.refetch()}
          />
        ) : (
          <>
            <NotesList
              variant={activeTab}
              notes={notes}
              isLoading={isLoading}
              isFiltered={
                activeTab === "active" && filters.selectedTagIds.length > 0
              }
              onCreateNote={handleCreateNote}
            />
            {pagination && pagination.total > 0 ? (
              <PaginationControl
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={handlePageChange}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
