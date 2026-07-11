import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  loginSchema,
  registerSchema,
  resendOtpSchema,
  verifyOtpSchema,
} from "@shared/core/schemas";
import { API_PATHS } from "@shared/core/constants";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const authUserSchema = registry.register(
  "AuthUser",
  z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    isVerified: z.boolean(),
  }),
);

const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});

const jsonResponse = <T extends z.ZodTypeAny>(
  description: string,
  schema: T,
) => ({
  description,
  content: {
    "application/json": {
      schema: z.object({ success: z.literal(true), data: schema }),
    },
  },
});

const authPath = API_PATHS.BASE + API_PATHS.AUTH.ROOT;

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.REGISTER}`,
  summary:
    "Register a new account (or re-trigger verification for a pending one)",
  request: { body: jsonBody(registerSchema) },
  responses: {
    201: jsonResponse(
      "Account created, OTP sent",
      z.object({ isReTriggered: z.literal(false), userId: z.string().uuid() }),
    ),
    200: jsonResponse(
      "Verification re-triggered",
      z.object({ isReTriggered: z.literal(true), userId: z.string().uuid() }),
    ),
  },
});

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.VERIFY_OTP}`,
  summary: "Verify an email-verification or password-reset OTP",
  request: { body: jsonBody(verifyOtpSchema) },
  responses: {
    200: jsonResponse("OTP verified", z.object({ message: z.string() })),
  },
});

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.RESEND_OTP}`,
  summary: "Resend an OTP code",
  request: { body: jsonBody(resendOtpSchema) },
  responses: {
    200: jsonResponse("OTP resent", z.object({ message: z.string() })),
  },
});

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.LOGIN}`,
  summary: "Log in with email + password",
  request: { body: jsonBody(loginSchema) },
  responses: {
    200: jsonResponse(
      "Login successful",
      z.object({ accessToken: z.string(), user: authUserSchema }),
    ),
  },
});

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.REFRESH}`,
  summary: "Silently rotate the refresh session and issue a new access token",
  responses: {
    200: jsonResponse(
      "Session refreshed",
      z.object({ accessToken: z.string(), user: authUserSchema }),
    ),
  },
});

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.LOGOUT}`,
  summary: "Revoke the current session's refresh token",
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse("Logged out", z.object({ message: z.string() })),
  },
});

registry.registerPath({
  method: "get",
  path: `${authPath}${API_PATHS.AUTH.ME}`,
  summary: "Hydrate the current session from the access token",
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse("Current user", z.object({ user: authUserSchema })),
  },
});

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

export function buildOpenApiDocument(): ReturnType<
  OpenApiGeneratorV3["generateDocument"]
> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: { title: "Notes App API", version: "1.0.0" },
    servers: [{ url: API_PATHS.BASE }],
  });
}
