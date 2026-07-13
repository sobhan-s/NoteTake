import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { toast } from "sonner";
import { UI_COPY } from "@shared/core/constants";
import type { ApiErrorResponse } from "@shared/core/types";
import { revokeShareLink } from "@/api/share.api";
import { mapApiError } from "@/lib/errorMessages";

export function useRevokeShareLink(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => revokeShareLink(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", "share", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "detail", noteId] });
      queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      toast.success(UI_COPY.SHARE_LINK_REVOKED_SUCCESS, { duration: 3000 });
    },
    onError: (error) => {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      queryClient.invalidateQueries({ queryKey: ["notes", "share", noteId] });
      toast.error(mapApiError(axiosError.response?.data.error.code), {
        duration: 5000,
      });
    },
  });
}
