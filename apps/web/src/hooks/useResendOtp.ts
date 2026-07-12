import { useMutation } from "@tanstack/react-query";
import { resendOtp } from "@/api/auth.api";

export function useResendOtp() {
  return useMutation({
    mutationFn: resendOtp,
  });
}
