import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@shared/core/schemas";
import type { ApiErrorResponse, ForgotPasswordInput } from "@shared/core/types";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { AxiosError } from "axios";
import { useForgotPassword } from "@/hooks/useForgotPassword";
import { mapApiError } from "@/lib/errorMessages";
import { AuthCard } from "@/components/AuthCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const forgotPasswordMutation = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onBlur",
  });

  const onSubmit = handleSubmit((data) => {
    forgotPasswordMutation.mutate(data, {
      onSuccess: () => {
        toast.success(
          "If an account exists for this email, a reset code has been sent.",
        );
        navigate("/reset-password", { state: { email: data.email } });
      },
      onError: (error) => {
        const axiosError = error as AxiosError<ApiErrorResponse>;
        toast.error(mapApiError(axiosError.response?.data.error.code));
      },
    });
  });

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset code"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            hasError={!!errors.email}
            {...register("email")}
          />
          {errors.email ? (
            <p className="text-xs text-red-500">{errors.email.message}</p>
          ) : null}
        </div>
        <Button
          type="submit"
          disabled={!isValid || forgotPasswordMutation.isPending}
          isLoading={forgotPasswordMutation.isPending}
          className="w-full"
        >
          Send reset code
        </Button>
      </form>
    </AuthCard>
  );
}
