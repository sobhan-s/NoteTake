import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
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
    <div className="flex min-h-screen bg-[#fafbfc]">
      {/* Sidebar */}
      <div className="hidden lg:flex lg:w-[260px] lg:flex-shrink-0 lg:border-r lg:border-zinc-200/80 lg:bg-white lg:p-4">
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

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Tiny top strip: mobile menu + back link */}
        <div className="flex items-center gap-2 px-4 py-2 sm:px-8">
          <Button
            variant="ghost"
            className="h-8 w-8 rounded-md p-0 text-zinc-500 hover:text-zinc-900 lg:hidden"
            onClick={openMobileSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Link
            to="/notes"
            className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />← Back to notes
          </Link>
        </div>

        {/* Content */}
        {noteId !== "new" && isMinLoading ? (
          <div className="mx-auto w-full max-w-[820px] px-6 py-10 sm:px-12">
            <Skeleton className="mb-3 h-10 w-2/3 rounded-md" />
            <div className="mb-6 flex gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="mb-4 h-10 w-full rounded-md" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        ) : noteId !== "new" && (noteQuery.isError || !noteQuery.data) ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <div className="w-full max-w-sm">
              <ErrorFallback
                message="This note is no longer available."
                onRetry={() => noteQuery.refetch()}
              />
            </div>
          </div>
        ) : (
          <NoteEditor
            noteId={noteId === "new" ? null : noteId}
            note={noteQuery.data}
            onCreated={handleCreated}
            onDeleted={() => navigate("/notes")}
          />
        )}
      </div>
    </div>
  );
}
