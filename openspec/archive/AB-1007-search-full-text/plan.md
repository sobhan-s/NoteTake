# Implementation Plan — AB-1007: Full-Text Search with Highlight & Pagination

Source spec: `openspec/changes/AB-1007-search-full-text/specs/search/spec.md`
Scope: **BACKEND** (`AB-1002..AB-1009`). No frontend (AB-1013), no migration
(`search_vector`/`GIN`/trigger already exist since `AB-1001`).

---

## 1. Layered File Map (routers → controllers → services → repositories → shared)

| Layer            | File                                                            | Change                                                                      |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| shared/constants | `packages/shared/src/constants/api-paths.constant.ts`           | add `API_PATHS.SEARCH.ROOT`                                                 |
| shared/constants | `packages/shared/src/constants/validation-messages.constant.ts` | add `SEARCH_QUERY_REQUIRED`                                                 |
| shared/schemas   | `packages/shared/src/schemas/search.schema.ts` **(new)**        | `searchNotesSchema`                                                         |
| shared/schemas   | `packages/shared/src/schemas/index.ts`                          | add `export * from "./search.schema"`                                       |
| shared/types     | `packages/shared/src/types/search.type.ts` **(new)**            | `SearchNotesQuery`, `SearchResultResponseDto`, `PaginatedSearchResponseDto` |
| shared/types     | `packages/shared/src/types/index.ts`                            | add `export * from "./search.type"`                                         |
| repository       | `apps/api/src/repositories/note.repository.ts`                  | add `searchNotesForUser`, `countSearchNotesForUser` (raw SQL)               |
| service          | `apps/api/src/services/search.service.ts` **(new)**             | `searchNotes`                                                               |
| controller       | `apps/api/src/controllers/search.controller.ts` **(new)**       | `search`                                                                    |
| router           | `apps/api/src/routers/search.router.ts` **(new)**               | `GET /` behind `requireAuth`                                                |
| router           | `apps/api/src/routers/index.ts`                                 | mount `search.router.ts` at `API_PATHS.BASE + API_PATHS.SEARCH.ROOT`        |

No repository file split — search SQL lives in the existing `note.repository.ts` per spec's Executive
Summary and `SDS §4.3`'s literal `NoteRepository.searchNotes` naming.

---

## 2. Shared Package (`packages/shared`)

### `api-paths.constant.ts`

```ts
SEARCH: {
  ROOT: "/search",
},
```

### `validation-messages.constant.ts`

```ts
SEARCH_QUERY_REQUIRED: "Search query is required",
```

`page`/`limit`/`tagIds`/`tagMode` reuse `NOTE_PAGE_INVALID`, `NOTE_LIMIT_INVALID`,
`NOTE_TAG_IDS_INVALID`, `NOTE_TAG_MODE_INVALID` verbatim — no new copy.

### `search.schema.ts` (new) — exactly as finalized in spec.md's "Shared Search Contracts" (already

reviewed and approved verbatim):

```ts
import { z } from "zod";
import { APP_LIMITS } from "../constants/app-limits.constant";
import { VALIDATION_MESSAGES } from "../constants/validation-messages.constant";

export const searchNotesSchema = z.object({
  q: z.string().trim().min(1, VALIDATION_MESSAGES.SEARCH_QUERY_REQUIRED),
  page: z.coerce
    .number()
    .int()
    .min(1, VALIDATION_MESSAGES.NOTE_PAGE_INVALID)
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
    .max(APP_LIMITS.PAGE_SIZE_MAX, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
    .default(APP_LIMITS.PAGE_SIZE_DEFAULT),
  tagIds: z
    .string()
    .optional()
    .refine(
      (val) =>
        val === undefined ||
        val.split(",").every((id) => z.string().uuid().safeParse(id).success),
      { message: VALIDATION_MESSAGES.NOTE_TAG_IDS_INVALID },
    ),
  tagMode: z
    .enum(["ALL", "ANY"], {
      errorMap: () => ({ message: VALIDATION_MESSAGES.NOTE_TAG_MODE_INVALID }),
    })
    .default("ALL"),
});
```

`.trim()` runs before `.min(1, ...)`, so a whitespace-only `q` (e.g. `"   "`) trims to `""` and fails
the same way an empty string does — satisfies the spec's "Whitespace-only query is rejected" scenario
with no separate check needed.

### `search.type.ts` (new)

```ts
import type { z } from "zod";
import type { searchNotesSchema } from "../schemas/search.schema";

export type SearchNotesQuery = z.infer<typeof searchNotesSchema>;

export type SearchResultResponseDto = {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
};

export type PaginatedSearchResponseDto = {
  results: SearchResultResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
```

### Barrels

`schemas/index.ts` and `types/index.ts` each gain one `export *` line for the new files — same pattern
`note.schema.ts`/`note.type.ts` already follow.

---

## 3. Repository Layer (`note.repository.ts`)

Two new raw-SQL functions appended to the existing file. Table/column names confirmed from
`schema.prisma`: `notes` (`user_id`, `deleted_at`, `search_vector`, `body`, `title`, `updated_at`),
`note_tags` (`note_id`, `tag_id`).

**Tag-filter fragment** — mirrors `buildTagFilter`'s ALL/ANY semantics but as a raw-SQL fragment
parameterized by a single `uuid[]` array (never string-interpolated tag values), with the placeholder
index passed in since the search query and count query have different preceding param counts:

```ts
function buildSearchTagFilterSql(
  tagIds: string[] | undefined,
  tagMode: "ALL" | "ANY",
  placeholderIndex: number,
): string {
  if (!tagIds || tagIds.length === 0) return "";
  return tagMode === "ALL"
    ? `AND NOT EXISTS (
         SELECT 1 FROM unnest($${placeholderIndex}::uuid[]) AS required(tag_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = required.tag_id
         )
       )`
    : `AND EXISTS (
         SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ANY($${placeholderIndex}::uuid[])
       )`;
}
```

- `ALL`: a note qualifies only if there's no required tag that it's missing (`NOT EXISTS ... WHERE NOT
EXISTS ...`) — same "must have every listed tag" semantics as `buildTagFilter`'s `AND` array, expressed
  set-wise instead of one `EXISTS` per tag (raw SQL can't easily splice a variable number of extra
  positional params without building the array param itself, so the array form is the direct
  equivalent).
- `ANY`: single `EXISTS ... tag_id = ANY($n)` — same "at least one listed tag" semantics as
  `buildTagFilter`'s single `in` filter.
- `placeholderIndex` is always a small integer literal we control (5 for the search query, 3 for the
  count query) — never derived from request input — so this is not string-interpolation of untrusted
  data; `q` and `tagIds` values themselves always travel as separate positional arguments to
  `$queryRawUnsafe`.

```ts
type Db = Pick<Prisma.TransactionClient, "note">;
type RawDb = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

type SearchRow = {
  id: string;
  title: string;
  updated_at: Date;
  snippet: string;
};

type SearchNotesParams = {
  userId: string;
  query: string;
  page: number;
  limit: number;
  tagIds?: string[];
  tagMode: "ALL" | "ANY";
};

export function searchNotesForUser(
  params: SearchNotesParams,
  db: RawDb = prisma,
): Promise<SearchRow[]> {
  const { userId, query, page, limit, tagIds, tagMode } = params;
  const offset = (page - 1) * limit;
  const tagClause = buildSearchTagFilterSql(tagIds, tagMode, 5);
  const args: unknown[] = [userId, query, limit, offset];
  if (tagIds && tagIds.length > 0) args.push(tagIds);
  return db.$queryRawUnsafe<SearchRow[]>(
    `SELECT n.id, n.title, n.updated_at,
            ts_headline('english', n.body, plainto_tsquery('english', $2),
                        'StartSel=[[[MARK]]], StopSel=[[[MARK_END]]], MaxWords=35, MinWords=15') AS snippet
     FROM notes n
     WHERE n.user_id = $1 AND n.deleted_at IS NULL
       AND n.search_vector @@ plainto_tsquery('english', $2)
       ${tagClause}
     ORDER BY ts_rank(n.search_vector, plainto_tsquery('english', $2)) DESC, n.updated_at DESC
     LIMIT $3 OFFSET $4`,
    ...args,
  );
}

export async function countSearchNotesForUser(
  params: Omit<SearchNotesParams, "page" | "limit">,
  db: RawDb = prisma,
): Promise<number> {
  const { userId, query, tagIds, tagMode } = params;
  const tagClause = buildSearchTagFilterSql(tagIds, tagMode, 3);
  const args: unknown[] = [userId, query];
  if (tagIds && tagIds.length > 0) args.push(tagIds);
  const rows = await db.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count
     FROM notes n
     WHERE n.user_id = $1 AND n.deleted_at IS NULL
       AND n.search_vector @@ plainto_tsquery('english', $2)
       ${tagClause}`,
    ...args,
  );
  return rows[0]?.count ?? 0;
}
```

- `n.deleted_at IS NULL` excludes Stage 1 **and** Stage 2 trashed notes identically to
  `listActiveNotesForUser` (`FRS-2.2.3, FRS-4.4`) — no separate Stage-1/Stage-2 branching needed since
  search never exposes trashed notes at all (unlike `/trash`, which has its own endpoint).
- `n.user_id = $1` is the only scoping predicate — no override param exists (`FRS-4.4, FRS-8.1`).
- `ORDER BY ts_rank(...) DESC, n.updated_at DESC` gives the stable tiebreak the spec requires.
- `q`/`tagIds` values are always passed as positional `$queryRawUnsafe` arguments, never concatenated
  into the SQL string — satisfies `apps/api/CLAUDE.md`'s XSS/injection-safety mandate and the spec's
  "Special-character query is handled safely" scenario. `plainto_tsquery` itself treats `q` as a plain
  phrase (no operator parsing), so metacharacters like `' OR 1=1 --` or `foo & bar` are matched
  literally, never executed as SQL or `tsquery` syntax.

---

## 4. Service Layer (`search.service.ts`, new)

```ts
import type {
  PaginatedSearchResponseDto,
  SearchNotesQuery,
} from "@shared/core/types";
import * as noteRepository from "../repositories/note.repository.js";

function toPagination(
  page: number,
  limit: number,
  total: number,
): PaginatedSearchResponseDto["pagination"] {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

export async function searchNotes(
  userId: string,
  query: SearchNotesQuery,
): Promise<PaginatedSearchResponseDto> {
  const tagIds = query.tagIds ? query.tagIds.split(",") : undefined;
  const baseParams = { userId, query: query.q, tagIds, tagMode: query.tagMode };
  const [rows, total] = await Promise.all([
    noteRepository.searchNotesForUser({
      ...baseParams,
      page: query.page,
      limit: query.limit,
    }),
    noteRepository.countSearchNotesForUser(baseParams),
  ]);
  return {
    results: rows.map((row) => ({
      id: row.id,
      title: row.title,
      snippet: row.snippet,
      updatedAt: row.updated_at.toISOString(),
    })),
    pagination: toPagination(query.page, query.limit, total),
  };
}
```

`toPagination` is a small private helper local to this file, identical in shape to `note.service.ts`'s
private `toPagination` — services never import from one another, so this mirrors the existing codebase
style (no shared `utils/` module exists for this one-liner) rather than introducing a new
cross-service dependency.

---

## 5. Controller Layer (`search.controller.ts`, new)

```ts
import type { Request, Response } from "express";
import { searchNotesSchema } from "@shared/core/schemas";
import * as searchService from "../services/search.service.js";

export async function search(req: Request, res: Response): Promise<void> {
  const query = searchNotesSchema.parse(req.query);
  const data = await searchService.searchNotes(req.user!.userId, query);
  res.status(200).json({ success: true, data });
}
```

Zero SQL, zero Zod definitions in the controller — imports the schema, calls exactly one service
method, wraps the response — identical pattern to `note.controller.ts`'s `list`.

---

## 6. Router Layer (`search.router.ts`, new + `routers/index.ts`)

```ts
// search.router.ts
import { Router, type Router as RouterType } from "express";
import * as searchController from "../controllers/search.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";

const router: RouterType = Router();

router.use(requireAuth);
router.get("/", searchController.search);

export default router;
```

```ts
// routers/index.ts — add
import searchRouter from "./search.router.js";
router.use(API_PATHS.BASE + API_PATHS.SEARCH.ROOT, searchRouter);
```

Final route: `GET /api/v1/search`, behind the same `requireAuth` guard as `notes`/`tags`.

---

## 7. Cross-Cutting Compliance Checklist

- **SSOT (Rule 11 / FRS-8.5)**: `PAGE_SIZE_DEFAULT`/`PAGE_SIZE_MAX` reused unchanged; only one new
  constant (`API_PATHS.SEARCH.ROOT`) and one new message (`SEARCH_QUERY_REQUIRED`) added. Zero literals
  in `apps/api`.
- **Layering**: controller only `schema.parse` + one service call + response wrap; service holds zero
  HTTP context and zero raw SQL text (delegates to repository); repository holds zero business logic
  (tag-CSV splitting stays in the service, matching `listNotes`'s existing precedent).
- **Response wrapper**: `GET /api/v1/search` returns `{ success: true, data: PaginatedSearchResponseDto }`
  on success; validation failures fall through to the existing global `ZodError` handler in
  `error.middleware.ts` → `{ success: false, error: { code: "VALIDATION_ERROR", message: "Validation
failed", details: err.issues } }` — no new error-handling code needed.
- **Auth/token handling**: unaffected — route sits behind its own `router.use(requireAuth)`;
  `req.user!.userId` scopes every query. No token storage/rotation logic touched.
- **Soft delete (FRS-2.2)**: `deleted_at IS NULL` excludes Stage 1 and Stage 2 notes from every search
  result and from the `total`/`totalPages` count. No mutation at all (pure read endpoint).
- **XSS-safe highlighting (`apps/api/CLAUDE.md`)**: `ts_headline` sentinels
  (`[[[MARK]]]`/`[[[MARK_END]]]`) only, no HTML tags ever returned from SQL.
- **DB/test isolation (FRS-0.3.3)**: no schema/migration change (`search_vector`/`GIN`/trigger exist
  since `AB-1001`) — `prisma migrate dev` is **not** required for this ticket. New tests run against
  `notes_app_test` per existing suite convention; no new `TRUNCATE` usage introduced.

---

## 8. Test Plan (for `/tasks` → `test-writer`)

Derived from `FRS-4.1–4.5`, `FRS-4.2.1`, `FRS-2.3.5` requirement text (not AC bullets), per project
convention. Suggested files (mirroring the existing `notes.*` contract-test naming):

- `apps/api/tests/contract/search.test.ts` (new): full 400/200 matrix from spec's Error Scenarios
  table — missing/empty/whitespace `q`, special-character `q` (SQL metacharacters, `tsquery` operator
  syntax) returning `200 OK` with safe literal-phrase matching, `page`/`limit` boundary values
  (`0`, `101`, valid `2`/`100`), invalid `tagMode`, malformed `tagIds` UUID, foreign/nonexistent
  `tagIds` narrowing to zero results (not an error), zero-match `200 OK` with empty array.
- Same file, additional cases: cross-user note exclusion (search as user B never surfaces user A's
  matching notes), Stage 1 and Stage 2 trashed-note exclusion (insert notes with `deletedAt` inside and
  beyond the 30-day cutoff, confirm both excluded), multi-word AND-semantics (`"meeting notes"` only
  matches notes containing both words), snippet sentinel presence with no HTML tags, `tagIds`/`tagMode`
  combined with `q` (`ALL` requires every tag, `ANY` requires at least one).
- `apps/api/tests/unit/note.repository.test.ts` (extend, or new
  `apps/api/tests/unit/search.repository.test.ts`): `buildSearchTagFilterSql` ALL vs ANY SQL-fragment
  shape, positional-parameter array assembly (confirms `tagIds` array only appended when present, and at
  the correct placeholder index for both the search and count queries).
- `apps/api/tests/unit/search.service.test.ts` (new): pagination math (`totalPages` rounding, `total=0`
  edge), `tagIds` CSV-to-array parsing, row-to-DTO mapping (`updated_at` → `updatedAt` ISO string).
- Tied-relevance stability (`ts_rank` ties ordered by `updated_at DESC`) verified via direct DB-state
  setup (two notes engineered to produce equal rank), not inferable from API responses alone without
  seeding identical term frequency/density.

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

No fuzzy/OR search, no cross-user search, no exposed `ts_rank`, no frontend search UI (`AB-1013`), no
sort/order override on search results, no changes to `GET /api/v1/notes`/`GET /api/v1/notes/trash`
(`AB-1005`), no tag CRUD (`AB-1006`), no new migration.
