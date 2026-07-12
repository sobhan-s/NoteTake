# AB-1010 — Frontend: Auth Pages

## Executive Summary

Builds the `apps/web` authenticated-entry surface: Register, Email Verification (OTP), Login, Forgot Password, and Reset Password pages, wired against the already-implemented `AB-1002`/`AB-1003` backend contracts. This is the **first frontend ticket** — `apps/web` currently ships only `react`/`react-dom` — so it also bootstraps the routing, server-state, client-state, form, and design-system foundation that every subsequent frontend ticket (`AB-1011`–`AB-1015`) builds on.

## Objective

Deliver a fully operable, responsive, accessible register → verify → login → forgot → reset UI flow, with the access token held strictly in memory and zero client-side re-validation duplicating `packages/shared` Zod schemas.

## Target Requirements

- `FRS-1.1.1–1.1.5` — registration, re-trigger on unverified duplicate.
- `FRS-1.2.1–1.2.5` — OTP verification, resend cooldown, 3-attempt cap, distinct unverified-login message.
- `FRS-1.3.1–1.3.5` — login, token storage split (memory vs `HttpOnly` cookie), rate-limit messaging.
- `FRS-1.4.1` — logout revokes only the current session.
- `FRS-1.5.1–1.5.6` — forgot/reset password OTP flow, forced re-login everywhere on success.
- `FRS-7.1–7.5` (scoped to auth pages) — loading feedback, at-a-glance status, confirmation-before-destructive pattern (N/A here, no destructive actions on auth pages), responsive layout.
- `FRS-8.5` — zero hardcoded routes/limits/copy; everything sourced from `@shared/core`.

## Architectural Mappings

- `SDS §1.1` monorepo runtime boundaries (`apps/web` deps).
- `SDS §1.2` 3-tier constants — Tier 3 (`apps/web/src/constants`) for debounce/UI-only values; Tier 1 (`@shared/core`) for `API_PATHS.AUTH.*`, `APP_LIMITS.OTP_*`, `VALIDATION_MESSAGES`.
- `SDS §3.1` token lifecycle (`useAuthStore` memory + `HttpOnly` cookie + silent rotation).
- `SDS §7` Auth route matrix (`register`, `verify-otp`, `resend-otp`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password`).
- `docs/ux.md §1,2,4,6,7,8,9,10` — loading states, error states, form patterns, nav/route guards, state boundaries, token security, a11y, toasts.

## Out of Scope

- The real `/notes` dashboard (`AB-1011`) — this ticket ships only a minimal authenticated stub route (see Decision D1).
- Trash, tags, search, sharing, version-history UI (later tickets).
- Any destructive-action confirmation modal beyond logout (no trash/delete/revoke surfaces exist on auth pages).
- `shadcn/ui` CLI (`npx shadcn@latest ...`) — forbidden by Rule 20 (`zero @latest`); primitives are hand-authored against pinned Radix packages instead (see Decision D3 / Task note below).

## Decisions Log (resolved with user before drafting)

- **D1 — Post-login landing**: Build a minimal protected `/notes` stub page (welcome message + "Notes dashboard coming soon" + Logout button). Gives route guards a real destination and makes the full register→verify→login→logout journey demoable end-to-end in this ticket. `AB-1011` replaces the stub's contents without touching routing/guards.
- **D2 — Reset-password flow shape**: Single combined form. `/forgot-password` collects email only; `/reset-password` collects OTP code + new password + confirm-password in one submission, matching `resetPasswordSchema` (`email, code, newPassword`) exactly — there is no standalone "verify code" endpoint, so a code-first wizard step would be a UI-only gate giving false confidence.
- **D3 — Dependency scope**: Full design-system bootstrap now (not auth-only minimal). Adds routing/state/forms/design-system deps in one pass so `AB-1011`–`AB-1015` inherit a settled foundation instead of re-deciding it under time pressure later.

## New Dependencies (`apps/web/package.json`) — exact pinned versions (Rule 20)

Verified live via `npm view <pkg> version` (current published latest at spec time):

| Package                    | Version                       | Purpose                                                    |
| -------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `react-router-dom`         | `7.18.1`                      | Declarative routing + protected-route guards               |
| `zustand`                  | `5.0.14`                      | `useAuthStore` in-memory token state                       |
| `@tanstack/react-query`    | `5.101.2`                     | Server state (OTP resend mutation status, `/me` bootstrap) |
| `axios`                    | `1.18.1`                      | HTTP client with silent-refresh interceptor                |
| `react-hook-form`          | `7.81.0`                      | Form state                                                 |
| `@hookform/resolvers`      | `5.4.0`                       | Wires `@shared/core` Zod schemas into `react-hook-form`    |
| `tailwindcss`              | `4.3.2`                       | Utility CSS                                                |
| `@tailwindcss/vite`        | (bundled w/ `tailwindcss` v4) | Vite-native Tailwind v4 plugin (no PostCSS config file)    |
| `sonner`                   | `2.0.7`                       | Toast engine (`docs/ux.md §10`)                            |
| `lucide-react`             | `1.24.0`                      | Icons (spinner, form icons)                                |
| `class-variance-authority` | `0.7.1`                       | Variant-driven primitive components                        |
| `clsx`                     | `2.1.1`                       | Conditional className joining                              |
| `tailwind-merge`           | `3.6.0`                       | `cn()` helper for class merging                            |
| `@radix-ui/react-slot`     | `1.3.0`                       | `Button asChild` composition                               |
| `@radix-ui/react-label`    | `2.1.11`                      | Accessible form labels                                     |

`react` / `react-dom` already pinned at `19.2.7` — no change.

> **Live-doc verification note (`FRS-0.3.1`)**: Tailwind v4 install confirmed via Context7 (`/websites/tailwindcss_installation_using-vite`) — uses `@tailwindcss/vite` Vite plugin + `@import "tailwindcss"` in the CSS entry file, **not** a `tailwind.config.js` + PostCSS setup (that's the v3 pattern). React Router v7 confirmed via Context7 (`/remix-run/react-router`) — this ticket uses **declarative mode** (`<BrowserRouter>`/`<Routes>`/`<Navigate>`), not framework/data mode (`createBrowserRouter` + loaders), because auth-guard state lives in Zustand client memory (`docs/ux.md §6`), not a route loader.

---

## ADDED Requirements

### Requirement: Design-System & App-Shell Bootstrap

- The build SHALL configure Tailwind v4 via the `@tailwindcss/vite` plugin in `vite.config.ts` and a single CSS entry (`src/index.css`) containing `@import "tailwindcss";`.
- `apps/web/src/lib/cn.ts` SHALL export a `cn()` helper composing `clsx` + `tailwind-merge`, used by every primitive component.
- `apps/web/src/components/ui/` SHALL contain hand-authored primitives (`Button`, `Input`, `Label`, `Card`, `Spinner`) built directly on the pinned Radix packages + `class-variance-authority`, styled to match `docs/ux.md` (focus rings, WCAG AA contrast, disabled/loading states) — never generated via `shadcn` CLI.
- `App.tsx` SHALL mount a single `<BrowserRouter>` wrapping a `<QueryClientProvider>` (TanStack Query) and a `<Toaster position="top-right" />` (`sonner`, `docs/ux.md §10`).

#### Scenario: App shell mounts cleanly with design primitives and providers

- **WHEN** the application starts up in the browser
- **THEN** `<BrowserRouter>`, `<QueryClientProvider>`, and `<Toaster>` are active without runtime errors, and hand-authored primitive components render using `cn()` and Tailwind v4 classes

### Requirement: In-Memory Token Store (`useAuthStore`)

- `apps/web/src/store/useAuthStore.ts` SHALL hold exactly `{ accessToken: string | null, user: AuthUserDto | null }` plus `setSession()`/`reset()` actions.
- The store SHALL NOT persist to `localStorage`/`sessionStorage`/`IndexedDB` in any form (no `persist` middleware) — `FRS-1.3.5`.

#### Scenario: Token is held strictly in memory without browser storage persistence

- **WHEN** `setSession({ accessToken, user })` is invoked after login
- **THEN** the token is accessible inside `useAuthStore.getState().accessToken` but `localStorage` and `sessionStorage` remain completely free of any token or session state

### Requirement: Axios API Client with Silent Refresh Interceptor

- `apps/web/src/api/httpClient.ts` SHALL export an Axios instance with `withCredentials: true` and a request interceptor attaching `Authorization: Bearer <accessToken>` from `useAuthStore`.
- On a `401` response, a response interceptor SHALL attempt exactly one silent refresh (`POST API_PATHS.AUTH.REFRESH`, guarded by a `_retry` flag to prevent loops), update `useAuthStore` on success, and transparently replay the original request.
- If the refresh call itself returns `401/403/400`, the interceptor SHALL call `useAuthStore.reset()` and redirect to `/login` — `docs/ux.md §8`.
- All auth API calls (`register`, `verifyOtp`, `resendOtp`, `login`, `forgotPassword`, `resetPassword`, `logout`, `me`) SHALL live in `apps/web/src/api/auth.api.ts`, importing paths exclusively from `API_PATHS.AUTH.*` (`@shared/core`) — zero hardcoded route strings.

#### Scenario: Silent refresh interceptor rotates expired access token transparently

- **WHEN** an authenticated API request receives a `401 Unauthorized` response due to access token expiry
- **THEN** the Axios interceptor calls `POST API_PATHS.AUTH.REFRESH` exactly once, updates `useAuthStore` with the new access token, and successfully replays the original request without user interruption

### Requirement: Protected Route Guard & Navigation

- `apps/web/src/components/ProtectedRoute.tsx` SHALL redirect to `/login?next=<attempted-path>` when `useAuthStore.accessToken` is `null`, and render its children otherwise — `docs/ux.md §6`.
- `/notes` (protected) and `/login`, `/register`, `/verify-otp`, `/forgot-password`, `/reset-password` (public) SHALL be declared as `<Routes>` entries in `App.tsx`.
- On successful login or OTP verification, the app SHALL redirect to the `?next=` value if present, else default to `/notes` — `docs/ux.md §6`.
- Visiting `/notes` unauthenticated SHALL redirect to `/login?next=/notes`.

#### Scenario: Unauthenticated visitor accessing protected route is redirected to login with next param

- **WHEN** an unauthenticated visitor (`accessToken === null`) navigates directly to `/notes`
- **THEN** `<ProtectedRoute>` intercepts the render and redirects the user to `/login?next=/notes`

### Requirement: Register Page (`/register`)

- The form SHALL validate `email`/`password` client-side using `registerSchema` from `@shared/core` via `zodResolver`, in `mode: 'onBlur'` — `docs/ux.md §4`.
- On submit, the page SHALL call `POST /api/v1/auth/register`. On `201` (new account) or `200` (`isReTriggered: true`, re-sent OTP for an existing unverified account), the page SHALL navigate to `/verify-otp` carrying `userId` (never displaying whether the account was newly created or re-triggered — no email-enumeration leak, `FRS-1.1.5`).
- On `409 Conflict` (already-verified duplicate email), the page SHALL show a toast error mapped from `error.code` via the centralized error dictionary (`docs/ux.md §2`) — never the raw message.
- The submit button SHALL be disabled while `!isValid || isSubmitting` and SHALL show a spinner replacing its label during the in-flight request, holding its exact dimensions (`docs/ux.md §1`).

#### Scenario: Register form validates on blur and navigates to verify-otp on success

- **WHEN** a user fills out valid credentials and submits the registration form
- **THEN** the form disables submit during request execution, displays a spinner, and upon `201 Created` / `200 OK` transitions smoothly to `/verify-otp` with `userId` in location state

### Requirement: Email Verification Page (`/verify-otp`)

- The page SHALL render a 6-digit code input (`APP_LIMITS.OTP_LENGTH`) and submit via `verifyOtpSchema` (`type: 'EMAIL_VERIFICATION'`).
- On `200 OK`, the page SHALL navigate to `/login` with a success toast.
- On `400` (expired/invalid, attempts remaining N), the page SHALL show a toast with the exact `attempts remaining` count from the response and clear the code input for re-entry.
- On `429` (`OTP_MAX_ATTEMPTS_EXCEEDED`), the page SHALL disable the code input entirely and surface only the "Resend Code" action — the user cannot keep guessing the same invalidated OTP.
- A "Resend Code" button SHALL call `POST /api/v1/auth/resend-otp` and, upon success, start a client-side countdown of `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS` (60s) during which the button is disabled and displays the remaining seconds; a `429` (cooldown still active server-side, e.g. after a page refresh) SHALL re-sync the visible countdown from the error rather than only trusting client state.

#### Scenario: OTP verification code submission and resend cooldown management

- **WHEN** the user enters a 6-digit OTP code on `/verify-otp`
- **THEN** on success the user is redirected to `/login`; on `400` the remaining attempts are displayed; on `429` the code field is locked until "Resend Code" is triggered with a 60-second cooldown timer

### Requirement: Login Page (`/login`)

- The form SHALL validate via `loginSchema` (`mode: 'onBlur'`).
- On `200 OK`, the page SHALL call `useAuthStore.setSession({ accessToken, user })` and redirect per the route-guard `?next=` rule above.
- On `401` (`INVALID_CREDENTIALS`), the page SHALL show one generic toast — never indicating whether the email exists (`FRS-1.3.1` Error Scenarios).
- On `403` (`ACCOUNT_NOT_VERIFIED`), the page SHALL show a distinct toast/inline message directing the user to verify, with a link to resend the OTP (re-entering `/verify-otp` requires the email — the page SHALL prompt for it via `resendOtpSchema`'s `email` field since no `userId` is known at this point).
- On `429` (`RATE_LIMIT_EXCEEDED`), the page SHALL render the full-page `<ErrorFallback />` pattern (`docs/ux.md §2`) — never disclosing the unlock time (`FRS-1.3.4`).

#### Scenario: Login form authenticates user and sets in-memory session on success

- **WHEN** the user submits valid login credentials
- **THEN** the client receives `accessToken` and `user`, updates `useAuthStore`, and navigates to the target protected route (`/notes` or `?next=`)

### Requirement: Forgot Password Page (`/forgot-password`)

- The form SHALL validate via `forgotPasswordSchema` (email only).
- On `200 OK` the page SHALL always show the identical success message and navigate to `/reset-password` carrying the submitted email — regardless of whether the account exists, is on cooldown, or a fresh OTP was issued (byte-identical response per `SDS §3.2`, so the UI has nothing to branch on and must not attempt to distinguish these cases itself).

#### Scenario: Forgot password submission transitions to reset-password wizard uniformly

- **WHEN** a user enters their email address and requests a password reset
- **THEN** upon `200 OK` the UI navigates to `/reset-password` carrying the email address without revealing whether the email was found on the server

### Requirement: Reset Password Page (`/reset-password`) — Single Combined Form (Decision D2)

- The form SHALL pre-fill/accept `email` (from navigation state or manual entry) plus `code` (`APP_LIMITS.OTP_LENGTH` digits), `newPassword`, and a client-only `confirmPassword` field that SHALL be validated to match `newPassword` before enabling submit (this equality check is UI-only; `resetPasswordSchema` itself has no `confirmPassword` field).
- Submission SHALL call `POST /api/v1/auth/reset-password` with `{ email, code, newPassword }` in one request.
- On `200 OK`, the page SHALL show a success toast ("all devices logged out" copy reflecting `FRS-1.5.6`) and navigate to `/login`.
- On `400` (expired/invalid/consumed code), the page SHALL show a toast and keep the form populated except the code field, allowing retry without re-entering the new password.

#### Scenario: Combined reset password form validates confirmation and resets credentials

- **WHEN** the user enters their email, OTP reset code, and matching `newPassword` + `confirmPassword`
- **THEN** on `200 OK` all sessions are revoked on the server and the user is redirected to `/login` with a confirmation toast

### Requirement: Protected `/notes` Stub Page & Logout (Decision D1)

- `/notes` SHALL render behind `<ProtectedRoute>`, showing the authenticated user's email and a "Notes dashboard coming soon (AB-1011)" placeholder.
- A "Logout" button SHALL call `POST /api/v1/auth/logout`, then unconditionally `useAuthStore.reset()` and redirect to `/login` — even if the network call fails, the client-side session SHALL still be cleared (logout must never leave the UI stuck in an authenticated-looking state against a dead session).

#### Scenario: Logout button clears local state and navigates to login reliably

- **WHEN** an authenticated user clicks the "Logout" button on the `/notes` stub page
- **THEN** `POST API_PATHS.AUTH.LOGOUT` is invoked, `useAuthStore.reset()` clears all memory state, and the browser redirects to `/login` immediately

### Requirement: Centralized Error Mapping Dictionary

- `apps/web/src/lib/errorMessages.ts` SHALL map every `API_ERROR_CODES` value relevant to auth (`EMAIL_ALREADY_VERIFIED`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `RESEND_COOLDOWN_ACTIVE`, `INVALID_CREDENTIALS`, `ACCOUNT_NOT_VERIFIED`, `RATE_LIMIT_EXCEEDED`, `VALIDATION_ERROR`) to user-facing copy — `docs/ux.md §2`. Unmapped/unknown codes SHALL fall back to a single generic "Something went wrong" toast, never the raw `error.message`/stack.

#### Scenario: Centralized error dictionary maps API error codes to user-friendly toasts

- **WHEN** any API response returns `{ success: false, error: { code, message } }`
- **THEN** `errorMessages[error.code]` produces clean, polished UI copy instead of raw server error messages

### Requirement: Responsive Layout & Accessibility

- All five pages SHALL use a mobile-first centered single-column card layout, remaining usable at Tailwind's default breakpoints (`sm 640px`, `md 768px`, `lg 1024px`, `xl 1280px`) — satisfying the four-breakpoint-class requirement of `FRS-7.5` (no sidebar/drawer chrome applies here; that rule is `AB-1011`+ scope per `SDS §4.5`).
- Every input SHALL have an associated `<label>`; the submit button SHALL be keyboard-reachable and show a visible focus ring (`docs/ux.md §9`).
- Global shortcut keys (none defined for auth pages) SHALL NOT be wired here — out of scope until `AB-1011`.

#### Scenario: Auth cards adapt across all breakpoints with accessible form labels and focus rings

- **WHEN** the user accesses auth pages across mobile (`sm`), tablet (`md`), and desktop (`lg`/`xl`) breakpoints
- **THEN** the single-column card layout centers appropriately, every form control is keyboard accessible, and focus rings remain distinct and visible

---

## Clarifying Questions (asked and resolved before this draft)

1. Where does a successfully authenticated user land, given `/notes` doesn't exist yet? → **Resolved: D1**, minimal stub page.
2. Is the reset-password flow one combined form or a two-step code-then-password wizard? → **Resolved: D2**, single combined form.
3. Should this ticket bootstrap the full design system or stay auth-only minimal? → **Resolved: D3**, full bootstrap.
4. Confirmed exact pinned dependency versions (table above) via live `npm view` lookups, consistent with Rule 20.
5. Confirmed Tailwind v4 and React Router v7 API shapes via Context7 (`FRS-0.3.1`) rather than relying on training data, given both libraries changed significantly from their v3/v6 predecessors.

No further open questions — ready for `/plan` upon approval.
