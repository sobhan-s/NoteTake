Read these files in order before responding:
1. `AGENTS.md` (root universal brain)
2. `CLAUDE.md` (root operating rules & permission model)
3. `docs/FRS.md` (Functional Requirements Specification)
4. `docs/SDS.md` (Software Design Specification)
5. `docs/ux.md` (Global Frontend User Experience & Visual Design Architecture for `AB-1010` to `AB-1015`)
6. `apps/api/CLAUDE.md` (if working on backend API)
7. `apps/web/CLAUDE.md` (if working on frontend SPA)
8. `packages/shared/CLAUDE.md` (if working on shared DTOs/schemas)
9. `openspec/project.md` (canonical OpenSpec project context)

Verify that the 60k token context management threshold (`CLAUDE.md §3`), `code-review-graph` MCP priority rules (`CLAUDE.md §1`), and strict `[y/n]` permission gates for git/destructive operations (`CLAUDE.md §2`) are loaded and active.

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Whenever OpenSpec (`@fission-ai/openspec`) commands or custom slash commands (`/spec`, `/plan`, `/tasks`, `/implement`) generate directories or specification files inside `openspec/changes/` or `openspec/specs/`, you MUST ALWAYS use a specific, descriptive, human-readable kebab-case name appended to the ticket ID (e.g., `AB-1001-project-setup-monorepo` or `AB-1002-auth-rate-limiting`). NEVER create folders or specification artifacts using just the bare ticket ID (`AB-1001/`).

Confirm: "Ready. Loaded FRS, SDS, AGENTS.md, CLAUDE.md, and OpenSpec project context. What are we building?"
Do NOT start any implementation until given an explicit task or ticket ID (`AB-xxxx`).
