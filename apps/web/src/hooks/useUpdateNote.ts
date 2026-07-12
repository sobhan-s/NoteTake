import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UpdateNoteInput } from "@shared/core/types";
import { updateNote } from "@/api/notes.api";

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNoteInput }) =>
      updateNote(id, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["notes", "detail", variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
    },
  });
}
