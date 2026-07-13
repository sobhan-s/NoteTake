import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateShareLinkInput } from "@shared/core/types";
import { createShareLink } from "@/api/share.api";

export function useGenerateShareLink(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateShareLinkInput) => createShareLink(noteId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(["notes", "share", noteId], data);
      queryClient.invalidateQueries({ queryKey: ["notes", "detail", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
    },
  });
}
