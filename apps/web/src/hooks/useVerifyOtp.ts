import { useMutation } from "@tanstack/react-query";
import { verifyOtp } from "@/api/auth.api";

export function useVerifyOtp() {
  return useMutation({
    mutationFn: verifyOtp,
  });
}
