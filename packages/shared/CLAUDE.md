# CLAUDE.md — packages/shared

Domain rules for `@shared/core`, the single source of truth (`Rule 11`, `FRS-8.5`).

## Scope

Pure TypeScript + Zod only. Zero runtime dependencies beyond `zod`. Zero framework code (no Express, no React) — this package must be importable by both `apps/api` and `apps/web` without pulling in either's runtime.

## Conventions

- Every exported Zod schema in `src/schemas/` must have a corresponding inferred type in `src/types/` via `z.infer<typeof schema>` — never a hand-written duplicate interface.
- Every new file added under `schemas/`, `types/`, or `constants/` must be re-exported from that directory's `index.ts` barrel — barrels must never drift out of sync with their directory contents.
- Numeric/string constants mandated by `docs/FRS.md` belong in `src/constants/` (`API_PATHS`, `APP_LIMITS`, `VALIDATION_MESSAGES`, `API_ERROR_CODES`, `UI_COPY`) — never redefined or hardcoded in `apps/api` or `apps/web`.
