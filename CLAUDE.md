@AGENTS.md

# CLAUDE.md — Claude Code Operating Rules

Behavioral rules for Claude Code only. Architecture, stack, schema, and layering
live in `AGENTS.md` (loaded above) — never restate them here.

## 1. Tool Priority

### 1a. Code exploration & review: `code-review-graph` (crg)

Before reaching for `Grep`, `Glob`, or `Read` to explore code or assess change
impact, ALWAYS try `crg` MCP tools first (~82x–528x token savings vs. raw file
reads). Fall back to raw reads only when the semantic graph doesn't cover the
specific query.

| Task                            | Tool                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| Explore code / find symbols     | `semantic_search_nodes`, `query_graph`                             |
| Assess blast radius of a change | `get_impact_radius`, `get_affected_flows`                          |
| Review a diff                   | `detect_changes` + `get_review_context`                            |
| Trace relationships             | `query_graph` (`callers_of`/`callees_of`/`imports_of`/`tests_for`) |
| Architecture overview           | `get_architecture_overview`, `list_communities`                    |
| Plan renames / find dead code   | `refactor_tool`                                                    |

The graph auto-updates on file changes via hooks — no manual refresh needed.

### 1b. Live third-party API verification: `context7` (`FRS-0.3.1`)

Before writing code against any third-party library API (Prisma, Express 5,
TipTap, TanStack Query, React 19, or any other dependency listed in
`AGENTS.md §3`), consult `context7` for the library's current API shape rather
than relying on training data — a library's published API is the source of
truth, and training data goes stale. Fall back to `npm view <package> version`
or `WebFetch` against official docs only if `context7` doesn't cover the
library.

## 2. Permission Gates

Ask `[y/n]` before **every single**:

- Git operation: `add`, `commit`, `push`, `checkout`, `branch`, `merge`, `rebase`.
- DB migration: `pnpm --filter @apps/api prisma migrate dev`.
- Delete or overwrite of an existing file.

Proceed automatically, no prompt, for local read-only verification:
`pnpm turbo run build`, `pnpm turbo run test`, `pnpm turbo run lint`,
`pnpm turbo run typecheck`.

## 3. Context Management (Rule 15)

- Run `/clear` after finishing each self-contained task or ticket checkpoint.
- At ~60k tokens (~70% of context window): save progress, modified-file list,
  and pending checklist items to `session-context.md` → prompt the user to run
  `/clear` → resume from `session-context.md`. Never let context hit the hard
  limit.

## 4. Thinking Depth

| Task class                                   | Depth                          |
| -------------------------------------------- | ------------------------------ |
| Bug fix / one-off syntax tweak               | default                        |
| Multi-file feature / Zod schema update       | `"think hard before starting"` |
| Architecture / concurrency / DB transactions | `"ultrathink"`                 |

## 5. Commit & Branch Naming (Rule 14)

- Commit header: exact format is in `AGENTS.md` §6
  (`type(scope): description AB#ticket`; types
  `feat|fix|chore|docs|refactor|test`).
- Branch: `feature/{domain}/AB-{ticket}-{short-name}` or
  `fix/{domain}/AB-{ticket}-{short-name}`.

## 6. Quality Gates — Definition of Done (Rule 12)

After every `/tasks` checkpoint, all four must pass before moving on:

1. `pnpm turbo run build` → 0 errors.
2. `pnpm turbo run lint` → `--max-warnings 0`.
3. `pnpm turbo run typecheck` → 0 static type errors.
4. `pnpm turbo run test -- --coverage` → all green against isolated
   `notes_app_test`, ≥80% coverage on new code.

Before every commit (Husky `pre-commit` / `commit-msg`):

- `npx commitlint --from HEAD~1` must pass cleanly.
- NEVER commit, or run `/pr`, if any test fails, lint has warnings, or
  typecheck reports errors.
