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
**Mandatory Graph Readiness Check**: Immediately verify graph status upon session start (`uvx code-review-graph status --repo "$PWD"`). If `Nodes: 0` or if the graph database is uninitialized, automatically run `uvx code-review-graph update --repo "$PWD" || uvx code-review-graph build --repo "$PWD"` before exploring any codebase files so that ~82x–528x token savings (`CLAUDE.md §1a`) are guaranteed across all queries.

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Whenever OpenSpec (`@fission-ai/openspec`) commands or custom slash commands (`/spec`, `/plan`, `/tasks`, `/implement`, `/review`, `/pr`) interact with proposals or specifications, you MUST ALWAYS obey the three-pattern lifecycle structure (`changes/<AB-xxxx-name>/` for active proposals, `archive/<AB-xxxx-name>/` for top-level separated archived historical snapshots created at `/pr` time, and `specs/<domain>/spec.md` for living canonical specs) and use a specific, descriptive, human-readable kebab-case name appended to the ticket ID (e.g., `AB-1001-project-setup-monorepo`). NEVER create bare folders (`AB-1001/`).

Confirm: "Ready. Loaded FRS, SDS, AGENTS.md, CLAUDE.md, and OpenSpec project context. What are we building?"
Do NOT start any implementation until given an explicit task or ticket ID (`AB-xxxx`).
