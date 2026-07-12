# Implementation Plan — AB-1008: Sharing — Generate Link, Revoke, Public Access, Atomic View Count

Source spec: `openspec/changes/AB-1008-sharing-links/spec.md`
Scope: **BACKEND** (`AB-1002..AB-1009`). No frontend (`AB-1014`), no migration
(`ShareLink` model/indexes already exist since `AB-1001`'s `20260710124549_init`).

---

## 1. Layered File Map (routers → controllers → services → repositories → shared)

| Layer            | File                                                            | Change                                                                                           |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| shared/constants | `packages/shared/src/constants/app-limits.constant.ts`          | add `SHARE_LINK_DEFAULT_EXPIRY_DAYS`, `SHARE_LINK_MIN_EXPIRY_DAYS`, `SHARE_LINK_MAX_EXPIRY_DAYS` |
| shared/constants | `packages/shared/src/constants/api-paths.constant.ts`           | `NOTES.SHARE: "/share"`; new `PUBLIC: { ROOT: "/public", SHARE: "/share" }`                      |
| shared/constants | `packages/shared/src/constants/api-error-codes.constant.ts`     | add `SHARE_LINK_NOT_FOUND`, `SHARE_LINK_UNAVAILABLE`                                             |
| shared/constants | `packages/shared/src/constants/validation-messages.constant.ts` | add `SHARE_EXPIRY_DAYS_INVALID`                                                                  |
| shared/schemas   | `packages/shared/src/schemas/share.schema.ts` **(new)**         | `createShareLinkSchema`                                                                          |
| shared/schemas   | `packages/shared/src/schemas/index.ts`                          | add `export * from "./share.schema"`                                                             |
| shared/types     | `packages/shared/src/types/share.type.ts` **(new)**             | `CreateShareLinkInput`, `ShareLinkResponseDto`, `PublicNoteResponseDto`                          |
| shared/types     | `packages/shared/src/types/index.ts`                            | add `export * from "./share.type"`                                                               |
| shared/types     | `packages/shared/src/types/note.type.ts`                        | `NoteResponseDto` gains `hasActiveShareLink: boolean`                                            |
| repository       | `apps/api/src/repositories/share.repository.ts` **(new)**       | active-link lookup/create/revoke + atomic public view-increment raw SQL                          |
| repository       | `apps/api/src/repositories/note.repository.ts`                  | every Note-returning query gains a filtered `shareLinks` include                                 |
| service          | `apps/api/src/services/share.service.ts` **(new)**              | `getOrCreateShareLink`, `getActiveShareLink`, `revokeShareLink`, `getPublicNoteByToken`          |
| service          | `apps/api/src/services/note.service.ts`                         | `toNoteResponseDto` maps `hasActiveShareLink`; `softDeleteNote` gains a `$transaction`           |
| controller       | `apps/api/src/controllers/share.controller.ts` **(new)**        | `create`, `getActive`, `revoke` (owner-facing, authenticated)                                    |
| controller       | `apps/api/src/controllers/public-share.controller.ts` **(new)** | `getByToken` (public, unauthenticated)                                                           |
| router           | `apps/api/src/routers/share.router.ts` **(new)**                | `POST/GET/DELETE /` (mounted under notes as `/:id/share`, `mergeParams: true`)                   |
| router           | `apps/api/src/routers/public-share.router.ts` **(new)**         | `GET /share/:token`, no `requireAuth`                                                            |
| router           | `apps/api/src/routers/note.router.ts`                           | mount `share.router.ts` at `` `/:id${API_PATHS.NOTES.SHARE}` ``                                  |
| router           | `apps/api/src/routers/index.ts`                                 | mount `public-share.router.ts` at `API_PATHS.BASE + API_PATHS.PUBLIC.ROOT`                       |
| docs             | `apps/api/src/docs/openapi.ts`                                  | add sharing schemas/paths (follow-up doc-sync, mirrors `AB-1007`'s search doc commit)            |

No new migration — `ShareLink` (table `share_links`) is fully provisioned already.

---

## 2. Shared Package (`packages/shared`)

### `app-limits.constant.ts` — add

```ts
SHARE_LINK_DEFAULT_EXPIRY_DAYS: 7,
SHARE_LINK_MIN_EXPIRY_DAYS: 1,
SHARE_LINK_MAX_EXPIRY_DAYS: 30,
```

### `api-paths.constant.ts` — add

```ts
NOTES: {
  ROOT: "/notes",
  TRASH: "/trash",
  RESTORE: "/restore",
  PERMANENT: "/permanent",
  SHARE: "/share",          // new
},
PUBLIC: {                    // new group
  ROOT: "/public",
  SHARE: "/share",
},
```

Resulting mounted paths: `POST/GET/DELETE /api/v1/notes/:id/share`, `GET /api/v1/public/share/:token`.

### `api-error-codes.constant.ts` — add

```ts
SHARE_LINK_NOT_FOUND: "SHARE_LINK_NOT_FOUND",
SHARE_LINK_UNAVAILABLE: "SHARE_LINK_UNAVAILABLE",
```

### `validation-messages.constant.ts` — add

```ts
SHARE_EXPIRY_DAYS_INVALID: `Expiry must be between ${APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS} and ${APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS} days`,
```

### `share.schema.ts` (new) — exactly as finalized in `spec.md`

```ts
import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const createShareLinkSchema = z.object({
  expiresInDays: z.coerce
    .number()
    .int()
    .min(
      APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS,
      VALIDATION_MESSAGES.SHARE_EXPIRY_DAYS_INVALID,
    )
    .max(
      APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS,
      VALIDATION_MESSAGES.SHARE_EXPIRY_DAYS_INVALID,
    )
    .default(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS),
});
```

`req.body` from `express.json()` is `{}` (never `undefined`) when no body is sent, so
`createShareLinkSchema.parse(req.body)` applies the default cleanly with no `?? {}` guard needed.

### `share.type.ts` (new)

```ts
import type { z } from "zod";
import type { createShareLinkSchema } from "../schemas/share.schema";

export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

export type ShareLinkResponseDto = {
  noteId: string;
  token: string;
  expiresAt: string;
  viewCount: number;
  createdAt: string;
};

export type PublicNoteResponseDto = {
  title: string;
  body: string;
  updatedAt: string;
};
```

### `note.type.ts` — `NoteResponseDto` gains

```ts
hasActiveShareLink: boolean;
```

### Barrels

`schemas/index.ts` and `types/index.ts` each gain one `export *` line, same pattern as
`search.schema.ts`/`search.type.ts` in `AB-1007`.

---

## 3. Repository Layer

### `share.repository.ts` (new)

```ts
import type { Prisma, ShareLink } from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<Prisma.TransactionClient, "shareLink">;

function activeWhere(noteId: string): Prisma.ShareLinkWhereInput {
  return { noteId, revokedAt: null, expiresAt: { gt: new Date() } };
}

export function findActiveShareLinkForNote(
  noteId: string,
  db: Db = prisma,
): Promise<ShareLink | null> {
  return db.shareLink.findFirst({ where: activeWhere(noteId) });
}

export function createShareLink(
  data: { noteId: string; token: string; expiresAt: Date },
  db: Db = prisma,
): Promise<ShareLink> {
  return db.shareLink.create({ data });
}

export function revokeShareLinkById(
  id: string,
  db: Db = prisma,
): Promise<ShareLink> {
  return db.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export function revokeActiveShareLinksForNote(
  noteId: string,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.shareLink.updateMany({
    where: activeWhere(noteId),
    data: { revokedAt: new Date() },
  });
}

type RawDb = Pick<Prisma.TransactionClient, "$queryRaw">;

type PublicShareRow = {
  view_count: number;
  expires_at: Date;
  note_id: string;
  title: string;
  body: string;
  updated_at: Date;
};

export async function consumePublicShareView(
  token: string,
  db: RawDb = prisma,
): Promise<PublicShareRow | null> {
  const rows = await db.$queryRaw<PublicShareRow[]>`
    UPDATE share_links sl
    SET view_count = view_count + 1
    FROM notes n
    WHERE sl.token = ${token}
      AND sl.note_id = n.id
      AND sl.revoked_at IS NULL
      AND sl.expires_at > NOW()
      AND n.deleted_at IS NULL
    RETURNING sl.view_count AS view_count, sl.expires_at AS expires_at,
              n.id AS note_id, n.title, n.body, n.updated_at AS updated_at
  `;
  return rows[0] ?? null;
}
```

- `$queryRaw` tagged-template (not `$queryRawUnsafe`) — the query has exactly one variable (`token`)
  and no dynamic clause construction, so Prisma's automatic tagged-template parameterization is the
  safer, simpler fit (`apps/api/CLAUDE.md` raw-SQL safety mandate).
- `activeWhere` is reused by both `findActiveShareLinkForNote` (owner reads) and
  `revokeActiveShareLinksForNote` (trash-time revoke) — one definition of "active" everywhere.
- Zero business logic here (no 404 throwing, no ownership checks) — purely Prisma/raw SQL per
  `apps/api/CLAUDE.md`'s repository contract; ownership/"not found" framing lives entirely in
  `share.service.ts`.

### `note.repository.ts` — amend every Note-returning query to compute `hasActiveShareLink`

Add an exported type alias and a shared include fragment:

```ts
export type NoteWithShareLinks = Note & { shareLinks: { id: string }[] };

const ACTIVE_SHARE_LINK_INCLUDE = {
  shareLinks: {
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.NoteInclude;
```

Apply `include: ACTIVE_SHARE_LINK_INCLUDE` (and update the return type to
`Promise<NoteWithShareLinks>` / `Promise<NoteWithShareLinks[]>`) on: `findActiveNoteByIdForUser`,
`findTrashedNoteByIdForUser`, `updateNoteContent`, `softDeleteNote`, `restoreNote`,
`listActiveNotesForUser`, `listTrashedNotesForUser`.

`createNote` is **left unchanged** (still returns plain `Note`) — a brand-new note can never have a
share link yet, so `note.service.ts`'s `createNote` synthesizes `shareLinks: []` directly instead of
paying for a join that would always return empty. `permanentlyDeleteNote` and `purgeStage2Notes` are
unaffected (they don't return a `NoteResponseDto`-shaped value).

`take: 1` keeps the join cheap (existence check, not a full list) — the service layer only ever reads
`.length > 0`.

---

## 4. Service Layer

### `note.service.ts` — amendments

```ts
import type { NoteWithShareLinks } from "../repositories/note.repository.js";
import { prisma } from "../lib/prisma-client.js";
import * as shareRepository from "../repositories/share.repository.js";

function toNoteResponseDto(note: NoteWithShareLinks): NoteResponseDto {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    hasActiveShareLink: note.shareLinks.length > 0,
  };
}
```

`createNote` becomes:

```ts
export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponseDto> {
  const note = await noteRepository.createNote({
    userId,
    title: input.title,
    body: input.body,
  });
  return toNoteResponseDto({ ...note, shareLinks: [] });
}
```

`softDeleteNote` gains the transactional revoke (Resolved Decision #3):

```ts
export async function softDeleteNote(
  userId: string,
  noteId: string,
): Promise<NoteResponseDto> {
  const existing = await noteRepository.findActiveNoteByIdForUser(
    noteId,
    userId,
  );
  if (!existing) notFound();
  const deleted = await prisma.$transaction(async (tx) => {
    const note = await noteRepository.softDeleteNote(noteId, tx);
    await shareRepository.revokeActiveShareLinksForNote(noteId, tx);
    return note;
  });
  return toNoteResponseDto(deleted);
}
```

`tx` (`Prisma.TransactionClient`) satisfies both `noteRepository`'s `Pick<Prisma.TransactionClient,
"note">` and `shareRepository`'s `Pick<Prisma.TransactionClient, "shareLink">` simultaneously — no
type friction. All other functions (`getNoteById`, `updateNote`, `restoreNote`, `listNotes`,
`listTrash`) are untouched apart from `toNoteResponseDto`'s new required input shape, which the
repository layer now already provides via `ACTIVE_SHARE_LINK_INCLUDE`.

### `share.service.ts` (new)

```ts
import * as crypto from "node:crypto";
import { Prisma, type ShareLink } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import type {
  CreateShareLinkInput,
  PublicNoteResponseDto,
  ShareLinkResponseDto,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import * as noteRepository from "../repositories/note.repository.js";
import * as shareRepository from "../repositories/share.repository.js";

function noteNotFound(): never {
  throw new AppError(404, API_ERROR_CODES.NOTE_NOT_FOUND, "Note not found");
}

function shareLinkNotFound(): never {
  throw new AppError(
    404,
    API_ERROR_CODES.SHARE_LINK_NOT_FOUND,
    "Share link not found",
  );
}

function shareLinkUnavailable(): never {
  throw new AppError(
    404,
    API_ERROR_CODES.SHARE_LINK_UNAVAILABLE,
    "This shared note is no longer available",
  );
}

function toShareLinkResponseDto(link: ShareLink): ShareLinkResponseDto {
  return {
    noteId: link.noteId,
    token: link.token,
    expiresAt: link.expiresAt.toISOString(),
    viewCount: link.viewCount,
    createdAt: link.createdAt.toISOString(),
  };
}

async function assertOwnedActiveNote(
  userId: string,
  noteId: string,
): Promise<void> {
  const note = await noteRepository.findActiveNoteByIdForUser(noteId, userId);
  if (!note) noteNotFound();
}

async function createShareLinkWithRetry(
  noteId: string,
  expiresAt: Date,
  attemptsLeft = 3,
): Promise<ShareLink> {
  const token = crypto.randomBytes(32).toString("hex");
  try {
    return await shareRepository.createShareLink({ noteId, token, expiresAt });
  } catch (err) {
    const isTokenCollision =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002";
    if (isTokenCollision && attemptsLeft > 1) {
      return createShareLinkWithRetry(noteId, expiresAt, attemptsLeft - 1);
    }
    throw err;
  }
}

export async function getOrCreateShareLink(
  userId: string,
  noteId: string,
  input: CreateShareLinkInput,
): Promise<{ dto: ShareLinkResponseDto; created: boolean }> {
  await assertOwnedActiveNote(userId, noteId);
  const existing = await shareRepository.findActiveShareLinkForNote(noteId);
  if (existing)
    return { dto: toShareLinkResponseDto(existing), created: false };
  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  );
  const created = await createShareLinkWithRetry(noteId, expiresAt);
  return { dto: toShareLinkResponseDto(created), created: true };
}

export async function getActiveShareLink(
  userId: string,
  noteId: string,
): Promise<ShareLinkResponseDto> {
  await assertOwnedActiveNote(userId, noteId);
  const link = await shareRepository.findActiveShareLinkForNote(noteId);
  if (!link) shareLinkNotFound();
  return toShareLinkResponseDto(link);
}

export async function revokeShareLink(
  userId: string,
  noteId: string,
): Promise<{ noteId: string }> {
  await assertOwnedActiveNote(userId, noteId);
  const link = await shareRepository.findActiveShareLinkForNote(noteId);
  if (!link) shareLinkNotFound();
  await shareRepository.revokeShareLinkById(link.id);
  return { noteId };
}

export async function getPublicNoteByToken(
  token: string,
): Promise<PublicNoteResponseDto> {
  const row = await shareRepository.consumePublicShareView(token);
  if (!row) shareLinkUnavailable();
  return {
    title: row.title,
    body: row.body,
    updatedAt: row.updated_at.toISOString(),
  };
}
```

- `assertOwnedActiveNote` reuses `findActiveNoteByIdForUser` (already excludes trashed + cross-user
  notes, returning `404 NOTE_NOT_FOUND`) — satisfies Resolved Decisions #8 and the cross-user-rejection
  scenarios in `getOrCreateShareLink`/`getActiveShareLink`/`revokeShareLink` with zero new logic.
  `revokeShareLink` throws before calling `revokeShareLinkById` when `!link`, so `link` is narrowed
  non-null at the call site (TypeScript control-flow narrowing through the `never`-returning helper).
- `createShareLinkWithRetry` is the Decision #7 collision-retry: on a `P2002` unique-constraint hit on
  `token` (astronomically unlikely at 64 hex chars, but not impossible), regenerate and retry up to 3
  attempts before letting the error propagate to the global error handler.
- `getPublicNoteByToken` never differentiates _why_ `row` is null (expired vs. revoked vs. trashed vs.
  nonexistent) — single `shareLinkUnavailable()` path, satisfying `FRS-5.6`'s "identical no longer
  available" mandate structurally (the controller has no way to leak the distinction even by mistake).

---

## 5. Controller Layer

### `share.controller.ts` (new) — owner-facing, authenticated

```ts
import type { Request, Response } from "express";
import { createShareLinkSchema } from "@shared/core/schemas";
import * as shareService from "../services/share.service.js";

export async function create(req: Request, res: Response): Promise<void> {
  const input = createShareLinkSchema.parse(req.body);
  const { dto, created } = await shareService.getOrCreateShareLink(
    req.user!.userId,
    req.params.id as string,
    input,
  );
  res.status(created ? 201 : 200).json({ success: true, data: dto });
}

export async function getActive(req: Request, res: Response): Promise<void> {
  const data = await shareService.getActiveShareLink(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const data = await shareService.revokeShareLink(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}
```

### `public-share.controller.ts` (new) — public, unauthenticated

```ts
import type { Request, Response } from "express";
import * as shareService from "../services/share.service.js";

export async function getByToken(req: Request, res: Response): Promise<void> {
  const data = await shareService.getPublicNoteByToken(
    req.params.token as string,
  );
  res.status(200).json({ success: true, data });
}
```

Zero SQL, zero Zod definitions, zero business logic in either controller — matches
`note.controller.ts`/`tag.controller.ts` exactly.

---

## 6. Router Layer

### `share.router.ts` (new)

```ts
import { Router, type Router as RouterType } from "express";
import * as shareController from "../controllers/share.controller.js";

const router: RouterType = Router({ mergeParams: true });

router.post("/", shareController.create);
router.get("/", shareController.getActive);
router.delete("/", shareController.revoke);

export default router;
```

`mergeParams: true` is required so `req.params.id` (captured by the parent mount path) is visible
inside this sub-router. `requireAuth` is **not** re-applied here — it's inherited from
`note.router.ts`'s existing top-level `router.use(requireAuth)`, which runs before this sub-router is
reached, since `share.router.ts` is only ever mounted as a child of `note.router.ts`.

### `note.router.ts` — add

```ts
import shareRouter from "./share.router.js";
// ...
router.use(`/:id${API_PATHS.NOTES.SHARE}`, shareRouter);
```

Placed alongside the existing `restore`/`permanent` sub-route registrations. No ordering conflict
with the `/:id` `GET`/`PATCH`/`DELETE` routes — `/:id/share` carries an extra path segment Express
won't match against a bare `/:id` pattern regardless of registration order.

### `public-share.router.ts` (new)

```ts
import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as publicShareController from "../controllers/public-share.controller.js";

const router: RouterType = Router();

router.get(
  `${API_PATHS.PUBLIC.SHARE}/:token`,
  publicShareController.getByToken,
);

export default router;
```

No `requireAuth` — this is the app's only unauthenticated data-returning route (`FRS-8.6`), consistent
with `SDS.md` §7.

### `routers/index.ts` — add

```ts
import publicShareRouter from "./public-share.router.js";
// ...
router.use(API_PATHS.BASE + API_PATHS.PUBLIC.ROOT, publicShareRouter);
```

Final routes: `POST/GET/DELETE /api/v1/notes/:id/share` (authenticated), `GET
/api/v1/public/share/:token` (public).

---

## 7. Cross-Cutting Compliance Checklist

- **SSOT (Rule 11 / FRS-8.5)**: every numeric literal (`7`, `1`, `30`) lives in `APP_LIMITS`; every
  path segment in `API_PATHS`; every error code in `API_ERROR_CODES`; zero duplication in `apps/api`.
- **Layering**: controllers only `schema.parse` + one service call + response wrap; services hold zero
  HTTP context, own all ownership/"not found" logic and the one cross-repository transaction; the
  atomic view-count query is the only raw SQL, confined to `share.repository.ts`.
- **Response wrapper**: every new endpoint returns `{ success: true, data }`; validation failures fall
  through to the existing global `ZodError` handler in `error.middleware.ts`; `AppError` throws
  (`404`s) are caught by the same existing error middleware — no new error-handling code needed.
- **IDOR defense**: every owner-facing endpoint 404s (never 403s) for cross-user or trashed notes, via
  the existing `findActiveNoteByIdForUser` + `notFound()`/`noteNotFound()` pattern, reused verbatim.
- **Public route isolation**: `public-share.router.ts` is the only router with no `requireAuth`,
  mounted at a structurally separate `/api/v1/public` prefix — cannot accidentally inherit auth
  middleware from a parent mount.
- **Two-stage soft delete (FRS-2.2, FRS-2.2.4)**: `softDeleteNote`'s new transaction sets
  `ShareLink.revokedAt` alongside `Note.deletedAt` in one atomic unit; the public query's own
  `n.deleted_at IS NULL` join independently re-verifies liveness on every single access, so protection
  never depends on the explicit revoke having run first.
- **Token safety**: `crypto.randomBytes(32).toString("hex")` (Node's CSPRNG, not `Math.random()`), 64
  hex chars exactly filling `VarChar(64)`; collision-retry via `P2002` catch, not a pre-check-then-
  insert race.
- **No information leakage**: public response is `{ title, body, updatedAt }` only — verified no `id`,
  `viewCount`, owner reference, or shareable-URL construction anywhere in `share.service.ts` /
  `public-share.controller.ts`.
- **DB/test isolation (FRS-0.3.3)**: no schema/migration change — `prisma migrate dev` is **not**
  required. New tests run against `notes_app_test` per existing convention.

---

## 8. Test Plan (for `/tasks` → `test-writer`)

Derived from `FRS-5.1–5.6`, `FRS-2.2.4`, `FRS-7.2` requirement text (not AC bullets), per project
convention. Suggested files:

- `apps/api/tests/contract/share.test.ts` (new): full matrix for `POST/GET/DELETE
/api/v1/notes/:id/share` — first-time creation (`201`), default-expiry-when-omitted, out-of-range
  `expiresInDays` (`0`, `31`, negative, non-integer) rejection, re-`POST` idempotency (`200`, same
  token/expiresAt/viewCount, `expiresInDays` ignored), `GET` with/without an active link, `DELETE` with
  no active link (`404 SHARE_LINK_NOT_FOUND`), all three verbs against a trashed note and a
  cross-user note (`404 NOTE_NOT_FOUND`, never `403`).
- `apps/api/tests/contract/public-share.test.ts` (new): valid token (`200`, exact `{ title, body,
updatedAt }` shape, no other keys), repeat visits increment `view_count` by exactly N (verified via
  direct DB read, since the public response itself never exposes the counter), concurrent-request
  view-count correctness (fire N parallel requests, assert final count via DB), expired/revoked/
  trashed/nonexistent token all returning byte-identical `404` bodies (`SHARE_LINK_UNAVAILABLE`).
- `apps/api/tests/unit/share.service.test.ts` (new): `createShareLinkWithRetry`'s `P2002` retry path
  (mock repository to throw once then succeed), get-or-create branching (`created: true` vs `false`),
  `assertOwnedActiveNote` 404 framing.
- `apps/api/tests/unit/share.repository.test.ts` (new): `activeWhere` predicate shape, confirm
  `consumePublicShareView` uses `$queryRaw` tagged-template parameterization (not string
  concatenation) via a Prisma mock/spy on the query args.
- `apps/api/tests/unit/note.service.test.ts` (extend): `hasActiveShareLink: true/false` mapping for
  `getNoteById`/`updateNote`/`listNotes`/`listTrash`; `softDeleteNote`'s transaction revokes an active
  link and is a no-op when none exists; restoring a note after trash-time revoke does not resurrect the
  link (`GET .../share` still `404` post-restore — covered in the contract test file instead, since it
  spans two endpoints).
- `apps/api/tests/unit/note.repository.test.ts` (extend): `ACTIVE_SHARE_LINK_INCLUDE` correctly
  excludes expired/revoked links from the returned `shareLinks` array.

---

## 9. Quality Gate Commands (run after implementation, before `/review`)

```
pnpm turbo run build
pnpm turbo run lint -- --max-warnings 0
pnpm turbo run typecheck
pnpm turbo run test -- --coverage
```

All four must be green, ≥80% coverage on new code, before `/tasks` is marked complete or `/pr` is
invoked.

---

## 10. Out of Scope (carried from spec, unchanged)

Frontend share modal/UI (`AB-1014`), password-protected links, edit/comment permissions on shared
links, per-viewer analytics beyond total view count, any DB migration, rate-limiting the public
endpoint, multiple concurrent active links per note, a link-history/audit list, or a `:linkId` route
param.
