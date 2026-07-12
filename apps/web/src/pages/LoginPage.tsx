import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@shared/core/schemas";
import type { ApiErrorResponse, LoginInput } from "@shared/core/types";
import { API_ERROR_CODES } from "@shared/core/constants";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { AxiosError } from "axios";
import { useLogin } from "@/hooks/useLogin";
import { useResendOtp } from "@/hooks/useResendOtp";
import { useAuthStore } from "@/store/useAuthStore";
import { mapApiError } from "@/lib/errorMessages";
import { AuthCard } from "@/components/AuthCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setSession = useAuthStore((state) => state.setSession);
  const loginMutation = useLogin();
  const resendOtpMutation = useResendOtp();
  const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isValid },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
  });

  const onSubmit = handleSubmit((data) => {
    setShowVerifyPrompt(false);
    loginMutation.mutate(data, {
      onSuccess: ({ accessToken, user }) => {
        setSession({ accessToken, user });
        navigate(searchParams.get("next") ?? "/notes", { replace: true });
      },
      onError: (error) => {
        const axiosError = error as AxiosError<ApiErrorResponse>;
        const code = axiosError.response?.data.error.code;

        if (code === API_ERROR_CODES.RATE_LIMIT_EXCEEDED) {
          setRateLimited(true);
          return;
        }

        if (code === API_ERROR_CODES.ACCOUNT_NOT_VERIFIED) {
          setShowVerifyPrompt(true);
        }

        toast.error(mapApiError(code));
      },
    });
  });

  function handleResendOtp(): void {
    resendOtpMutation.mutate(
      { email: getValues("email"), type: "EMAIL_VERIFICATION" },
      {
        onSuccess: () => {
          navigate("/verify-otp", { state: { email: getValues("email") } });
        },
        onError: (error) => {
          const axiosError = error as AxiosError<ApiErrorResponse>;
          toast.error(mapApiError(axiosError.response?.data.error.code));
        },
      },
    );
  }

  if (rateLimited) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">
          Too many attempts
        </h1>
        <p className="max-w-sm text-sm text-zinc-500">
          Your account has been temporarily locked due to repeated failed login
          attempts. Please try again later.
        </p>
        <Button variant="outline" onClick={() => setRateLimited(false)}>
          Back to login
        </Button>
      </div>
    );
  }

  return (
    <AuthCard title="Welcome back" subtitle="Log in to your account">
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
            autoComplete="current-password"
            hasError={!!errors.password}
            {...register("password")}
          />
          {errors.password ? (
            <p className="text-xs text-red-500">{errors.password.message}</p>
          ) : null}
        </div>
        {showVerifyPrompt ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p>Please verify your email before logging in.</p>
            <Button
              type="button"
              variant="ghost"
              className="mt-2 h-auto min-w-0 p-0 underline"
              onClick={handleResendOtp}
              disabled={resendOtpMutation.isPending}
              isLoading={resendOtpMutation.isPending}
            >
              Resend verification code
            </Button>
          </div>
        ) : null}
        <Button
          type="submit"
          disabled={!isValid || loginMutation.isPending}
          isLoading={loginMutation.isPending}
          className="w-full"
        >
          Log in
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm text-zinc-500">
        <Link to="/forgot-password" className="underline">
          Forgot password?
        </Link>
        <Link to="/register" className="underline">
          Create an account
        </Link>
      </div>
    </AuthCard>
  );
}
