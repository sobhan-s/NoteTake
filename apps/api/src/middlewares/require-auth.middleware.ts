import type { NextFunction, Request, Response } from "express";
import { API_ERROR_CODES } from "@shared/core/constants";
import {
  verifyAccessToken,
  type AccessTokenPayload,
} from "../services/token.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : undefined;

  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: API_ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" },
    });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { code: API_ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" },
    });
  }
}
