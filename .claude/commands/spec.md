Run OpenSpec proposal creation for: $ARGUMENTS

Steps:
1. Run: `openspec changes list`
2. Read: `openspec/specs/` (current system state)
3. Read: `docs/FRS.md` -> find relevant requirements and acceptance criteria for this ticket (`[FRS §x.y]`).
4. Read: `docs/SDS.md` -> find relevant design decisions, DB schema tables/fields (`Citext`, `tsvector`), and API contracts for this ticket.
5. Read: `AGENTS.md` and `openspec/project.md` (architectural and stack constraints).
6. Ask clarifying questions — minimum 3, maximum 8 — to identify edge cases, error scenarios, and potential drift before any proposal draft is finalized.
7. Run: `openspec proposal $ARGUMENTS`
8. Show generated `proposal.md` and spec delta (`ADDED/MODIFIED/REMOVED` scenarios).
9. Verify that every scenario uses precise RFC 2119 terminology (`SHALL/MUST`, never `should`) and includes an explicit `Out of Scope` section.
10. Do NOT proceed to `/plan` or implementation until the user explicitly reviews and approves the spec delta.

Format: `/spec AB-xxxx-short-description`
