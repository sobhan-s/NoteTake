# UX Conventions (`UX.md`)
## Global Frontend User Experience & Visual Design Architecture

> **Global conventions for all frontend tickets (`AB-1010` to `AB-1015`).**  
> Every frontend behavioral specification (`spec.md`) inherits these conventions. Override only with explicit justification in `spec.md` (and update `UX.md` via fix bundle if the override is reusable across components).  
> **Traceability:** Fully aligned with `[FRS §7 (Frontend/UX Requirements)]`, `[FRS §1.3.5 (Token Storage Strategy)]`, `[FRS §8.4 (Server-Side Filtering)]`, and `[SDS §4.5, §5.1, §3.1]`.

---

## 1. Loading States (`[FRS-7.2]`)
- **Responsive Feedback (`<100ms`)**: Every asynchronous user action MUST trigger a visual loading indicator within `100ms` of initiation (`[FRS-7.2]`).
- **Button Loading Actions**: When an action button is clicked (e.g., `"Create Note"`, `"Log In"`, `"Restore"`), replace the text label with a loading spinner (`lucide-react` `<Loader2 className="animate-spin" />`). Keep the exact button dimensions (`min-width` and `height`) stable to prevent layout shift.
- **Lists & Collections Skeleton Screens**: Never display blank space or jarring content jumps while fetching data (`GET /api/v1/notes`, `GET /api/v1/tags`). Render professional skeleton screens (`shadcn/ui <Skeleton />`) matching the exact card/row height of the final content (`[FRS-7.2]`).
- **Minimum Display Timer (`>=200ms`)**: Never show a loading state for less than `200ms`. If a network response completes in `30ms`, hold the skeleton/spinner for at least `200ms` (`useMinLoadingTime` hook) to eliminate jarring visual flicker.
- **Editor Autosave Indicator (`[FRS-7.1, FRS-7.2]`)**: During background autosaving (`1500ms` debounce), the editor toolbar displays a status pill:
  - `saving`: Displays an animated monochrome ring with `"Saving to cloud..."` (`UI_COPY.AUTOSAVE_SAVING`).
  - `saved`: Fades to `"Saved"` (`UI_COPY.AUTOSAVE_SAVED`) and smoothly hides after 2 seconds.
  - `error`: Displays `"Save failed — Retrying..."` in high-contrast yellow (`#fef08a`) with a manual click-to-retry button.

---

## 2. Error States & Exception Handling (`[Rule 11, FRS-8.5]`)
- **Centralized Error Dictionary**: API errors (`error.code` from `API_ERROR_CODES`) MUST map directly to user-facing copy via a single dictionary in `apps/web/src/lib/errorMessages.ts` consuming `@shared/constants`.
- **Zero Raw Error Exposure**: Never display raw `error.detail`, backend stack traces, or internal SQL errors to the user (`[Rule 12]`). Map strictly by `error.code`.
- **Inline Form Validation Errors**: Show inline validation errors directly below the affected input field in red text (`text-red-500 text-xs mt-1`), with the input border highlighted red (`border-red-500 focus:ring-red-500`).
- **Toast Action Failures**: Action failures (`POST`, `PATCH`, `DELETE`) emit a top-right dismissible toast notification (`sonner`). Toasts auto-dismiss after `5s` for non-critical errors.
- **Permanent Page-Level Errors (`404 / 429 / 500`)**: Full-page error screens (`<ErrorFallback />`) must render when navigating to missing notes (`404 Note Not Found / Note in Trash [FRS-2.1.2]`) or encountering rate limit lockouts (`429 Account Locked [FRS-1.3.4]`). Include a clear explanation and a primary recovery action (`"Return to Active Notes"` or `"Retry"`).

---

## 3. Empty States (`UI_COPY`)
Every list or collection MUST render a custom-designed empty state when `total === 0`:
- **Visual Composition**:
  - **Icon**: Subtle monochrome icon from `lucide-react` (`FileText`, `Trash2`, `Tags`, `Share2`).
  - **Heading**: `"<Resource> yet"` (e.g., `"No notes yet"`, `"Spotless bin!"`, `"No custom tags yet"`).
  - **Subtext**: Short prompt consuming `UI_COPY` from `@shared/constants` or `apps/web/src/constants`:
    - `UI_COPY.EMPTY_NOTES_LIST`: `"Your mind is a blank canvas. Press C to drop your first thought."`
    - `UI_COPY.EMPTY_TRASH_BIN`: `"Spotless! Not even a digital crumb in sight."`
  - **Primary Action Button**: Prominent CTA button initiating creation (`"Create your first note"`, `"Create Fly Tag #"`).
- **Search Exception (`AB-1013 / FRS-4.1`)**: The search no-results state (`GET /api/v1/search?q=...`) omits the primary action button. The active search input already provides the direct recovery path (`"No notes matching query — try different keywords or search sentinels"`).

---

## 4. Form Patterns & Validation (`[Rule 11, FRS-8.5]`)
- **Shared Zod Schemas**: Client-side form validation (`react-hook-form` + `@hookform/resolvers/zod`) strictly imports schemas (`loginSchema`, `createNoteSchema`, `createTagSchema`) from `packages/shared/src/schemas/*`. Never duplicate validation regexes or character limits across frontend and backend.
- **Validate on Blur**: Trigger field validation on blur (`mode: 'onBlur'`), not on every single keystroke during active typing, preventing premature red borders while typing.
- **Submit Button State**: The submit button remains disabled (`disabled={!isValid || isSubmitting}`) until all required fields satisfy Zod validation rules.
- **Focus First Invalid Field**: Upon failed form submission attempt, automatically move focus to the first invalid input field (`useForm` focus handling).
- **Draft Persistence (`Zustand`)**: Persist form drafts (`uiStore.drafts`) for multi-line forms that can be interrupted (such as the TipTap note body editor `[FRS-7.1]`), ensuring zero data loss if the browser tab is accidentally refreshed or navigated away.

---

## 5. Confirm-Before-Destructive Actions (`[FRS-7.4]`)
Any irreversible or destructive action MUST require an explicit confirmation modal (`<ConfirmModal />` or `<VersionPreviewModal />`) before dispatching the API mutation (`[FRS-7.4]`):
- **Destructive Action Scope**:
  - Revoking an active public share link (`DELETE /api/v1/notes/:id/share` — `[FRS-5.3]`).
  - Permanently deleting a note from Trash (`DELETE /api/v1/notes/:id/permanent` — `[FRS-2.2.8]`).
  - Restoring a historical note version over the top of live content (`POST /api/v1/notes/:id/versions/:vId/restore` — `[FRS-6.4]`).
- **Modal Composition**:
  - **Heading**: Clearly states the exact consequence (`"Permanent Delete Note"`, `"Revoke Public Share Link"`, `"Restore Version [FRS-6.4]"`).
  - **Body Subtext**: Explains severity and irreversibility (`UI_COPY.PERMANENT_DELETE_CONFIRM` = `"Gone forever. Like tears in rain. Are you 100% sure? [FRS-2.2.8]"`).
  - **Primary Action Button**: Styled with destructive color (`bg-red-600 hover:bg-red-700 text-white` / `variant="destructive"`).
  - **Secondary Button (`"Cancel"`)**: Set as the default keyboard focus (`autoFocus`) to prevent accidental Enter-key confirmation (`[FRS-7.4]`).

---

## 6. Navigation & Route Guards (`[FRS-1.3.1, FRS-1.4.1]`)
- **Protected Route Interception**: All protected routes (`/notes/*`, `/tags/*`, `/search`, `/trash`) require a valid access token in memory (`authStore.accessToken`). If absent, the router immediately redirects to `/login` (`[FRS-1.3.1]`).
- **Original Destination Preservation**: When redirecting an unauthenticated user to `/login`, preserve their intended destination in the query string (`?next=/notes/a1b2c3d4`). Upon successful login or OTP verification, redirect back to `?next=...` (or default to `/notes`).
- **Clean Logout Flow (`[FRS-1.4.1]`)**: Initiating logout (`POST /api/v1/auth/logout`) revokes the server session, clears all Zustand in-memory stores (`authStore.reset()`), and redirects cleanly to `/login`.

---

## 7. State Management Boundaries (`[FRS §0.2 / CLAUDE.md]`)
- **Server State (`TanStack Query v5`)**:
  - Manages all remote API data (`useNotesList`, `useNoteById`, `useTags`, `useSearchNotes`).
  - Handles response caching (`staleTime: 5000ms`), request deduplication, background refetching, and optimistic updates (such as instant Fly Tag creation inside `FlyTagCombobox.tsx` — `[FRS-3.1]`).
  - Every list/filter hook MUST include all query tokens inside its query key (`['notes', 'list', sort, order, tags, tagMode, q, page, limit]`) to ensure strict server-side refetching (`[FRS-8.4]`).
- **Client UI State (`Zustand`)**:
  - Manages strictly ephemeral client-side state (`authStore` for JavaScript memory JWT, `uiStore` for sidebar drawer state, filter selections, active modal IDs, and local drafts — `[FRS-1.3.5]`).
- **Strict Separation Rule**: Never store server data collections inside Zustand (`[Rule 11]`). Never store ephemeral UI toggles or access token strings inside TanStack Query cache.

---

## 8. Tokens & Authentication Security Strategy (`[FRS-1.3.1, FRS-1.3.3, FRS-1.3.5]`)
- **Access Token (`Zustand Memory Only`)**: The short-lived JWT access token (`15m` expiry `[FRS-1.3.2]`) is stored **strictly in JavaScript heap memory inside `authStore`** (`[FRS-1.3.5]`). Never write the access token or refresh token to `localStorage`, `sessionStorage`, or IndexedDB. Totally immune to XSS theft.
- **Refresh Token (`HttpOnly Cookie Only`)**: The long-lived refresh token (`7d` expiry `[FRS-1.3.3]`) is managed **exclusively by the backend inside an `HttpOnly`, `Secure`, `SameSite=Strict` cookie** (`refreshToken` — `[FRS-1.3.5]`). Frontend JavaScript never reads, parses, or accesses this cookie directly.
- **Silent Refresh Interceptor (`Axios / Fetch Client`)**:
  - When an API request returns `401 Unauthorized`, the API client interceptor intercepts the error and attempts exactly **one** silent token refresh (`POST /api/v1/auth/refresh`, attaching the HTTP cookie automatically).
  - If successful, the new access token is saved into `authStore` and the original failed request is transparently retried (`[FRS-1.3.5]`).
  - If the refresh attempt returns `401 / 403 / 400`, the interceptor clears all in-memory state (`authStore.reset()`) and redirects the user to `/login`.

---

## 9. Accessibility (`a11y` Minimum Bar)
- **Keyboard Operability**: All interactive elements (`buttons`, `inputs`, `cards`, `modals`, `comboboxes`) MUST be keyboard-reachable (`Tab` and `Shift+Tab` flow in a logical DOM order).
- **Keyboard Shortcuts (`[FRS-7.1]`)**: Global shortcuts (e.g., press `C` to create a note, `Ctrl/Cmd + K` to open search) MUST include `aria-keyshortcuts` and automatically skip activation when the user's focus is inside an active text `<input>`, `<textarea>`, or TipTap editor.
- **Semantic Labels & ARIA Attributes**: Every form input field MUST have an associated `<label>` (or `aria-labelledby`). Icon-only buttons (`Delete`, `Share`, `Close Modal`, `Toggle Drawer`) MUST include clear `aria-label` or `<span className="sr-only">` descriptions.
- **Visible Focus Rings**: Never remove default focus outlines (`outline-none`) without providing a high-contrast visual replacement (`focus-visible:ring-2 focus-visible:ring-snow/80 focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian`).
- **Contrast Ratio (WCAG AA)**: All text and interactive icon elements MUST meet **WCAG AA minimum contrast requirements** (`4.5:1` for normal body text, `3:1` for large text and UI boundaries) against dark theme backgrounds (`#09090b` obsidian and `#18181b` surface dark).

---

## 10. Toasts & Notifications (`shadcn/ui` + `sonner`)
- **Single Toast Library**: The frontend uses a unified toast engine (`sonner` mounted via `shadcn/ui <Toaster position="top-right" />`).
- **Success Toasts**: Rendered with green accent styling, top-right positioning, auto-dismissing after `3 seconds` (`duration: 3000`).
- **Error Toasts**: Rendered with high-contrast red accent styling (`#ef4444`), top-right positioning, auto-dismissing after `5 seconds` (`duration: 5000`), always dismissible via an explicit close icon button (`[Rule 12]`).
- **Queue & Stack Limits**: Never stack more than `3` simultaneous toasts on screen (`maxToasts: 3`). Any additional toasts wait cleanly in the notification queue until active toasts dismiss.
