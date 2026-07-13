import { useQuery } from "@tanstack/react-query";
import { listNoteVersions } from "@/api/note-version.api";

export function useNoteVersions(noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["notes", "versions", noteId],
    queryFn: () => listNoteVersions(noteId),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
