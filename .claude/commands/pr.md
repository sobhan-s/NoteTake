Prepare PR and commit for: $ARGUMENTS

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Verify that `$ARGUMENTS` matches the exact descriptive archive/change directory inside `openspec/archive/` (or `openspec/changes/`). If `$ARGUMENTS` was supplied as only a bare ticket ID (`AB-xxxx`), search `openspec/archive/` and `openspec/changes/` for the exact folder matching `AB-xxxx-*` (e.g., `openspec/archive/AB-1001-project-setup-monorepo`) and use that exact descriptive name across the commit and PR generation.

## Preconditions & Mandatory PR Gates
1. Verify `openspec/changes/$ARGUMENTS/review-log.md` (or `openspec/archive/$ARGUMENTS/review-log.md`) exists and reports `all ✅ PASSED` (`[Rule 16–17]`). If any `❌ MISSING`, `⚠️ DRIFTED`, or `🔒 SECURITY` findings exist, HALT and instruct user to run `/implement $ARGUMENTS`.
2. Verify `openspec/changes/$ARGUMENTS/fix-bundles.md` has all fix bundles marked resolved/completed.
3. Verify local non-negotiable quality suite (`CLAUDE.md §6 / DoD`) passes cleanly:
   - `pnpm turbo run build` -> must compile cleanly (`0 errors` via `tsup`).
   - `pnpm turbo run lint` -> `--max-warnings 0`.
   - `pnpm turbo run typecheck` -> `tsc --noEmit` (`0 static errors`).
   - `pnpm turbo run test -- --coverage` -> `100% green against notes_app_test`, `≥80% coverage on new code`.
4. Verify `openspec archive $ARGUMENTS` has completed (`[Rule 18]`), migrating the folder from `openspec/changes/` to `openspec/archive/`.

---

## Commit & PR Execution
1. Run diff inspection via `code-review-graph` (`detect_changes_tool`) or `git diff main --stat`.
2. Read: `openspec/archive/$ARGUMENTS/spec.md`.
3. Prepare conventional commit message matching `AGENTS.md §6` (`Rule 14`):
   ```text
   type(scope): description AB#ticket

   - bullet 1 summarizing architectural/layer changes
   - bullet 2 summarizing test coverage and spec validation
   Relates to AB#XXXX
   ```
4. **Strict Git Permission Gate (`CLAUDE.md §2`)**:
   - Ask: "Run `git add .`? [y/n]" -> wait for user `y`.
   - Ask: "Run `git commit -m ...`? [y/n]" -> wait for user `y`.
   - Run `npx commitlint --from HEAD~1` -> must pass cleanly (`Husky hook check`).
5. Generate structured PR description:
   ```markdown
   ## What
   Brief explanation of changes matching `$ARGUMENTS` (`AB-xxxx-descriptive-name`) and FRS/SDS criteria.

   ## FRS Requirements Covered
   - `[FRS-x.y.z]`: description ✅

   ## Spec Artifacts
   - `openspec/archive/$ARGUMENTS/proposal.md`
   - `openspec/specs/domain/spec.md` (updated canonical source of truth)

   ## Verification & Checklist
   - [x] `pnpm turbo run build` (0 errors via `tsup` / `^build`)
   - [x] `pnpm turbo run lint --max-warnings 0`
   - [x] `pnpm turbo run typecheck` (`tsc --noEmit`)
   - [x] `pnpm turbo run test -- --coverage` (≥80% new coverage against isolated `notes_app_test`)
   - [x] Read-only `/review` verification confirmed all ✅ in `review-log.md`
   - [x] Conventional commit header verified via `commitlint` (`AB#XXXX`)
   - [x] `@shared/core` single source of truth verified (`Rule 11`)
   ```
6. **Strict Push Gate (`CLAUDE.md §2`)**:
   - Ask: "Run `git push` to remote branch? [y/n]" -> wait for user `y`.

Format: `/pr AB-xxxx-short-description`
