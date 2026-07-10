Read these files in order before responding:
1. `AGENTS.md` (root universal brain)
2. `CLAUDE.md` (root operating rules & permission model)
3. `docs/FRS.md` (Functional Requirements Specification)
4. `docs/SDS.md` (Software Design Specification)
5. `apps/api/CLAUDE.md` (if working on backend API)
6. `apps/web/CLAUDE.md` (if working on frontend SPA)
7. `packages/shared/CLAUDE.md` (if working on shared DTOs/schemas)
8. `openspec/project.md` (canonical OpenSpec project context)

Verify that the 60k token context management threshold, `code-review-graph` MCP priority rules, and strict `[y/n]` permission gates for git/destructive operations (`CLAUDE.md §2`) are loaded and active.

Confirm: "Ready. Loaded FRS, SDS, AGENTS.md, CLAUDE.md, and OpenSpec project context. What are we building?"
Do NOT start any implementation until given an explicit task or ticket ID (`AB-xxxx`).
