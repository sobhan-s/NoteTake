# Review Log — AB-1008: Sharing — Generate Link, Revoke, Public Access, Atomic View Count

Reviewer: `.claude/agents/reviewer.md` sub-agent (read-only compliance audit) + Main Claude triage.

## Spec Scenario Coverage

✅ PASSED: Generate Share Link — first-time creates new link -> `apps/api/src/services/share.service.ts` (`getOrCreateShareLink`) -> `apps/api/tests/contract/share.test.ts`
✅ PASSED: Omitted expiresInDays defaults to 7 days -> `packages/shared/src/schemas/share.schema.ts` (`.default(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS)`)
✅ PASSED: Out-of-range expiresInDays rejected 400 SHARE_EXPIRY_DAYS_INVALID -> `share.schema.ts` -> tests cover 0, 31, negative, non-integer
✅ PASSED: Re-POST while active link exists returns unchanged 200, expiresInDays ignored -> `share.service.ts` (`getOrCreateShareLink`)
✅ PASSED: Generate for trashed/cross-user/nonexistent note -> 404 NOTE_NOT_FOUND, never 403 -> `assertOwnedActiveNote`
✅ PASSED: `GET .../share` active/none/trashed/cross-user cases -> `share.service.ts` (`getActiveShareLink`)
✅ PASSED: `DELETE .../share` revoke/none/trashed/cross-user cases -> `share.service.ts` (`revokeShareLink`)
✅ PASSED: Public valid link -> exactly `{title,body,updatedAt}` + view count +1 -> `share.repository.ts` (`consumePublicShareView`)
✅ PASSED: Every visit counts, no dedup -> `public-share.test.ts` (5 sequential -> +5)
✅ PASSED: Concurrent visits never lost -> `public-share.test.ts` (10 concurrent -> exactly +10, atomic SQL)
✅ PASSED: Expired/revoked/trashed/nonexistent -> identical 404 SHARE_LINK_UNAVAILABLE
✅ PASSED: No route to other data (no id/owner leak in public response)
✅ PASSED: Trashing revokes active link inside the same transaction -> `note.service.ts` (`softDeleteNote` -> `prisma.$transaction`)
✅ PASSED: Trashing with no active link is a no-op -> `revokeActiveShareLinksForNote` (`updateMany`, 0 rows silently)
✅ PASSED: `hasActiveShareLink` on create/get/update/list/trash-list -> `note.service.ts` (`toNoteResponseDto`)

**Fixed during triage:**
📋 FRS GAP (FIXED): No dedicated test existed for "restore does not resurrect the revoked share link" (spec.md Scenario, Resolved Decision #3). Added
`[Resolved Decision #3, FRS-2.2.4] Restoring a note does not resurrect its revoked share link` describe block to
`apps/api/tests/contract/share.test.ts` — trashes a note with an active link, asserts the link is revoked, restores the note, asserts
the link is STILL revoked and `GET .../share` still 404s, then asserts a fresh `POST` creates a brand-new link with a different token.
Verified green: `pnpm --filter @apps/api exec vitest run tests/contract/share.test.ts` (25/25 passed).

⚠️ MINOR (FIXED): `apps/api/tests/helpers/notes.ts`'s `createShareLinkDirect` hardcoded a literal `7 * 24 * 60 * 60 * 1000` default expiry
instead of referencing `APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS` (AGENTS.md §11: "NO hardcoded numeric literals for anything listed
in APP_LIMITS"). Fixed to import and use `APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS`.

**Accepted scope decisions (no fix needed):**
⚠️ DRIFTED (ACCEPTED): `hasActiveShareLink` is not populated on `SearchResultResponseDto` (`packages/shared/src/types/search.type.ts`,
`apps/api/src/services/search.service.ts`). spec.md's intro prose parenthetically mentions "search DTOs that reuse it," but the
normative "Share Status Visible on the Note DTO" Requirement explicitly scopes to `NoteResponseDto` and lists only
create/get-by-id/update/list/trash-list — search is a structurally distinct `SearchResultResponseDto`, not a `NoteResponseDto` consumer.
`plan.md`'s Layered File Map (§1, 15 rows) never lists `search.type.ts`/`search.service.ts` as files to change, confirming this was
already scoped out at `/plan` time. Accepted as out of scope for AB-1008; a future ticket can extend search results if the product
decides it's needed.

⚠️ DOC DRIFT (ACCEPTED, non-blocking): `docs/SDS.md` §2.2(3)'s literal `RETURNING` clause predates spec.md's amendment adding
`n.updated_at` to the atomic query. The code correctly follows spec.md (the authoritative amendment), and spec.md itself already
flags `docs/SDS.md` as needing a follow-up doc-sync (Resolved Decision #2) — deferred, not part of this ticket's file list.

## FRS Requirement Coverage

✅ FRS-5.1 (generate link), FRS-5.2 (expiry range/default), FRS-5.3 (revoke), FRS-5.4 (atomic view increment, no dedup),
FRS-5.5 (read-only public view), FRS-5.6 (identical 404), FRS-2.2.4 (live trash check + revoke-on-trash),
FRS-7.2 (hasActiveShareLink), FRS-8.5 (shared constants), FRS-8.6 (public route isolation) — all covered with code + test citations
verified by the reviewer sub-agent against exact file:line references.

## SDS Contract Adherence

✅ All three owner-facing routes and the public route match SDS's route matrix (plus the Resolved-Decision-#2 GET addition).
✅ Layering strictly respected — controllers do exactly `schema.parse` (or nothing) + one service call + `{success,data}` wrap.
✅ No shared-type duplication — all schemas/types/constants imported from `@shared/core`.
✅ No `any` in any new/amended backend file. No physical `DELETE` used for revoke (uses `UPDATE ... revokedAt`).

## Out-of-Scope Violations

✅ No new Prisma migration (verified `share_links` table fully provisioned in `20260710124549_init`).
✅ No `apps/web` changes.
✅ No `:linkId` param, no multi-link model, no password-protected links, no public-endpoint rate-limiting added.
✅ No constructed shareable URL anywhere in the backend.

## Security Concerns

✅ Auth guard (`requireAuth`) covers all three owner endpoints via `note.router.ts`'s existing top-level `router.use(requireAuth)`,
inherited by the nested `share.router.ts` mount.
✅ `public-share.router.ts` has zero `requireAuth` reference, mounted at a structurally separate `/api/v1/public` prefix.
✅ IDOR defense verified in code and tests — every owner-facing function 404s (never 403) for cross-user/trashed/nonexistent notes.
✅ Public response payload is exactly `{title, body, updatedAt}` — no id/viewCount/owner-info leakage possible by construction.
✅ Atomic view-count query uses a genuine `$queryRaw` TAGGED TEMPLATE (not `$queryRawUnsafe`/string concatenation) — token
parameterized, confirmed by unit test asserting the token never appears literally inside the SQL text.
✅ Token generation via `crypto.randomBytes(32).toString("hex")` (CSPRNG), bounded 3-attempt P2002 collision retry (no infinite loop).
✅ No token/secret logging anywhere in the new files.

**No `🔒 SECURITY` findings raised — zero critical security defects.**

## Test Coverage Gaps

✅ All Generate/Fetch/Revoke/Public-view scenarios covered across `share.test.ts`, `public-share.test.ts`, `share.service.test.ts`,
`share.repository.test.ts`, `note.repository.test.ts`, and the `note.service.test.ts` extension.
✅ DB isolation guard present in every new contract-test `describe` block (`FATAL SAFETY BREAK` guard + `resetTestDatabase()`).
✅ `it()` titles are FRS-ID/Resolved-Decision-tagged, derived from SHALL text — no copy-pasted Acceptance Criteria bullets.
✅ Restore-flow gap (see above) — FIXED.

Full suite: `pnpm turbo run test -- --coverage` → **384+ tests passed** (35 files), coverage 97.58% stmts / 94.91% branch / 99.19%
funcs / 98.14% lines — well above the 80%-on-new-code gate. `pnpm turbo run build` / `lint -- --max-warnings 0` / `typecheck` all
clean after every phase checkpoint and after the post-review fixes.

---

## Triage Resolution

| Finding                                            | Severity     | Action                                                                                      |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| Missing restore-flow end-to-end test               | 📋 FRS GAP   | **FIXED** — test added to `share.test.ts`, verified green                                   |
| Hardcoded `7 * 24 * 60 * 60 * 1000` in test helper | ⚠️ MINOR     | **FIXED** — now references `APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS`                      |
| `hasActiveShareLink` omitted from search DTO       | ⚠️ DRIFTED   | **ACCEPTED** — out of scope per plan.md's file map and the normative spec Requirement text  |
| `docs/SDS.md` §2.2(3) staleness                    | ⚠️ DOC DRIFT | **ACCEPTED** — explicitly deferred to a follow-up doc-sync per spec.md Resolved Decision #2 |

## Final Verdict

✅ **All checks passed (100% FRS/SDS compliance) after triage fixes.**

Review complete: All checks passed. Change remains in `openspec/changes/AB-1008-sharing-links` until `/pr` is run.
**Approved for `/pr AB-1008-sharing-links`.**
