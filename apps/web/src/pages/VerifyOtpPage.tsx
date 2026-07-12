import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { verifyOtpSchema } from "@shared/core/schemas";
import type { ApiErrorResponse, VerifyOtpInput } from "@shared/core/types";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { AxiosError } from "axios";
import { useVerifyOtp } from "@/hooks/useVerifyOtp";
import { useResendOtp } from "@/hooks/useResendOtp";
import { mapApiError } from "@/lib/errorMessages";
import { OTP_RESEND_TICK_MS } from "@/constants/ui.constant";
import { AuthCard } from "@/components/AuthCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

interface VerifyOtpLocationState {
  userId?: string;
  email?: string;
}

function extractAttemptsRemaining(message?: string): number | null {
  const match = message?.match(/Attempts remaining: (\d+)/);
  return match ? Number(match[1]) : null;
}

export function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as VerifyOtpLocationState;
  const verifyOtpMutation = useVerifyOtp();
  const resendOtpMutation = useResendOtp();
  const [attemptsExceeded, setAttemptsExceeded] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!state.userId && !state.email) {
      navigate("/register", { replace: true });
    }
  }, [state.userId, state.email, navigate]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startCooldown(seconds: number): void {
    setCooldownSeconds(seconds);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, OTP_RESEND_TICK_MS);
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { isValid },
  } = useForm<VerifyOtpInput>({
    resolver: zodResolver(verifyOtpSchema),
    mode: "onBlur",
    defaultValues: {
      userId: state.userId,
      email: state.email,
      type: "EMAIL_VERIFICATION",
      code: "",
    },
  });

  const onSubmit = handleSubmit((data) => {
    verifyOtpMutation.mutate(data, {
      onSuccess: () => {
        toast.success("Account verified successfully.");
        navigate("/login");
      },
      onError: (error) => {
        const axiosError = error as AxiosError<ApiErrorResponse>;
        const code = axiosError.response?.data.error.code;
        const message = axiosError.response?.data.error.message;

        if (code === API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED) {
          setAttemptsExceeded(true);
          toast.error(mapApiError(code));
          return;
        }

        if (code === API_ERROR_CODES.OTP_INVALID) {
          const attemptsRemaining = extractAttemptsRemaining(message);
          toast.error(
            attemptsRemaining !== null
              ? `Incorrect code. Attempts remaining: ${attemptsRemaining}`
              : mapApiError(code),
          );
          reset({ ...data, code: "" });
          return;
        }

        toast.error(mapApiError(code));
        reset({ ...data, code: "" });
      },
    });
  });

  function handleResend(): void {
    resendOtpMutation.mutate(
      {
        userId: state.userId,
        email: state.email,
        type: "EMAIL_VERIFICATION",
      },
      {
        onSuccess: () => {
          setAttemptsExceeded(false);
          toast.success("A new code has been sent.");
          startCooldown(APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS);
        },
        onError: (error) => {
          const axiosError = error as AxiosError<ApiErrorResponse>;
          const code = axiosError.response?.data.error.code;
          toast.error(mapApiError(code));
          if (code === API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE) {
            startCooldown(APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS);
          }
        },
      },
    );
  }

  return (
    <AuthCard
      title="Verify your email"
      subtitle="Enter the 6-digit code we sent to your email"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {state.userId ? <input type="hidden" {...register("userId")} /> : null}
        {state.email ? <input type="hidden" {...register("email")} /> : null}
        <input type="hidden" {...register("type")} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={APP_LIMITS.OTP_LENGTH}
            {...register("code")}
            disabled={attemptsExceeded}
          />
        </div>
        {!attemptsExceeded ? (
          <Button
            type="submit"
            disabled={!isValid || verifyOtpMutation.isPending}
            isLoading={verifyOtpMutation.isPending}
            className="w-full"
          >
            Verify
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={cooldownSeconds > 0 || resendOtpMutation.isPending}
          isLoading={resendOtpMutation.isPending}
          onClick={handleResend}
          className="w-full"
        >
          {cooldownSeconds > 0
            ? `Resend code (${cooldownSeconds}s)`
            : "Resend code"}
        </Button>
      </form>
    </AuthCard>
  );
}
