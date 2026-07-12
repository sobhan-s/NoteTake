import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema } from "@shared/core/schemas";
import type { ApiErrorResponse, RegisterInput } from "@shared/core/types";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { AxiosError } from "axios";
import { useRegister } from "@/hooks/useRegister";
import { mapApiError } from "@/lib/errorMessages";
import { AuthCard } from "@/components/AuthCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

export function RegisterPage() {
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
  });

  const onSubmit = handleSubmit((data) => {
    registerMutation.mutate(data, {
      onSuccess: ({ userId }) => {
        navigate("/verify-otp", { state: { userId } });
      },
      onError: (error) => {
        const axiosError = error as AxiosError<ApiErrorResponse>;
        toast.error(mapApiError(axiosError.response?.data.error.code));
      },
    });
  });

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start taking notes in seconds"
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
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.password}
            {...register("password")}
          />
          {errors.password ? (
            <p className="text-xs text-red-500">{errors.password.message}</p>
          ) : null}
        </div>
        <Button
          type="submit"
          disabled={!isValid || registerMutation.isPending}
          isLoading={registerMutation.isPending}
          className="w-full"
        >
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
