import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  createNoteSchema,
  updateNoteSchema,
  createTagSchema,
  updateTagSchema,
  searchNotesSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  loginSchema,
  registerSchema,
  resendOtpSchema,
  verifyOtpSchema,
  createShareLinkSchema,
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

const noteSchema = registry.register(
  "Note",
  z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    deletedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    hasActiveShareLink: z.boolean(),
  }),
);

const shareLinkSchema = registry.register(
  "ShareLink",
  z.object({
    noteId: z.string().uuid(),
    token: z.string(),
    expiresAt: z.string().datetime(),
    viewCount: z.number(),
    createdAt: z.string().datetime(),
  }),
);

const publicNoteSchema = registry.register(
  "PublicNote",
  z.object({
    title: z.string(),
    body: z.string(),
    updatedAt: z.string().datetime(),
  }),
);

const tagSchema = registry.register(
  "Tag",
  z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    name: z.string(),
    color: z.string(),
    noteCount: z.number().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
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
const notesPath = API_PATHS.BASE + API_PATHS.NOTES.ROOT;
const tagsPath = API_PATHS.BASE + API_PATHS.TAGS.ROOT;
const searchPath = API_PATHS.BASE + API_PATHS.SEARCH.ROOT;
const publicPath = API_PATHS.BASE + API_PATHS.PUBLIC.ROOT;

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
  path: `${authPath}${API_PATHS.AUTH.FORGOT_PASSWORD}`,
  summary: "Request a password reset OTP",
  request: { body: jsonBody(forgotPasswordSchema) },
  responses: {
    200: jsonResponse(
      "Password reset requested",
      z.object({ message: z.string() }),
    ),
  },
});

registry.registerPath({
  method: "post",
  path: `${authPath}${API_PATHS.AUTH.RESET_PASSWORD}`,
  summary: "Reset account password with verified OTP code",
  request: { body: jsonBody(resetPasswordSchema) },
  responses: {
    200: jsonResponse(
      "Password reset successful",
      z.object({ message: z.string() }),
    ),
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

// Notes Endpoints
registry.registerPath({
  method: "get",
  path: notesPath,
  summary: "List all active (non-trashed) notes for the current user",
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse("Notes list", z.object({ notes: z.array(noteSchema) })),
  },
});

registry.registerPath({
  method: "post",
  path: notesPath,
  summary: "Create a new note",
  security: [{ bearerAuth: [] }],
  request: { body: jsonBody(createNoteSchema) },
  responses: {
    201: jsonResponse("Note created", z.object({ note: noteSchema })),
  },
});

registry.registerPath({
  method: "get",
  path: `${notesPath}${API_PATHS.NOTES.TRASH}`,
  summary: "List trashed notes (Stage 1 soft-deleted)",
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse(
      "Trashed notes list",
      z.object({ notes: z.array(noteSchema) }),
    ),
  },
});

registry.registerPath({
  method: "get",
  path: `${notesPath}/{id}`,
  summary: "Get a specific active note by ID",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse("Note details", z.object({ note: noteSchema })),
  },
});

registry.registerPath({
  method: "patch",
  path: `${notesPath}/{id}`,
  summary: "Update note title or body",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: jsonBody(updateNoteSchema),
  },
  responses: {
    200: jsonResponse("Note updated", z.object({ note: noteSchema })),
  },
});

registry.registerPath({
  method: "delete",
  path: `${notesPath}/{id}`,
  summary: "Soft-delete a note (move to trash Stage 1)",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse("Note moved to trash", z.object({ note: noteSchema })),
  },
});

registry.registerPath({
  method: "post",
  path: `${notesPath}/{id}${API_PATHS.NOTES.RESTORE}`,
  summary: "Restore a Stage 1 trashed note back to active state",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse("Note restored", z.object({ note: noteSchema })),
  },
});

registry.registerPath({
  method: "delete",
  path: `${notesPath}/{id}${API_PATHS.NOTES.PERMANENT}`,
  summary: "Permanently purge a trashed note",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse(
      "Note permanently deleted",
      z.object({ message: z.string() }),
    ),
  },
});

registry.registerPath({
  method: "post",
  path: `${notesPath}/{id}/tags`,
  summary: "Attach a tag to a note",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: jsonBody(z.object({ tagId: z.string().uuid() })),
  },
  responses: {
    200: jsonResponse("Tag attached", z.object({ message: z.string() })),
  },
});

registry.registerPath({
  method: "delete",
  path: `${notesPath}/{id}/tags/{tagId}`,
  summary: "Detach a tag from a note",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid(), tagId: z.string().uuid() }),
  },
  responses: {
    200: jsonResponse("Tag detached", z.object({ message: z.string() })),
  },
});

// Tags Endpoints
registry.registerPath({
  method: "get",
  path: tagsPath,
  summary: "List all user tags with live note counts",
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse("Tags list", z.object({ tags: z.array(tagSchema) })),
  },
});

registry.registerPath({
  method: "post",
  path: tagsPath,
  summary: "Create a new tag",
  security: [{ bearerAuth: [] }],
  request: { body: jsonBody(createTagSchema) },
  responses: {
    201: jsonResponse("Tag created", z.object({ tag: tagSchema })),
  },
});

registry.registerPath({
  method: "patch",
  path: `${tagsPath}/{id}`,
  summary: "Rename or recolor a tag",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: jsonBody(updateTagSchema),
  },
  responses: {
    200: jsonResponse("Tag updated", z.object({ tag: tagSchema })),
  },
});

registry.registerPath({
  method: "delete",
  path: `${tagsPath}/{id}`,
  summary: "Delete a tag (detaches from notes without deleting notes)",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse("Tag deleted", z.object({ message: z.string() })),
  },
});

// Search Endpoint
registry.registerPath({
  method: "get",
  path: searchPath,
  summary:
    "Full-text search across active note titles and bodies with highlighted snippets",
  security: [{ bearerAuth: [] }],
  request: { query: searchNotesSchema },
  responses: {
    200: jsonResponse(
      "Search results",
      z.object({
        results: z.array(
          z.object({
            id: z.string().uuid(),
            title: z.string(),
            snippet: z.string(),
            updatedAt: z.string().datetime(),
          }),
        ),
        pagination: z.object({
          page: z.number(),
          limit: z.number(),
          total: z.number(),
          totalPages: z.number(),
        }),
      }),
    ),
  },
});

// Sharing Endpoints
registry.registerPath({
  method: "post",
  path: `${notesPath}/{id}${API_PATHS.NOTES.SHARE}`,
  summary:
    "Generate a share link for a note, or return the existing active one unchanged (idempotent get-or-create)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: jsonBody(createShareLinkSchema),
  },
  responses: {
    201: jsonResponse("New share link created", shareLinkSchema),
    200: jsonResponse(
      "Existing active share link returned unchanged",
      shareLinkSchema,
    ),
  },
});

registry.registerPath({
  method: "get",
  path: `${notesPath}/{id}${API_PATHS.NOTES.SHARE}`,
  summary: "Fetch the note's current active share link",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse("Active share link", shareLinkSchema),
  },
});

registry.registerPath({
  method: "delete",
  path: `${notesPath}/{id}${API_PATHS.NOTES.SHARE}`,
  summary: "Revoke the note's active share link",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse(
      "Share link revoked",
      z.object({ noteId: z.string().uuid() }),
    ),
  },
});

registry.registerPath({
  method: "get",
  path: `${publicPath}${API_PATHS.PUBLIC.SHARE}/{token}`,
  summary:
    "Public, unauthenticated read-only view of a shared note; atomically increments the link's view count",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonResponse("Shared note view", publicNoteSchema),
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
    servers: [{ url: "/" }],
  });
}
