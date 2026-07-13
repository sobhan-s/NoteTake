import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import type { ApiErrorResponse } from "@shared/core/types";
import { deleteNote } from "@/api/notes.api";
import { mapApiError } from "@/lib/errorMessages";

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      queryClient.invalidateQueries({ queryKey: ["notes", "trash"] });
      toast.success(UI_COPY.NOTE_TRASHED_SUCCESS, { duration: 3000 });
    },
    onError: (error) => {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      toast.error(mapApiError(axiosError.response?.data.error.code), {
        duration: 5000,
      });
    },
  });
}
