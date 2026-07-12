import { useQuery } from "@tanstack/react-query";
import type { ListNotesQuery } from "@shared/core/types";
import { listNotes } from "@/api/notes.api";

export function useActiveNotes(params: Partial<ListNotesQuery>) {
  return useQuery({
    queryKey: ["notes", "list", params],
    queryFn: () => listNotes(params),
  });
}
