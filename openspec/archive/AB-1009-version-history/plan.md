# Implementation Plan — AB-1009-version-history

Spec: `openspec/changes/AB-1009-version-history/specs/version-history/spec.md`
Scope: `BACKEND` only (`AB-1002..AB-1009 → BACKEND`, ticket scope map). No `apps/web` changes.
Layering invariant enforced throughout: `routers/ → controllers/ → services/ → repositories/ → shared`.

## 0. Database

No migration required. `NoteVersion` (`apps/api/prisma/schema.prisma:131-142`) already exists exactly as
`SDS §4.4` specifies (`titleSnapshot`, `bodySnapshot`, `@@index([noteId, createdAt(sort: Desc)])`). This
ticket is application-layer only.

## 1. `packages/shared` — Single Source of Truth (Rule 11, FRS-8.5)

All steps in this section are prerequisites for every `apps/api` change below; no backend code may
hardcode a literal `5`, `90`, `"/versions"`, or a new error-code string.

### 1.1 `src/constants/app-limits.constant.ts` (MODIFIED)

Add two keys to the existing `APP_LIMITS` object:

```typescript
VERSION_SNAPSHOT_THROTTLE_MINUTES: 5,
VERSION_RETENTION_DAYS: 90,
```

### 1.2 `src/constants/api-paths.constant.ts` (MODIFIED)

Add to `API_PATHS.NOTES`:

```typescript
VERSIONS: "/versions",
```

`RESTORE: "/restore"` (already present) is reused verbatim for the nested version-restore segment —
no new path literal for it.

### 1.3 `src/constants/api-error-codes.constant.ts` (MODIFIED)

Add to `API_ERROR_CODES`:

```typescript
VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
```

### 1.4 `src/schemas/note.schema.ts` (MODIFIED)

Add `isExplicitSave` to the existing `updateNoteSchema`, before the `.refine(...)` call:

```typescript
isExplicitSave: z.boolean().default(false),
```

`createNoteSchema`, `permanentDeleteSchema`, `listNotesSchema`, `listTrashSchema` are unchanged.

### 1.5 `src/types/note.type.ts` (MODIFIED)

`UpdateNoteInput` picks up `isExplicitSave: boolean` automatically via `z.infer` — no manual edit
needed there. Add two new hand-written response DTOs (no schema backs these; they're read models):

```typescript
export type NoteVersionSummaryDto = {
  id: string;
  titleSnapshot: string;
  createdAt: string;
};

export type NoteVersionResponseDto = {
  id: string;
  noteId: string;
  titleSnapshot: string;
  bodySnapshot: string;
  createdAt: string;
};
```

No barrel changes needed — both schema and type files are already re-exported by the existing
`src/schemas/index.ts` / `src/types/index.ts`.

## 2. `apps/api/src/repositories/note-version.repository.ts` (NEW)

Models on the existing `note.repository.ts` pattern: every function accepts `db: Db = prisma` for
transaction composability, every read scopes by `noteId`.

```typescript
import type { NoteVersion, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "noteVersion">;
type RawDb = Pick<Prisma.TransactionClient, "$executeRaw">;

export function createVersion(
  data: { noteId: string; titleSnapshot: string; bodySnapshot: string },
  db: Db = prisma,
): Promise<NoteVersion> {
  return db.noteVersion.create({ data });
}

export function findLatestVersionForNote(
  noteId: string,
  db: Db = prisma,
): Promise<NoteVersion | null> {
  return db.noteVersion.findFirst({
    where: { noteId },
    orderBy: { createdAt: "desc" },
  });
}

export function listVersionsForNote(
  noteId: string,
  db: Db = prisma,
): Promise<NoteVersion[]> {
  return db.noteVersion.findMany({
    where: { noteId },
    orderBy: { createdAt: "desc" },
  });
}

export function findVersionByIdForNote(
  noteId: string,
  versionId: string,
  db: Db = prisma,
): Promise<NoteVersion | null> {
  return db.noteVersion.findFirst({ where: { id: versionId, noteId } });
}

export function purgeOldVersions(
  cutoff: Date,
  db: RawDb = prisma,
): Promise<number> {
  return db.$executeRaw`
    DELETE FROM note_versions
    WHERE created_at < ${cutoff}
      AND id NOT IN (
        SELECT DISTINCT ON (note_id) id
        FROM note_versions
        ORDER BY note_id, created_at DESC
      )
  `;
}
```

`findVersionByIdForNote`'s compound `{ id: versionId, noteId }` where-clause is what makes a
cross-note version id resolve to `null` (spec scenario: "belongs to a different note") without any
extra service-layer branching. `purgeOldVersions` uses a tagged-template `$executeRaw` (not
`$queryRawUnsafe`) since the only variable is a `Date`, safely parameterized — no string
interpolation, no injection surface, matching the SDS §5.3 Pass 2 SQL exactly.

## 3. `apps/api/src/services/note.service.ts` (MODIFIED)

Two changes, both wrapped in `prisma.$transaction` (same pattern already used by `softDeleteNote`):

1. Export the existing private `toNoteResponseDto` (drop nothing, just add the `export` keyword) —
   `note-version.service.ts` (§4) needs it to map a restored note back to `NoteResponseDto` without
   duplicating the mapper.
2. `createNote`: wrap in a transaction that creates the note, then unconditionally creates its first
   `NoteVersion` from the same title/body (`FRS-6.1`).
3. `updateNote`: wrap in a transaction that updates the note, then conditionally creates a new
   `NoteVersion` per the 3-branch algorithm (`FRS-6.1`, `SDS §4.4`).

```typescript
import * as noteVersionRepository from "../repositories/note-version.repository.js";

async function shouldSnapshot(
  noteId: string,
  isExplicitSave: boolean,
  db: Prisma.TransactionClient,
): Promise<boolean> {
  if (isExplicitSave) return true;
  const latest = await noteVersionRepository.findLatestVersionForNote(
    noteId,
    db,
  );
  if (!latest) return true;
  const throttleMs = APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES * 60 * 1000;
  return Date.now() - latest.createdAt.getTime() >= throttleMs;
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponseDto> {
  const note = await prisma.$transaction(async (tx) => {
    const created = await noteRepository.createNote(
      { userId, title: input.title, body: input.body },
      tx,
    );
    await noteVersionRepository.createVersion(
      {
        noteId: created.id,
        titleSnapshot: created.title,
        bodySnapshot: created.body,
      },
      tx,
    );
    return created;
  });
  return toNoteResponseDto({ ...note, shareLinks: [] });
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
  const updated = await prisma.$transaction(async (tx) => {
    const note = await noteRepository.updateNoteContent(
      noteId,
      { title: input.title, body: input.body },
      tx,
    );
    if (await shouldSnapshot(noteId, input.isExplicitSave, tx)) {
      await noteVersionRepository.createVersion(
        { noteId, titleSnapshot: note.title, bodySnapshot: note.body },
        tx,
      );
    }
    return note;
  });
  return toNoteResponseDto(updated);
}
```

`shouldSnapshot` reads the latest version through the same `tx` the update runs in, so the
throttle decision and the write are consistent within one transaction — no race between concurrent
autosave requests for the same note.

## 4. `apps/api/src/services/note-version.service.ts` (NEW)

Modeled directly on `share.service.ts`'s `assertOwnedActiveNote` precedent — duplicated locally
rather than extracted to a shared util, matching the existing convention (`share.service.ts` already
duplicates this exact helper rather than importing it from `note.service.ts`).

```typescript
import type { NoteVersion } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import type {
  NoteResponseDto,
  NoteVersionResponseDto,
  NoteVersionSummaryDto,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import { prisma } from "../lib/prisma-client.js";
import * as noteRepository from "../repositories/note.repository.js";
import * as noteVersionRepository from "../repositories/note-version.repository.js";
import { toNoteResponseDto } from "./note.service.js";

function noteNotFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

function versionNotFound(): never {
  throw new AppError(
    404,
    API_ERROR_CODES.VERSION_NOT_FOUND,
    "Version not found",
  );
}

async function assertOwnedActiveNote(
  userId: string,
  noteId: string,
): Promise<void> {
  const note = await noteRepository.findActiveNoteByIdForUser(noteId, userId);
  if (!note) noteNotFound();
}

function toSummaryDto(v: NoteVersion): NoteVersionSummaryDto {
  return {
    id: v.id,
    titleSnapshot: v.titleSnapshot,
    createdAt: v.createdAt.toISOString(),
  };
}

function toVersionResponseDto(v: NoteVersion): NoteVersionResponseDto {
  return {
    id: v.id,
    noteId: v.noteId,
    titleSnapshot: v.titleSnapshot,
    bodySnapshot: v.bodySnapshot,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function listVersions(
  userId: string,
  noteId: string,
): Promise<{ versions: NoteVersionSummaryDto[] }> {
  await assertOwnedActiveNote(userId, noteId);
  const versions = await noteVersionRepository.listVersionsForNote(noteId);
  return { versions: versions.map(toSummaryDto) };
}

export async function getVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteVersionResponseDto> {
  await assertOwnedActiveNote(userId, noteId);
  const version = await noteVersionRepository.findVersionByIdForNote(
    noteId,
    versionId,
  );
  if (!version) versionNotFound();
  return toVersionResponseDto(version);
}

export async function restoreVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteResponseDto> {
  await assertOwnedActiveNote(userId, noteId);
  const version = await noteVersionRepository.findVersionByIdForNote(
    noteId,
    versionId,
  );
  if (!version) versionNotFound();
  const restored = await prisma.$transaction(async (tx) => {
    const note = await noteRepository.updateNoteContent(
      noteId,
      { title: version.titleSnapshot, body: version.bodySnapshot },
      tx,
    );
    await noteVersionRepository.createVersion(
      {
        noteId,
        titleSnapshot: version.titleSnapshot,
        bodySnapshot: version.bodySnapshot,
      },
      tx,
    );
    return note;
  });
  return toNoteResponseDto(restored);
}
```

Restore never checks `shouldSnapshot`/the throttle — it unconditionally appends, per spec.

## 5. `apps/api/src/controllers/note-version.controller.ts` (NEW)

Zero Zod, zero SQL — pure HTTP adapters, mirroring `share.controller.ts`:

```typescript
import type { Request, Response } from "express";
import * as noteVersionService from "../services/note-version.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  const data = await noteVersionService.listVersions(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await noteVersionService.getVersion(
    req.user!.userId,
    req.params.id as string,
    req.params.versionId as string,
  );
  res.status(200).json({ success: true, data });
}

export async function restore(req: Request, res: Response): Promise<void> {
  const data = await noteVersionService.restoreVersion(
    req.user!.userId,
    req.params.id as string,
    req.params.versionId as string,
  );
  res.status(200).json({ success: true, data });
}
```

`apps/api/src/controllers/note.controller.ts` needs **no change** — `update` already parses the full
`updateNoteSchema` object and forwards it wholesale to `noteService.updateNote`, so the new
`isExplicitSave` field flows through automatically once §1.4 lands.

## 6. `apps/api/src/routers/note-version.router.ts` (NEW)

`mergeParams: true` sub-router, same shape as `share.router.ts`:

```typescript
import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as noteVersionController from "../controllers/note-version.controller.js";

const router: RouterType = Router({ mergeParams: true });

router.get("/", noteVersionController.list);
router.get("/:versionId", noteVersionController.getById);
router.post(
  `/:versionId${API_PATHS.NOTES.RESTORE}`,
  noteVersionController.restore,
);

export default router;
```

## 7. `apps/api/src/routers/note.router.ts` (MODIFIED)

Mount the new sub-router exactly like `shareRouter`:

```typescript
import noteVersionRouter from "./note-version.router.js";
// ...
router.use(`/:id${API_PATHS.NOTES.VERSIONS}`, noteVersionRouter);
```

Resulting routes: `GET /api/v1/notes/:id/versions`, `GET /api/v1/notes/:id/versions/:versionId`,
`POST /api/v1/notes/:id/versions/:versionId/restore` — all behind the router-level `requireAuth`
already applied to `/api/v1/notes`.

## 8. `apps/api/src/jobs/cleanup.job.ts` (MODIFIED)

Add a second purge pass alongside the existing Stage-2 trash purge, run in the same cron tick
(`03:00 UTC`, unchanged `CRON_CLEANUP_SCHEDULE`):

```typescript
import * as noteVersionRepository from "../repositories/note-version.repository.js";

function computeVersionRetentionCutoff(): Date {
  return new Date(
    Date.now() - APP_LIMITS.VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}

export async function runVersionsPurgePass(): Promise<void> {
  await noteVersionRepository.purgeOldVersions(computeVersionRetentionCutoff());
}

export function startCleanupJob(): void {
  cron.schedule(CRON_CLEANUP_SCHEDULE, () => {
    void runNotesPurgePass();
    void runVersionsPurgePass();
  });
}
```

Both passes run independently (neither depends on the other's result) — matches the "unified nightly
cleanup job, multiple passes" description in `SDS §5.3`.

## 9. Out of Scope (carried over from spec, not touched by this plan)

- Diff/comparison view, manual pinning — explicitly out of scope, no code for either.
- Swagger/OpenAPI docs for the 3 new routes — separate follow-up commit, same split as `AB-1007`
  (`6a8107d` feature / `87709ee` docs).
- All `apps/web` components (`<VersionHistoryDrawer />`, etc.) — `AB-1010`+ frontend tickets.

## 10. Testing Plan (`test-writer`, FRS-derived — not AC-line-derived)

Against isolated `notes_app_test` only, `TRUNCATE ... CASCADE` guarded by
`process.env.DATABASE_URL?.includes('notes_app_test')`:

- **Unit (Vitest)** — `note.service.ts` / `note-version.service.ts` snapshot-decision logic:
  explicit save at 30s bypasses throttle; autosave at 2min skips; autosave at exactly
  5min-1s vs. 5min+1s boundary; `isExplicitSave` omitted defaults to `false`; no-prior-version
  always snapshots.
- **Unit (Vitest)** — `note-version.repository.ts` `purgeOldVersions`: 5-version note with all 5
  past 90 days deletes 4, keeps 1; idempotent re-run deletes 0; single 200-day-old version on an
  untouched note is never deleted.
- **Contract (Supertest)** — `POST /notes` creates exactly 1 version; `PATCH /notes/:id` 3-branch
  matrix; `GET /notes/:id/versions` ordering + single-initial-version + cross-user 404 + trashed-note
  404; `GET /notes/:id/versions/:versionId` normal view + cross-note-id 404 (`VERSION_NOT_FOUND`) +
  purged-version 404; `POST /notes/:id/versions/:versionId/restore` normal restore (history intact,
  new top row) + throttle-bypass + trashed-note rejection (`NOTE_NOT_FOUND`) + cross-note/cross-user
  rejection.
- Target ≥80% coverage on all new/modified files per Definition of Done.

## 11. Definition of Done — Quality Gates (CLAUDE.md §6)

Run in order after implementation, all four must be clean before `/tasks` closes:

1. `pnpm turbo run build` → 0 errors (`tsup` bundles `apps/api` + `packages/shared`).
2. `pnpm turbo run lint` → `--max-warnings 0`.
3. `pnpm turbo run typecheck` → 0 static errors (`tsc --noEmit` only).
4. `pnpm turbo run test -- --coverage` → all green against `notes_app_test`, ≥80% coverage on new code.

Pre-commit (Husky): `npx commitlint --from HEAD~1` must pass. Commit format:
`feat(notes): implement version history snapshot, list, view, and restore AB#1009`.
