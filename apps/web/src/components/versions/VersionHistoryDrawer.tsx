import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError, type AxiosError } from "axios";
import { toast } from "sonner";
import { API_ERROR_CODES, UI_COPY } from "@shared/core/constants";
import type { ApiErrorResponse, NoteResponseDto } from "@shared/core/types";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatUpdatedAt } from "@/components/notes/NoteCard";
import { useNoteVersions } from "@/hooks/useNoteVersions";
import { useNoteVersion } from "@/hooks/useNoteVersion";
import { useRestoreNoteVersion } from "@/hooks/useRestoreNoteVersion";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";
import { mapApiError } from "@/lib/errorMessages";

export interface VersionHistoryDrawerProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (restoredNote: NoteResponseDto) => void;
}

export function VersionHistoryDrawer({
  noteId,
  open,
  onOpenChange,
  onRestored,
}: VersionHistoryDrawerProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);

  const queryClient = useQueryClient();
  const versionsQuery = useNoteVersions(noteId, open);
  const versionQuery = useNoteVersion(noteId, selectedVersionId);
  const restoreMutation = useRestoreNoteVersion(noteId);

  const isListMinLoading = useMinLoadingTime(versionsQuery.isFetching);
  const isPreviewMinLoading = useMinLoadingTime(versionQuery.isFetching);
  const isVersionUnavailable =
    isAxiosError(versionQuery.error) &&
    versionQuery.error.response?.status === 404;

  useEffect(() => {
    if (open) {
      setSelectedVersionId(null);
      setIsRestoreConfirmOpen(false);
    }
  }, [open]);

  const editor = useEditor({
    editable: false,
    extensions: [StarterKit],
    content: "",
  });

  useEffect(() => {
    if (editor && versionQuery.data) {
      editor.commands.setContent(versionQuery.data.bodySnapshot);
    }
  }, [editor, versionQuery.data]);

  function handleConfirmRestore(): void {
    if (selectedVersionId === null) return;
    restoreMutation.mutate(selectedVersionId, {
      onSuccess: (data) => {
        setIsRestoreConfirmOpen(false);
        onRestored(data);
        onOpenChange(false);
        toast.success(UI_COPY.VERSION_RESTORE_SUCCESS, { duration: 3000 });
      },
      onError: (error) => {
        const axiosError = error as AxiosError<ApiErrorResponse>;
        setIsRestoreConfirmOpen(false);
        toast.error(mapApiError(axiosError.response?.data.error.code), {
          duration: 5000,
        });
        if (
          axiosError.response?.data.error.code ===
          API_ERROR_CODES.VERSION_NOT_FOUND
        ) {
          queryClient.invalidateQueries({
            queryKey: ["notes", "versions", noteId, selectedVersionId],
          });
        }
      },
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Version History"
      side="right"
      widthClassName="w-full sm:w-[420px]"
    >
      {selectedVersionId === null ? (
        <div className="flex h-full flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-900">
            Version History
          </h2>
          {isListMinLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : versionsQuery.isError ? (
            <ErrorFallback
              message="Couldn't load this note's version history."
              onRetry={() => versionsQuery.refetch()}
            />
          ) : versionsQuery.data && versionsQuery.data.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {UI_COPY.EMPTY_VERSION_HISTORY}
            </p>
          ) : (
            <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {versionsQuery.data?.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedVersionId(version.id)}
                    className="flex w-full flex-col gap-1 rounded-md border border-zinc-200 p-3 text-left hover:bg-zinc-50"
                  >
                    <span className="truncate text-sm font-medium text-zinc-900">
                      {version.titleSnapshot || "Untitled"}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatUpdatedAt(version.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex h-full flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            className="w-fit px-2"
            onClick={() => setSelectedVersionId(null)}
          >
            ← Back to list
          </Button>
          {isPreviewMinLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : isVersionUnavailable ? (
            <p className="text-sm text-zinc-500">
              {UI_COPY.VERSION_UNAVAILABLE}
            </p>
          ) : versionQuery.isError ? (
            <ErrorFallback
              message="Couldn't load this version."
              onRetry={() => versionQuery.refetch()}
            />
          ) : versionQuery.data ? (
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
              <p className="text-xs text-zinc-400">
                {formatUpdatedAt(versionQuery.data.createdAt)}
              </p>
              <h3 className="text-xl font-semibold text-zinc-900">
                {versionQuery.data.titleSnapshot || "Untitled"}
              </h3>
              <EditorContent
                editor={editor}
                className="text-sm text-zinc-800"
              />
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={() => setIsRestoreConfirmOpen(true)}
                >
                  Restore this version
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmModal
        open={isRestoreConfirmOpen}
        onOpenChange={setIsRestoreConfirmOpen}
        heading="Restore Version"
        body={UI_COPY.VERSION_RESTORE_CONFIRM}
        confirmLabel="Restore"
        isConfirming={restoreMutation.isPending}
        onConfirm={handleConfirmRestore}
      />
    </Sheet>
  );
}
