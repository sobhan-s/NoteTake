@AGENTS.md

# CLAUDE.md — Claude Code Operating Rules

Behavioral rules for Claude Code only. Architecture, stack, schema, and layering
live in `AGENTS.md` (loaded above) — never restate them here.

## 1. MCP Priority: `code-review-graph` (crg)

Before reaching for `Grep`, `Glob`, or `Read` to explore code or assess change
impact, ALWAYS try `crg` MCP tools first: `detect_changes`, `get_impact_radius`,
`query_graph` (~82x–528x token savings vs. raw file reads). Fall back to raw
reads only when the semantic graph doesn't cover the specific query.

## 1a. Live Third-Party API Verification: `context7` (`FRS-0.3.1`)

Before writing code against any third-party library API (Prisma, Express 5, TipTap, TanStack Query, React 19, or any other dependency in `AGENTS.md §3`), consult the `context7` MCP server for the library's current API shape rather than relying solely on training data. Training data goes stale; a library's actual published API is the source of truth. Fall back to `npm view <package> version`/`WebFetch` against official docs only if `context7` doesn't cover the specific library.

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

- Commit header: exact format is in `AGENTS.md` §6 (`type(scope): description
AB#ticket`; types `feat|fix|chore|docs|refactor|test`).
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

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
| --------------------------- | ------------------------------------------------------ |
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
