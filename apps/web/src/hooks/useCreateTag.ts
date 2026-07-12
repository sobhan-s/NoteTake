import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTag } from "@/api/tags.api";

export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", "list"] });
    },
  });
}
