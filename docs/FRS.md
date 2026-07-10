# Functional Requirements Specification (FRS)
## Note Taking Application

**Version:** 2.2 
**Status:** Approved — reviewed and locked by project owner
**Owner:** Sobhan Sahoo
**Scope:** Defines WHAT the system must do. Architecture, DB schema, and API contracts live in `SDS.md`.
---

## Ticket Map (one ticket per row, each mapped to its exact FRS reference)

| Ticket | Title | FRS Ref |
|---|---|---|
| AB-1001 | Project setup — monorepo, Prisma, CLAUDE.md files, agents, skills, MCPs | §0 |
| AB-1002 | Auth — register, login, logout, JWT + refresh token, **+ email verification** | §1.1–1.4 |
| AB-1003 | Auth — forgot password + OTP reset | §1.5 |
| AB-1004 | Notes — full CRUD + soft delete (Trash Stage 1/2) | §2.1–2.2 |
| AB-1005 | Notes — pagination, sorting, tag filtering | §2.3 |
| AB-1006 | Tags — CRUD + live note count + Fly Tags | §3 |
| AB-1007 | Search — full-text with highlight + pagination | §4 |
| AB-1008 | Sharing — generate link, revoke, public access, atomic view count | §5 |
| AB-1009 | Version history — snapshot, list, view, restore, auto-purge | §6 |
| AB-1010 | Frontend — Auth pages | §7, §1 |
| AB-1011 | Frontend — Notes list page **+ Trash view** | §7, §2.2, §2.3.6 |
| AB-1012 | Frontend — Note editor (TipTap) + autosave | §7.1–7.2, §6.1 |
| AB-1013 | Frontend — Search UI with highlights | §7.3, §4.2 |
| AB-1014 | Frontend — Share modal + active links | §7.2, §5 |
| AB-1015 | Frontend — Version history drawer + restore | §7.4, §6 |
| AB-1016 | E2E — Playwright full user journey | Assignment DOD + §1–§8a |

**Folded scope (binding — no new ticket IDs exist for these):**
- Email verification builds inside **AB-1002** (register/login ticket), not AB-1003.
- Trash bin UI (list, restore, permanent-delete) builds inside **AB-1011** (notes list ticket), as a filtered view — not its own page/ticket.

---

## 0. Phase 0 — Project Infrastructure & AI Governance (`AB-1001`)

Foundational monorepo/DB/AI-workflow requirements, established before any feature code (`AB-1002+`).

- **FRS-0.1** — `pnpm workspaces` + Turborepo monorepo: `apps/api/` (Node.js 22 + Express 5 + TS), `apps/web/` (React 19 + TS + Vite + TanStack Query + Zustand + TipTap + shadcn/ui), `packages/shared/` (Zod schemas/DTOs/types, Rule 11), `packages/config/` (shared lint/prettier/TS config).
- **FRS-0.2** — AI governance files: `AGENTS.md` (root, universal brain, <200 lines), `CLAUDE.md` (root + one per `apps/api`, `apps/web`, `packages/shared`).
- **FRS-0.3** — OpenSpec (`@fission-ai/openspec`) workspace initialized with root `openspec/` directory structure (`openspec/config.yaml`, `openspec/changes/`, `openspec/archive/`, `openspec/specs/`) and custom slash commands in `.claude/commands/` (`/start /spec /plan /tasks /implement /review /pr`) plus sub-agents in `.claude/agents/`: `reviewer.md` (read-only FRS/SDS compliance checker) and `test-writer.md` (dispatched to build unit/integration/contract tests from spec, decoupled from implementation). All Spec-Driven Development (SDD) actions MUST execute strictly via OpenSpec (`/spec AB-xxxx` → human review of `delta-openapi.yaml` → `/plan` → `/tasks` → `/implement` → `openspec validate` → `openspec archive AB-xxxx` prior to raising PR).
  - **FRS-0.3.1** — Any AI-generated code against a third-party library API (ORM, HTTP framework, test framework, etc.) SHALL be verified against current live documentation before use, not solely model training data. Mechanism is an SDS decision; the requirement itself is binding for the project's lifetime.
  - **FRS-0.3.2 (test-writer input source restriction)** — The Acceptance Criteria checklists in this document exist for **human/reviewer sign-off tracking only**. `test-writer.md`, or any sub-agent generating test cases, SHALL derive tests from the underlying FRS requirement text (`SHALL` statements, numbered `FRS-x.y.z` IDs, Error Scenarios, and Out-of-Scope boundaries) and the SDS API/DB contracts — **not** from the Acceptance Criteria bullet wording. An Acceptance Criteria line SHALL NOT be copied or lightly reworded into a test name or assertion. This exists because a checklist item is a compressed summary written for a reviewer skimming a PR, not a test spec — mechanically converting it into tests produces shallow, checklist-mirroring coverage that misses boundary values, concurrency conditions, and negative-path combinations the checklist wording never had room to spell out (e.g. FRS-1.3.4 becoming one "rate limit works" test instead of separate tests for the 4th/5th/6th attempt, the 15-minute-minus-one-second boundary, and per-email vs. cross-email isolation). Each Acceptance Criteria item may end up covered by several tests; the reverse — one test per checklist line — SHALL NOT be treated as sufficient. `reviewer.md` checks test coverage against the FRS requirement IDs and SDS contracts directly, not against whether each Acceptance Criteria line has a same-named test.
  - **FRS-0.3.3 (test database isolation restriction)** — Any automated contract/integration tests (`supertest`) or E2E full-journey tests (`playwright`) SHALL execute strictly against a dedicated, isolated test database (`e.g., notes_app_test`) loaded via `.env.test` or ephemeral test containers (`@testcontainers/postgresql`). Under no circumstances shall `supertest` or `playwright` tests execute against the local development database (`notes_app`) or production database, as test runners execute destructive table truncation (`TRUNCATE TABLE ... CASCADE`) before/after test suites to guarantee deterministic state. Furthermore, because the application relies on native PostgreSQL 16 features (`citext` and `tsvector` GIN indexes per FRS-0.4), tests SHALL NOT substitute an in-memory SQLite database (`sqlite::memory:`); they SHALL execute against a genuine PostgreSQL 16 test database instance.
- **FRS-0.4** — PostgreSQL 16 + Prisma initialized in `apps/api/prisma/schema.prisma`, with case-insensitive text and GIN index extensions (see SDS §3).
- **FRS-0.5** — All tool/library versions pinned exactly (Rule 20). ESLint `--max-warnings 0` + Prettier across workspaces. Husky + lint-staged + commitlint enforcing Conventional Commits.
  - **Canonical commit format (binding):** `feat(scope): description AB#ticket` — e.g. `feat(auth): implement user registration AB#1002`. Same shape for `fix`/`chore` (chore may omit ticket only for non-ticket-tied changes, e.g. tooling upgrades). Any prior ticket-ID-first format is superseded by this.
- **FRS-0.6** — Local verification runs and quality gates (`Rule 12`): `pnpm install` → Turborepo (`turbo run lint typecheck build test`) across all workspaces, `tsup` for bundling, `tsc --noEmit` reserved strictly for type-checking. Enforces Definition of Done: `pnpm build` (0 errors), `pnpm lint --max-warnings 0`, and `pnpm test --coverage` (all green, ≥80% coverage on new code). No PR mergeable (`/pr`) unless `/review` agent (`all ✅`) and all verification checkpoints pass.

### Acceptance Criteria (AB-1001)
- [ ] Workspace layout matches FRS-0.1 exactly; `turbo.json` builds `packages/*` before `apps/*`.
- [ ] OpenSpec directory structure (`openspec/config.yaml`, `openspec/changes/`, `openspec/archive/`, `openspec/specs/`) matches FRS-0.3 exactly.
- [ ] `AGENTS.md` exists, root + 3 domain `CLAUDE.md` files exist.
- [ ] `.claude/commands/` has all 7 slash commands; `.claude/agents/` has both sub-agents.
- [ ] A concrete, working live-doc-verification mechanism exists (not just a comment) — FRS-0.3.1.
- [ ] `test-writer.md`'s instructions explicitly direct it to FRS requirement IDs/SDS contracts as its test-generation source, and explicitly prohibit deriving tests from Acceptance Criteria wording — FRS-0.3.2. Spot-check a generated test file: no test name/assertion should read as a re-typed checklist line, and coverage should include boundary/negative cases the checklist didn't enumerate.
- [ ] `supertest` and `playwright` test suites strictly target an isolated test database (`notes_app_test` or ephemeral container) and never the local development database (`notes_app`) or SQLite — FRS-0.3.3.
- [ ] Postgres 16 + Prisma initialize cleanly via `docker compose up`.
- [ ] Zero `^ ~ * >=` version ranges anywhere in any `package.json`; zero `@latest` in install scripts.
- [ ] A malformed commit message (wrong prefix or missing `AB#ticket`) is rejected by the commit-msg hook.
- [ ] A failing lint/typecheck/build/test step blocks PR creation and merge.

---

## 1. Authentication

### 1.1 Registration
- **FRS-1.1.1** — Register with email + password.
- **FRS-1.1.2** — Email unique across all users, case-insensitive.
- **FRS-1.1.3** — Password ≥8 chars, ≥1 number, ≥1 symbol.
- **FRS-1.1.4** — New account starts **unverified**; login blocked until verified (§1.2).
- **FRS-1.1.5** — Registering with an email that already exists **unverified** SHALL re-trigger the verification OTP for that pending account and return `200 OK` (not create a duplicate, not `201`).

### 1.2 Email Verification (OTP-based)
- **FRS-1.2.1** — 6-digit OTP on registration, 10-min expiry, logged to console (no real email, FRS-8.3).
- **FRS-1.2.2** — Correct OTP → account **verified**, login enabled, OTP marked **consumed** (single-use, can never be resubmitted even if unexpired).
- **FRS-1.2.3** — Resend allowed with a 60-second cooldown between requests.
- **FRS-1.2.4** — 3 incorrect attempts → OTP **invalidated**; user must request a new one (same rule as password-reset OTP, FRS-1.5.5).
- **FRS-1.2.4a (terminal-state distinction)** — An OTP record tracks exactly one of two terminal states, never conflated:
  - **Consumed** — entered correctly and used (FRS-1.2.2 or FRS-1.5.4). Single-use, permanent.
  - **Invalidated** — hit the 3-attempt cap without ever succeeding (FRS-1.2.4, FRS-1.5.5). Requires a fresh OTP.
  These carry different security-audit meaning and SHALL be independently queryable.
- **FRS-1.2.5** — Login attempt on an unverified account → rejected with a distinct "please verify" message, not generic invalid-credentials.

### 1.3 Login
- **FRS-1.3.1** — Login returns an access token + refresh token.
- **FRS-1.3.2** — Access token expires in 15 minutes.
- **FRS-1.3.3** — Refresh token expires in 7 days, stored server-side, individually revocable.
- **FRS-1.3.4** — 5 consecutive failed logins for the same email within 15 minutes → further attempts rejected for 15 minutes. **(Decision)** This counter tracks **wrong-password failures only**. A login attempt rejected solely for being unverified (FRS-1.2.5) SHALL NOT be recorded against this counter — it's a deterministic, non-guessable rejection reason, not a brute-force signal, and counting it risks locking out a legitimate user who simply forgot to verify. If the same request is *also* a wrong password on an unverified account, it SHALL count (password-guessing risk exists regardless of verification state).
- **FRS-1.3.5** — Refresh token returned only in an `HttpOnly + Secure + SameSite=Strict` cookie; access token returned in JSON body and held client-side strictly in memory (Zustand/React state) — zero tokens in `localStorage`/`sessionStorage`.

### 1.4 Logout
- **FRS-1.4.1** — Logout invalidates only the refresh token used in that session; other sessions/devices remain valid.

### 1.5 Forgot / Reset Password (OTP-based) — `AB-1003`
- **FRS-1.5.1** — Request reset via email.
- **FRS-1.5.2** — 6-digit OTP, 10-min expiry, console-logged.
- **FRS-1.5.3** — Same 60-second resend cooldown as registration (FRS-1.2.3), same abuse concern.
- **FRS-1.5.4** — OTP single-use — marked **consumed** on successful reset, invalidated for further use even if unexpired.
- **FRS-1.5.5** — 3 incorrect attempts → **invalidated** (FRS-1.2.4a); new OTP required.
- **FRS-1.5.6** — Successful reset revokes all existing refresh tokens for that user (forced re-login everywhere — security default, non-optional).

### Error Scenarios (Auth)
Duplicate verified email → rejected, no account created · Weak password → rejected, names violated rule · Register on existing-unverified email → re-triggers OTP for same account, no duplicate, no email-enumeration leak · Wrong password → generic rejection, doesn't reveal whether email exists · Correct credentials, unverified account → distinct "please verify" message · Rate-limited login → rejected without revealing unlock time · Expired/consumed/invalidated OTP (either flow) → rejected, "request a new one" · Refresh with expired/revoked token → rejected, re-login required.

### Out of Scope (Auth)
OAuth/social login · MFA beyond the OTP flows above · Account deletion/self-service (explicitly deferred — cascading-delete design equivalent in complexity to the Trash cleanup system; needs its own ticket + FRS subsection if ever built).

### Acceptance Criteria (AB-1002 — §1.1–1.4 + email verification)
- [ ] Valid registration → unverified account created, OTP console-logged, 10-min expiry.
- [ ] Registering an existing **verified** email → rejected, nothing re-sent.
- [ ] Registering an existing **unverified** email → `200 OK`, OTP re-triggered, no duplicate account.
- [ ] Correct OTP → account verified, OTP consumed, cannot be reused even before expiry.
- [ ] Resend before 60s → rejected with cooldown message; after 60s → succeeds.
- [ ] 3 wrong OTP attempts → invalidated, distinct from consumed in the data model.
- [ ] Login while unverified → distinct "verify your account" message, not generic invalid-credentials.
- [ ] Login success → 15-min access token in body, 7-day refresh token only in `HttpOnly+Secure+SameSite=Strict` cookie; nothing in web storage.
- [ ] 5 failed logins/15 min for one email → 6th rejected for 15 min, unlock time not disclosed.
- [ ] Repeated login attempts against a correct-password-but-unverified account do **not** consume the rate-limit counter; repeated **wrong-password** attempts on an unverified account do.
- [ ] Logout → only that session's refresh token revoked; other sessions unaffected.
- [ ] Wrong password → generic message, no email-existence leak.

### Acceptance Criteria (AB-1003 — §1.5)
- [ ] Valid reset request → OTP generated, console-logged, 10-min expiry.
- [ ] Resend cooldown = 60s, identical to registration.
- [ ] Successful reset → OTP consumed, unreusable.
- [ ] 3 wrong attempts → invalidated, new OTP required.
- [ ] Successful reset → every refresh token for that user revoked; all other devices force-logged-out.

---

## 2. Notes CRUD

### 2.1 Create / Read / Update
- **FRS-2.1.1** — Authenticated user creates notes with title + rich-text body.
- **FRS-2.1.2** — A user sees/edits/deletes only their own notes.
- **FRS-2.1.3** — Title and/or body updatable at any time.
- **FRS-2.1.4** — `createdAt`/`updatedAt` tracked on every note.
- **FRS-2.1.5** — Title required; empty/whitespace-only rejected at create and update.
- **FRS-2.1.6** — Title cap 200 chars, body cap 100,000 chars, enforced server-side.

### 2.2 Trash Bin (Two-Stage Deletion) — Trash UI folds into `AB-1011`
- **FRS-2.2.1** — Delete sets `deletedAt` only (Rule 15) — Stage 1, no physical delete.
- **FRS-2.2.2** — Trashed note stays restorable for **30 days**.
- **FRS-2.2.3** — While trashed, a note is excluded from lists, search, and tag counts (FRS-2.3, FRS-4.4).
- **FRS-2.2.4** — Any share link for a trashed note (Stage 1 or 2) behaves as revoked, enforced as a **live check on every access attempt** (re-verified against current `deletedAt` at request time — not just applied once at delete time). Link's view counter does not increment while trashed, regardless of the link's own `revokedAt`/`expiresAt`. Restoring the note does **not** resurrect the old link — a new one must be generated. *(Decision: flag if restore-resurrects-link is ever wanted instead.)*
- **FRS-2.2.5** — After 30 days unrestored, note silently leaves Trash view and enters Stage 2 (pending permanent deletion).
- **FRS-2.2.6** — Stage 2 lasts 30 more days (60 total) — record still physically exists (audit/last-resort recovery) but is not user-accessible in any way.
- **FRS-2.2.7** — End of Stage 2 → note + versions + tag links + share-link records permanently removed.
- **FRS-2.2.8** — User can "delete forever" immediately from Trash, skipping remaining wait, with explicit confirmation.

> Stage transitions and permanent removal are handled by the shared cleanup system (§8a), not a feature-specific purge job.

### 2.3 Pagination, Sorting, Tag Filtering
- **FRS-2.3.1** — Paginated, default page size 20, max 100.
- **FRS-2.3.2** — Sortable by `createdAt`/`updatedAt`/`title`, asc/desc.
- **FRS-2.3.3** — Tag filter logic (ALL vs ANY) is an explicit request param, defaulting to **ALL (AND)** when omitted.
- **FRS-2.3.4** — Ties on primary sort field get a server-level secondary tiebreaker: `createdAt desc` — pagination stays stable/reproducible.
- **FRS-2.3.5** — Search query (§4.1) and tag filter (§2.3.3) are combinable in one request.
- **FRS-2.3.6** — Trash view: no independent pagination/sort UI, same default page size as active list, always ordered `deletedAt desc`. The Trash *query itself* enforces the 30-day Stage-1 window — not solely a check inside restore.

### Error Scenarios (Notes)
Access/edit/delete another user's note → looks like "not found" · Update/delete/restore a Stage-2 note → not found · Edit a Stage-1 trashed note directly → rejected, must restore first · Invalid sort field / out-of-range page size → rejected, valid options listed · Invalid `tagMode` → rejected, `ALL`/`ANY` listed · Empty/whitespace title → rejected, names `title` · Title/body over length cap → rejected, names field + limit.

### Out of Scope (Notes)
File/image attachments · Note folders or nesting.

### Acceptance Criteria (AB-1004 — §2.1–2.2)
- [ ] Create with title+body succeeds; empty/whitespace title rejected naming `title`.
- [ ] Title >200 / body >100,000 chars rejected server-side even if the frontend allowed it.
- [ ] Cross-user access returns "not found," never "forbidden."
- [ ] `createdAt`/`updatedAt` correct and in UTC.
- [ ] Delete → `deletedAt` set, row still present (Stage 1).
- [ ] Trashed note restorable for 30 days; invisible in lists/search/tag counts while trashed.
- [ ] Trashing a note immediately breaks its share link, verified live per access, not only at delete time.
- [ ] Day 31 unrestored → invisible in Trash view (Stage 2), still present in DB.
- [ ] Day 60 → note, versions, tag links, share-link rows physically gone.
- [ ] "Delete forever" requires confirmation and is immediate.
- [ ] Editing a Stage-1 note without restoring first → rejected; any action on a Stage-2 note → not found.

### Acceptance Criteria (AB-1005 — §2.3)
- [ ] Default page size 20, max 100; violation rejected with valid range shown.
- [ ] Sort by each of the 3 allowed fields, both directions; invalid field rejected with options shown.
- [ ] Omitted `tagMode` defaults to ALL; explicit ANY works; invalid value rejected with options shown.
- [ ] Tied primary-sort rows come back in stable `createdAt desc` order across repeated/paginated calls.
- [ ] Query + tag filter combine correctly in one request.
- [ ] Trash view has no sort/page-size controls, is always `deletedAt desc`, and the query excludes anything past 30 days itself (verify by checking DB state directly, not just the restore path).

---

## 3. Tags

- **FRS-3.1** — Create/rename/recolor/delete tags, scoped to own account. On-the-fly creation supported in **both** the note editor and the search/filter bar ("Fly Tags") without needing a dedicated tag-management page.
- **FRS-3.2** — Each tag shows a live count of its non-deleted notes.
- **FRS-3.3** — Deleting a tag removes it from all notes without deleting the notes.
- **FRS-3.4** — Tag names unique per user, case-insensitive.

### Error Scenarios (Tags)
Duplicate tag name for same user → rejected · Deleting another user's tag → not found.

### Out of Scope (Tags)
Shared/team tags · Nested/hierarchical tags.

### Acceptance Criteria (AB-1006)
- [ ] Create/rename/recolor/delete all scoped correctly to the owning user.
- [ ] Tag creatable inline from both the note editor and the search/filter bar, no navigation required.
- [ ] Note count on a tag updates live as notes are trashed/restored/tagged/untagged.
- [ ] Deleting a tag detaches it from notes but leaves the notes intact.
- [ ] Duplicate name (any case) for same user → rejected; another user's tag → not found on delete.

---

## 4. Search

- **FRS-4.1** — Full-text search over title + body, own notes only.
- **FRS-4.2** — Matching keywords highlighted in the returned snippet.
  - **FRS-4.2.1** — Snippet generation (`ts_headline`) uses custom sentinels (`[[[MARK]]]` / `[[[MARK_END]]]`) instead of raw HTML tags, for clean styling with zero XSS coupling.
- **FRS-4.3** — Same pagination rules as the notes list (FRS-2.3.1).
- **FRS-4.4** — Only the searching user's own non-deleted notes are returned.
- **FRS-4.5** — Results ranked by relevance, not just recency.

### Error Scenarios (Search)
Empty/whitespace query → rejected, not treated as "match everything" · Special characters → safely escaped, not passed raw (correctness + injection safety).

### Out of Scope (Search)
Fuzzy/typo-tolerant search · Cross-user search (doesn't exist in this app).

### Acceptance Criteria (AB-1007)
- [ ] Search returns only the caller's own non-deleted notes, ranked by relevance.
- [ ] Snippet contains `[[[MARK]]]…[[[MARK_END]]]` around matches, no raw HTML.
- [ ] Same page-size/max rules as the notes list.
- [ ] Empty/whitespace query rejected with a validation error.
- [ ] Special-character query handled safely (no injection, no crash).

---

## 5. Sharing

- **FRS-5.1** — Generate a public, read-only link for any of the user's own notes.
- **FRS-5.2** — Expiry defaults to **7 days**, adjustable 1–30 days at creation.
- **FRS-5.3** — Manual revoke invalidates the link immediately.
- **FRS-5.4** — Every visit increments the view counter by exactly 1, including repeat visits from the same visitor — a raw visit counter, no dedup by IP/cookie/session. **Must be atomic/race-safe**: simultaneous hits are never lost (single atomic increment statement, not read-then-write; see SDS for mechanism). This same atomic operation is also the point where current deletion state is checked (FRS-2.2.4) — one query, not two steps that could disagree.
- **FRS-5.5** — Public link view is strictly read-only: no edit, no viewer-identity exposure, no access to the owner's other notes.
- **FRS-5.6** — Expired, revoked, in-Trash (FRS-2.2.4), or otherwise invalid link → clear "no longer available" state, never a raw error or the note content. Identical presentation regardless of *why* it's invalid (revoked vs. expired vs. trashed) — the public viewer cannot tell which.

### Error Scenarios (Sharing)
Viewing an expired or revoked link → identical "no longer available," no distinction shown · Viewing a link to a currently-trashed note → same message, no distinction (FRS-2.2.4, FRS-5.6) · Generating a link for a trashed note → rejected · A note trashed after its link was created → link stops working immediately, verified live on next access.

### Out of Scope (Sharing)
Password-protected links · Edit/comment permissions on shared links · Per-viewer analytics beyond a total view count.

### Acceptance Criteria (AB-1008)
- [ ] Generate link with default 7-day expiry; custom 1–30 day expiry accepted, out-of-range rejected.
- [ ] Manual revoke → immediately unusable.
- [ ] Rapid/concurrent visits all counted — no lost increments under load (verify with a concurrency test, not just sequential calls).
- [ ] The same request that increments the counter also rejects access if the note is currently trashed — confirm this is one query/transaction, not two.
- [ ] Public view shows no edit affordance, no viewer list, no link to other notes by the owner.
- [ ] Expired, revoked, and trashed-note links all render the identical "no longer available" state — diff the responses to confirm no distinguishing detail leaks.
- [ ] Creating a link for an already-trashed note → rejected.

---

## 6. Version History

- **FRS-6.1** — Every explicit save/significant update creates a new version snapshot. Automatic (debounced autosave, FRS-7.1) snapshots are throttled to **at most 1 per 5-minute window** per note. Explicit saves (Ctrl+S, title change) always create a version immediately.
- **FRS-6.2** — List all versions of a note, reverse chronological, with timestamps.
- **FRS-6.3** — View the full content of any past version.
- **FRS-6.4** — "Restore" a version creates a **new** version at the top of history — never deletes/overwrites intervening versions. History is append-only.
- **FRS-6.5** — Versions older than **90 days** are auto-purge-eligible, except the current live version, which is never purged regardless of age.

> Purging is handled by the shared cleanup system (§8a), not a feature-specific job.

### Error Scenarios (Version History)
Viewing a purged version → "no longer available" · Restoring a version on a since-soft-deleted note → rejected · Requesting another user's note's history → not found.

### Out of Scope (Version History)
Diff/comparison view between two versions · Manual pinning of specific versions to exempt from purge.

### Acceptance Criteria (AB-1009)
- [ ] Explicit save always creates a version immediately, even inside the 5-min autosave throttle window.
- [ ] Autosave-triggered versions are capped at 1 per 5 minutes per note.
- [ ] Version list is reverse-chronological with correct timestamps.
- [ ] Restore appends a new version; all prior versions remain untouched and queryable.
- [ ] Versions >90 days old are purge-eligible; the current live version is exempt regardless of age.
- [ ] Viewing a purged version → "no longer available"; restoring on a trashed note → rejected; cross-user history request → not found.

---

## 7. Frontend / UX Requirements

Business-level UX only — visual design/component structure is in `SDS.md`.

- **FRS-7.1** — Note editor autosaves in the background, no manual "save" click, while still respecting version-snapshot rules (§6.1).
- **FRS-7.2** — At-a-glance indicator of: unsaved/in-flight changes, shared status, active share link.
- **FRS-7.3** — Search highlighting (§4.2) is visible in the frontend results list, not just present in the API response.
- **FRS-7.4** — Version history lets a user preview a past version before restoring — restore is never a single-click destructive action without confirmation.
- **FRS-7.5** — Fully responsive and usable (editor, search, sharing, version history, trash — every feature, not just marketing surfaces) across phone/tablet/laptop/large-desktop. Exact breakpoints in `SDS.md`.

### Out of Scope (Frontend)
Offline mode / local-first editing · Mobile-native app behavior beyond standard responsive web.

### Acceptance Criteria (AB-1010 — Auth pages)
- [ ] Full register→verify→login→forgot→reset flow operable in UI against AB-1002/AB-1003 contracts.
- [ ] Access token never touches `localStorage`/`sessionStorage`.
- [ ] Usable at all four breakpoint classes.

### Acceptance Criteria (AB-1011 — Notes list + Trash)
- [ ] List page pagination/sort/tag-filter controls trigger a **new server request** on every change — no client-side re-sort/re-filter of an already-fetched page.
- [ ] Trash is a filtered view (restore + delete-forever), not a bespoke page.
- [ ] Per-note indicator shows unsaved/shared/active-link status at a glance.
- [ ] Usable at all four breakpoint classes.

### Acceptance Criteria (AB-1012 — Editor + autosave)
- [ ] Background autosave requires no manual save action; respects the 5-min snapshot throttle.
- [ ] Saving/saved/error states are visibly distinct and update in real time.
- [ ] Usable at all four breakpoint classes.

### Acceptance Criteria (AB-1013 — Search UI)
- [ ] Highlighted matches render visibly in the results list (not just in raw API JSON).
- [ ] Every sort/filter/query change issues a fresh backend call, never a local re-slice.

### Acceptance Criteria (AB-1014 — Share modal)
- [ ] Generate/revoke/view-active-links UI matches AB-1008 contracts, including the 1–30 day expiry selector and view-count display.
- [ ] Share status reflected on the note per FRS-7.2.

### Acceptance Criteria (AB-1015 — Version history drawer)
- [ ] User can preview a version's full content before restoring.
- [ ] Restore requires an explicit confirmation step — never a single click.

---

## 8. Cross-Cutting Non-Functional Requirements

- **FRS-8.1** — All list/search endpoints **and** all public share-link access (FRS-2.2.4, FRS-5.6) exclude/reject soft-deleted notes by default, with no client override parameter — one guarantee applied consistently across every read path.
- **FRS-8.2** — All timestamps stored/returned in UTC.
- **FRS-8.3** — No feature sends real email — OTPs and notifications are console-logged only.
- **FRS-8.4** — Sorting, filtering (FRS-2.3.3), and searching (FRS-4.1) are performed **server-side** over the full dataset before pagination. Frontend never locally re-sorts/re-filters/re-searches an already-fetched page — every criteria change triggers a new backend request, regardless of how small the result set looks.
- **FRS-8.5** — Single Source of Truth / 3-Tier Constants (Rule 11): all Zod schemas, inferred DTO types, and shared constants (`API_PATHS`, `APP_LIMITS`, `VALIDATION_MESSAGES`) live in `packages/shared` only. Backend-only constants in `apps/api/src/constants`; frontend-only in `apps/web/src/constants`. Every numeric value mandated in this document maps to exactly one named constant in `packages/shared` — implementation code references it, never re-derives or hardcodes it.
- **FRS-8.6** — All API endpoints namespace-versioned under `/api/v1`.
- **FRS-8.7** — Interactive OpenAPI/Swagger docs mounted at `/api/v1/docs`, accurately reflecting `packages/shared` schemas.

### Acceptance Criteria (cross-cutting — verified as part of every ticket touching a read path)
- [ ] No read endpoint or share-link path can be made to return soft-deleted note content via any request parameter.
- [ ] All timestamps in API responses are UTC.
- [ ] Grep confirms zero real-email-sending code paths anywhere.
- [ ] Changing sort/filter/search in the UI always produces a new network request (verify via network tab / test spy) — never a local array operation on stale data.
- [ ] Every FRS numeric constant (OTP timing, rate limits, retention windows, page sizes, token expiries) resolves to one named export in `packages/shared`, referenced (not re-typed) everywhere it's used.
- [ ] Every route lives under `/api/v1`.
- [ ] `/api/v1/docs` renders and matches the live shared schemas.

---

## 8a. Shared Data Cleanup System (Cross-Cutting)

Core rule: **no data past its retention period remains accessible or persists indefinitely.**

- **FRS-8a.1** — Data past its defined retention period (Trash §2.2, versions §6, OTPs §1) SHALL be permanently, reliably removed — not accessible to user or attacker, not retained indefinitely by default.
- **FRS-8a.2** — Applies to at least these five categories (extensible without redefining the guarantee):
  - Notes in Trash Stage 2 → permanent removal (FRS-2.2.6–2.2.7)
  - Note versions past retention → permanent removal (FRS-6.5)
  - Expired/consumed/invalidated OTP records → permanent removal
  - Stale login-attempt records (`LoginAttempt`, FRS-1.3.4) older than 24 hours → permanent removal
  - Revoked or expired refresh-token sessions (`RefreshSession`, FRS-1.3.3) older than 24 hours → permanent removal
- **FRS-8a.3** — Removal happens automatically, no manual trigger.
- **FRS-8a.4** — Removal is safe to run repeatedly and concurrently with normal use — never removes a note a user is actively restoring/viewing at that instant; repeat runs never double-process or error.
- **FRS-8a.5** — Each category's specific retention number is defined where it already lives (§1, §2, §6); this section governs only the guarantee itself.

> Live per-access enforcement for share links (FRS-2.2.4, FRS-8.1) is a **separate** guarantee from this nightly-purge system — a link must break the instant its note is trashed, not merely by the next scheduled run. Mechanism (cron / lazy-check-on-read / queued job) is an SDS decision.

### Acceptance Criteria (part of AB-1004/AB-1009/AB-1002/AB-1003 as applicable)
- [ ] All five categories in FRS-8a.2 (including revoked/expired refresh sessions) are actually purged by an automated job, verified by direct DB inspection after the retention window (not just "the code exists").
- [ ] Running the cleanup twice back-to-back causes no errors and no double-processing.
- [ ] A note actively being restored/viewed during a cleanup run is never removed mid-operation.
- [ ] Share-link blocking on trash (FRS-2.2.4) works even if the nightly job hasn't run yet — confirmed as a separate live check, not dependent on the purge job's schedule.

---

## 9. Master Out-of-Scope List (binding across all tickets)

Real-time collaborative editing · File/image attachments · Mobile app · OAuth/social login · Note folders or nesting · Actual email sending.

---

## Key Numeric Constants (single reference — see `packages/shared/APP_LIMITS` for the canonical export)

| Constant | Value | FRS Ref |
|---|---|---|
| OTP length / expiry | 6 digits / 10 min | 1.2.1, 1.5.2 |
| OTP resend cooldown | 60 sec | 1.2.3, 1.5.3 |
| OTP max attempts | 3 | 1.2.4, 1.5.5 |
| Login rate limit | 5 attempts / 15 min lockout | 1.3.4 |
| Access token expiry | 15 min | 1.3.2 |
| Refresh token expiry | 7 days | 1.3.3 |
| Password rule | ≥8 chars, 1 number, 1 symbol | 1.1.3 |
| Note title / body cap | 200 / 100,000 chars | 2.1.6 |
| Trash Stage 1 / Stage 2 | 30 days / 30 days (60 total) | 2.2.2, 2.2.6 |
| Default / max page size | 20 / 100 | 2.3.1 |
| Default tag filter mode | ALL (AND) | 2.3.3 |
| Share link expiry | default 7 days, range 1–30 | 5.2 |
| Version snapshot throttle | 1 per 5 min (autosave only) | 6.1 |
| Version retention | 90 days | 6.5 |
| Stale OTP/login-attempt purge | 24 hours | 8a.2 |

