import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email(VALIDATION_MESSAGES.EMAIL_INVALID),
  password: z
    .string()
    .min(8, VALIDATION_MESSAGES.PASSWORD_WEAK)
    .regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])/, VALIDATION_MESSAGES.PASSWORD_WEAK),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email(VALIDATION_MESSAGES.EMAIL_INVALID),
  password: z.string().min(1),
});

export const verifyOtpSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    code: z.string().length(APP_LIMITS.OTP_LENGTH),
    type: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
  })
  .refine((data) => !!(data.userId || data.email), {
    message: VALIDATION_MESSAGES.OTP_IDENTIFIER_REQUIRED,
  });

export const resendOtpSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    type: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
  })
  .refine((data) => !!(data.userId || data.email), {
    message: VALIDATION_MESSAGES.OTP_IDENTIFIER_REQUIRED,
  });
