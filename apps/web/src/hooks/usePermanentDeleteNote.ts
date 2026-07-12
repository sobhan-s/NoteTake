import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import type {
  ApiErrorResponse,
  PermanentDeleteInput,
} from "@shared/core/types";
import { permanentDeleteNote } from "@/api/notes.api";
import { mapApiError } from "@/lib/errorMessages";

interface PermanentDeleteVariables {
  id: string;
  input: PermanentDeleteInput;
}

export function usePermanentDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: PermanentDeleteVariables) =>
      permanentDeleteNote(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", "trash"] });
      toast.success(UI_COPY.PERMANENT_DELETE_SUCCESS, { duration: 3000 });
    },
    onError: (error) => {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      queryClient.invalidateQueries({ queryKey: ["notes", "trash"] });
      toast.error(mapApiError(axiosError.response?.data.error.code), {
        duration: 5000,
      });
    },
  });
}
