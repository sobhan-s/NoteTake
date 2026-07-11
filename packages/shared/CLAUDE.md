# CLAUDE.md — packages/shared (`@shared/core` Domain Blueprint)

Authoritative rules for `packages/shared` (`@shared/core`). Root `AGENTS.md`/`CLAUDE.md` govern monorepo-wide standards (`crg`, git gates, `/tasks` DoD, commit format) and are never restated here.

## Single Source of Truth Architecture (`Rule 11`, `FRS-8.5`)

```
         ┌──────────────────────────────────────────────────┐
         │             packages/shared (@shared/core)       │
         │  src/schemas/  •  src/types/  •  src/constants/  │
         └─────────────────────────┬────────────────────────┘
                                   │ (Universal Zod & DTO Import)
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
         apps/api (Backend)                  apps/web (Frontend)
   Controllers • Services • Repos        TanStack Query • API Client
```

- **Zero Duplication Contract**: Neither `apps/api` nor `apps/web` may ever define a local Zod schema for an API request/response, hand-write an API DTO interface, hardcode an API route path (`/api/v1/...`), or invent a validation error string.
- **Runtime Independence**: Must depend strictly on `zod` and pure TypeScript. **NEVER** import server frameworks (`express`, `prisma`, `bcrypt`) or client libraries (`react`, `axios`, `zustand`, `@tanstack/react-query`).

## Symmetric Schema-to-Type Inference (`z.infer`)

```ts
// Schema Definition (src/schemas/notes.schema.ts)
export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(255),
});

// Inferred DTO Export (src/types/notes.dto.ts)
export type CreateNoteDto = z.infer<typeof createNoteSchema>;
```

- **Rule**: **NEVER** write duplicate `interface CreateNoteDto { ... }` manually. Manual interfaces drift out of sync with runtime Zod schemas. Enforce bounds (`min`, `max`, `trim`) directly in Zod; never use `z.any()`/`z.unknown()` shortcuts.

## Three-Tier Constant Governance (`Rule 11`)

| Constant Category     | Canonical Location             | Examples / Enforced Limits                       |
| :-------------------- | :----------------------------- | :----------------------------------------------- |
| **`API_PATHS`**       | `src/constants/api-paths.ts`   | `/api/v1/auth`, `/api/v1/notes`, `/api/v1/tags`  |
| **`APP_LIMITS`**      | `src/constants/app-limits.ts`  | `15m` access, `7d` refresh, `30d` trash Stage 1  |
| **`API_ERROR_CODES`** | `src/constants/error-codes.ts` | `UNAUTHORIZED`, `NOTE_NOT_FOUND`, `NOTE_TRASHED` |
| **`UI_COPY`**         | `src/constants/ui-copy.ts`     | `CONFIRM_TRASH_RESTORE`, `CONFIRM_LOGOUT`        |

- **Rule**: Never hardcode route paths, numeric limits, or confirmation copy anywhere in `apps/api` or `apps/web`. Reference `API_PATHS.X` or `APP_LIMITS.X`.

## Universal Bundling & Barrel Integrity

- **`tsup` (`^build`)**: Bundles `packages/shared` to clean ESM (`.mjs`) and CommonJS (`.cjs`) outputs plus `.d.ts` type definitions, executing natively inside both browser bundles and Node backend runtimes.
- **Barrels (`index.ts`)**: Every directory (`schemas`, `types`, `constants`) MUST maintain a clean `index.ts` re-exporting all files (`export * from './file'`).
