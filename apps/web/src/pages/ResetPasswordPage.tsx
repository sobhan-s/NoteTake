import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema } from "@shared/core/schemas";
import type { ApiErrorResponse } from "@shared/core/types";
import { APP_LIMITS } from "@shared/core/constants";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { AxiosError } from "axios";
import { useResetPassword } from "@/hooks/useResetPassword";
import { mapApiError } from "@/lib/errorMessages";
import { AuthCard } from "@/components/AuthCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

interface ResetPasswordLocationState {
  email?: string;
}

const resetPasswordFormSchema = resetPasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as ResetPasswordLocationState;
  const resetPasswordMutation = useResetPassword();
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isValid },
  } = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: "onBlur",
    defaultValues: {
      email: state.email ?? "",
      code: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = handleSubmit(
    ({ confirmPassword: _confirmPassword, ...payload }) => {
      resetPasswordMutation.mutate(payload, {
        onSuccess: () => {
          toast.success(
            "Password reset. You've been logged out of all devices.",
          );
          navigate("/login");
        },
        onError: (error) => {
          const axiosError = error as AxiosError<ApiErrorResponse>;
          toast.error(mapApiError(axiosError.response?.data.error.code));
          reset({ ...getValues(), code: "" });
        },
      });
    },
  );

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the code we sent you along with your new password"
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Reset code</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={APP_LIMITS.OTP_LENGTH}
            hasError={!!errors.code}
            {...register("code")}
          />
          {errors.code ? (
            <p className="text-xs text-red-500">{errors.code.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.newPassword}
            {...register("newPassword")}
          />
          {errors.newPassword ? (
            <p className="text-xs text-red-500">{errors.newPassword.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p className="text-xs text-red-500">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          disabled={!isValid || resetPasswordMutation.isPending}
          isLoading={resetPasswordMutation.isPending}
          className="w-full"
        >
          Reset password
        </Button>
      </form>
    </AuthCard>
  );
}
