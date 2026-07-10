# Functional Requirements Specification (FRS)
## Note Taking Application

**Version:** 1.2
**Status:** Approved - reviewed and locked by project owner
**Scope:** Defines WHAT the system must do. Does not define architecture, database schema, or API contracts - see SDS.md for that.
**Changelog:**
- v1.0 initial draft
- v1.1 added email verification, two-stage trash bin, note validation/length caps, server-side-only filtering rule, and OTP flow consistency fixes, following full human review.
- v1.2 forensic-audit corrections, following full human review:
  - Fixed a contradiction between this document's stated commit-message format and the Assignment's binding Rule 14 (FRS-0.5).
  - Closed a trash/share-link loophole: the "no access to deleted data" guarantee (FRS-8.1) now explicitly extends to public share-link access, not just list/search endpoints, and FRS-2.2.4/FRS-5.6 now require this to be enforced as a live check on every access, not only at the moment of deletion (FRS-2.2.4, FRS-5.6, FRS-8.1).
  - Clarified that OTP records must track two distinct terminal states - "invalidated by failed attempts" vs. "consumed by successful use" - since these have different business meaning and both were previously implied only by a single ambiguous "used" concept (FRS-1.2.4, FRS-1.5.4, FRS-1.5.5).
  - Added an explicit requirement that AI-governance tooling (sub-agents, MCP context tools) must be live-documentation-verified per project tooling rules, closing a gap where this was assumed but never stated (FRS-0.3).
  - No functional scope, ticket mapping, or numeric decision values changed from v1.1 elsewhere.

---

## How to read this document

- Every requirement has an ID (e.g. `FRS-1.1`) so it can be traced from a ticket → to a spec scenario → to a test name. Nothing should exist in code without tracing back to an ID here.
- "SHALL" = mandatory, testable, non-negotiable.
- Every feature section ends with **Error Scenarios** and **Out of Scope**. If a behavior isn't listed in either, it is undefined - flag it during `/spec`, don't assume it.
- Several values below (OTP expiry, link expiry, rate limits) are **decisions I'm making explicitly right now** so every ticket uses the same number instead of guessing independently. Treat these as changeable - but changeable in this document, not silently inside one ticket.

---

## Ticket Mapping

| FRS Section | Ticket(s) |
|---|---|
| 0. Phase 0 - Project Infrastructure & AI Setup (`AGENTS.md`, `CLAUDE.md`, Monorepo, Prisma) | AB-1001 |
| 1. Authentication (`[FRS §1]`) | AB-1002, AB-1003 |
| 2. Notes CRUD (`[FRS §2]`) | AB-1004, AB-1005 |
| 3. Tags (`[FRS §3]`) | AB-1006 |
| 4. Search (`[FRS §4]`) | AB-1007 |
| 5. Sharing (`[FRS §5]`) | AB-1008 |
| 6. Version History (`[FRS §6]`) | AB-1009 |
| 7. Frontend / UX Requirements (`[FRS §7]`) | AB-1010-AB-1015 |
| 8. E2E Full User Journey (`[FRS §10 DOD]`) | AB-1016 |

---

## 0. Phase 0 - Project Infrastructure & AI Governance (`AB-1001`)

This section defines the foundational operational, monorepo, database, and AI workflow requirements that must be established (`Ticket AB-1001`) before any functional feature code (`AB-1002+`) is written.

- **FRS-0.1 (Monorepo & Workspace Structure)** - The project SHALL be configured as a `pnpm workspaces` + **Turborepo (`turbo.json`)** orchestrated monorepo containing:
  - `apps/api/` (Node.js 24 + Express 5 + TypeScript backend)
  - `apps/web/` (React 19 + TypeScript + Vite + TanStack Query + Zustand frontend SPA)
  - `packages/shared/` (Single source of truth for Zod schemas, DTOs, and TS types per `Rule 11`)
  - `packages/config/` (Shared ESLint, Prettier, and TypeScript base configs)
- **FRS-0.2 (AI Development Brain & Rules)** - The project SHALL generate and maintain strict AI governance context files:
  - `AGENTS.md` in the repo root as the universal project brain (`<200 lines`), generated from FRS + SDS + codebase.
  - `CLAUDE.md` in the repo root with Claude Code-specific rules (permission models, context compacting, quality gates `Rule 12/13`, commit format `Rule 14`).
  - Domain `CLAUDE.md` files in `apps/api/`, `apps/web/`, and `packages/shared/`.
- **FRS-0.3 (Spec-Driven Development Engine & Slash Commands)** - The project SHALL initialize OpenSpec (`@fission-ai/openspec`) and mount custom slash commands inside `.claude/commands/` (`/start`, `/spec`, `/plan`, `/tasks`, `/implement`, `/review`, `/pr`). It SHALL provide specialized sub-agents inside `.claude/agents/`:
  - `reviewer.md` (Read-only compliance checker verifying every diff against FRS/SDS before merge).
  - `test-writer.md` (Dedicated test engineering sub-agent dispatched to build comprehensive unit, integration, and contract tests from specs in parallel or immediately upon feature contract completion, ensuring test generation stays decoupled and rigorous).
  - **FRS-0.3.1** - Any AI tooling used to write code against third-party library APIs (ORM, HTTP framework, testing framework, etc.) SHALL verify method signatures and usage against current, live documentation before use, rather than relying solely on model training data, to prevent hallucinated APIs. The specific mechanism (e.g. a documentation-lookup MCP server) is an SDS-level technical decision, but the requirement that such verification happen is binding at the FRS level and applies for the lifetime of the project, not just Phase 0.
- **FRS-0.4 (Database & ORM Baseline)** - The project SHALL initialize PostgreSQL 16 + Prisma ORM inside `apps/api/prisma/schema.prisma` with exact relational tables and case-insensitive text/GIN index extensions (`[SDS §3]`).
- **FRS-0.5 (Pinned Tooling, Linting & Git Hooks)** - All tool and library versions SHALL be pinned exactly in `package.json` (`Rule 20`). The project SHALL configure:
  - **Shared Code Quality (`packages/config`)**: Strict ESLint (`--max-warnings 0`) and Prettier formatting across all workspaces (`Rule 12`).
  - **Git Hooks (`Husky` + `lint-staged` + `commitlint`)**: Pre-commit hook running linting and formatting strictly on changed files, and commit-msg hook enforcing strict Conventional Commits syntax (`Rule 14`).
    - **Canonical commit format (binding, matches Assignment Rule 14 exactly - do not restate this differently anywhere else):**
      `feat(scope): description AB#ticket`
      Example: `feat(auth): implement user registration AB#1002`
      Other allowed types follow the same shape: `fix(scope): description AB#ticket`, `chore(scope): description AB#ticket` (chore commits may omit the ticket reference only when the change is not tied to a specific ticket, e.g. tooling upgrades).
      *(Note: any prior draft of this document or any companion document showing a ticket-ID-first format, e.g. `AB-1002 - feat(auth): ...`, was an error and is superseded by this section. `commitlint.config` SHALL implement only the format above.)*
- **FRS-0.6 (GitHub Actions CI Pipeline & Build Tooling)** - The project SHALL establish a GitHub Actions Continuous Integration pipeline (`.github/workflows/ci.yml`) that automatically runs on every pull request and push to main (`Rule 12`). The CI pipeline SHALL execute `pnpm install`, and then use **Turborepo (`turbo run lint typecheck build test`)** for high-performance, dependency-aware execution across all workspaces (strictly utilizing **`tsup`** for bundling/building packages and backend code via `^build`, while **`tsc` (`tsc --noEmit`) is strictly reserved for type error checking without compilation**). No PR SHALL be mergeable unless the CI pipeline passes 100%.

---

## 1. Authentication

> **Ticket mapping note:** Email verification (Section 1.2 below) is a requirement added after the original assignment ticket list was fixed. Since the ticket sequence cannot be reordered or expanded with new IDs, verification SHALL be built as part of **AB-1002** (register/login/logout/JWT), not as a separate ticket. Make sure this is explicitly included when running `/spec AB-1002` - it's easy to miss since it's not named in the ticket title.

### 1.1 Registration
- **FRS-1.1.1** - A user SHALL be able to register with an email address and password.
- **FRS-1.1.2** - Email SHALL be unique across all users (case-insensitive).
- **FRS-1.1.3** - Password SHALL be at least 8 characters, containing at least 1 number and 1 symbol.
- **FRS-1.1.4** - On successful registration, the account SHALL be created in an **unverified** state. The user SHALL NOT be able to log in until the account is verified (see 1.2).
- **FRS-1.1.5** - If a user attempts to register with an email that already exists in an **unverified** state, the system SHALL re-trigger the verification OTP for that pending account and return `200 OK` (rather than creating a duplicate or returning `201 Created`).

### 1.2 Email Verification (OTP-based)
- **FRS-1.2.1** - On registration, the system SHALL generate a 6-digit verification OTP, valid for **10 minutes**, logged to console (no real email sending, per assignment constraint).
- **FRS-1.2.2** - A user SHALL submit the OTP to verify their account. On success, the account moves to **verified** state and login becomes possible. The OTP record SHALL be marked **consumed** at this point (see FRS-1.2.4a) and can never be submitted again even if it has not yet expired.
- **FRS-1.2.3** - A user SHALL be able to request the OTP be resent if it expires, with a cooldown of **60 seconds** between resend requests (prevents spam/abuse of the console-log mechanism).
- **FRS-1.2.4** - After 3 incorrect OTP attempts, the OTP SHALL be **invalidated** and the user must request a new one (same rule as password-reset OTP, FRS-1.5.5 - kept consistent deliberately).
- **FRS-1.2.4a (OTP terminal-state distinction)** - An OTP record SHALL track its terminal state as exactly one of two distinct outcomes, and these SHALL NOT be conflated in the data model or in any audit trail:
  - **Consumed** - the OTP was entered correctly and successfully used (FRS-1.2.2, or password reset per FRS-1.5.4). A consumed OTP is single-use and can never be reused, regardless of remaining time-to-expiry.
  - **Invalidated** - the OTP was invalidated after 3 incorrect attempts (FRS-1.2.4, FRS-1.5.5) *without* ever being successfully used. An invalidated OTP requires the user to request a brand new OTP; it is not "used" in the same sense as a consumed one.
  This distinction exists because the two states carry different meaning for security auditing (a consumed OTP indicates legitimate successful verification; an invalidated OTP indicates a failed attempt pattern that may warrant monitoring) and must be independently queryable.
- **FRS-1.2.5** - An unverified account attempting to log in SHALL be rejected with a message directing them to verify, not a generic "invalid credentials" error (this is a different failure reason and should read differently to the user).

### 1.3 Login
- **FRS-1.3.1** - A user SHALL log in with email + password and receive an access token and a refresh token.
- **FRS-1.3.2** - Access tokens SHALL expire after 15 minutes.
- **FRS-1.3.3** - Refresh tokens SHALL expire after 7 days and SHALL be stored server-side so they can be individually revoked.
- **FRS-1.3.4** - After 5 consecutive failed login attempts for the same email within 15 minutes, further attempts SHALL be rejected for 15 minutes (rate limiting).
- **FRS-1.3.5** - To prevent XSS exposure, the refresh token SHALL be returned strictly inside an `HttpOnly + Secure + SameSite=Strict` cookie (`refreshToken`), and the access token SHALL be returned in the JSON response body and stored by the client strictly in memory (Zustand/React state), with zero tokens stored in `localStorage` or `sessionStorage`.

### 1.4 Logout
- **FRS-1.4.1** - Logout SHALL invalidate the specific refresh token used in that session. Other active sessions (other devices) SHALL remain valid.

### 1.5 Forgot / Reset Password (OTP-based)
- **FRS-1.5.1** - A user SHALL be able to request a password reset by submitting their email.
- **FRS-1.5.2** - The system SHALL generate a 6-digit OTP, valid for **10 minutes**, and log it to console (per assignment - no real email sending).
- **FRS-1.5.3** - A user SHALL be able to request the reset OTP be resent, with the same **60-second cooldown** between requests as registration OTP (FRS-1.2.3) - kept consistent deliberately, same abuse concern applies to both flows.
- **FRS-1.5.4** - An OTP SHALL be single-use - once used to reset a password, it is marked **consumed** (FRS-1.2.4a) and invalidated for further use even if not expired.
- **FRS-1.5.5** - After 3 incorrect OTP attempts, the OTP SHALL be **invalidated** (FRS-1.2.4a) and the user must request a new one.
- **FRS-1.5.6** - On successful reset, all existing refresh tokens for that user SHALL be revoked (force re-login everywhere - a security default, not optional).

### Error Scenarios (Auth)
- Duplicate email on registration → rejected, no account created.
- Weak password → rejected with the specific rule violated.
- Registering with an email that exists but is unverified → SHALL NOT create a duplicate account; instead, re-trigger the verification OTP for that same pending account (prevents a user from being locked out just because they didn't verify in time, and prevents email-enumeration via a different error message).
- Login with wrong password → rejected; does not reveal whether the email exists or the password was wrong (prevents user enumeration).
- Login with correct credentials but unverified account → rejected with a distinct "please verify your account" message (see FRS-1.2.5).
- Login while rate-limited → rejected, without revealing exact unlock time to avoid aiding enumeration/timing attacks.
- Expired, already-consumed, or invalidated OTP (registration or reset) → rejected, clear message to request a new one.
- Refresh with an expired or revoked refresh token → rejected, user must log in again.

### Out of Scope (Auth)
- OAuth / social login
- Multi-factor authentication beyond OTP flows (registration verification + password reset)
- Account deletion / "delete my account" self-service. This is a genuine gap in the original assignment - not mentioned in the feature list, tickets, or FRS until now. Explicitly marking it **out of scope for this build**, rather than leaving it silently undefined, because building it properly would require its own cascading-delete design (notes, tags, versions, share links, refresh tokens) equivalent in complexity to the Trash/cleanup system in Section 8a. If this is needed later, it should get its own ticket and its own FRS subsection, not be bolted onto an existing one.

---

## 2. Notes CRUD

### 2.1 Create / Read / Update
- **FRS-2.1.1** - An authenticated user SHALL be able to create a note with a title and rich-text body.
- **FRS-2.1.2** - A user SHALL only ever see, edit, or delete their own notes - never another user's.
- **FRS-2.1.3** - A user SHALL be able to update a note's title and/or body at any time.
- **FRS-2.1.4** - Every note SHALL track `createdAt` and `updatedAt` timestamps.
- **FRS-2.1.5** - A note title SHALL be required - empty or whitespace-only titles SHALL be rejected with a validation error at create and update time.
- **FRS-2.1.6** - A note title SHALL be capped at **200 characters**. A note body SHALL be capped at **100,000 characters**. Both limits are enforced server-side, not just in the frontend editor.

### 2.2 Trash Bin (Two-Stage Deletion)

> **Ticket mapping note:** there is no dedicated frontend ticket for Trash in the original list. The Trash view (list, restore, permanent-delete-now action) SHALL be built as part of **AB-1011 (Frontend - Notes list page)** - treat it as a filtered view of the same list with a restore action, not a separate page requiring its own ticket.

- **FRS-2.2.1** - Deleting a note SHALL move it to the user's **Trash** by setting its `deletedAt` timestamp only (`Rule 15`), without physically deleting the note immediately. This is Stage 1.
- **FRS-2.2.2** - A trashed note SHALL remain visible in a dedicated Trash view for **30 days**, and the user SHALL be able to **restore** it from Trash at any point during that window, returning it to normal active state (visible again in lists, search, tag counts).
- **FRS-2.2.3** - While in Trash, a note SHALL NOT appear in normal list views, search results, or tag counts (FRS-2.3, FRS-4.4).
- **FRS-2.2.4** - While a note is in Trash (Stage 1 or Stage 2), any public share link for that note SHALL behave as revoked (FRS-5.6). This guarantee SHALL be enforced as a **live check performed on every single access attempt to the share link** (i.e. re-verified against the note's current `deletedAt` state at request time), not merely applied once at the moment the note is deleted. A share link SHALL NOT be servable, and its view counter SHALL NOT increment, for any note that is currently soft-deleted, regardless of whether the link's own `revokedAt`/`expiresAt` fields have been separately updated. If the note is later restored, the share link SHALL remain revoked - restoring a note does not resurrect an old share link; the user must generate a new one if desired. *(Decision - flag if you want restore to also restore the old link.)*
- **FRS-2.2.5** - After 30 days in Trash without restoration, a note SHALL automatically leave the Trash view (no longer visible or restorable to the user) and enter Stage 2 - pending permanent deletion.
- **FRS-2.2.6** - Stage 2 SHALL last an additional **30 days by default** (60 days total from original deletion) during which the record still physically exists in the database for audit/recovery-of-last-resort purposes (`Rule 15`), but is not user-accessible or restorable through the application in any way.
- **FRS-2.2.7** - At the end of Stage 2, the note and all its data (versions, tag associations, share link records) SHALL be physically and permanently removed from the database.
- **FRS-2.2.8** - A user SHALL be able to permanently delete a note immediately from within the Trash view, skipping the remaining wait time, as an explicit "delete forever" action requiring confirmation.

> **Resolved:** the Stage 1→2 transition and Stage 2→permanent-removal steps SHALL be handled by the shared cleanup system defined in Section 8a - not a purge mechanism built separately for this feature.

### 2.3 Pagination, Sorting, Tag Filtering
- **FRS-2.3.1** - Notes list SHALL be paginated, default page size 20, configurable up to 100.
- **FRS-2.3.2** - Notes SHALL be sortable by `createdAt`, `updatedAt`, or `title`, ascending or descending.
- **FRS-2.3.3** - Notes list SHALL be filterable by one or more tags, with the logic (must have ALL selected tags vs. ANY selected tag) selectable by the user via an explicit request parameter, defaulting to **ALL (AND)** when the parameter is omitted.
- **FRS-2.3.4** - When two notes have identical values on the primary sort field, a secondary tiebreaker sort of `createdAt` descending SHALL be applied at the query level (not client-side), so pagination ordering is always stable and reproducible.
- **FRS-2.3.5** - Search query (FRS-4.1) and tag filter (FRS-2.3.3) SHALL be combinable in a single request - e.g. "notes tagged #work matching 'meeting'."
- **FRS-2.3.6** - The Trash view (FRS-2.2.2) SHALL be a simple list only - no independent pagination or sort controls. It uses the same default page size as the active notes list (FRS-2.3.1) and is always ordered by deletion date, descending, with no user-configurable sort option. The Trash listing query SHALL itself enforce the Stage 1 window (i.e. only return notes with `deletedAt` within the last 30 days) rather than relying solely on a separate check inside the restore action.

### Error Scenarios (Notes)
- Access/edit/delete a note belonging to another user → rejected as if the note does not exist (do not reveal it exists but isn't theirs).
- Update, delete, or restore a note that is in Stage 2 (past the 30-day Trash window) → rejected, note not found (it is no longer user-accessible per FRS-2.2.5).
- Attempting to edit a note while it's in Trash (Stage 1) → rejected; a trashed note must be restored first before it can be edited again.
- Invalid sort field or out-of-range page size → rejected with the valid options listed.
- Invalid or unrecognized tag-filter-logic parameter (FRS-2.3.3) → rejected with the valid options listed (`ALL`/`ANY`).
- Empty/whitespace-only title on create or update → rejected, validation error naming the `title` field.
- Title or body exceeding its length cap (FRS-2.1.6) → rejected, validation error naming which field and its limit.

### Out of Scope (Notes)
- File or image attachments
- Note folders or nesting

---

## 3. Tags

- **FRS-3.1** - A user SHALL be able to create, rename, recolor, and delete tags, scoped to their own account only. Tag creation SHALL be supported on-the-fly directly within **both** (a) the note creation/editing flow and (b) the search/filter bar ('Fly Tags'), without requiring navigation to a dedicated tag management page in either case.
- **FRS-3.2** - Each tag SHALL display a live count of non-deleted notes currently using it.
- **FRS-3.3** - Deleting a tag SHALL remove it from all notes that reference it, without deleting the notes themselves.
- **FRS-3.4** - Tag names SHALL be unique per user (case-insensitive) - no duplicate tag names for the same user.

### Error Scenarios (Tags)
- Creating a tag with a name that already exists (for that user) → rejected.
- Deleting a tag that doesn't belong to the user → rejected as not found.

### Out of Scope (Tags)
- Shared/team tags across users
- Nested or hierarchical tags

---

## 4. Search

- **FRS-4.1** - A user SHALL be able to search their own notes (title + body) using full-text search.
- **FRS-4.2** - Search results SHALL highlight the matching keyword(s) in the returned snippet.
- **FRS-4.2.1** - Full-text search snippet generation (`ts_headline`) SHALL use custom sentinel delimiters (`[[[MARK]]]` and `[[[MARK_END]]]`) rather than raw HTML tags (`<b>`), enabling clean styling without HTML coupling or XSS risks.
- **FRS-4.3** - Search results SHALL be paginated using the same page-size rules as the notes list (FRS-2.3.1).
- **FRS-4.4** - Search SHALL only return the searching user's own non-deleted notes.
- **FRS-4.5** - Search SHALL rank results by relevance (best match first), not just recency.

### Error Scenarios (Search)
- Empty or whitespace-only search query → rejected with a validation message, not treated as "match everything."
- Search query containing special characters SHALL be safely escaped, not passed raw into the query - both for correctness and to prevent injection.

### Out of Scope (Search)
- Fuzzy/typo-tolerant search
- Search across other users' notes (there is no such thing in this app)

---

## 5. Sharing

- **FRS-5.1** - A user SHALL be able to generate a public, read-only link for any of their own notes.
- **FRS-5.2** - A share link SHALL have an expiry, defaulting to **7 days**, adjustable by the user at creation time between 1 and 30 days.
- **FRS-5.3** - A user SHALL be able to manually revoke a share link at any time, immediately invalidating it.
- **FRS-5.4** - Each **visit** to a shared note's public link SHALL increment a view counter by exactly 1 - including repeat visits from the same person/browser (this is a raw visit counter, not a unique-visitor counter; no deduplication by IP, cookie, or session). **This counter update must be atomic/race-safe** - if two people (or one person refreshing rapidly) hit the link at the same instant, both visits SHALL be counted, with zero lost updates. *(Flagging the atomicity requirement now because "read count, add 1, write count" is a classic race-condition bug - see SDS for the exact mechanism, e.g. a single atomic increment statement rather than read-then-write.)* This same atomic operation SHALL also be the point at which the note's current deletion state is checked (FRS-2.2.4) - a single query, not two separate steps that could disagree with each other.
- **FRS-5.5** - A public share link SHALL show the note content read-only - no edit capability, no indication of who else has viewed it, no access to the owner's other notes.
- **FRS-5.6** - An expired, revoked, in-Trash (FRS-2.2.4), or otherwise invalid link SHALL show a clear "this link is no longer available" state - never a raw error or the note content. This applies identically whether the link became invalid through explicit revocation, expiry, or the underlying note being soft-deleted - the public viewer SHALL NOT be able to distinguish which of these caused it.

### Error Scenarios (Sharing)
- Viewing an expired link → rejected, "no longer available" message.
- Viewing a revoked link → same as expired, no distinction shown to the public viewer (don't leak whether it was revoked vs. expired).
- Viewing a link whose note is currently in Trash (Stage 1 or Stage 2) → same "no longer available" message, no distinction shown to the public viewer (FRS-2.2.4, FRS-5.6).
- Generating a share link for a note currently in Trash → rejected.
- A note that gets moved to Trash after its share link was created → link SHALL immediately stop working (see FRS-2.2.4), verified live on next access, not just at the moment of deletion.

### Out of Scope (Sharing)
- Password-protected share links
- Shared links with edit/comment permissions
- Per-viewer analytics beyond a simple total view count

---

## 6. Version History

- **FRS-6.1** - Every explicit save or significant update of a note SHALL create a new version snapshot. To prevent database bloat from background debounced autosaves (`FRS-7.1`), automatic version snapshot creation SHALL be throttled to at most **one version snapshot per 5-minute window** per note. Explicit saves (`Ctrl+S` or title changes) SHALL always create a version immediately.
- **FRS-6.2** - A user SHALL be able to list all versions of a note, in reverse chronological order, each showing a timestamp.
- **FRS-6.3** - A user SHALL be able to view the full content of any past version.
- **FRS-6.4** - "Restore" a version SHALL create a **new** version at the top of history with that version's content - it SHALL NOT delete or overwrite intervening versions. History is append-only, never rewritten.
- **FRS-6.5** - Version history SHALL be auto-purged: versions older than **90 days** SHALL be eligible for automatic removal, except the note's current live version, which is never purged regardless of age. *(Explicit decision: this needs an actual scheduled job - see note below.)*

> **Resolved:** version purging SHALL be handled by the shared cleanup system defined in Section 8a, not a purge mechanism built separately for this feature.

### Error Scenarios (Version History)
- Viewing a version that has been purged → rejected, "no longer available."
- Restoring a version of a note that has since been soft-deleted → rejected.
- Requesting version history for another user's note → rejected as not found (same pattern as FRS-2.1.2).

### Out of Scope (Version History)
- Diff/comparison view between two versions
- Manual pinning of specific versions to exempt them from purge

---

## 7. Frontend / UX Requirements

These are business-level UX requirements only - visual design and component structure belong in SDS.md.

- **FRS-7.1** - The note editor SHALL autosave in the background without the user manually clicking "save," while still allowing version snapshots per FRS-6.1.
- **FRS-7.2** - The user SHALL always be able to tell, at a glance, whether a note has unsaved/in-flight changes, is a shared note, or has an active share link.
- **FRS-7.3** - Search result highlighting (FRS-4.2) SHALL be visible in the frontend results list, not just present in the API response.
- **FRS-7.4** - The version history view SHALL let a user preview a past version before committing to restore it - restore SHALL NOT be a single-click destructive action without a confirmation step.
- **FRS-7.5** - The application SHALL be fully responsive and usable across phone, tablet, laptop, and large desktop monitor viewport sizes - all features (editor, search, sharing, version history, trash) SHALL be operable at each size, not just the marketing/landing surfaces. Specific breakpoints and layout behavior are defined in SDS.md.

### Out of Scope (Frontend)
- Offline mode / local-first editing
- Mobile-responsive native app behavior beyond standard responsive web layout

---

## 8. Cross-Cutting Non-Functional Notes

*(Kept brief - full detail belongs in SDS.md. Listed here only because they affect acceptance criteria.)*

- **FRS-8.1** - All list/search endpoints, **and all public share-link access (FRS-2.2.4, FRS-5.6)**, SHALL exclude/reject soft-deleted notes by default, with no way for a client to override this via a request parameter. This is a single guarantee applied consistently across every read path that can expose note content - not just the authenticated list/search endpoints.
- **FRS-8.2** - All timestamps SHALL be stored and returned in UTC.
- **FRS-8.3** - No feature in this document may send real email - OTPs and any other notifications SHALL be logged to console only, per assignment constraint.
- **FRS-8.4** - All sorting, filtering (by tag, per FRS-2.3.3), and searching (FRS-4.1) SHALL be performed **server-side**, over the complete dataset, before pagination is applied. The frontend SHALL NOT locally re-sort, re-filter, or re-search a page of results that has already been fetched - every change to sort/filter/search criteria SHALL trigger a new backend request. This applies regardless of how small a result set might appear to be.
- **FRS-8.5** - Single Source of Truth & 3-Tier Constants (`Rule 11`): All Zod schemas, inferred TypeScript DTO types, and shared constants/messages (`API_PATHS`, `APP_LIMITS`, `VALIDATION_MESSAGES`) SHALL reside strictly inside `packages/shared`. Backend-only constants live in `apps/api/src/constants`, and frontend-only UI constants live in `apps/web/src/constants`. Never duplicate schemas or models across frontend and backend. Every numeric value mandated in this document (OTP expiry/cooldown/attempt-limits, rate-limit thresholds, trash/version retention windows, page sizes, token expiries) SHALL correspond to exactly one named constant in `packages/shared`, and implementation code (including scheduled jobs) SHALL reference that constant rather than re-deriving or hardcoding the value.
- **FRS-8.6** - API Versioning: All API endpoints SHALL be namespace-versioned under the base path `/api/v1`.
- **FRS-8.7** - Interactive API Documentation: The backend SHALL generate and mount interactive OpenAPI/Swagger documentation at `/api/v1/docs`, accurately reflecting all request/response schemas from `packages/shared`.

> **For SDS.md:** define the exact query parameter shape (e.g. `?sort=createdAt&order=desc&tags=work,urgent&tagMode=ALL&q=meeting&page=1`) and confirm TanStack Query is configured to refetch on every filter/sort/search state change rather than caching-and-locally-slicing a previous response.

---

## 8a. Shared Data Cleanup System (Cross-Cutting)

The core business rule is simple: **no data past its retention period SHALL remain accessible or persist indefinitely.** Multiple features in this document rely on that same guarantee (Trash Stage 2, old versions, expired OTPs) - the sections below make sure that guarantee is worded once, consistently, rather than redefined slightly differently per feature.

- **FRS-8a.1** - Data past its defined retention period (per its own section: Trash in Section 2.2, versions in Section 6, OTPs in Section 1) SHALL be permanently and reliably removed - a user or attacker SHALL NOT be able to access it, and it SHALL NOT remain in the database indefinitely by default.
- **FRS-8a.2** - This guarantee currently applies to at least these four categories, and SHALL be extensible to future categories without redefining the guarantee itself:
  - Notes in Trash Stage 2 → permanent removal (FRS-2.2.6, FRS-2.2.7)
  - Note versions past retention → permanent removal (FRS-6.5)
  - Expired, consumed, or invalidated OTP records (registration + password reset, FRS-1.2.4a) → permanent removal
  - Stale login attempt records (`LoginAttempt` rows `[FRS-1.3.4]`) older than 24 hours → permanent removal
- **FRS-8a.3** - Removal SHALL happen automatically, without requiring a user or admin to trigger it manually.
- **FRS-8a.4** - Removal SHALL be safe to run repeatedly and safe to run concurrently with normal application use - it must never remove a note a user is actively restoring or viewing at that exact moment, and repeated runs must not cause errors or double-processing.
- **FRS-8a.5** - Each category's specific retention number (30/30/60/90 days, OTP expiry) remains defined where it already lives in this document (Sections 1, 2, 6) - this section governs the guarantee itself, not *how long* each thing is kept.

> **For SDS.md (architecture decision, not an FRS mandate):** we recommend implementing this as **one reusable mechanism** (e.g. a single nightly scheduled job checking each relevant table) rather than three separately-built ones, purely to avoid duplicate code and duplicate bugs - but that's a technical efficiency choice, not a business requirement. The business requirement is only FRS-8a.1: expired data must not persist or stay accessible. Choose the mechanism (cron / lazy check-on-read / queued job) in SDS.md. Note also that the live-access-time enforcement required for share links (FRS-2.2.4, FRS-8.1) is a *separate* guarantee from this nightly-purge cleanup system - a share link must be blocked the instant its note is trashed, not merely by the time the nightly job runs.

---

## 9. Master Out-of-Scope List (repeated from assignment, binding across all tickets)

Any ticket attempting these is a violation, regardless of what seems technically convenient:

- Real-time collaborative editing
- File or image attachments
- Mobile app
- OAuth / social login
- Note folders or nesting
- Actual email sending

---

## 10. Open Decisions Log

Every number in this document that isn't from the assignment itself was a judgment call. Logged here so they're visible, not buried:

| Decision | Value chosen | Where used |
|---|---|---|
| Registration OTP expiry | 10 minutes | FRS-1.2.1 |
| Registration OTP resend cooldown | 60 seconds | FRS-1.2.3 |
| Password-reset OTP resend cooldown | 60 seconds (matches registration) | FRS-1.5.3 |
| OTP max attempts (both registration & reset) | 3 | FRS-1.2.4, FRS-1.5.5 |
| OTP terminal states tracked separately | "consumed" vs. "invalidated" | FRS-1.2.4a |
| Login rate limit | 5 attempts / 15 min lockout | FRS-1.3.4 |
| Trash Stage 1 (visible, restorable) | 30 days | FRS-2.2.2 |
| Trash Stage 2 (hidden, pending permanent removal) | 30 days (60 total) | FRS-2.2.6 |
| Restoring a note resurrects its old share link? | No - new link required | FRS-2.2.4 |
| Trash/share-link deletion check performed | Live, per-access (not just at deletion time) | FRS-2.2.4, FRS-8.1 |
| Default tag filter logic | ALL / AND (explicit override parameter available) | FRS-2.3.3 |
| Default share link expiry | 7 days (range 1–30) | FRS-5.2 |
| Version history retention | 90 days | FRS-6.5 |
| Default page size | 20 (max 100) | FRS-2.3.1 |
| Expired/consumed/invalidated OTP retention before cleanup | 24 hours | FRS-8a.2 |
| Shared cleanup mechanism (Trash Stage 2, versions, OTPs) | one reusable system, not three separate ones | FRS-8a.1 |
| Password complexity rule | min 8 chars, 1 number, 1 symbol | FRS-1.1.3 |
| Empty/blank note title | rejected with validation error | FRS-2.1.5 |
| Note title max length | 200 characters | FRS-2.1.6 |
| Note body max length | 100,000 characters | FRS-2.1.6 |
| Email verification ticket ownership | folded into AB-1002 (no new ticket ID) | Section 1 mapping note |
| Trash bin UI ticket ownership | folded into AB-1011 (no new ticket ID) | Section 2.2 mapping note |
| Sort/filter/search location | server-side only, never client-side re-slicing | FRS-8.4 |
| Canonical commit message format | `feat(scope): description AB#ticket` (matches Assignment Rule 14 verbatim) | FRS-0.5 |