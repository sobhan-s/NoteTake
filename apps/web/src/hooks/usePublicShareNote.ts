import { useQuery } from "@tanstack/react-query";
import { getPublicShareNote } from "@/api/share.api";

export function usePublicShareNote(token: string) {
  return useQuery({
    queryKey: ["public", "share", token],
    queryFn: () => getPublicShareNote(token),
    retry: false,
  });
}
