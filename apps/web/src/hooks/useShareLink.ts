import { useQuery } from "@tanstack/react-query";
import { getShareLink } from "@/api/share.api";

export function useShareLink(noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["notes", "share", noteId],
    queryFn: () => getShareLink(noteId),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
