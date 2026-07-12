# AB-1010 — Implementation Plan

Source spec: `openspec/changes/AB-1010-frontend-auth-pages/specs/auth/spec.md` (approved content — see Decisions D1–D3).

## 0. Scope Confirmation

- Ticket scope: **FRONTEND** (`AB-1010` falls in `AB-1010..AB-1015`).
- Workspace touched: `apps/web` only. Zero changes to `apps/api`, `packages/shared` (all needed schemas/types/constants already exist — confirmed by reading `auth.schema.ts`, `auth.type.ts`, `api-paths.constant.ts`, `app-limits.constant.ts`, `validation-messages.constant.ts`, `api-error-codes.constant.ts`).
- Current `apps/web/src` state: only `App.tsx`, `main.tsx`, and `.gitkeep` placeholders in `api/ components/ hooks/ pages/ store/ types/` — full bootstrap required.

## 1. Dependency Installation (Rule 20 — exact pinned versions, zero ranges)

Run from repo root, scoped to `@apps/web`:

```bash
pnpm --filter @apps/web add \
  react-router-dom@7.18.1 \
  zustand@5.0.14 \
  @tanstack/react-query@5.101.2 \
  axios@1.18.1 \
  react-hook-form@7.81.0 \
  @hookform/resolvers@5.4.0 \
  tailwindcss@4.3.2 \
  @tailwindcss/vite@4.3.2 \
  sonner@2.0.7 \
  lucide-react@1.24.0 \
  class-variance-authority@0.7.1 \
  clsx@2.1.1 \
  tailwind-merge@3.6.0 \
  @radix-ui/react-slot@1.3.0 \
  @radix-ui/react-label@2.1.11
```

- `@shared/core` (`packages/shared`) is already a workspace dependency path — verify `apps/web/package.json` has `"@shared/core": "workspace:*"` in `dependencies`; add it if missing (it is required for every schema/type/constant import in this ticket).
- No devDependency additions needed — `vitest`, `@playwright/test`, `@vitejs/plugin-react` already present.

## 2. Build Configuration Changes

| File                           | Change                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/vite.config.ts`      | Add `import tailwindcss from "@tailwindcss/vite"` and append to `plugins: [react(), tailwindcss()]`. No `tailwind.config.js`, no `postcss.config.js` (Tailwind v4 Vite-plugin pattern, confirmed via Context7). |
| `apps/web/src/index.css` (new) | `@import "tailwindcss";` — single CSS entry point.                                                                                                                                                              |
| `apps/web/src/main.tsx`        | Add `import "./index.css"` as the first import.                                                                                                                                                                 |

## 3. Layer-by-Layer File Plan

Frontend layering order per `apps/web/CLAUDE.md`: `store/ → api/ → hooks/ → components/ → pages/`.

### 3.1 `apps/web/src/lib/` (new directory)

| File                   | Contents                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/cn.ts`            | `cn(...inputs: ClassValue[])` = `twMerge(clsx(inputs))`.                                                                                                                                                                                                                                                                                                                                      |
| `lib/errorMessages.ts` | `mapApiError(code?: string): string` — switch over `API_ERROR_CODES` (imported from `@shared/core`) covering `EMAIL_ALREADY_VERIFIED, OTP_EXPIRED, OTP_INVALID, OTP_MAX_ATTEMPTS_EXCEEDED, RESEND_COOLDOWN_ACTIVE, INVALID_CREDENTIALS, ACCOUNT_NOT_VERIFIED, RATE_LIMIT_EXCEEDED, VALIDATION_ERROR`; `default:` returns generic "Something went wrong" — never surfaces raw `error.message`. |

### 3.2 `apps/web/src/constants/` (new — Tier 3 only, per `AGENTS.md §5`)

| File                       | Contents                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants/ui.constant.ts` | `OTP_RESEND_TICK_MS = 1000` (client countdown tick interval — UI-only, not an `APP_LIMITS` value so it belongs here, not in `@shared/core`). |

No other Tier-3 constants needed — all durations/lengths/limits used by this ticket (`OTP_LENGTH`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_ATTEMPTS`) come straight from `APP_LIMITS`.

### 3.3 `apps/web/src/store/` (Zustand — client state)

| File                    | Contents                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store/useAuthStore.ts` | `create<AuthState>()` with state `{ accessToken: string \| null; user: AuthUserDto \| null }` and actions `setSession({ accessToken, user })`, `reset()`. **No** `persist` middleware — `FRS-1.3.5`. Types imported from `@shared/core` (`AuthUserDto`). |

### 3.4 `apps/web/src/api/` (Axios + endpoint functions)

| File                | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/httpClient.ts` | `axios.create({ baseURL: API_PATHS.BASE, withCredentials: true })`. Request interceptor reads `useAuthStore.getState().accessToken` and sets `Authorization` header if present. Response interceptor: on `401` + `!config._retry`, set `config._retry = true`, call `POST API_PATHS.AUTH.ROOT + API_PATHS.AUTH.REFRESH` via a **plain** axios call (not the interceptor-wrapped instance, to avoid recursion), on success `useAuthStore.getState().setSession(...)` then retry original via `httpClient(config)`; on failure `useAuthStore.getState().reset()` + `window.location.assign('/login')`. |
| `api/auth.api.ts`   | Thin functions: `register(input: RegisterInput)`, `verifyOtp(input: VerifyOtpInput)`, `resendOtp(input: ResendOtpInput)`, `login(input: LoginInput)`, `forgotPassword(input: ForgotPasswordInput)`, `resetPassword(input: ResetPasswordInput)`, `logout()`, `me()` — each a thin `httpClient.post/get` call to `API_PATHS.AUTH.*`, returning `response.data.data` (unwraps `{ success, data }`). All input/output types imported from `@shared/core`.                                                                                                                                                |

### 3.5 `apps/web/src/hooks/` (TanStack Query — server-state wrappers, thin)

| File                                                                                                                                       | Contents                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useRegister.ts`, `useVerifyOtp.ts`, `useResendOtp.ts`, `useLogin.ts`, `useForgotPassword.ts`, `useResetPassword.ts`, `useLogout.ts` | Each a `useMutation` wrapping the matching `api/auth.api.ts` function — keeps pages free of raw Axios calls and gives consistent `isPending`/`error` state for the disabled-button/spinner pattern. |

_(Decision: no `useQuery` needed in this ticket — `/me` bootstrap on app load is intentionally deferred; session existence is derived purely from `useAuthStore.accessToken` per the approved spec. If a future ticket needs page-refresh session rehydration via `/me`, that's a separate concern outside AB-1010.)_

### 3.6 `apps/web/src/components/ui/` (hand-authored primitives, Rule 20 — no `shadcn` CLI)

| File                        | Contents                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/Button.tsx`  | `cva`-driven variants (`default`, `outline`, `ghost`), `asChild` via `@radix-ui/react-slot`, `isLoading` prop rendering `<Spinner>` in place of label while keeping fixed width/height. |
| `components/ui/Input.tsx`   | Styled `<input>` forwardRef, error-state border/focus-ring styling.                                                                                                                     |
| `components/ui/Label.tsx`   | Wraps `@radix-ui/react-label`.                                                                                                                                                          |
| `components/ui/Card.tsx`    | `Card`, `CardHeader`, `CardContent`, `CardFooter` — layout shell for all five auth pages.                                                                                               |
| `components/ui/Spinner.tsx` | `lucide-react`'s `Loader2` with `animate-spin`.                                                                                                                                         |

### 3.7 `apps/web/src/components/` (feature-level)

| File                            | Contents                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ProtectedRoute.tsx` | Reads `useAuthStore.accessToken`; if `null`, `<Navigate to={`/login?next=${location.pathname}`} replace />`; else renders `children` (or `<Outlet />` if used as a layout route).     |
| `components/AuthCard.tsx`       | Shared centered-card layout wrapper (title + children) reused by all 5 pages for the mobile-first responsive shell (`docs/ux.md`, spec "Responsive layout & accessibility" scenario). |

### 3.8 `apps/web/src/pages/`

| File                           | Scenario covered                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/RegisterPage.tsx`       | "Register page" scenario — `registerSchema` + `zodResolver`, `mode: 'onBlur'`, `useRegister` mutation, navigates to `/verify-otp` with `{ userId }` in router state on `200/201`, toast on `409`.                           |
| `pages/VerifyOtpPage.tsx`      | "Email verification page" — reads `userId`/`email` from router state (redirect to `/register` if neither present — can't verify without an identifier), `verifyOtpSchema`, resend cooldown countdown, 429 lockout UI.       |
| `pages/LoginPage.tsx`          | "Login page" — `loginSchema`, `useLogin`, `setSession`, `?next=` redirect, distinct 401/403/429 handling per spec.                                                                                                          |
| `pages/ForgotPasswordPage.tsx` | "Forgot password page" — `forgotPasswordSchema`, identical success message always, navigates to `/reset-password` with `{ email }` state.                                                                                   |
| `pages/ResetPasswordPage.tsx`  | "Reset password page" — single combined form (D2): `code`, `newPassword`, `confirmPassword` (UI-only match check via `react-hook-form` `refine`/`watch`), submits `{ email, code, newPassword }` via `resetPasswordSchema`. |
| `pages/NotesStubPage.tsx`      | "Protected `/notes` stub page & logout" (D1) — shows `user.email`, "coming soon" copy, Logout button calling `useLogout` then unconditional `reset()` + navigate `/login`.                                                  |

### 3.9 `apps/web/src/App.tsx` / `main.tsx`

- `main.tsx`: import `./index.css`, wrap `<App />` in `<QueryClientProvider client={new QueryClient()}>`.
- `App.tsx`: `<BrowserRouter>` + `<Toaster position="top-right" richColors />` + `<Routes>`:
  - Public: `/login`, `/register`, `/verify-otp`, `/forgot-password`, `/reset-password`.
  - Protected: `/notes` wrapped in `<ProtectedRoute>`.
  - Fallback: `<Navigate to="/login" replace />` for unknown paths.

## 4. `packages/shared` / `apps/api` Changes

**None.** All required schemas (`registerSchema`, `loginSchema`, `verifyOtpSchema`, `resendOtpSchema`, `forgotPasswordSchema`, `resetPasswordSchema`), types (`AuthUserDto`, `RegisterResponseDto`, `LoginResponseDto`, `MeResponseDto`), and constants (`API_PATHS.AUTH.*`, `APP_LIMITS.OTP_*`/`ACCESS_TOKEN_EXPIRY_MINUTES`/`REFRESH_TOKEN_EXPIRY_DAYS`, `VALIDATION_MESSAGES`, `API_ERROR_CODES`) already exist from `AB-1002`/`AB-1003`. Confirmed zero duplication risk (`Rule 11`, `FRS-8.5`).

## 5. Critical Rule Verification Checklist

- [ ] **Token storage (`FRS-1.3.5`, `SDS §3.1`)**: `accessToken` lives only in `useAuthStore` (Zustand, no `persist`); refresh token never read/written by JS (cookie is `HttpOnly`, set server-side only — confirmed already implemented in `apps/api/src/controllers/auth.controller.ts`).
- [ ] **Zero hardcoded routes/limits (`FRS-8.5`)**: every path/limit sourced from `@shared/core` (`API_PATHS`, `APP_LIMITS`) — grep for literal `"/api/v1"` or `"/auth/"` strings in `apps/web/src` before considering this done; there should be none outside `httpClient.ts`'s `baseURL` config.
- [ ] **No client-side duplication of Zod rules (`Rule 11`)**: all five forms use `zodResolver(<schema>)` imported directly from `@shared/core`, never re-declared inline.
- [ ] **State boundary (`apps/web/CLAUDE.md`)**: no server data (user/session) stored in TanStack Query; no mutation state stored in Zustand — mutations live in `hooks/use*.ts` via `useMutation` only.
- [ ] **No `shadcn` CLI invocation** anywhere (`Rule 20` — zero `@latest`) — primitives hand-authored per §3.6.
- [ ] **Response wrapper unwrapping**: `api/auth.api.ts` functions return `response.data.data`, never the raw Axios response, so pages/hooks consume typed DTOs directly.
- [ ] **Error message safety**: no page ever renders `error.message`/`error.stack` directly — always routed through `lib/errorMessages.ts`.

## 6. Testing Strategy (executed at `/tasks`+`/implement` time via `test-writer` agent)

Per `AGENTS.md §10`, tests are derived from `FRS-x.y.z` SHALL text, not AC bullets. Anticipated suites (final enumeration happens in `/tasks`):

- **Vitest + React Testing Library** (component-level, `apps/web/src/**/*.test.tsx`):
  - `useAuthStore`: `setSession`/`reset` transitions; confirm no `localStorage` calls (spy on `window.localStorage.setItem`, assert never called).
  - `httpClient` interceptor: mock 401 → single refresh attempt → replay; second consecutive 401 does not loop (`_retry` guard); refresh failure triggers `reset()` + redirect.
  - `lib/errorMessages.ts`: every mapped code returns non-generic copy; unmapped code returns the generic fallback.
  - Each page: disabled-until-valid submit button, loading-spinner-replaces-label, correct navigation target per response code (409/401/403/429/200 branches from the spec scenarios).
- **Playwright E2E** (`apps/web/e2e/`, against a running `notes_app_test`-backed API per `FRS-0.3.2`/`FRS-0.3.3` isolation contract):
  - Full register → verify (read OTP from console-logged output per `FRS-8.3`) → login → `/notes` → logout journey.
  - Forgot → reset → forced re-login journey.
  - Route guard: unauthenticated visit to `/notes` redirects to `/login?next=/notes`; post-login redirect honors `?next=`.
- Coverage target: ≥80% on new code (`CLAUDE.md §6` DoD) — enforced via `pnpm turbo run test -- --coverage`.

## 7. Quality Gate Commands (must all pass before `/pr`)

```bash
pnpm turbo run build       # tsup/vite build, 0 errors
pnpm turbo run lint        # --max-warnings 0
pnpm turbo run typecheck   # tsc --noEmit, 0 errors
pnpm turbo run test -- --coverage   # vitest + playwright, all green, ≥80% new-code coverage
```

## 8. Risks / Open Items Carried Forward (non-blocking for this ticket)

- `UI_COPY` shared constant (referenced by `apps/web/CLAUDE.md` for `CONFIRM_LOGOUT` etc.) does not exist yet in `packages/shared`. Not required here (logout has no confirm-dialog per the approved spec — it's a direct action), but will need to be created starting `AB-1011` when destructive-confirm modals appear (trash restore/permanent delete).
- Prior archived tickets (`AB-1001`–`AB-1009`) used a flat `spec.md` at the change root rather than the `specs/<domain>/spec.md` nesting `openspec/config.yaml` mandates. This ticket follows `config.yaml`; worth reconciling conventions before the next `/pr` archive step.

---

Awaiting explicit **APPROVED** confirmation before proceeding to `/tasks`.
