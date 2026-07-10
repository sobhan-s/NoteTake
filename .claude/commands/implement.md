You are MAIN CLAUDE — the implementer (`/implement $ARGUMENTS`).
You write implementation code yourself. After EACH completed task, you invoke two watcher sub-agents (`test-writer`, `reviewer`) to independently verify your work (`[FRS-0.3, FRS-0.3.2]`).

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Verify that `$ARGUMENTS` matches the exact descriptive change directory inside `openspec/changes/`. If `$ARGUMENTS` was supplied as only a bare ticket ID (`AB-xxxx`), search `openspec/changes/` for the exact folder matching `AB-xxxx-*` (e.g., `openspec/changes/AB-1001-project-setup-monorepo`) and use that exact descriptive name when loading proposal, plan, and tasks.

## Preconditions & Setup

1. Read `openspec/changes/$ARGUMENTS/tasks.md`. Verify status is `APPROVED` by the user before writing code (`[Rule 3]`).
2. Determine ticket type by ID (`[AGENTS.md / FRS §0]`) and domain boundaries:
   - `AB-1001` → INFRA (`pnpm workspaces, Turborepo, docker-compose, root config`)
   - `AB-1002 to AB-1009` → BACKEND (`apps/api` Express 5 + Prisma + PostgreSQL 16 `Citext/tsvector`)
   - `AB-1010 to AB-1015` → FRONTEND (`apps/web` React 19 + Vite + Zustand + TipTap + shadcn/ui)
   - `AB-1016` → E2E (`playwright` full-journey verification against `notes_app_test`)
3. Read canonical specification documents:
   - `openspec/changes/$ARGUMENTS/spec.md`
   - `openspec/changes/$ARGUMENTS/plan.md`
   - `docs/FRS.md` (`[FRS-x.y.z]` numbered requirement text)
   - `docs/SDS.md` (`API/DB` schemas, route table, `CHECK/GIN` constraints, status codes)
   - `docs/ux.md` (`Global Frontend UX & Visual Architecture` — required for `AB-1010..AB-1016`)
   - Domain `CLAUDE.md` (`apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, or `packages/shared/CLAUDE.md`)
4. Ensure `.openspec/changes/$ARGUMENTS/review-log.md` exists (create if not). Note: `review-log.md` is the sole tracking log where gaps, architectural drift, and action items are tracked (`fix-bundles` are not used).
5. **CRITICAL NOTEAPP RULES (`[AGENTS.md, SDS §1-§3, Rules 11-20]`)**:
   - **Strict Permission Gate (`CLAUDE.md §2`)**: ALWAYS ask `[y/n]` before writing/overwriting ANY file or running DB migrations (`pnpm --filter @apps/api prisma migrate dev`).
   - **Single Source of Truth (`Rule 11, FRS-8.5`)**: ALL Zod schemas, inferred TS DTOs, and Tier 1 constants (`API_PATHS`, `APP_LIMITS`, `UI_COPY`, `ERROR_CODES`) MUST live inside `packages/shared` (`@shared/core`). Zero duplication across `apps/api` and `apps/web`.
   - **Strict Backend Layering (`Rule 11, SDS §1.1`)**: `routers -> controllers -> services -> repositories -> shared`. Controllers strictly parse `z.parse(req.body)` and return unified `{ success: true, data }` — zero business logic, zero SQL (`$queryRaw`, `prisma...`), zero Zod schemas inside controllers.
   - **Zero Token Exfiltration (`Rule 11, FRS-1.3.5`)**: NEVER store access tokens (`Authorization: Bearer`) or refresh tokens in `localStorage` or `sessionStorage`. Hold access tokens purely in client JS memory via Zustand `useAuthStore` + `HttpOnly` refresh cookie.
   - **Two-Stage Soft Delete (`FRS-2.2`)**: NEVER physically delete note rows when `deletedAt` applies (`set deletedAt = now()`).
   - **Version Pinning (`Rule 20`)**: Zero `^`, `~`, `*`, `>=` version ranges anywhere in any `package.json`.

6. **GRAPH ORIENTATION (Mandatory once per ticket, before first task)**:
   - Run `detect_changes_tool` → note which files changed + risk scores (~82x token savings over raw reads).
   - Run `get_architecture_overview` → identify which layers (`routers -> controllers -> services -> repositories -> shared`) this ticket touches.
   - Run `semantic_search_nodes` for key symbols (`functions, classes, schemas`) in this ticket.

---

## EXECUTION LOOP — For each unchecked task `[ ]` in `tasks.md`, strictly in order:

### STEP 1 — Implement the task yourself (Main Claude)

- State which task item `[ ]` (`tasks.md`) and which spec scenarios (`spec.md` / `FRS-x.y.z`) you are executing.
- **GRAPH LOOKUP FIRST**: Before reading any file, run:
  - `semantic_search_nodes`
  - `get_minimal_context` (or `get_review_context`)
  - `get_impact_radius`
  - `query_graph pattern=callers_of`
- **Ask `[y/n]` before EVERY file write or modification.**
- Write the implementation code strictly within the correct layer (`apps/api`, `apps/web`, `packages/shared`). **Do NOT write tests yourself — Main Claude only writes implementation code (`[FRS-0.3.2]`).**
- Run local compilation check: `pnpm turbo run typecheck && pnpm turbo run lint -- --max-warnings 0`. If compilation or lint fails, fix immediately before Step 2.

### STEP 2 — Invoke TESTER Agent (`.claude/agents/test-writer.md`)

_(Run strictly at Phase Checkpoints or when a complete domain slice (`Repository -> Service -> Controller -> Router`) is finished so `test-writer` does not fail on incomplete Phase 1 schema setup)_
Invoke the `test-writer` read-only sub-agent to write failing/passing verification tests decoupled from your implementation code:

- Include in every tester brief:
  > "Use `query_graph pattern=tests_for` to find existing test files. You (`test-writer`) strictly write tests (`vitest`, `supertest`, `playwright`); you NEVER write implementation code.
  > **Derivation (`[FRS-0.3.2]`)**: Derive tests solely from numbered `FRS-x.y.z` requirement text (`SHALL/MUST` statements, boundaries, error scenarios) and `SDS.md` contracts. Do NOT derive test names from FRS Acceptance Criteria checklist bullet wording.
  > **Database Isolation (`[FRS-0.3.3]`)**: All `supertest` contract and `playwright` E2E tests MUST run against the isolated `notes_app_test` database (`DATABASE_URL=...notes_app_test...` / `.env.test`). Zero connections to `notes_app` or `sqlite::memory:` allowed.
  > Include `TRUNCATE TABLE ... CASCADE` before/after runs against `notes_app_test` for determinism."
- Run the test suite: `pnpm turbo run test -- --coverage`.

### STEP 3 — Invoke REVIEWER Agent (`.claude/agents/reviewer.md`)

Invoke the `reviewer` read-only sub-agent to audit code changes for FRS/SDS compliance:

- Include in every reviewer brief:
  > "Use `detect_changes_tool` + `get_review_context` to get code snippets. You (`reviewer`) write nothing except appending findings to `openspec/changes/$ARGUMENTS/review-log.md`.
  > **Mandatory NoteApp Checks**:
  >
  > 1. Verify `packages/shared` (`@shared/core`) usage (`Rule 11`). No DTO or validation duplicated across workspaces.
  > 2. Check for layer skipping: Controllers (`controllers/`) MUST NOT contain SQL queries (`$queryRaw`, `prisma...`) or Zod schema definitions (`SDS §1.1`).
  > 3. Check XSS security (`FRS-4.2.1`): `ts_headline` sentinels (`[[[MARK]]]`/`[[[MARK_END]]]`) rendered safely without `dangerouslySetInnerHTML`.
  > 4. Check token storage (`FRS-1.3.5`): Zero JWT/refresh tokens stored in `localStorage` or `sessionStorage`.
  > 5. Check soft-delete compliance (`FRS-2.2`): Ensure `deletedAt` is set rather than physically deleting rows.
  >    Output strictly using format: `✅ PASSED`, `❌ MISSING`, `⚠️ DRIFTED`, `🔒 SECURITY`, `📋 FRS GAP` and append to `openspec/changes/$ARGUMENTS/review-log.md`."

### STEP 4 — Triage Findings (Main Claude)

Combine the `test-writer` test results + `reviewer` compliance audit findings:

- **Case A: All `[OK]` (`100% green tests` AND `all ✅ PASSED` in review)**:
  - Mark the current task item `[x]` complete in `tasks.md`.
  - Check context compacting (`Rule 15 / CLAUDE.md §3`): If at ~60k tokens (~70% context window), save progress to `session-context.md`, prompt `/clear`, and resume.
  - Proceed immediately to the next unchecked `[ ]` task in `tasks.md`.
- **Case B: Tester failures OR `[WARN]/[FAIL]` (`❌ MISSING` / `⚠️ DRIFTED`) findings**:
  - **Spec-First Authority Hierarchy (`Eliminating Ping-Pong`)**: `Specification (SDS/FRS) > Reviewer > Test > Code`. If a test fails because its assertion contradicts `SDS.md / FRS.md` (`e.g., test expects 200 when SDS specifies 201`), **the test is wrong**. Fix the test (`test-writer`) rather than changing correct implementation code (`[FRS-0.3.2]`).
  - If the code violated `SDS.md / FRS.md`, log all gap action items directly inside `openspec/changes/$ARGUMENTS/review-log.md` documenting:
    1. The failing task / requirement ID (`[FRS-x.y.z]`).
    2. Root cause analysis (`e.g. Controller performed SQL directly instead of calling NoteService`).
    3. Exact planned code correction across the layered architecture.
  - **Present the review-log.md action items to the user with ONE `[y/n]` approval request before applying the fix.** Once approved, apply the fix and re-run Step 2 & Step 3.
- **Case C: Any `[SEC]` (`🔒 SECURITY`) finding**:
  - HALT the execution loop immediately.
  - Surface the exact security vulnerability (`e.g. SQL injection risk, raw token inside localStorage, missing XSS sentinels`) directly to the user for explicit review and remediation instruction.

---

### STEP 5 — After ALL Tasks Complete (`DoD Validation`)

Once every item in `tasks.md` is marked `[x]`:

1. Run local non-negotiable Definition of Done (`CLAUDE.md §6 / DoD`):
   $$\text{pnpm turbo run build} \longrightarrow \text{pnpm turbo run lint -- --max-warnings 0} \longrightarrow \text{pnpm turbo run typecheck} \longrightarrow \text{pnpm turbo run test -- --coverage}$$
2. Verify total compilation success (`0 errors` via `tsup` / `^build`), zero lint warnings (`--max-warnings 0`), 0 static type errors (`tsc --noEmit`).
3. Verify test coverage $\ge 80\%$ on new code (`100% green against notes_app_test`).
4. Run `openspec validate` against the spec delta inside `openspec/changes/$ARGUMENTS/specs/`.
5. Verify `openspec/changes/$ARGUMENTS/proposal.md`, `tasks.md`, `review-log.md`, and `docs/FRS.md` are 100% in sync.
6. **STOP and report to user**:
   > "Implementation complete (`100% DoD compliant`). Run `/review $ARGUMENTS` to perform read-only compliance audit. Once review passes, run `/pr $ARGUMENTS` to archive the proposal (`openspec archive`) and create the pull request."

Format: `/implement AB-xxxx-short-description`
