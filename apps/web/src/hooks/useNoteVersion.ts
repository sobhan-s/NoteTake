import { useQuery } from "@tanstack/react-query";
import { getNoteVersion } from "@/api/note-version.api";

export function useNoteVersion(noteId: string, versionId: string | null) {
  return useQuery({
    queryKey: ["notes", "versions", noteId, versionId],
    queryFn: () => getNoteVersion(noteId, versionId!),
    enabled: versionId !== null,
    staleTime: 0,
    retry: false,
  });
}
