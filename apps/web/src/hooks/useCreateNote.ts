import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createNote } from "@/api/notes.api";

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
    },
  });
}
