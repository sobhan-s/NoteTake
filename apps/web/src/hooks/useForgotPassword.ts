import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/api/auth.api";

export function useForgotPassword() {
  return useMutation({
    mutationFn: forgotPassword,
  });
}
