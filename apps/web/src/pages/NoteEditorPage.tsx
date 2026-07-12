import { Link, useNavigate, useParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { useNoteById } from "@/hooks/useNoteById";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";
import { useUiStore } from "@/store/useUiStore";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { Button } from "@/components/ui/Button";
import { NoteEditor } from "@/components/editor/NoteEditor";

export function NoteEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const noteId = id ?? "new";
  const isMobileSidebarOpen = useUiStore((state) => state.isMobileSidebarOpen);
  const openMobileSidebar = useUiStore((state) => state.openMobileSidebar);
  const closeMobileSidebar = useUiStore((state) => state.closeMobileSidebar);

  const noteQuery = useNoteById(noteId);
  const isMinLoading = useMinLoadingTime(
    noteId !== "new" && noteQuery.isLoading,
  );

  function handleCreated(newId: string): void {
    navigate(`/notes/${newId}`, { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <div className="hidden lg:flex lg:w-[260px] lg:flex-shrink-0 lg:border-r lg:border-zinc-200 lg:bg-white lg:p-4">
        <SidebarNav activeTab="active" onTabChange={() => navigate("/notes")} />
      </div>
      <Sheet
        open={isMobileSidebarOpen}
        onOpenChange={(open) =>
          open ? openMobileSidebar() : closeMobileSidebar()
        }
        title="Notes navigation"
      >
        <SidebarNav activeTab="active" onTabChange={() => navigate("/notes")} />
      </Sheet>
      <div className="flex w-full flex-1 gap-6 p-4 sm:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="lg:hidden"
              onClick={openMobileSidebar}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Link
              to="/notes"
              className="text-sm text-zinc-500 hover:text-zinc-900"
            >
              ← Back to notes
            </Link>
          </div>

          {noteId !== "new" && isMinLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : noteId !== "new" && (noteQuery.isError || !noteQuery.data) ? (
            <ErrorFallback
              message="This note is no longer available."
              onRetry={() => noteQuery.refetch()}
            />
          ) : (
            <NoteEditor
              noteId={noteId === "new" ? null : noteId}
              note={noteQuery.data}
              onCreated={handleCreated}
            />
          )}
        </div>
        <div className="hidden w-[320px] flex-shrink-0 lg:block" />
      </div>
    </div>
  );
}
