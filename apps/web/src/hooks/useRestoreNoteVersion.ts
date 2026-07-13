import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NoteResponseDto } from "@shared/core/types";
import { restoreNoteVersion } from "@/api/note-version.api";

export function useRestoreNoteVersion(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (versionId: string) => restoreNoteVersion(noteId, versionId),
    onSuccess: (data: NoteResponseDto) => {
      queryClient.setQueryData(["notes", "detail", noteId], data);
      queryClient.invalidateQueries({ queryKey: ["notes", "detail", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      queryClient.invalidateQueries({
        queryKey: ["notes", "versions", noteId],
      });
    },
  });
}
