import type { z } from "zod";
import type {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from "../schemas/auth.schema";

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type AuthUserDto = {
  id: string;
  email: string;
  isVerified: boolean;
};

export type RegisterResponseDto = {
  isReTriggered: boolean;
  userId: string;
};

export type LoginResponseDto = {
  accessToken: string;
  user: AuthUserDto;
};

export type MeResponseDto = {
  user: AuthUserDto;
};
