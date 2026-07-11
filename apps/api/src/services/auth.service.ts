import bcrypt from "bcrypt";
import type { User } from "@prisma/client";
import { APP_LIMITS, API_ERROR_CODES } from "@shared/core/constants";
import type {
  AuthUserDto,
  ForgotPasswordInput,
  LoginInput,
  MeResponseDto,
  RegisterInput,
  RegisterResponseDto,
  ResendOtpInput,
  ResetPasswordInput,
  VerifyOtpInput,
} from "@shared/core/types";
import { prisma } from "../lib/prisma-client.js";
import { BCRYPT_ROUNDS } from "../constants/api.constants.js";
import { AppError } from "../errors/app-error.js";
import * as authRepository from "../repositories/auth.repository.js";
import {
  generateOtpCode,
  hashOtpCode,
  logOtpToConsole,
  verifyOtpCodeHash,
} from "./otp.service.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "./token.service.js";

function toAuthUserDto(user: User): AuthUserDto {
  return { id: user.id, email: user.email, isVerified: user.isVerified };
}

function otpCooldownRemaining(latestCreatedAt: Date): boolean {
  const cooldownMs = APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS * 1000;
  return Date.now() - latestCreatedAt.getTime() < cooldownMs;
}

async function resolveUser(input: {
  userId?: string;
  email?: string;
}): Promise<User | null> {
  if (input.userId) return authRepository.findUserById(input.userId);
  if (input.email) return authRepository.findUserByEmail(input.email);
  return null;
}

export async function register(
  input: RegisterInput,
): Promise<{ statusCode: 200 | 201; data: RegisterResponseDto }> {
  const existing = await authRepository.findUserByEmail(input.email);

  if (existing?.isVerified) {
    throw new AppError(
      409,
      API_ERROR_CODES.EMAIL_ALREADY_VERIFIED,
      "Account already exists",
    );
  }

  if (existing && !existing.isVerified) {
    const latestOtp = await authRepository.findLatestOtp(
      existing.id,
      "EMAIL_VERIFICATION",
    );
    if (latestOtp && otpCooldownRemaining(latestOtp.createdAt)) {
      throw new AppError(
        429,
        API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE,
        "Please wait before requesting another code",
      );
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const code = generateOtpCode();
    const codeHash = await hashOtpCode(code);

    await prisma.$transaction(async (tx) => {
      await authRepository.updateUserPasswordHash(
        existing.id,
        passwordHash,
        tx,
      );
      await authRepository.invalidatePendingOtp(
        existing.id,
        "EMAIL_VERIFICATION",
        tx,
      );
      await authRepository.createOtp(
        {
          userId: existing.id,
          type: "EMAIL_VERIFICATION",
          codeHash,
          expiresAt: new Date(
            Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
          ),
        },
        tx,
      );
    });
    logOtpToConsole(existing.email, code, "EMAIL_VERIFICATION");

    return {
      statusCode: 200,
      data: { isReTriggered: true, userId: existing.id },
    };
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);

  const user = await prisma.$transaction(async (tx) => {
    const created = await authRepository.createUser(
      { email: input.email, passwordHash },
      tx,
    );
    await authRepository.createOtp(
      {
        userId: created.id,
        type: "EMAIL_VERIFICATION",
        codeHash,
        expiresAt: new Date(
          Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
        ),
      },
      tx,
    );
    return created;
  });
  logOtpToConsole(user.email, code, "EMAIL_VERIFICATION");

  return { statusCode: 201, data: { isReTriggered: false, userId: user.id } };
}

export async function verifyOtp(
  input: VerifyOtpInput,
): Promise<{ message: string }> {
  const user = await resolveUser(input);
  if (!user) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const latest = await authRepository.findLatestOtp(user.id, input.type);
  if (!latest) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }
  if (
    latest.status === "INVALIDATED" ||
    latest.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS
  ) {
    throw new AppError(
      429,
      API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
      "Maximum verification attempts exceeded. Please request a new code.",
    );
  }
  if (latest.status !== "PENDING" || latest.expiresAt < new Date()) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await authRepository.lockOtpRowForUpdate(tx, latest.id);
    const fresh = await authRepository.findOtpById(latest.id, tx);

    if (!fresh) return { outcome: "expired" as const };
    if (
      fresh.status === "INVALIDATED" ||
      fresh.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS
    ) {
      return { outcome: "max_attempts" as const };
    }
    if (fresh.status !== "PENDING" || fresh.expiresAt < new Date()) {
      return { outcome: "expired" as const };
    }

    const matches = await verifyOtpCodeHash(input.code, fresh.codeHash);
    if (!matches) {
      const newAttempts = fresh.attempts + 1;
      if (newAttempts >= APP_LIMITS.OTP_MAX_ATTEMPTS) {
        await authRepository.updateOtpAttempts(
          fresh.id,
          { attempts: newAttempts, status: "INVALIDATED" },
          tx,
        );
        return { outcome: "max_attempts" as const };
      }
      await authRepository.updateOtpAttempts(
        fresh.id,
        { attempts: newAttempts },
        tx,
      );
      return {
        outcome: "mismatch" as const,
        attemptsRemaining: APP_LIMITS.OTP_MAX_ATTEMPTS - newAttempts,
      };
    }

    await authRepository.markOtpConsumed(fresh.id, tx);
    await authRepository.markUserVerified(user.id, tx);
    return { outcome: "success" as const };
  });

  switch (result.outcome) {
    case "expired":
      throw new AppError(
        400,
        API_ERROR_CODES.OTP_EXPIRED,
        "OTP expired or invalid. Please request a new one.",
      );
    case "max_attempts":
      throw new AppError(
        429,
        API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
        "Maximum verification attempts exceeded. Please request a new code.",
      );
    case "mismatch":
      throw new AppError(
        400,
        API_ERROR_CODES.OTP_INVALID,
        `Invalid OTP code. Attempts remaining: ${result.attemptsRemaining}`,
      );
    case "success":
      return { message: "Account verified successfully." };
  }
}

export async function resendOtp(
  input: ResendOtpInput,
): Promise<{ message: string }> {
  const user = await resolveUser(input);
  if (!user) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const latest = await authRepository.findLatestOtp(user.id, input.type);
  if (latest && otpCooldownRemaining(latest.createdAt)) {
    throw new AppError(
      429,
      API_ERROR_CODES.RESEND_COOLDOWN_ACTIVE,
      "Please wait before requesting another code",
    );
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);

  await prisma.$transaction(async (tx) => {
    await authRepository.invalidatePendingOtp(user.id, input.type, tx);
    await authRepository.createOtp(
      {
        userId: user.id,
        type: input.type,
        codeHash,
        expiresAt: new Date(
          Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
        ),
      },
      tx,
    );
  });
  logOtpToConsole(user.email, code, input.type);

  return { message: "A new code has been sent." };
}

export async function forgotPassword(
  input: ForgotPasswordInput,
): Promise<{ message: string }> {
  const message =
    "If an account exists for this email, a reset code has been sent.";

  const user = await authRepository.findUserByEmail(input.email);
  if (!user) return { message };

  const latest = await authRepository.findLatestOtp(user.id, "PASSWORD_RESET");
  if (latest && otpCooldownRemaining(latest.createdAt)) return { message };

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);

  await prisma.$transaction(async (tx) => {
    await authRepository.invalidatePendingOtp(user.id, "PASSWORD_RESET", tx);
    await authRepository.createOtp(
      {
        userId: user.id,
        type: "PASSWORD_RESET",
        codeHash,
        expiresAt: new Date(
          Date.now() + APP_LIMITS.OTP_EXPIRY_MINUTES * 60_000,
        ),
      },
      tx,
    );
  });
  logOtpToConsole(user.email, code, "PASSWORD_RESET");

  return { message };
}

export async function resetPassword(
  input: ResetPasswordInput,
): Promise<{ message: string }> {
  const user = await authRepository.findUserByEmail(input.email);
  if (!user) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const latest = await authRepository.findLatestOtp(user.id, "PASSWORD_RESET");
  if (!latest) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }
  if (
    latest.status === "INVALIDATED" ||
    latest.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS
  ) {
    throw new AppError(
      429,
      API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
      "Maximum verification attempts exceeded. Please request a new code.",
    );
  }
  if (latest.status !== "PENDING" || latest.expiresAt < new Date()) {
    throw new AppError(
      400,
      API_ERROR_CODES.OTP_EXPIRED,
      "OTP expired or invalid. Please request a new one.",
    );
  }

  const newPasswordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    await authRepository.lockOtpRowForUpdate(tx, latest.id);
    const fresh = await authRepository.findOtpById(latest.id, tx);

    if (!fresh) return { outcome: "expired" as const };
    if (
      fresh.status === "INVALIDATED" ||
      fresh.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS
    ) {
      return { outcome: "max_attempts" as const };
    }
    if (fresh.status !== "PENDING" || fresh.expiresAt < new Date()) {
      return { outcome: "expired" as const };
    }

    const matches = await verifyOtpCodeHash(input.code, fresh.codeHash);
    if (!matches) {
      const newAttempts = fresh.attempts + 1;
      if (newAttempts >= APP_LIMITS.OTP_MAX_ATTEMPTS) {
        await authRepository.updateOtpAttempts(
          fresh.id,
          { attempts: newAttempts, status: "INVALIDATED" },
          tx,
        );
        return { outcome: "max_attempts" as const };
      }
      await authRepository.updateOtpAttempts(
        fresh.id,
        { attempts: newAttempts },
        tx,
      );
      return {
        outcome: "mismatch" as const,
        attemptsRemaining: APP_LIMITS.OTP_MAX_ATTEMPTS - newAttempts,
      };
    }

    await authRepository.markOtpConsumed(fresh.id, tx);
    await authRepository.updateUserPasswordHash(user.id, newPasswordHash, tx);
    await authRepository.revokeAllRefreshSessionsForUser(user.id, tx);
    return { outcome: "success" as const };
  });

  switch (result.outcome) {
    case "expired":
      throw new AppError(
        400,
        API_ERROR_CODES.OTP_EXPIRED,
        "OTP expired or invalid. Please request a new one.",
      );
    case "max_attempts":
      throw new AppError(
        429,
        API_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
        "Maximum verification attempts exceeded. Please request a new code.",
      );
    case "mismatch":
      throw new AppError(
        400,
        API_ERROR_CODES.OTP_INVALID,
        `Invalid OTP code. Attempts remaining: ${result.attemptsRemaining}`,
      );
    case "success":
      return { message: "Password reset successfully. Please log in again." };
  }
}

export async function login(
  input: LoginInput,
  ctx: { ipAddress: string; userAgent: string | null },
): Promise<{
  accessToken: string;
  user: AuthUserDto;
  rawRefreshToken: string;
}> {
  const user = await authRepository.findUserByEmail(input.email);
  const passwordMatches = user
    ? await bcrypt.compare(input.password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    await authRepository.createLoginAttempt({
      email: input.email,
      ipAddress: ctx.ipAddress,
    });
    throw new AppError(
      401,
      API_ERROR_CODES.INVALID_CREDENTIALS,
      "Invalid credentials",
    );
  }

  if (!user.isVerified) {
    throw new AppError(
      403,
      API_ERROR_CODES.ACCOUNT_NOT_VERIFIED,
      "Account not verified",
    );
  }

  await authRepository.deleteLoginAttemptsByEmail(input.email);
  await authRepository.revokeActiveSessionsForDevice(user.id, ctx.userAgent);

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    isVerified: user.isVerified,
  });
  const rawRefreshToken = generateRefreshToken();
  await authRepository.createRefreshSession({
    userId: user.id,
    tokenHash: hashRefreshToken(rawRefreshToken),
    userAgent: ctx.userAgent,
    ipAddress: ctx.ipAddress,
    expiresAt: new Date(
      Date.now() + APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ),
  });

  return { accessToken, user: toAuthUserDto(user), rawRefreshToken };
}

export async function refresh(rawCookieToken: string | undefined): Promise<{
  accessToken: string;
  user: AuthUserDto;
  rawRefreshToken: string;
}> {
  if (!rawCookieToken) {
    throw new AppError(401, API_ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  }

  const tokenHash = hashRefreshToken(rawCookieToken);
  const session = await authRepository.findRefreshSessionByHash(tokenHash);

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError(401, API_ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  }

  await authRepository.revokeRefreshSession(session.id);

  const user = await authRepository.findUserById(session.userId);
  if (!user) {
    throw new AppError(401, API_ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    isVerified: user.isVerified,
  });
  const rawRefreshToken = generateRefreshToken();
  await authRepository.createRefreshSession({
    userId: user.id,
    tokenHash: hashRefreshToken(rawRefreshToken),
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    expiresAt: new Date(
      Date.now() + APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ),
  });

  return { accessToken, user: toAuthUserDto(user), rawRefreshToken };
}

export async function logout(
  rawCookieToken: string | undefined,
): Promise<void> {
  if (!rawCookieToken) return;

  const tokenHash = hashRefreshToken(rawCookieToken);
  const session = await authRepository.findRefreshSessionByHash(tokenHash);
  if (session && !session.revokedAt) {
    await authRepository.revokeRefreshSession(session.id);
  }
}

export async function getMe(userId: string): Promise<MeResponseDto> {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new AppError(401, API_ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  }
  return { user: toAuthUserDto(user) };
}
