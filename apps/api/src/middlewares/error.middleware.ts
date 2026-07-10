import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { API_ERROR_CODES } from "@shared/core/constants";
import { AppError } from "../errors/app-error.js";

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Validation failed",
        details: err.issues,
      },
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: err.message },
  });
}
