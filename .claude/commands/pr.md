Prepare PR, execute specification archive (`openspec archive`), and commit for: $ARGUMENTS

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Verify that `$ARGUMENTS` matches the exact descriptive change directory inside `openspec/changes/`. If `$ARGUMENTS` was supplied as only a bare ticket ID (`AB-xxxx`), search `openspec/changes/` for the exact folder matching `AB-xxxx-*` (`e.g., openspec/changes/AB-1001-project-setup-monorepo`) and use that exact descriptive name across the archival, commit, and PR generation (`[Rule 3]`).

## Preconditions & Mandatory PR Gates (`[Rule 16–18]`)

1. **Active Change Verification**: Verify that the change folder currently resides cleanly inside `openspec/changes/$ARGUMENTS/`. (Do **NOT** allow `/pr` if the change specification has already been manually moved or archived prematurely).
2. **Review Compliance Check**: Read `openspec/changes/$ARGUMENTS/review-log.md` and verify it reports `all ✅ PASSED` (`[Rule 16–17]`). If any `❌ MISSING`, `⚠️ DRIFTED`, `🔒 SECURITY`, or `📋 FRS GAP` findings exist, HALT immediately and instruct user to run `/implement $ARGUMENTS` to resolve the items listed in `review-log.md`. Note: `review-log.md` is the sole tracking log (`fix-bundles` are not used).
3. **Local DoD Verification (`CLAUDE.md §6 / DoD`)**: Verify the non-negotiable local quality suite passes cleanly:
   - `pnpm turbo run build` -> must compile cleanly (`0 errors via tsup / ^build`).
   - `pnpm turbo run lint` -> `--max-warnings 0`.
   - `pnpm turbo run typecheck` -> `tsc --noEmit` (`0 static errors`).
   - `pnpm turbo run test -- --coverage` -> `100% green against notes_app_test, >=80% coverage on new code`.

---

## Step-by-Step Archival, Commit & PR Execution

### STEP 1 — Execute Specification Archive (`openspec archive`)

**Crucial Workflow Note (`[Rule 18]`)**: Archival happens **ONLY HERE (`/pr time`)**.
Execute the OpenSpec archive command to merge delta specifications into canonical system specs and migrate the change specification folder to the archive pattern:

```bash
npx openspec archive $ARGUMENTS -y
```

_(Note: This command merges delta scenarios from `openspec/changes/$ARGUMENTS/specs/<domain>/spec.md` into `openspec/specs/<domain>/spec.md` and moves the change folder out of `openspec/changes/$ARGUMENTS/`)._

### STEP 1b — Hardcoded Archive Folder Separation & Meaningful Naming (`[Rule 18]`)

Because `@fission-ai/openspec` defaults to placing archives inside `openspec/changes/archive/` and prepends random/date prefix numbers (`YYYY-MM-DD-`), immediately enforce hardcoded top-level separation and clean meaningful naming by moving and renaming the folder into `openspec/archive/$ARGUMENTS/`, and automatically flatten `specs/<domain>/spec.md` directly into `openspec/archive/$ARGUMENTS/spec.md`:

```bash
mkdir -p openspec/archive && mv openspec/changes/archive/*$ARGUMENTS* openspec/archive/$ARGUMENTS 2>/dev/null || (mv openspec/changes/archive/* openspec/archive/ 2>/dev/null || true) && rm -rf openspec/changes/archive && find openspec/archive/$ARGUMENTS/specs/ -name "spec.md" -exec mv {} openspec/archive/$ARGUMENTS/spec.md \; 2>/dev/null && rm -rf openspec/archive/$ARGUMENTS/specs
```

_(This ensures `openspec/changes/` remains strictly for active changes, and `openspec/archive/$ARGUMENTS/` is a separate top-level folder stripped of any random numbers, given its clean, meaningful ticket change name, with all tracking files and `spec.md` cleanly flattened right at the root)._

### STEP 2 — Diff & Git Staging Gate (`CLAUDE.md §2`)

1. Run diff inspection via `code-review-graph` (`detect_changes_tool`) or `git status --short`.
2. **Strict Git Permission Gate (`CLAUDE.md §2`)**:
   - Ask: `"Run git add . (staging implementation code + separated archive specification in openspec/archive/ + merged canonical specs)? [y/n]"` -> wait for explicit user `y`.

### STEP 3 — Conventional Commit Execution (`AGENTS.md §6`)

1. Read the archived specification summary (`openspec/archive/$ARGUMENTS/specs/<domain>/spec.md`).
2. Prepare conventional commit message matching `AGENTS.md §6` (`Rule 14`):
   ```text
   type(scope): description AB#ticket

   - bullet 1 summarizing architectural/layer changes
   - bullet 2 summarizing test coverage and spec validation
   Relates to AB#XXXX
   ```
3. Ask: `"Run git commit -m ...? [y/n]"` -> wait for explicit user `y`.
4. Verify `npx commitlint --from HEAD~1` passes cleanly (`Husky hook verification`).

### STEP 4 — Generate PR Description & Push Gate

1. Generate structured PR markdown:
   ```markdown
   ## What

   Brief explanation of changes matching `$ARGUMENTS` (`AB-xxxx-descriptive-name`) and FRS/SDS criteria.

   ## FRS Requirements Covered

   - `[FRS-x.y.z]`: description ✅

   ## OpenSpec Lifecycle & Artifacts

   - [x] Specification archived via `openspec archive $ARGUMENTS` and separated into top-level archive (`[Rule 18]`)
   - `openspec/archive/$ARGUMENTS/spec.md` (Separated Archived Specification Audit Trail — Flattened)
   - `openspec/specs/<domain>/spec.md` (Merged Canonical Source of Truth)

   ## Verification & Checklist

   - [x] `pnpm turbo run build` (0 errors via `tsup` / `^build`)
   - [x] `pnpm turbo run lint --max-warnings 0`
   - [x] `pnpm turbo run typecheck` (`tsc --noEmit`)
   - [x] `pnpm turbo run test -- --coverage` (>=80% new coverage against isolated `notes_app_test`)
   - [x] Read-only `/review` verification confirmed all ✅ in `review-log.md`
   - [x] Conventional commit header verified via `commitlint` (`AB#XXXX`)
   - [x] `@shared/core` single source of truth verified (`Rule 11`)
   ```
2. **Strict Push Gate (`CLAUDE.md §2`)**:
   - Ask: `"Run git push to remote branch? [y/n]"` -> wait for explicit user `y`.

Format: `/pr AB-xxxx-short-description`
