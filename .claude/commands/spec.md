Run OpenSpec proposal creation for: $ARGUMENTS (`[Rule 1]`).

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Before running `openspec proposal`, verify that `$ARGUMENTS` contains both the ticket ID (`AB-xxxx`) AND a specific, relevant, human-readable kebab-case description (e.g., `AB-1001-project-setup-monorepo` or `AB-1002-auth-rate-limiting`).
If `$ARGUMENTS` is only a bare ticket ID (like `AB-1001`), DO NOT create a bare folder `openspec/changes/AB-1001/`. Instead, inspect the ticket scope from `docs/FRS.md` and automatically append a concise, descriptive kebab-case name to `$ARGUMENTS` before executing `openspec proposal`.

## Preconditions & Setup

1. Read canonical specification documents:
   - `docs/FRS.md` (`[FRS-x.y.z]` numbered requirement text)
   - `docs/SDS.md` (`API/DB` schemas, route table, `CHECK/GIN` constraints, status codes)
   - `docs/ux.md` (`Global Frontend UX & Visual Architecture` — strictly required for `AB-1010` to `AB-1016`)
   - `AGENTS.md` and `openspec/project.md` (monorepo boundaries and stack constraints)
2. Determine ticket scope by ID (`AB-1001 -> INFRA`, `AB-1002..AB-1009 -> BACKEND`, `AB-1010..AB-1015 -> FRONTEND`, `AB-1016 -> E2E`).
3. **GRAPH ORIENTATION (`code-review-graph`)**:
   - Run `query_graph` or `semantic_search_nodes` to check existing domain specifications and `@shared/core` schemas (~82x token savings).

---

## Spec Generation Rules (`[FRS-0.3, OpenSpec Lifecycle Protocol]`)

When generating a proposal (`/spec $ARGUMENTS`), adhere strictly to the OpenSpec three-pattern lifecycle structure (`changes/` for active proposals vs `archive/` for separated top-level archived proposals vs `specs/` for living canonical specifications):

1. **Active Change Proposal Pattern (`openspec/changes/$ARGUMENTS/`)**:
   Create two canonical artifacts inside the proposal directory:
   - `openspec/changes/$ARGUMENTS/proposal.md`: Executive summary, objective, target requirements (`[FRS-x.y.z]`), architectural mappings (`[SDS §x.y]`), and explicit `Out of Scope` boundaries.
   - `openspec/changes/$ARGUMENTS/specs/<domain>/spec.md`: The exact RFC 2119 `SHALL/MUST` behavioral deltas grouped cleanly under `ADDED Scenarios`, `MODIFIED Scenarios`, or `REMOVED Scenarios`.

2. **CRITICAL NOTEAPP RULES Integration across Proposal & Spec**:
   - Confirm all API request/response shapes match `@shared/core` (`packages/shared/src/schemas/` & `src/types/`).
   - Confirm backend endpoints use `/api/v1/...` namespace and unified `{ success: true, data }` response wrappers (`[FRS-8.6]`).
   - Confirm authentication tokens live purely in `useAuthStore` JS memory + `HttpOnly` refresh cookies (`[FRS-1.3.5]`).
   - Confirm soft-delete state transitions set `deletedAt = now()` (`Stage 1 Trash [FRS-2.2]`).

3. **Clarifying Questions**: Before or alongside outputting `proposal.md` and `specs/<domain>/spec.md`, ask minimum 3, maximum 8 clarifying questions to identify edge cases, error scenarios, and potential drift before user sign-off.

Show the complete `proposal.md` and `specs/<domain>/spec.md` content to the user.
Do NOT proceed to `/plan` or `/implement` until the user explicitly reviews and approves the proposal (`[Rule 2]`).

Format: `/spec AB-xxxx-short-description`
