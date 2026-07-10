Implement execution tasks for: $ARGUMENTS

Before writing ONE line of code, read:
1. `AGENTS.md` and root `CLAUDE.md`
2. `docs/FRS.md` (business rules for this ticket)
3. `docs/SDS.md` (API contracts, DB schema, exact error codes, and design decisions)
4. Domain `CLAUDE.md` (`apps/api/CLAUDE.md` or `apps/web/CLAUDE.md`)
5. `openspec/changes/$ARGUMENTS/proposal.md`
6. `openspec/changes/$ARGUMENTS/plan.md`
7. `openspec/changes/$ARGUMENTS/tasks.md`

Execution Rules:
- **Permission Gate (`CLAUDE.md §2`)**: ALWAYS ask `[y/n]` before EVERY git operation, running database migrations, or deleting/overwriting existing files.
- **MCP Priority (`code-review-graph` / `crg`)**: Always query `detect_changes_tool` or `query_graph` before doing raw file reads across unfamiliar code.
- **Quality Gates after every phase**: Run `pnpm turbo run build` -> `pnpm turbo run lint` -> `pnpm turbo run typecheck` -> `pnpm turbo run test -- --coverage`.
- **Test-First / Parallel Test Derivation (`[FRS-0.3.2, FRS-0.3.3]`)**: Write tests BEFORE or ALONGSIDE implementation against isolated `notes_app_test`. Never skip or ignore a failing test. If a test fails, fix the code or verify the test contract against `SDS/FRS`.
- **Context Compacting (`Rule 15`)**: At ~60k tokens, save state to `session-context.md`, prompt `/clear`, and resume.
- **When complete**: Run `openspec archive $ARGUMENTS`.

Output summary when complete:
## Files Changed + Why
## Spec Scenarios Covered (scenario -> test name & location)
## FRS Requirements Covered (requirement ID -> implementation location)
## Assumptions Made
## Follow-up Tasks

Format: `/implement AB-xxxx-short-description`
