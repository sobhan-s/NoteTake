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

## Spec Generation Rules (`[FRS-0.3, 1-to-1 Rule]`)
Generate **ONLY one single file (`spec.md`)** inside `openspec/changes/$ARGUMENTS/spec.md` (`[Rule 1]`). Do NOT split across `proposal.md` or `specs/` directories. Everything must live cleanly in `spec.md`.

Inside `openspec/changes/$ARGUMENTS/spec.md`, structure the document with two exact sections:
### Section 1: Proposal Summary & Scope Boundaries
- **Objective & Traceability**: State exact target requirements (`[FRS-x.y.z]`) and architectural mappings (`[SDS §x.y]`).
- **Explicit Scope Boundaries**: Must include an explicit `Out of Scope` section.
- **CRITICAL NOTEAPP RULES Integration**:
  - Confirm all API request/response shapes match `@shared/core` (`packages/shared/src/schemas/` & `src/types/`).
  - Confirm backend endpoints use `/api/v1/...` namespace and unified `{ success: true, data }` response wrappers (`[FRS-8.6]`).
  - Confirm authentication tokens live purely in `useAuthStore` JS memory + `HttpOnly` refresh cookies (`[FRS-1.3.5]`).
  - Confirm soft-delete state transitions set `deletedAt = now()` (`Stage 1 Trash [FRS-2.2]`).

### Section 2: Behavioral Specification (`SHALL/MUST` Scenarios)
- **Precise RFC 2119 Terminology**: Every behavioral scenario must use exact `SHALL/MUST` (never `should`).
- Group scenarios cleanly under `ADDED Scenarios`, `MODIFIED Scenarios`, or `REMOVED Scenarios`.

**Clarifying Questions**: Before or alongside outputting `spec.md`, ask minimum 3, maximum 8 clarifying questions to identify edge cases, error scenarios, and potential drift before user sign-off.

Show the complete `spec.md` content to the user.
Do NOT proceed to `/plan` or `/implement` until the user explicitly reviews and approves `spec.md` (`[Rule 2]`).

Format: `/spec AB-xxxx-short-description`
