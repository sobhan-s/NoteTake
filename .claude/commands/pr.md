Prepare PR and commit for: $ARGUMENTS

Steps:
1. Run local non-negotiable quality suite (`CLAUDE.md §6 / DoD`):
   - `pnpm turbo run build` -> must compile cleanly (`0 errors`).
   - `pnpm turbo run lint` -> `--max-warnings 0`.
   - `pnpm turbo run typecheck` -> `tsc --noEmit` (`0 static errors`).
   - `pnpm turbo run test -- --coverage` -> `100% green against notes_app_test`, `≥80% coverage on new code`.
   - If any verification step fails, fix all errors before proceeding.
2. Run diff inspection via `code-review-graph` (`detect_changes_tool`) or `git diff main --stat`.
3. Read: `openspec/archive/$ARGUMENTS/proposal.md` and spec delta.
4. Prepare conventional commit message matching `AGENTS.md §6` (`Rule 14`):
   ```text
   type(scope): description AB#ticket

   - bullet 1 summarizing architectural/layer changes
   - bullet 2 summarizing test coverage and spec validation
   Relates to AB#XXXX
   ```
5. **Strict Git Permission Gate (`CLAUDE.md §2`)**:
   - Ask: "Run `git add .`? [y/n]" -> wait for user `y`.
   - Ask: "Run `git commit -m ...`? [y/n]" -> wait for user `y`.
   - Run `npx commitlint --from HEAD~1` -> must pass cleanly (`Husky hook check`).
6. Generate structured PR description:
   ```markdown
   ## What
   Brief explanation of changes matching $ARGUMENTS and FRS/SDS criteria.

   ## FRS Requirements Covered
   - `[FRS-x.y.z]`: description ✅

   ## Spec Artifacts
   - `openspec/archive/$ARGUMENTS/proposal.md`
   - `openspec/specs/domain/spec.md` (updated canonical source of truth)

   ## Verification & Checklist
   - [x] `pnpm turbo run build` (0 errors)
   - [x] `pnpm turbo run lint --max-warnings 0`
   - [x] `pnpm turbo run typecheck` (`tsc --noEmit`)
   - [x] `pnpm turbo run test -- --coverage` (≥80% new coverage, isolated `notes_app_test`)
   - [x] Conventional commit header verified via `commitlint`
   - [x] `@shared/core` single source of truth verified
   ```
7. **Strict Push Gate (`CLAUDE.md §2`)**:
   - Ask: "Run `git push` to remote branch? [y/n]" -> wait for user `y`.

Format: `/pr AB-xxxx-short-description`
