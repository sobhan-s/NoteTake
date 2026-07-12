import { useQuery } from "@tanstack/react-query";
import type { SearchNotesQuery } from "@shared/core/types";
import { searchNotes } from "@/api/search.api";

export function useSearchNotes(params: Partial<SearchNotesQuery>) {
  return useQuery({
    queryKey: ["search", "list", params],
    queryFn: () => searchNotes(params),
    enabled: (params.q ?? "").trim().length > 0,
  });
}
