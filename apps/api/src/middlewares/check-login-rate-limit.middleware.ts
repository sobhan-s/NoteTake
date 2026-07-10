import type { NextFunction, Request, Response } from "express";
import { APP_LIMITS, API_ERROR_CODES } from "@shared/core/constants";
import { countRecentLoginAttempts } from "../repositories/auth.repository.js";

export async function checkLoginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : undefined;

  if (!email) {
    next();
    return;
  }

  const since = new Date(
    Date.now() - APP_LIMITS.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
  );
  const failedCount = await countRecentLoginAttempts(email, since);

  if (failedCount >= APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    res.status(429).json({
      success: false,
      error: {
        code: API_ERROR_CODES.RATE_LIMIT_EXCEEDED,
        message: "Too many login attempts. Please try again later.",
      },
    });
    return;
  }

  next();
}
