import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { UI_COPY } from "@shared/core/constants";
import type { NoteResponseDto } from "@shared/core/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { NoteCard } from "@/components/notes/NoteCard";
import { useDeleteNote } from "@/hooks/useDeleteNote";
import { useRestoreNote } from "@/hooks/useRestoreNote";
import { usePermanentDeleteNote } from "@/hooks/usePermanentDeleteNote";

const SKELETON_CARD_COUNT = 6;

export interface NotesListProps {
  variant: "active" | "trash";
  notes: NoteResponseDto[];
  isLoading: boolean;
  isFiltered: boolean;
  onCreateNote: () => void;
}

export function NotesList({
  variant,
  notes,
  isLoading,
  isFiltered,
  onCreateNote,
}: NotesListProps) {
  const deleteNoteMutation = useDeleteNote();
  const restoreNoteMutation = useRestoreNote();
  const permanentDeleteMutation = usePermanentDeleteNote();
  const [pendingTrashNote, setPendingTrashNote] =
    useState<NoteResponseDto | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] =
    useState<NoteResponseDto | null>(null);
  const [pendingRestoreNote, setPendingRestoreNote] =
    useState<NoteResponseDto | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: SKELETON_CARD_COUNT }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (notes.length === 0) {
    if (variant === "trash") {
      return (
        <EmptyState
          icon={Trash2}
          heading="Spotless bin!"
          subtext={UI_COPY.EMPTY_TRASH_BIN}
        />
      );
    }

    if (isFiltered) {
      return (
        <EmptyState
          icon={FileText}
          heading="No notes match the selected tags"
          subtext="Try a different tag combination."
        />
      );
    }

    return (
      <EmptyState
        icon={FileText}
        heading="No notes yet"
        subtext={UI_COPY.EMPTY_NOTES_LIST}
        action={{ label: "Create your first note", onClick: onCreateNote }}
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            variant={variant}
            onRestore={
              variant === "trash"
                ? () => setPendingRestoreNote(note)
                : undefined
            }
            onDeleteForever={
              variant === "trash" ? () => setPendingDeleteNote(note) : undefined
            }
            onDelete={
              variant === "active" ? () => setPendingTrashNote(note) : undefined
            }
            isRestorePending={
              restoreNoteMutation.isPending &&
              restoreNoteMutation.variables === note.id
            }
            isDeletePending={
              (permanentDeleteMutation.isPending &&
                permanentDeleteMutation.variables?.id === note.id) ||
              (deleteNoteMutation.isPending &&
                deleteNoteMutation.variables === note.id)
            }
          />
        ))}
      </div>
      <ConfirmModal
        open={pendingTrashNote !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTrashNote(null);
        }}
        heading="Move Note to Trash"
        body={UI_COPY.NOTE_TRASHED_CONFIRM}
        confirmLabel="Move to Trash"
        isConfirming={deleteNoteMutation.isPending}
        onConfirm={() => {
          if (!pendingTrashNote) return;
          deleteNoteMutation.mutate(pendingTrashNote.id, {
            onSettled: () => setPendingTrashNote(null),
          });
        }}
      />
      <ConfirmModal
        open={pendingRestoreNote !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestoreNote(null);
        }}
        heading="Restore Note"
        body={UI_COPY.TRASH_RESTORE_CONFIRM}
        confirmLabel="Restore Note"
        isConfirming={restoreNoteMutation.isPending}
        onConfirm={() => {
          if (!pendingRestoreNote) return;
          restoreNoteMutation.mutate(pendingRestoreNote.id, {
            onSettled: () => setPendingRestoreNote(null),
          });
        }}
      />
      <ConfirmModal
        open={pendingDeleteNote !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteNote(null);
        }}
        heading="Permanent Delete Note"
        body={UI_COPY.PERMANENT_DELETE_CONFIRM}
        confirmLabel="Delete Forever"
        isConfirming={permanentDeleteMutation.isPending}
        onConfirm={() => {
          if (!pendingDeleteNote) return;
          permanentDeleteMutation.mutate(
            { id: pendingDeleteNote.id, input: { confirm: true } },
            { onSettled: () => setPendingDeleteNote(null) },
          );
        }}
      />
    </>
  );
}
