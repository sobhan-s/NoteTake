import { useQuery } from "@tanstack/react-query";
import type { ListTrashQuery } from "@shared/core/types";
import { listTrash } from "@/api/notes.api";

export function useTrash(params: Partial<ListTrashQuery>) {
  return useQuery({
    queryKey: ["notes", "trash", params],
    queryFn: () => listTrash(params),
  });
}
