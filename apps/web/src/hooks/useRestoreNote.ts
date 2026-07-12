import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import type {
  ApiErrorResponse,
  PaginatedNotesResponseDto,
} from "@shared/core/types";
import { restoreNote } from "@/api/notes.api";
import { mapApiError } from "@/lib/errorMessages";

export function useRestoreNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: restoreNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", "trash"] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      toast.success(UI_COPY.TRASH_RESTORE_SUCCESS, { duration: 3000 });
    },
    onError: (error, id) => {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      const status = axiosError.response?.status;

      if (status === 404) {
        queryClient.setQueriesData<PaginatedNotesResponseDto>(
          { queryKey: ["notes", "trash"] },
          (current) =>
            current
              ? {
                  ...current,
                  notes: current.notes.filter((note) => note.id !== id),
                }
              : current,
        );
      }

      toast.error(mapApiError(axiosError.response?.data.error.code), {
        duration: 5000,
      });
    },
  });
}
