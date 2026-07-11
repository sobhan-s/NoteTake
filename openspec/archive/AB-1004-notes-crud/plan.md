# Implementation Plan — AB-1004: Notes Full CRUD + Two-Stage Trash

Source of truth: `openspec/changes/AB-1004-notes-crud/specs/notes/spec.md`. This plan maps that
spec's deltas onto exact file paths, function signatures, and sequencing, following the existing
`apps/api` auth-domain patterns (`auth.controller.ts` / `auth.service.ts` / `auth.repository.ts` /
`auth.router.ts`) so the notes domain is structurally identical.

## 0. Confirmed Pre-Existing Infrastructure (no action needed)

- `Note`, `Tag`, `NoteTag`, `NoteVersion`, `ShareLink` Prisma models — already in `schema.prisma`.
- Title/body `CHECK` constraints, `search_vector` trigger, GIN index — already applied in
  `20260710124549_init`. **No new migration in this ticket.**
- `node-cron` (`4.6.0`) — already a pinned dependency in `apps/api/package.json`.
- `tests/helpers/db.ts` → `resetTestDatabase()` already truncates `notes`, `tags`, `note_tags`,
  `note_versions`, `share_links` (built ahead of schedule in AB-1002/1003 test infra). No helper
  change needed, only new test files.

## 1. Shared Package (`packages/shared/src/...`) — implement first, everything downstream imports it

### 1.1 `src/constants/app-limits.constant.ts` (MODIFIED)

Add to the existing `APP_LIMITS` object (do not create a second export):

```ts
NOTE_TITLE_MAX_CHARS: 200,
NOTE_BODY_MAX_CHARS: 100000,
TRASH_STAGE_1_DAYS: 30,
TRASH_STAGE_2_DAYS: 30,
```

### 1.2 `src/constants/api-paths.constant.ts` (MODIFIED)

Add sibling key to `API_PATHS` (matches the `AUTH: {...}` shape):

```ts
NOTES: {
  ROOT: "/notes",
  RESTORE: "/restore",
  PERMANENT: "/permanent",
},
```

### 1.3 `src/constants/api-error-codes.constant.ts` (MODIFIED)

Add `NOTE_NOT_FOUND: "NOTE_NOT_FOUND"` to `API_ERROR_CODES`.

### 1.4 `src/constants/validation-messages.constant.ts` (MODIFIED)

Add the two field-specific messages the schemas below reference:

```ts
NOTE_TITLE_REQUIRED: "Title is required",
NOTE_TITLE_TOO_LONG: `Title must be ${APP_LIMITS.NOTE_TITLE_MAX_CHARS} characters or fewer`,
NOTE_BODY_TOO_LONG: `Body must be ${APP_LIMITS.NOTE_BODY_MAX_CHARS} characters or fewer`,
NOTE_UPDATE_EMPTY: "At least one of title or body must be provided",
```

(Requires importing `APP_LIMITS` into this file — check for a circular-import risk first; if
`app-limits.constant.ts` has zero imports from `validation-messages.constant.ts`, this is safe,
matching the existing one-directional pattern where `auth.schema.ts` imports both independently.)

### 1.5 `src/schemas/note.schema.ts` (ADDED)

```ts
import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const createNoteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.NOTE_TITLE_REQUIRED)
    .max(
      APP_LIMITS.NOTE_TITLE_MAX_CHARS,
      VALIDATION_MESSAGES.NOTE_TITLE_TOO_LONG,
    ),
  body: z
    .string()
    .max(
      APP_LIMITS.NOTE_BODY_MAX_CHARS,
      VALIDATION_MESSAGES.NOTE_BODY_TOO_LONG,
    ),
});

export const updateNoteSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, VALIDATION_MESSAGES.NOTE_TITLE_REQUIRED)
      .max(
        APP_LIMITS.NOTE_TITLE_MAX_CHARS,
        VALIDATION_MESSAGES.NOTE_TITLE_TOO_LONG,
      )
      .optional(),
    body: z
      .string()
      .max(
        APP_LIMITS.NOTE_BODY_MAX_CHARS,
        VALIDATION_MESSAGES.NOTE_BODY_TOO_LONG,
      )
      .optional(),
  })
  .refine((data) => data.title !== undefined || data.body !== undefined, {
    message: VALIDATION_MESSAGES.NOTE_UPDATE_EMPTY,
  });

export const permanentDeleteSchema = z.object({
  confirm: z.literal(true),
});
```

Note: body has no `.min(1)` — an empty body is valid per FRS-2.1 (only title is required); the
spec's Error Scenarios table only lists empty _title_ as a validation failure.

### 1.6 `src/schemas/index.ts` (MODIFIED)

Add `export * from "./note.schema";`.

### 1.7 `src/types/note.type.ts` (ADDED)

```ts
import type { z } from "zod";
import type {
  createNoteSchema,
  updateNoteSchema,
  permanentDeleteSchema,
} from "../schemas/note.schema";

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type PermanentDeleteInput = z.infer<typeof permanentDeleteSchema>;

export type NoteResponseDto = {
  id: string;
  title: string;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### 1.8 `src/types/index.ts` (MODIFIED)

Add `export * from "./note.type";`.

---

## 2. Backend (`apps/api/src/...`)

### 2.1 `src/repositories/note.repository.ts` (ADDED)

Mirrors `auth.repository.ts`'s `Db` narrowing + default-param transaction pattern:

```ts
import type { Note, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "note">;

export function createNote(
  data: { userId: string; title: string; body: string },
  db: Db = prisma,
): Promise<Note> {
  return db.note.create({ data });
}

export function findActiveNoteByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<Note | null> {
  return db.note.findFirst({ where: { id, userId, deletedAt: null } });
}

export function findTrashedNoteByIdForUser(
  id: string,
  userId: string,
  db: Db = prisma,
): Promise<Note | null> {
  return db.note.findFirst({ where: { id, userId, deletedAt: { not: null } } });
}

export function updateNoteContent(
  id: string,
  data: { title?: string; body?: string },
  db: Db = prisma,
): Promise<Note> {
  return db.note.update({ where: { id }, data });
}

export function softDeleteNote(id: string, db: Db = prisma): Promise<Note> {
  return db.note.update({ where: { id }, data: { deletedAt: new Date() } });
}

export function restoreNote(id: string, db: Db = prisma): Promise<Note> {
  return db.note.update({ where: { id }, data: { deletedAt: null } });
}

export function permanentlyDeleteNote(
  id: string,
  db: Db = prisma,
): Promise<Note> {
  return db.note.delete({ where: { id } });
}

export function purgeStage2Notes(
  stage2Cutoff: Date,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.note.deleteMany({
    where: { deletedAt: { not: null, lt: stage2Cutoff } },
  });
}
```

No raw SQL — `search_vector` trigger and `CHECK` constraints fire automatically on
`create`/`update`.

### 2.2 `src/services/note.service.ts` (ADDED)

Zero HTTP context, per `apps/api/CLAUDE.md`. All ownership/state checks throw
`AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found")` — a single shared helper avoids
repeating the message:

```ts
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import type {
  CreateNoteInput,
  NoteResponseDto,
  UpdateNoteInput,
} from "@shared/core/types";
import type { Note } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import * as noteRepository from "../repositories/note.repository.js";

function notFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

function toNoteResponseDto(note: Note): NoteResponseDto {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function isWithinStage1(deletedAt: Date | null): boolean {
  if (!deletedAt) return false;
  const stage1CutoffMs = APP_LIMITS.TRASH_STAGE_1_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - deletedAt.getTime() < stage1CutoffMs;
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponseDto> {
  const note = await noteRepository.createNote({
    userId,
    title: input.title,
    body: input.body,
  });
  return toNoteResponseDto(note);
}

export async function getNoteById(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const note = await noteRepository.findActiveNoteByIdForUser(noteId, userId);
  if (!note) notFound();
  return toNoteResponseDto(note);
}

export async function updateNote(
  userId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<NoteResponseDto> {
  const existing = await noteRepository.findActiveNoteByIdForUser(
    noteId,
    userId,
  );
  if (!existing) notFound();
  const updated = await noteRepository.updateNoteContent(noteId, {
    title: input.title,
    body: input.body,
  });
  return toNoteResponseDto(updated);
}

export async function softDeleteNote(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const existing = await noteRepository.findActiveNoteByIdForUser(
    noteId,
    userId,
  );
  if (!existing) notFound();
  const deleted = await noteRepository.softDeleteNote(noteId);
  return toNoteResponseDto(deleted);
}

export async function restoreNote(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const trashed = await noteRepository.findTrashedNoteByIdForUser(
    noteId,
    userId,
  );
  if (!trashed || !isWithinStage1(trashed.deletedAt)) notFound();
  const restored = await noteRepository.restoreNote(noteId);
  return toNoteResponseDto(restored);
}

export async function permanentDeleteNote(
  userId: string,
  noteId: string,
): Promise<{ id: string }> {
  const trashed = await noteRepository.findTrashedNoteByIdForUser(
    noteId,
    userId,
  );
  if (!trashed || !isWithinStage1(trashed.deletedAt)) notFound();
  await noteRepository.permanentlyDeleteNote(noteId);
  return { id: noteId };
}
```

- `createNoteSchema`/`updateNoteSchema`/`permanentDeleteSchema` parsing stays at the controller
  layer (per `apps/api/CLAUDE.md`); the service trusts its typed input.
- `getById`/`update`/`softDelete` all query with `deletedAt: null` — a Stage-1/2 trashed note
  simply doesn't match, collapsing to `404` with zero extra branching (satisfies Resolved
  Decision #2 for free).
- `restore`/`permanentDelete` share the identical `isWithinStage1` gate (Resolved Decision #4 +
  FRS-2.2.5/2.2.8) — same 404 for "never trashed," "already Stage 2," and "cross-user."

### 2.3 `src/controllers/note.controller.ts` (ADDED)

Mirrors `auth.controller.ts` — parse via `@shared/core/schemas`, one service call, wrap response:

```ts
import type { Request, Response } from "express";
import {
  createNoteSchema,
  permanentDeleteSchema,
  updateNoteSchema,
} from "@shared/core/schemas";
import * as noteService from "../services/note.service.js";

export async function create(req: Request, res: Response): Promise<void> {
  const input = createNoteSchema.parse(req.body);
  const data = await noteService.createNote(req.user!.userId, input);
  res.status(201).json({ success: true, data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await noteService.getNoteById(req.user!.userId, req.params.id);
  res.status(200).json({ success: true, data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = updateNoteSchema.parse(req.body);
  const data = await noteService.updateNote(
    req.user!.userId,
    req.params.id,
    input,
  );
  res.status(200).json({ success: true, data });
}

export async function softDelete(req: Request, res: Response): Promise<void> {
  const data = await noteService.softDeleteNote(
    req.user!.userId,
    req.params.id,
  );
  res.status(200).json({ success: true, data });
}

export async function restore(req: Request, res: Response): Promise<void> {
  const data = await noteService.restoreNote(req.user!.userId, req.params.id);
  res.status(200).json({ success: true, data });
}

export async function permanentDelete(
  req: Request,
  res: Response,
): Promise<void> {
  permanentDeleteSchema.parse(req.body);
  const data = await noteService.permanentDeleteNote(
    req.user!.userId,
    req.params.id,
  );
  res.status(200).json({ success: true, data });
}
```

### 2.4 `src/routers/note.router.ts` (ADDED)

```ts
import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as noteController from "../controllers/note.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";

const router: RouterType = Router();

router.use(requireAuth);

router.post("/", noteController.create);
router.get("/:id", noteController.getById);
router.patch("/:id", noteController.update);
router.delete("/:id", noteController.softDelete);
router.post(`/:id${API_PATHS.NOTES.RESTORE}`, noteController.restore);
router.delete(
  `/:id${API_PATHS.NOTES.PERMANENT}`,
  noteController.permanentDelete,
);

export default router;
```

Route order note: `/:id/restore` and `/:id/permanent` are distinct HTTP methods/suffixes from
plain `/:id`, so Express matches them unambiguously regardless of declaration order — no route
collision risk (unlike a hypothetical `GET /:id/restore` vs `GET /:id`).

### 2.5 `src/routers/index.ts` (MODIFIED)

Add one line, following the exact existing mount pattern:

```ts
import noteRouter from "./note.router.js";
...
router.use(API_PATHS.BASE + API_PATHS.NOTES.ROOT, noteRouter);
```

### 2.6 `src/constants/api.constants.ts` (MODIFIED — Tier 2)

Add:

```ts
export const CRON_CLEANUP_SCHEDULE = "0 3 * * *";
```

### 2.7 `src/jobs/cleanup.job.ts` (MODIFIED — Pass 1 implementation)

```ts
import cron from "node-cron";
import { APP_LIMITS } from "@shared/core/constants";
import { CRON_CLEANUP_SCHEDULE } from "../constants/api.constants.js";
import * as noteRepository from "../repositories/note.repository.js";

function computeStage2Cutoff(): Date {
  const totalDays =
    APP_LIMITS.TRASH_STAGE_1_DAYS + APP_LIMITS.TRASH_STAGE_2_DAYS;
  return new Date(Date.now() - totalDays * 24 * 60 * 60 * 1000);
}

export async function runNotesPurgePass(): Promise<void> {
  await noteRepository.purgeStage2Notes(computeStage2Cutoff());
}

export function startCleanupJob(): void {
  cron.schedule(CRON_CLEANUP_SCHEDULE, () => {
    void runNotesPurgePass();
  });
}
```

- Exporting `runNotesPurgePass` separately (not only the scheduled closure) lets contract/unit
  tests invoke the purge logic directly without waiting on/mocking `node-cron` timing.
- `deleteMany` on an empty match set is a no-op — naturally idempotent, satisfies FRS-8a.4.
- Confirmed via grep: `startCleanupJob()` is currently called nowhere in `src/`, and there is no
  `server.ts`/separate entrypoint — `package.json`'s `dev` (`tsx watch src/app.ts`) and `build`
  (`tsup src/app.ts ...`) both target `src/app.ts` directly, and it has no `app.listen(...)`
  call either (module only builds/exports the Express app — likely intentional so `supertest`
  can import `app` without binding a port). This ticket wires `startCleanupJob()` into
  `src/app.ts` at module scope (§2.8 below); it does **not** add `app.listen(...)`, since binding
  a port is unrelated to this ticket's scope and not mentioned anywhere in `spec.md`.

### 2.8 `src/app.ts` (MODIFIED — one addition)

```ts
import { startCleanupJob } from "./jobs/cleanup.job.js";
...
app.use(errorMiddleware);

startCleanupJob();

export default app;
```

Calling it unconditionally at module scope is safe for tests too: `node-cron`'s `cron.schedule`
only registers a timer callback, it does not execute the task immediately, so importing `app` in
`supertest` suites never triggers a real purge pass mid-test.

---

## 3. Tests (`apps/api/tests/`)

New files only — existing `resetTestDatabase()` in `tests/helpers/db.ts` already truncates all
notes-domain tables, and a `tests/helpers/notes.ts` (ROUTES + fixture helper, mirroring
`tests/helpers/auth.ts`) should be added for reuse across suites:

- `tests/helpers/notes.ts` (ADDED) — `ROUTES.NOTES_ROOT`, `ROUTES.noteById(id)`,
  `ROUTES.restore(id)`, `ROUTES.permanent(id)`, plus a `createNoteDirect(userId, overrides)`
  Prisma-direct fixture helper (parallel to `createVerifiedUser`) for seeding notes in
  arbitrary states (active / Stage-1 / Stage-2) without going through the HTTP layer.
- `tests/contract/notes.create.test.ts` — 201 + persisted row; empty/whitespace title 400
  naming `title`; title > 200 chars / body > 100,000 chars 400; requires auth (401 without token).
- `tests/contract/notes.get.test.ts` — 200 for own active note; 404 for another user's note;
  404 for nonexistent id; 404 for Stage-1 trashed; 404 for Stage-2 trashed.
- `tests/contract/notes.update.test.ts` — 200 partial update (title-only, body-only); 400 empty
  title; 400 both-fields-omitted (schema `.refine`); 404 cross-user; 404 on trashed note.
- `tests/contract/notes.delete-restore.test.ts` — soft-delete sets `deletedAt`; restore within
  Stage-1 clears `deletedAt`; restore on never-trashed note → 404; restore on Stage-2 note (seed
  `deletedAt` at 31+ days ago) → 404; restore on cross-user note → 404.
- `tests/contract/notes.permanent-delete.test.ts` — 200 + row physically gone from `notes` table
  (verify via `prisma.note.findUnique`); requires `confirm: true` (400 without it, using the exact
  Zod literal-mismatch shape — verify against the actual error the schema produces, matching the
  existing `VALIDATION_ERROR` convention); 404 on Stage-2 note; 404 cross-user.
- `tests/unit/note.service.test.ts` — direct-call boundary tests for `isWithinStage1` day-30
  edge (29d23h59m vs 30d0h1m boundary) and the repository-call sequencing for restore/permanent
  delete, using a mocked `noteRepository` (matching `otp.service.test.ts`'s mocking style — check
  that file's exact `vi.mock` pattern during `/implement`).
- `tests/contract/cleanup.notes-purge.test.ts` — seed a note at exactly the 60-day cutoff minus
  1s (must survive) and plus 1s (must be purged) via direct `prisma.note.create` with a forced
  `deletedAt`/`createdAt` override, call `runNotesPurgePass()` directly, assert row
  presence/absence and cascade removal of any `NoteTag`/`NoteVersion`/`ShareLink` rows seeded
  against it (exercises `onDelete: Cascade` even though those features aren't built yet).

Exact FRS-derived test names/boundary values are `test-writer`'s responsibility at `/implement`
time — this list is scope guidance only, not final assertions (per `AGENTS.md §10`).

---

## 4. Sequencing (bottom-up, matches dependency order)

1. `packages/shared` deltas (§1) — build/typecheck shared package alone first.
2. `apps/api` repository → service → controller → router → `routers/index.ts` mount (§2.1–2.5).
3. Tier-2 constant + cleanup job + `app.ts` wiring (§2.6–2.8).
4. Tests (§3), run against `notes_app_test` only.
5. Full `pnpm turbo run build && lint && typecheck && test -- --coverage` per the Definition of
   Done (`CLAUDE.md §6`) before `/review`.

## 5. Architectural Compliance Checklist

- [ ] Zero Zod schemas or SQL in `controllers/`/`routers/` — confirmed above (schemas imported
      from `@shared/core`, no raw SQL needed).
- [ ] Every numeric literal (200, 100000, 30, 30, cron string) sourced from `APP_LIMITS` / Tier-2
      constants — no inline magic numbers.
- [ ] `deletedAt = now()` only, never a physical `DELETE`, for `softDeleteNote` — physical delete
      reserved for `permanentDeleteNote` (user-confirmed) and `purgeStage2Notes` (cron-only).
- [ ] No `tagIds`, version-snapshot, or share-link logic introduced anywhere in this ticket's
      files (Out of Scope section, spec.md).
- [ ] All new/changed files re-exported from their directory's barrel `index.ts`
      (`packages/shared` rule).
- [ ] Tests run only against `notes_app_test`, reuse the existing `resetTestDatabase()` guard —
      no new `TRUNCATE` statements written by hand.
- [ ] Auth/token handling untouched — this ticket adds zero new auth surface, only consumes
      existing `requireAuth` middleware.

## 6. Quality Gate Commands (run before `/review`/`/pr`, per `CLAUDE.md §6`)

```
pnpm turbo run build
pnpm turbo run lint          # --max-warnings 0
pnpm turbo run typecheck     # tsc --noEmit only
pnpm turbo run test -- --coverage
```

---

Waiting for explicit **APPROVED** before proceeding to `/tasks`.
