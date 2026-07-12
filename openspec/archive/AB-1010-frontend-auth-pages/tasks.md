# Sequenced Tasks for AB-1010-frontend-auth-pages

Scope: **FRONTEND** (`apps/web` only). Zero `apps/api`/`packages/shared` changes — all required schemas/types/constants already exist (`AB-1002`/`AB-1003`), confirmed in `plan.md §4` (`Rule 11, FRS-8.5`).

## Phase 1: Foundation — Dependencies, Build Config & Design-System Primitives

- [x] Run `pnpm --filter @apps/web add react-router-dom@7.18.1 zustand@5.0.14 @tanstack/react-query@5.101.2 axios@1.18.1 react-hook-form@7.81.0 @hookform/resolvers@5.4.0 tailwindcss@4.3.2 @tailwindcss/vite@4.3.2 sonner@2.0.7 lucide-react@1.24.0 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.6.0 @radix-ui/react-slot@1.3.0 @radix-ui/react-label@2.1.11` — exact pinned versions, zero `^`/`~`/`*` ranges (`[Rule 20, FRS-8.5]`).
- [x] `apps/web/package.json`: verify/add `"@shared/core": "workspace:*"` to `dependencies` (`[Rule 11, FRS-8.5]`).
- [x] `apps/web/vite.config.ts`: add `import tailwindcss from "@tailwindcss/vite"`, append to `plugins: [react(), tailwindcss()]` — no `tailwind.config.js`/`postcss.config.js` (`[FRS-0.3.1 live-doc verification, Design-system & app-shell bootstrap scenario]`).
- [x] `apps/web/src/index.css` (new): `@import "tailwindcss";` single CSS entry point (`[Design-system & app-shell bootstrap scenario]`).
- [x] `apps/web/src/main.tsx`: add `import "./index.css"` as first import; wrap `<App />` in `<QueryClientProvider client={new QueryClient()}>` (`[Design-system & app-shell bootstrap scenario]`).
- [x] `apps/web/src/lib/cn.ts` (new): `cn()` = `twMerge(clsx(inputs))` (`[Design-system & app-shell bootstrap scenario]`).
- [x] `apps/web/src/lib/errorMessages.ts` (new): `mapApiError(code?: string): string` switching over `API_ERROR_CODES` from `@shared/core` (`EMAIL_ALREADY_VERIFIED, OTP_EXPIRED, OTP_INVALID, OTP_MAX_ATTEMPTS_EXCEEDED, RESEND_COOLDOWN_ACTIVE, INVALID_CREDENTIALS, ACCOUNT_NOT_VERIFIED, RATE_LIMIT_EXCEEDED, VALIDATION_ERROR`); generic fallback for unmapped codes, never raw `error.message` (`[Centralized error mapping scenario, docs/ux.md §2]`).
- [x] `apps/web/src/constants/ui.constant.ts` (new, Tier 3): `OTP_RESEND_TICK_MS = 1000` — UI-only, not duplicated from `APP_LIMITS` (`[AGENTS.md §5 Tier 3, FRS-8.5]`).
- [x] `apps/web/src/components/ui/Spinner.tsx`: `lucide-react` `Loader2` + `animate-spin` (`[Design-system & app-shell bootstrap scenario, docs/ux.md §1]`).
- [x] `apps/web/src/components/ui/Button.tsx`: `cva` variants (`default`, `outline`, `ghost`), `asChild` via `@radix-ui/react-slot`, `isLoading` prop swapping label for `<Spinner>` at fixed dimensions (`[Design-system & app-shell bootstrap scenario, docs/ux.md §1]`).
- [x] `apps/web/src/components/ui/Input.tsx`: styled `forwardRef` input with error-state border/focus-ring (`[Design-system & app-shell bootstrap scenario, docs/ux.md §9]`).
- [x] `apps/web/src/components/ui/Label.tsx`: wraps `@radix-ui/react-label` (`[Responsive layout & accessibility scenario, docs/ux.md §9]`).
- [x] `apps/web/src/components/ui/Card.tsx`: `Card`/`CardHeader`/`CardContent`/`CardFooter` layout shell (`[Design-system & app-shell bootstrap scenario]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/web`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop. Layer order: `store/ → api/ → hooks/ → components/ → pages/` per `apps/web/CLAUDE.md`.)_

- [x] `apps/web/src/store/useAuthStore.ts`: Zustand `create<AuthState>()` — `{ accessToken: string | null; user: AuthUserDto | null }` + `setSession()`/`reset()` actions; **no** `persist` middleware; `AuthUserDto` imported from `@shared/core` (`[FRS-1.3.5, useAuthStore scenario]`).
- [x] `apps/web/src/api/httpClient.ts`: Axios instance, `baseURL: API_PATHS.BASE`, `withCredentials: true`; request interceptor attaches `Authorization: Bearer` from `useAuthStore`; response interceptor: on `401` + `!config._retry`, plain-axios call to `API_PATHS.AUTH.ROOT + API_PATHS.AUTH.REFRESH`, on success `setSession()` + replay via `httpClient(config)`, on failure `reset()` + redirect `/login` (`[FRS-1.3.5, SDS §3.1, Axios API client with silent rotation scenario]`).
- [x] `apps/web/src/api/auth.api.ts`: thin functions `register/verifyOtp/resendOtp/login/forgotPassword/resetPassword/logout/me`, each hitting `API_PATHS.AUTH.*` and returning `response.data.data`; zero hardcoded route strings (`[FRS-8.5, Axios API client with silent rotation scenario]`).
- [x] `apps/web/src/hooks/useRegister.ts`, `useVerifyOtp.ts`, `useResendOtp.ts`, `useLogin.ts`, `useForgotPassword.ts`, `useResetPassword.ts`, `useLogout.ts`: thin `useMutation` wrappers over `api/auth.api.ts` — mutation state only, no server data cached (`[apps/web/CLAUDE.md state-boundary rule, FRS-1.1–1.5]`).
- [x] `apps/web/src/components/ProtectedRoute.tsx`: redirect to `/login?next=<path>` when `useAuthStore.accessToken` is `null`, else render children (`[Protected route guard & navigation scenario, docs/ux.md §6]`).
- [x] `apps/web/src/components/AuthCard.tsx`: shared centered-card layout wrapper for all 5 auth pages (`[Responsive layout & accessibility scenario]`).
- [x] `apps/web/src/pages/RegisterPage.tsx`: `registerSchema` + `zodResolver`, `mode: 'onBlur'`, `useRegister`; navigate to `/verify-otp` with `{ userId }` on `200/201` (no new-vs-re-triggered disclosure); toast on `409` via `mapApiError` (`[FRS-1.1.1–1.1.5, Register page scenario]`).
- [x] `apps/web/src/pages/VerifyOtpPage.tsx`: redirect to `/register` if no `userId`/`email` in router state; `verifyOtpSchema`; `400` shows attempts-remaining + clears input; `429` disables input, surfaces only Resend; Resend starts `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` countdown via `OTP_RESEND_TICK_MS`, re-syncs from server `429` (`[FRS-1.2.1–1.2.5, Email verification page scenario]`).
- [x] `apps/web/src/pages/LoginPage.tsx`: `loginSchema`, `mode: 'onBlur'`; `200` → `setSession()` + `?next=` redirect; `401` generic toast (no email-existence disclosure); `403` distinct message + resend-OTP-by-email path; `429` full-page `<ErrorFallback />`, no unlock-time disclosure (`[FRS-1.3.1–1.3.5, Login page scenario]`).
- [x] `apps/web/src/pages/ForgotPasswordPage.tsx`: `forgotPasswordSchema`; identical success message + navigate to `/reset-password` with `{ email }` regardless of account state (`[FRS-1.5.1–1.5.3, Forgot password page scenario]`).
- [x] `apps/web/src/pages/ResetPasswordPage.tsx`: single combined form (D2) — `email`, `code`, `newPassword`, client-only `confirmPassword` match check; submits `{ email, code, newPassword }` via `resetPasswordSchema`; `200` → "all devices logged out" toast + navigate `/login`; `400` keeps form minus code field (`[FRS-1.5.4–1.5.6, Reset password page scenario]`).
- [x] `apps/web/src/pages/NotesStubPage.tsx`: behind `<ProtectedRoute>`, shows `user.email` + "coming soon" copy; Logout calls `useLogout` then unconditional `reset()` + navigate `/login` even on network failure (`[FRS-1.4.1, D1, Protected /notes stub page & logout scenario]`).
- [x] `apps/web/src/App.tsx`: `<BrowserRouter>` + `<Toaster position="top-right" richColors />` + `<Routes>` — 5 public auth routes, 1 protected `/notes` route, fallback `<Navigate to="/login" replace />` (`[Protected route guard & navigation scenario]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

- [x] `apps/web/tests/unit/useAuthStore.test.ts`: `setSession`/`reset` transitions; spy on `window.localStorage.setItem`/`sessionStorage.setItem`, assert never called (`[FRS-1.3.5]`).
- [x] `apps/web/tests/unit/httpClient.test.ts`: mock `401` → single refresh → replay; second consecutive `401` does not loop (`_retry` guard); refresh failure → `reset()` + redirect (`[FRS-1.3.5, SDS §3.1]`).
- [x] `apps/web/tests/unit/errorMessages.test.ts`: every mapped `API_ERROR_CODES` value returns non-generic copy; unmapped code returns generic fallback (`[FRS-8.5, Centralized error mapping scenario]`).
- [x] `apps/web/tests/unit/pages/RegisterPage.test.tsx`: disabled-until-valid submit, spinner-replaces-label, `200/201`→`/verify-otp` nav, `409`→toast (`[FRS-1.1.1–1.1.5]`).
- [x] `apps/web/tests/unit/pages/VerifyOtpPage.test.tsx`: redirect-if-no-state, `200`→`/login`, `400` attempts-remaining message, `429` input-disabled+resend-only, resend cooldown countdown/re-sync (`[FRS-1.2.1–1.2.5]`).
- [x] `apps/web/tests/unit/pages/LoginPage.test.tsx`: `200`→`setSession`+`?next=` redirect, `401` generic toast, `403` verify-prompt, `429` `<ErrorFallback />` (`[FRS-1.3.1–1.3.5]`).
- [x] `apps/web/tests/unit/pages/ForgotPasswordPage.test.tsx`: identical success message + nav regardless of branch (`[FRS-1.5.1–1.5.3]`).
- [x] `apps/web/tests/unit/pages/ResetPasswordPage.test.tsx`: confirm-password mismatch blocks submit, `200`→toast+`/login`, `400` retains form minus code (`[FRS-1.5.4–1.5.6]`).
- [x] `apps/web/tests/unit/pages/NotesStubPage.test.tsx`: logout clears session and redirects even when the network call rejects (`[FRS-1.4.1]`).
- [x] `apps/web/tests/unit/components/ProtectedRoute.test.tsx`: unauthenticated `/notes` visit redirects to `/login?next=/notes` (`[Protected route guard & navigation scenario]`).
- [ ] `apps/web/e2e/auth-journey.spec.ts` (Playwright, against `notes_app_test`-backed API per `FRS-0.3.2`/`FRS-0.3.3`): full register → verify (OTP read from console per `FRS-8.3`) → login → `/notes` → logout journey (`[FRS-1.1–1.4]`).
- [ ] `apps/web/e2e/password-reset-journey.spec.ts`: forgot → reset → forced re-login journey (`[FRS-1.5.1–1.5.6]`).
- [ ] `apps/web/e2e/route-guard.spec.ts`: unauthenticated `/notes` redirect + `?next=` honored post-login (`[Protected route guard & navigation scenario]`).
- [ ] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — all green against isolated `notes_app_test` (zero connections to `notes_app`/`sqlite::memory:`), ≥80% new-code coverage.

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [ ] Run `openspec validate` against spec delta (`openspec/changes/AB-1010-frontend-auth-pages/specs/auth/spec.md`).
- [ ] Run `/review AB-1010-frontend-auth-pages` (`reviewer` agent checks: token storage, zero hardcoded routes/limits, no client Zod duplication, TanStack Query/Zustand state boundary, no `shadcn` CLI, response-wrapper unwrapping, error-message safety — per `plan.md §5` checklist).
- [ ] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1010-frontend-auth-pages`.

---

Awaiting explicit **APPROVED** confirmation before allowing `/implement`.
