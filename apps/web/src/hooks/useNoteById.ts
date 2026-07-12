import { useQuery } from "@tanstack/react-query";
import { getNoteById } from "@/api/notes.api";

export function useNoteById(id: string) {
  return useQuery({
    queryKey: ["notes", "detail", id],
    queryFn: () => getNoteById(id),
    enabled: id !== "new",
  });
}
