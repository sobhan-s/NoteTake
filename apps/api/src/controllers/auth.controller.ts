import type { Request, Response } from "express";
import {
  loginSchema,
  registerSchema,
  resendOtpSchema,
  verifyOtpSchema,
} from "@shared/core/schemas";
import { APP_LIMITS } from "@shared/core/constants";
import * as authService from "../services/auth.service.js";

const REFRESH_COOKIE_NAME = "refreshToken";

function setRefreshCookie(res: Response, rawRefreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: APP_LIMITS.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const { statusCode, data } = await authService.register(input);
  res.status(statusCode).json({ success: true, data });
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const input = verifyOtpSchema.parse(req.body);
  const data = await authService.verifyOtp(input);
  res.status(200).json({ success: true, data });
}

export async function resendOtp(req: Request, res: Response): Promise<void> {
  const input = resendOtpSchema.parse(req.body);
  const data = await authService.resendOtp(input);
  res.status(200).json({ success: true, data });
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const { accessToken, user, rawRefreshToken } = await authService.login(
    input,
    {
      ipAddress: req.ip ?? "",
      userAgent: req.get("user-agent") ?? null,
    },
  );
  setRefreshCookie(res, rawRefreshToken);
  res.status(200).json({ success: true, data: { accessToken, user } });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const rawCookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as
    string | undefined;
  try {
    const { accessToken, user, rawRefreshToken } =
      await authService.refresh(rawCookieToken);
    setRefreshCookie(res, rawRefreshToken);
    res.status(200).json({ success: true, data: { accessToken, user } });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawCookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as
    string | undefined;
  await authService.logout(rawCookieToken);
  clearRefreshCookie(res);
  res.status(200).json({ success: true, data: { message: "Logged out." } });
}

export async function me(req: Request, res: Response): Promise<void> {
  const data = await authService.getMe(req.user!.userId);
  res.status(200).json({ success: true, data });
}
