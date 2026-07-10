# SOFTWARE DESIGN SPECIFICATION (`SDS.md`)

**Full-Stack Note-Taking Application Monorepo**  
_Document Version: 1.3 | Target FRS Version: v1.2 (`Locked`)_

---

## 1. System Architecture & Monorepo Boundaries (`[FRS §0 (`AB-1001`)]`)

The project is structured as a `pnpm workspaces` + **Turborepo (`turbo.json`)** monorepo (`[FRS-0.1, FRS-0.6]`) enforcing strict architectural layering (`Router -> Controller -> Service -> Repository -> Shared DTO`).

### 1.1 Monorepo Workspace Layout & Directory Tree

```text
/
├── apps/
│   ├── api/                     # Backend API Service (Express 5 + TypeScript + Prisma) [FRS-0.1]
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # Single Database Schema Definition (PostgreSQL 16) [FRS-0.4]
│   │   │   └── migrations/      # Sequential SQL Migration Files (`citext`, `tsvector` GIN index)
│   │   ├── src/
│   │   │   ├── controllers/     # HTTP request handling & Zod input validation (`z.parse`)
│   │   │   ├── services/        # Business logic, state transitions & transaction boundaries
│   │   │   ├── repositories/    # Database queries via Prisma Client & raw SQL extensions
│   │   │   ├── routers/         # Express route declarations namespace-versioned (`/api/v1`)
│   │   │   ├── middlewares/   # Auth verification, rate-limiting & centralized error handling
│   │   │   ├── jobs/            # `node-cron` scheduled workers (`cleanup.job.ts` 03:00 AM UTC)
│   │   │   └── app.ts           # Express 5 initialization & OpenAPI/Swagger documentation mount
│   │   ├── package.json         # Workspace package: `@apps/api`
│   │   ├── tsconfig.json        # Extends @config/tsconfig.base.json
│   │   └── CLAUDE.md            # Domain AI rules: Layer isolation, zero raw JSON input [FRS-0.2]
│   │
│   └── web/                     # Frontend Single Page Application (React 19 + Vite + TS) [FRS-0.1]
│       ├── src/
│       │   ├── components/      # Atomic UI elements (`TagCombobox`, `SnippetHighlight`)
│       │   ├── pages/           # Route views (`Login`, `Register`, `NotesDashboard`, `Trash`)
│       │   ├── hooks/           # Custom React hooks (`useNoteAutosave`, `useDebounce`)
│       │   ├── store/           # Client memory state via Zustand (`useAuthStore`, `useUiStore`)
│       │   ├── api/             # HTTP API client wrappers (`axios`/`fetch` with credentials)
│       │   ├── types/           # UI-specific view types & theme interfaces
│       │   └── App.tsx          # Main Application router & provider setup
│       ├── package.json         # Workspace package: `@apps/web`
│       ├── tsconfig.json        # Extends @config/tsconfig.base.json
│       └── CLAUDE.md            # Domain AI rules: React 19 concurrency, TanStack vs Zustand [FRS-0.2]
│
├── packages/
│   ├── shared/                  # Single Source of Truth (Rule 11 & FRS-8.5)
│   │   ├── src/
│   │   │   ├── schemas/         # Zod schemas (Auth, Notes, Tags, Search, Sharing) [FRS-8.5]
│   │   │   ├── types/           # Inferred TypeScript DTO interfaces (`z.infer<typeof schema>`) [FRS-8.5]
│   │   │   └── constants/       # Tier 1 Shared Constants (API_PATHS, APP_LIMITS, UI_COPY) [FRS-8.5]
│   │   ├── package.json         # Workspace package: `@shared/*`
│   │   └── CLAUDE.md            # Domain AI rules: Pure TS/Zod, zero external runtime deps [FRS-0.2]
│   │
│   └── config/                  # Shared Workspace Tooling Configs [FRS-0.1, FRS-0.5]
│       ├── eslint.config.js     # Shared ESLint configuration (`--max-warnings 0`) [Rule 12]
│       ├── prettier.config.js   # Shared Prettier code formatting setup [Rule 12]
│       ├── tsconfig.base.json   # Shared TypeScript strict compiler options [Rule 12]
│       └── package.json         # Workspace package: `@config/*`
│
├── docker-compose.yml           # Local Development Infrastructure: PostgreSQL 16 Alpine container [FRS-0.4]
├── turbo.json                   # Turborepo task graph & build dependency orchestration (^build) [FRS-0.1, FRS-0.6]
├── AGENTS.md                    # Universal Project AI Brain (<200 lines, single source of truth) [FRS-0.2]
├── CLAUDE.md                    # Root Claude Code permissions, compacting rules, quality gates [FRS-0.2]
└── .claude/
    ├── commands/                # Custom Slash Commands: /start /spec /plan /tasks /implement /review /pr [FRS-0.3]
    └── agents/                  # Read-Only Sub-Agents: reviewer.md, test-writer.md [FRS-0.3]
```

#### Monorepo Runtime Specifications

- **`apps/api`**: Runs on Node.js v24 LTS using Express 5 (`[FRS-0.1]`). Express 5 natively supports `async/await` request handlers without requiring external wrappers (`express-async-errors`). It incorporates `@stoplight/prism-cli` (`[FRS-0.1]`) for contract testing and OpenAPI mock verification against generated schemas (`/api/v1/docs`).
- **`apps/web`**: Single Page Application (`SPA`) built with React 19 (`[FRS-0.1]`) and Vite. Uses TanStack Query v5 for server state and request deduplication, Zustand (`useAuthStore`, `useUiStore`) for strictly in-memory client state (`[FRS-1.3.5]`), and headless TipTap (`@tiptap/react`) for rich-text editing (`[FRS-2.1.1]`).
- **`packages/shared`**: The absolute single source of truth (`[Rule 11, FRS-8.5]`). Both `apps/api` and `apps/web` import `@shared/schemas/*`, `@shared/types/*`, and `@shared/constants/*`. **No DTO or validation rule may ever be duplicated across client and server workspaces.**
- **`packages/config`**: Provides unified linting, formatting, and compiler standards (`[FRS-0.5]`), ensuring exact code style parity across the entire monorepo (`[Rule 12]`).
- **Build & Type Tooling (`tsup` vs `tsc`)**: Backend and shared workspaces (`apps/api`, `packages/shared`) strictly utilize **`tsup`** (`@tsup/cli`) for high-performance ESM bundling (`pnpm build`). The TypeScript compiler (`tsc --noEmit`) is strictly reserved for static type verification and error checking (`pnpm typecheck`), and is NEVER used for code compilation (`[Rule 12, FRS-0.6]`).
- **Turborepo Task & Build Orchestration (`turbo.json`)**: The monorepo uses **Turborepo (`turbo`)** (`[FRS-0.1, FRS-0.6]`) to orchestrate tasks across workspaces with intelligent topological sorting and caching. The root `turbo.json` defines pipeline dependencies where `"build"` strictly depends on `"^build"` (`"dependsOn": ["^build"]`), ensuring `packages/shared` and `packages/config` are automatically built before `apps/api` and `apps/web` can build.
- **Strict Package Version Pinning (`[Rule 20, FRS-0.5]`)**: Every dependency and devDependency declared in `package.json` manifests across root `/`, `apps/api/`, `apps/web/`, `packages/shared/`, and `packages/config/` MUST be pinned to exact semantic version numbers (`e.g., "express": "5.0.1", "react": "19.0.0", "prisma": "6.1.0"`). Carets (`^`), tildes (`~`), wildcards (`*`), and range specifiers (`>=`) are strictly forbidden by CI linting and `package.json` validation checks (`[Rule 20]`).

---

### 1.2 Strict 3-Tier Constants Architecture (`Rule 11` & `[FRS-8.5]`)

Every string literal, numeric limit, cron schedule, and error message across the monorepo must adhere to the **3-Tier Constants Architecture (`[Rule 11, FRS-8.5]`)**. Hardcoding values inside controllers, services, queries, or UI components is strictly prohibited (`[FRS-8.5]`).

- **Tier 1: Shared Constants (`packages/shared/src/constants/index.ts`)**: Must contain all universally consumed values imported by both `apps/api` and `apps/web`:
  - **`API_PATHS`**: Base path `/api/v1` (`[FRS-8.6]`) and explicit route paths for Auth, Notes, Tags, Search, and Sharing.
  - **`APP_LIMITS`**: Document-mandated limits requiring exact synchronization: `PAGE_SIZE_DEFAULT (20)`, `PAGE_SIZE_MAX (100)`, `OTP_LENGTH (6)`, `OTP_EXPIRY_MINUTES (10)`, `OTP_MAX_ATTEMPTS (3)`, `OTP_RESEND_COOLDOWN_SECONDS (60)`, `LOGIN_RATE_LIMIT_MAX_ATTEMPTS (5)`, `LOGIN_RATE_LIMIT_WINDOW_MINUTES (15)`, `REFRESH_TOKEN_EXPIRY_DAYS (7)`, `ACCESS_TOKEN_EXPIRY_MINUTES (15)`, `NOTE_TITLE_MAX_CHARS (200)`, `NOTE_BODY_MAX_CHARS (100000)`, `VERSION_SNAPSHOT_THROTTLE_MINUTES (5)`, `VERSION_RETENTION_DAYS (90)`, `TRASH_STAGE_1_DAYS (30)`, `TRASH_STAGE_2_DAYS (30)`, `STALE_RECORD_PURGE_HOURS (24)`, `STALE_LOGIN_PURGE_HOURS (24)`, `SHARE_LINK_DEFAULT_EXPIRY_DAYS (7)`, `SHARE_LINK_MIN_EXPIRY_DAYS (1)`, and `SHARE_LINK_MAX_EXPIRY_DAYS (30)` (`[FRS-5.2, FRS-8a.2]`).
  - **`VALIDATION_MESSAGES` & `ERROR_CODES`**: Standardized user-facing validation errors and canonical API error codes (`OTP_EXPIRED`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED`, `NOTE_NOT_FOUND`, `NOTE_TRASHED`, `SHARE_LINK_EXPIRED`).
  - **`UI_COPY`**: Mandatory frontend confirmation prompts (`CONFIRM_TRASH_RESTORE`, `CONFIRM_PERMANENT_DELETE`, `CONFIRM_LOGOUT`).
- **Tier 2: Backend-Only Constants (`apps/api/src/constants/api.constants.ts`)**: Server-internal runtime secrets, JWT issuers, Bcrypt work factor (`12`), and the nightly cron schedule string (`CRON_CLEANUP_SCHEDULE = '0 3 * * *'`).
- **Tier 3: Frontend-Only Constants (`apps/web/src/constants/ui.constants.ts`)**: Client view configurations, TanStack Query refetch intervals, local storage keys, and debounce delays (`DEBOUNCE_SEARCH_MS = 300`, `DEBOUNCE_AUTOSAVE_MS = 2000`).

---

### 1.3 Git Hooks & Commit Rules (`[FRS-0.5, Rule 14]`)

The repository enforces strict code quality and git hygiene before commits enter version control (`[FRS-0.5, Rule 14]`):

- **Pre-Commit Hook (`.husky/pre-commit`)**: Invokes `npx lint-staged` to execute `eslint --max-warnings 0` and `prettier --write` strictly against staged files across all workspaces (`[Rule 12]`).
- **Commit Message Hook (`.husky/commit-msg`)**: Invokes `npx --no -- commitlint --edit` with `@commitlint/config-conventional`. The custom `commitlint.config.js` enforces the binding commit format (`[Rule 14]`):
  $$\text{type(scope): description AB\#ticket}$$
  _Example_: `feat(auth): implement user registration AB#1002`. Any commit missing the exact `AB#ticket` reference or violating the prefix (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`) is rejected by the git hook.

---

### 1.4 GitHub Actions Continuous Integration Pipeline (`.github/workflows/ci.yml` — `[FRS-0.6]`)

To enforce strict quality gates (`[Rule 12]`) and block broken or non-compliant pull requests before merge (`[FRS-0.6]`), the project configures a mandatory GitHub Actions CI workflow running across all monorepo workspaces on every pull request and push to main (`[Rule 12, FRS-0.6]`).

```yaml
# .github/workflows/ci.yml — Mandated by [FRS-0.6] & [Rule 12]
name: Continuous Integration

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality-gate:
    name: Lint, Typecheck, Build & Test [FRS-0.6]
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: Check Linting Errors (--max-warnings 0) [Rule 12]
        run: pnpm turbo run lint

      - name: Check Type Errors (`tsc --noEmit`) [Rule 12]
        run: pnpm turbo run typecheck

      - name: Build Workspaces (`tsup` for backend/packages via `^build`) [Rule 12]
        run: pnpm turbo run build

      - name: Execute Test Suite [Rule 13]
        run: pnpm turbo run test
```

#### CI Enforcement & Branch Protection Contract (`[FRS-0.6]`)

- **Block Merging (`[FRS-0.6]`)**: GitHub repository branch protection rules MUST set `quality-gate` (`Lint, Typecheck, Build & Test`) as a **Required Status Check**.
- **100% Green Requirement**: If `pnpm turbo run lint` emits even one warning (`--max-warnings 0`), if `pnpm turbo run typecheck` detects any static type mismatch, or if any test across `apps/api`, `apps/web`, or `packages/shared` fails, the pull request status turns red and merging is strictly blocked by GitHub at the API level (`[FRS-0.6]`).

---

### 1.5 Docker & Local Database Infrastructure (`docker-compose.yml` — `[FRS-0.4]`)

To ensure deterministic development environments and satisfy the **PostgreSQL 16** requirement (`[FRS-0.4]`), the project provides a root `docker-compose.yml` running PostgreSQL 16 Alpine in a localized container.

#### Local Docker Compose Configuration (`docker-compose.yml`)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: notes_app_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: notes_app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d notes_app"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

#### Database Connection & Environment Contract (`[FRS-0.4]`)

- **Local Startup**: Developers execute `docker compose up -d postgres` from the monorepo root to spin up the database container.
- **Connection String (`apps/api/.env`)**: The backend connects directly to the container via `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/notes_app?schema=public"` (`[FRS-0.4]`).
- **Prisma Synchronization**: After container healthcheck turns green, running `pnpm --filter @apps/api prisma migrate dev` applies the schema and native PostgreSQL extensions directly inside the containerized database.

---

## 2. Database & Schema Architecture (`[FRS §0.4, §1, §2, §3, §5, §6]`)

The database architecture mandates PostgreSQL 16 (`[FRS-0.4]`) managed strictly via Prisma ORM inside `apps/api/prisma/schema.prisma`. All datetime columns must use `@db.Timestamptz(6)` (`[FRS-8.1]`) to store accurate UTC timestamps.

### 2.1 Complete Prisma Schema Definition (`apps/api/prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres"]
}

enum OtpType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

enum OtpStatus {
  PENDING
  CONSUMED
  INVALIDATED
}

model User {
  id              String         @id @default(uuid()) @db.Uuid
  email           String         @unique @db.VarChar(255)
  passwordHash    String         @map("password_hash") @db.VarChar(255)
  isVerified      Boolean        @default(false) @map("is_verified")
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  notes           Note[]
  tags            Tag[]
  otpCodes        OtpCode[]
  refreshSessions RefreshSession[]

  @@map("users")
}

model LoginAttempt {
  id              String         @id @default(uuid()) @db.Uuid
  email           String         @db.VarChar(255)
  ipAddress       String         @map("ip_address") @db.VarChar(45)
  attemptedAt     DateTime       @default(now()) @map("attempted_at") @db.Timestamptz(6)

  @@index([email, attemptedAt])
  @@index([ipAddress, attemptedAt])
  @@map("login_attempts")
}

model OtpCode {
  id              String         @id @default(uuid()) @db.Uuid
  userId          String         @map("user_id") @db.Uuid
  codeHash        String         @map("code_hash") @db.VarChar(255)
  type            OtpType
  status          OtpStatus      @default(PENDING)
  attempts        Int            @default(0)
  expiresAt       DateTime       @map("expires_at") @db.Timestamptz(6)
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type, status])
  @@map("otp_codes")
}

model RefreshSession {
  id              String         @id @default(uuid()) @db.Uuid
  userId          String         @map("user_id") @db.Uuid
  tokenHash       String         @unique @map("token_hash") @db.VarChar(255)
  userAgent       String?        @map("user_agent") @db.Text
  ipAddress       String?        @map("ip_address") @db.VarChar(45)
  expiresAt       DateTime       @map("expires_at") @db.Timestamptz(6)
  revokedAt       DateTime?      @map("revoked_at") @db.Timestamptz(6)
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@map("refresh_sessions")
}

model Note {
  id              String         @id @default(uuid()) @db.Uuid
  userId          String         @map("user_id") @db.Uuid
  title           String         @db.VarChar(200)
  body            String         @db.Text
  searchVector    Unsupported("tsvector")? @map("search_vector")
  deletedAt       DateTime?      @map("deleted_at") @db.Timestamptz(6)
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  noteTags        NoteTag[]
  versions        NoteVersion[]
  shareLinks      ShareLink[]

  @@index([userId, deletedAt])
  @@map("notes")
}

model Tag {
  id              String         @id @default(uuid()) @db.Uuid
  userId          String         @map("user_id") @db.Uuid
  name            String         @db.VarChar(50)
  color           String         @default("#6B7280") @db.VarChar(9)
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  noteTags        NoteTag[]

  @@unique([userId, name])
  @@index([userId])
  @@map("tags")
}

model NoteTag {
  noteId          String         @map("note_id") @db.Uuid
  tagId           String         @map("tag_id") @db.Uuid
  assignedAt      DateTime       @default(now()) @map("assigned_at") @db.Timestamptz(6)

  note            Note           @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag             Tag            @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([noteId, tagId])
  @@index([tagId, noteId])
  @@map("note_tags")
}

model NoteVersion {
  id              String         @id @default(uuid()) @db.Uuid
  noteId          String         @map("note_id") @db.Uuid
  titleSnapshot   String         @map("title_snapshot") @db.VarChar(200)
  bodySnapshot    String         @map("body_snapshot") @db.Text
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  note            Note           @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId, createdAt(sort: Desc)])
  @@map("note_versions")
}

model ShareLink {
  id              String         @id @default(uuid()) @db.Uuid
  noteId          String         @map("note_id") @db.Uuid
  token           String         @unique @db.VarChar(64)
  viewCount       Int            @default(0) @map("view_count")
  expiresAt       DateTime       @map("expires_at") @db.Timestamptz(6)
  revokedAt       DateTime?      @map("revoked_at") @db.Timestamptz(6)
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  note            Note           @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([token, revokedAt, expiresAt])
  @@index([noteId])
  @@map("share_links")
}
```

---

### 2.2 Raw SQL Migrations & Native PostgreSQL Extensions (`[FRS-0.4]`)

Because Prisma Schema syntax does not natively express `citext` types or `tsvector` GIN indexes (`[FRS-0.4]`), the project executes exact SQL migration instructions via `prisma migrate dev`:

1. **Case-Insensitive Extensions & Table Constraints (`citext` & `CHECK`)**:
   - Enable the `citext` extension: `CREATE EXTENSION IF NOT EXISTS citext;` (`[FRS-1.1.2, FRS-3.1]`).
   - Alter columns to `citext`: `ALTER TABLE users ALTER COLUMN email TYPE citext;` and `ALTER TABLE tags ALTER COLUMN name TYPE citext;` to guarantee true per-user case-insensitive uniqueness (`[FRS-1.1.2, FRS-3.1]`).
   - Enforce database `CHECK` constraints (`[FRS-2.1.5, FRS-2.1.6, FRS-3.4]`):
     - `ALTER TABLE notes ADD CONSTRAINT notes_title_length_check CHECK (char_length(trim(title)) >= 1 AND char_length(title) <= 200);`
     - `ALTER TABLE notes ADD CONSTRAINT notes_body_length_check CHECK (char_length(body) <= 100000);`
     - `ALTER TABLE tags ADD CONSTRAINT tags_color_hex_check CHECK (color ~* '^#[0-9a-f]{6}([0-9a-f]{2})?$');`

2. **Full-Text Search (`tsvector` & `GIN` Indexing — `[FRS-4.1, FRS-4.2]`)**:
   - Create the `GIN` index on `search_vector`: `CREATE INDEX notes_search_vector_gin ON notes USING GIN (search_vector);` (`[FRS-4.2]`).
   - Create the automatic trigger function `notes_search_vector_update()` executing before `INSERT` or `UPDATE` on `notes` to populate the vector:
     $$\text{NEW.search\_vector} := \text{setweight(to\_tsvector('english', coalesce(NEW.title, '')), 'A')} \ || \ \text{setweight(to\_tsvector('english', coalesce(NEW.body, '')), 'B')};$$
   - Attach the trigger: `CREATE TRIGGER trg_notes_search_vector_update BEFORE INSERT OR UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();` (`[FRS-4.1]`).

3. **Atomic Share-Link View Increments (`$queryRaw` — `[FRS-2.2.4, FRS-5.4, FRS-5.6]`)**:
   - Public requests to `GET /api/v1/public/share/:token` execute an atomic single-query view count increment while enforcing non-deleted note constraints inside the database:
     ```sql
     UPDATE notes n
     SET view_count = view_count + 1
     FROM share_links sl
     WHERE sl.token = $1
       AND sl.note_id = n.id
       AND sl.revoked_at IS NULL
       AND sl.expires_at > NOW()
       AND n.deleted_at IS NULL
     RETURNING n.*, sl.expires_at;
     ```
   - This atomic query eliminates race conditions and immediately blocks access (`returning 404`) if the parent note is moved to Stage 1 Trash (`n.deleted_at IS NULL`) or if the link is expired/revoked (`[FRS-2.2.4, FRS-5.6, FRS-8.1]`).

---

## 3. Authentication & Security Architecture (`[FRS §1]`)

Authentication follows a **Cookie & Memory** token lifecycle (`[FRS-1.3.3, FRS-1.3.5]`) specifically designed to prevent Cross-Site Scripting (`XSS`) token exfiltration while supporting silent session rotation and rate-limited security.

### 3.1 Token Lifecycle & Storage Strategy (`[FRS-1.3.3, FRS-1.3.5]`)

- **Access Tokens (`15m` Expiry — `[FRS-1.3.2]`)**: Issued as short-lived JWTs containing `{ userId, email, isVerified }`. The frontend **NEVER** stores access tokens or refresh tokens in `localStorage` or `sessionStorage` (`[Rule 12, FRS-1.3.5]`). Instead, the access token resides exclusively inside a Zustand in-memory store (`useAuthStore`) and is attached to API requests via Axios/Fetch `Authorization: Bearer <token>` headers.
- **Refresh Tokens (`7d` Expiry — `[FRS-1.3.3]`)**: Cryptographically random 64-byte hex strings hashed via SHA-256 and stored in `refresh_sessions.token_hash`. The raw token is sent to the client strictly inside an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`refreshToken`).
- **Silent Rotation**: When the in-memory access token expires (`401 Unauthorized`), the Axios interceptor calls `POST /api/v1/auth/refresh`. The server verifies the `refreshToken` cookie against `refresh_sessions`, revokes the old session (`revokedAt = now()`), issues a fresh `HttpOnly` refresh cookie, and returns a new short-lived access token to memory (`[FRS-1.3.3]`).

---

### 3.2 Registration, OTP Verification & Rate-Limiting Flows (`[FRS-1.1 - 1.5]`)

#### Shared OTP & Verification DTO Schemas (`packages/shared/src/schemas/auth.schema.ts` — `[BUG-4 Fix]`)

To ensure unauthenticated flows (`Forgot/Reset Password`) and authenticated/registration flows function seamlessly without exposing internal UUIDs or creating DTO mismatches:

- `registerSchema`: `{ email: z.string().email(), password: z.string().min(8).regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])/) }`
- `verifyOtpSchema` / `resendOtpSchema`: Accepts either `userId` (UUID) or `email` along with `type`:

  ```typescript
  export const verifyOtpSchema = z
    .object({
      userId: z.string().uuid().optional(),
      email: z.string().email().optional(),
      code: z.string().length(APP_LIMITS.OTP_LENGTH),
      type: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
    })
    .refine((data) => data.userId || data.email, {
      message: "Either userId or email must be provided",
    });

  export const resendOtpSchema = z
    .object({
      userId: z.string().uuid().optional(),
      email: z.string().email().optional(),
      type: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
    })
    .refine((data) => data.userId || data.email, {
      message: "Either userId or email must be provided",
    });
  ```

- `forgotPasswordSchema`: `{ email: z.string().email() }` (Returns `200 OK` `{ success: true, userId, message }` so the UI has `userId` for optional `resend-otp` calls).
- `resetPasswordSchema`: `{ email: z.string().email(), code: z.string().length(6), newPassword: z.string().min(8)... }`.

#### Registration & Re-Trigger Flow (`AuthService.register` — `[FRS-1.1.1, FRS-1.1.5, BUG-6 Fix]`)

1. **Input Validation**: `z.parse(registerSchema)` validates email format and password complexity (`[FRS-1.1.3]`).
2. **Account Check**:
   - If `User` exists with `isVerified = true`, return `409 Conflict` (`Account already exists`).
   - If `User` exists with `isVerified = false`, check `OtpCode` table. If the latest OTP for `EMAIL_VERIFICATION` was created less than `APP_LIMITS.OTP_RESEND_COOLDOWN_SECONDS (60s)` ago, return `429 Too Many Requests` (`[FRS-1.2.3]`). Otherwise, update `passwordHash` if provided, generate a new 6-digit OTP (`[FRS-1.2.1]`), invalidate prior pending OTPs, and return **`200 OK`** `{ success: true, isReTriggered: true, userId }` (`[FRS-1.1.5]`).
   - If `User` does not exist, hash password via Bcrypt (`rounds=12`), create `User` (`isVerified = false`), generate 6-digit OTP (`expiresIn = 10m`), log OTP clearly to server console (`[FRS-1.2.1]`), and return **`201 Created`** `{ success: true, isReTriggered: false, userId }` (`[FRS-1.1.5]`).

#### OTP Verification & Distinct Terminal States (`AuthService.verifyOtp` — `[FRS-1.2.2, FRS-1.2.4a, BUG-1 Fix]`)

1. **Lookup & State Check**: Resolve user by `userId` or `email` (`[BUG-4 Fix]`). Query pending `OtpCode` matching `userId` and `type` ordered by `createdAt DESC LIMIT 1`.
   - If `otp.status === 'INVALIDATED' || otp.attempts >= APP_LIMITS.OTP_MAX_ATTEMPTS (3)`, return `429 Too Many Requests` (`Maximum verification attempts exceeded [FRS-1.2.4a]`).
   - If no record found or `expiresAt < now()` or `status !== 'PENDING'`, return `400 Bad Request` (`OTP expired or invalid`).
2. **Brute-Force Verification Logic (`[FRS-1.2.4, FRS-1.2.4a, BUG-1 Fix]`)**:
   Compare submitted `code` against `codeHash`:
   - **On Mismatch**: Calculate `newAttempts = otp.attempts + 1`.
     - If `newAttempts >= APP_LIMITS.OTP_MAX_ATTEMPTS (3)`, immediately update `OtpCode` setting `attempts = newAttempts` AND `status = INVALIDATED` (`[FRS-1.2.4a]`), commit transaction, and return `429 Too Many Requests` (`Maximum verification attempts exceeded. Please request a new code [FRS-1.2.4]`).
     - If `newAttempts < 3`, update `OtpCode.attempts = newAttempts` and return `400 Bad Request` (`Invalid OTP code. Attempts remaining: ${3 - newAttempts}`).
3. **On Success (`CONSUMED` State — `[FRS-1.2.4a]`)**:
   Update `OtpCode.status = CONSUMED`, update `User.isVerified = true` (or reset password if `PASSWORD_RESET`), commit transaction, and return `200 OK`.

#### Rate-Limited Login Flow (`AuthService.login` & `checkLoginRateLimit` Middleware — `[FRS-1.3.1, FRS-1.3.4, BUG-5 Fix]`)

- **Login Rate-Limiter (`checkLoginRateLimit` Middleware — `[FRS-1.3.4]`)**:
  To enforce exact email-level rate limiting (`[FRS-1.3.4]`) while preventing IP rotation bypasses, the middleware checks failed login attempts strictly by `email`:
  $$\text{failedCount} = \text{prisma.loginAttempt.count}(\{\text{where: } \{\text{email: req.body.email, attemptedAt: } \{\text{gte: now() - 15m}\}\}\})$$
  If `failedCount >= APP_LIMITS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS (5)`, return `429 Too Many Requests` (`Too many login attempts for this email. Try again in 15 minutes [FRS-1.3.4]`).
- **Login Execution (`[BUG-5 Fix]`)**:
  1. Verify `email` and `password` against `users` table.
  2. **On Failure (`invalid password` or `unverified account`)**: Insert a failure tracking record into `login_attempts` (`prisma.loginAttempt.create({ data: { email, ipAddress: req.ip } })`). If account unverified, return `403 Forbidden` (`Account not verified`); otherwise return `401 Unauthorized` (`Invalid credentials`).
  3. **On Success**: Atomically clear consecutive failed attempts via `prisma.loginAttempt.deleteMany({ where: { email } })` (`[BUG-5 Fix]`), revoke prior active `refresh_sessions` for that device (`userAgent`), create new `RefreshSession`, set `HttpOnly` cookie (`refreshToken`), and return `200 OK` `{ accessToken, user }` (`[FRS-1.3.1]`).

---

## 4. Core Features, Fly Tags & Search Snippets (`[FRS §2, §3, §4, §5, §6]`)

### 4.1 Note CRUD & Layered Request Flow (`[FRS-2.1]`)

All note operations strictly enforce owner isolation (`where: { userId }`) and pass through the 5-layer monorepo request flow:

1. **Router (`apps/api/src/routers/note.router.ts`)**: Receives request at `/api/v1/notes` with `requireAuth` middleware attached.
2. **Controller (`NoteController.create`)**: Invokes `createNoteSchema.parse(req.body)` from `packages/shared`. Validates `title` (`1..200 chars [FRS-2.1.4]`), `body` (`max 100,000 chars`), and optional `tagIds`.
3. **Service (`NoteService.createNote` & `NoteService.updateNote` — `[BUG-7 Fix]`)**: Orchestrates a Prisma transaction (`$transaction`):
   - **IDOR Ownership Verification (`[BUG-7 Fix]`)**: If `tagIds` (`UUID[]`) is provided, query `prisma.tag.count({ where: { id: { in: tagIds }, userId: req.user.id } })`. If the count does not strictly equal `tagIds.length`, abort transaction and return `403 Forbidden` / `404 Not Found` (`Cannot attach unauthorized or non-existent tags`).
   - Creates/Updates the `Note` record (`title, body, userId`).
   - Assigns or replaces `NoteTag` join rows for verified `tagIds` (`[FRS-2.1.1]`).
   - Automatically generates or throttles the `NoteVersion` snapshot per 5-minute window (`[FRS-6.1]`).
4. **Repository (`NoteRepository.create`)**: Executes exact database queries via Prisma Client.
5. **Response**: Returns `201 Created` with `NoteResponse` DTO (`[FRS-2.1.1]`).

---

### 4.2 Fly Tags Dynamic Creation Flow (`[FRS-3.1, FRS-3.4]`)

To support uninterrupted rich-text note organization (`[FRS-3.1]`), the frontend and backend coordinate seamless "Fly Tag" creation:

- **Frontend Flow (`TagCombobox.tsx`)**: As the user types a tag string (`e.g. "DevOps"`), the UI checks existing tags. If no match exists, a `"Create new tag: 'DevOps'"` option appears. Upon selection, the frontend immediately posts `POST /api/v1/tags` (`{ name: "DevOps", color: "#6B7280" }`).
- **Backend Flow (`TagService.createTag`)**: Validates exact unique name via `citext` (`[FRS-3.1]`) and `#RRGGBB` color regex (`[FRS-3.4]`). If tag already exists for the workspace, returns the existing tag (`200 OK` or `409 Conflict` handled gracefully); otherwise creates the `Tag` (`201 Created`) and returns the new `TagResponse`. The frontend immediately appends the new `Tag.id` to the note's active tag list (`[FRS-3.1]`).

---

### 4.3 Full-Text Search & Custom Sentinel Snippets Flow (`[FRS-4.1, FRS-4.2]`)

Search queries against `GET /api/v1/search?q=query` utilize PostgreSQL full-text search (`tsvector` GIN index) and custom sentinel markers (`[[[MARK]]]` and `[[[MARK_END]]]`) (`[FRS-4.2.1]`):

- **Backend Search Query (`NoteRepository.searchNotes`)**: Executes `$queryRaw` utilizing `ts_headline` with exact custom sentinels to prevent HTML injection while isolating matched text:
  ```sql
  SELECT n.id, n.title, n.updated_at,
         ts_headline('english', n.body, plainto_tsquery('english', $2),
                     'StartSel=[[[MARK]]], StopSel=[[[MARK_END]]], MaxWords=35, MinWords=15') AS snippet,
         ts_rank(n.search_vector, plainto_tsquery('english', $2)) AS rank
  FROM notes n
  WHERE n.user_id = $1 AND n.deleted_at IS NULL AND n.search_vector @@ plainto_tsquery('english', $2)
  ORDER BY rank DESC, n.updated_at DESC
  LIMIT $3 OFFSET $4;
  ```
- **Frontend Rendering Flow (`SnippetHighlight.tsx`)**: Receives `snippet` string containing sentinel markers (`e.g. "Fixing the [[[MARK]]]database[[[MARK_END]]] connection issue..."`). The React component splits the string precisely on regex `/(\[\[\[MARK\]\]\]|\[\[\[MARK_END\]\]\])/g` and renders text between markers inside `<mark className="bg-amber-200 text-amber-950 font-semibold px-1 rounded">` without ever using `dangerouslySetInnerHTML` (`[FRS-4.2.1]`).

---

### 4.4 Version History & 5-Minute Debounced Snapshot Flow (`[FRS-6.1 - 6.5]`)

To balance granular version recovery (`[FRS-6.3]`) with database storage optimization, note updates (`PATCH /api/v1/notes/:id`) enforce strict snapshot throttling:

- **Backend Throttling Rule (`NoteService.updateNote` — `[FRS-6.1]`)**:
  1. Inspect `isExplicitSave` boolean flag in `updateNoteSchema`. If `isExplicitSave === true` (e.g. user pressed `Ctrl+S` or clicked explicit Save), bypass throttling and immediately insert a new `NoteVersion` snapshot (`[FRS-6.1]`).
  2. If `isExplicitSave === false` (background TipTap autosave), query `NoteVersion` for the most recent snapshot matching `noteId` ordered by `createdAt DESC`.
  3. If the elapsed time since the last snapshot is less than `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES (5 minutes)`, update ONLY the parent `Note` table (`title, body, updatedAt`) without creating a `NoteVersion` snapshot (`[FRS-6.1]`).
  4. If elapsed time is $\ge 5\text{ minutes}$, insert a fresh `NoteVersion` snapshot alongside updating the `Note` table (`[FRS-6.1]`).
- **Restore Flow (`POST /api/v1/notes/:id/versions/:vId/restore` — `[FRS-6.4]`)**: Restoring a historical version does **NOT** overwrite or delete intermediate versions. Instead, the service copies `titleSnapshot` and `bodySnapshot` from `:vId`, overwrites the parent `Note`, and appends a brand new `NoteVersion` record representing the restoration event (`[FRS-6.4]`).

---

### 4.5 Frontend UX Parity & Responsive Architecture (`[FRS §7]`)

The frontend SPA (`apps/web`) must provide exact UX parity with the architectural contracts (`[FRS §7]`):

- **Real-Time Saving Status Badge (`[FRS-7.2]`)**: TipTap editor container mounts `<AutosaveIndicator status={status} />` reflecting exact state (`SAVING...` during debounced `PATCH` requests, `SAVED` upon `200 OK` confirmation, and `ERROR` with retry prompt if connection drops).
- **Side-by-Side Version Preview Modal (`[FRS-7.4]`)**: Clicking a version inside `<VersionHistoryDrawer />` opens `<VersionPreviewModal />` displaying a side-by-side or tabbed diff comparison between `currentNote.body` and `selectedVersion.bodySnapshot` alongside an explicit `Restore This Version` confirmation button (`[FRS-7.4]`).
- **Responsive Viewport Drawer Breakpoints (`[FRS-7.5]`)**: Navigation and layout drawers strictly adapt based on viewport size:
  - **Desktop (`>= 1024px`)**: Left `<SidebarNav />` (`260px` fixed) and right `<VersionHistoryDrawer />` (`320px` fixed) render as persistent, non-overlapping side panels (`[FRS-7.5]`).
  - **Mobile / Tablet (`< 1024px`)**: Sidebars collapse into slide-over overlay drawers (`<Sheet />` or `<Dialog />`) backed by backdrop blur and swipe/ESC dismissal, preserving 100% viewport width for `<TipTapEditor />` (`[FRS-7.5]`).

---

## 5. Cross-Cutting Non-Functional & Automated Cleanup Architecture (`[FRS §8, §8a]`)

### 5.1 TanStack Query & Server-Side Filtering/Pagination Flow (`[FRS-2.3, FRS-8.4]`)

All note listings strictly execute server-side filtering, pagination, and sorting (`[FRS-2.3, FRS-8.4]`). Client-side array filtering of notes is strictly prohibited (`[FRS-8.4]`).

- **Shared DTO Contract (`filterNotesSchema`)**:
  ```typescript
  export const filterNotesSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(APP_LIMITS.PAGE_SIZE_MAX)
      .default(APP_LIMITS.PAGE_SIZE_DEFAULT),
    sort: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    tags: z.string().optional(), // Comma-separated tag tokens e.g. "Work,Urgent"
    tagMode: z.enum(["ALL", "ANY"]).default("ALL"), // Default ALL (AND) per [FRS-2.3.3]
    q: z.string().optional(),
  });
  ```
- **Backend Query Logic (`NoteRepository.listActiveNotes`)**:
  - Enforces `deletedAt: null` (`[FRS-2.2.3, FRS-8.1]`).
  - If `tags` provided with `tagMode = 'ALL'` (`[FRS-2.3.3]`), constructs `where.AND = tagList.map(tag => ({ noteTags: { some: { tag: { name: { equals: tag, mode: 'insensitive' } } } } }))`.
  - If `tagMode = 'ANY'`, constructs `where.noteTags = { some: { tag: { name: { in: tagList, mode: 'insensitive' } } } }`.
  - Secondary sort tiebreaker strictly appends `{ createdAt: 'desc' }` as the stable tiebreaker (`[FRS-2.3.4]`).
- **TanStack Query Refetching (`[FRS-8.4]`)**: Frontend hooks (`useActiveNotes(params)`) use query key `['notes', 'list', params]`, automatically triggering server refetches whenever sort, tag, or page selection changes.

---

### 5.2 Trash Listing Query Stage-1 Window Enforcement (`[FRS-2.3.6]`)

As mandated by `[FRS-2.3.6]`, the Trash listing query (`GET /api/v1/notes/trash`) must independently enforce the 30-day Stage-1 window directly inside the database query (`deletedAt` within the last `APP_LIMITS.TRASH_STAGE_1_DAYS`), rather than relying solely on the restore action's validation check (`[FRS-2.3.6]`). Furthermore, the query must always return notes ordered strictly by `deletedAt` descending (`orderBy: { deletedAt: 'desc' }`) with zero client-side or user-configurable sorting permitted (`[FRS-2.3.6]`).

---

### 5.3 Unified Nightly Cleanup Job (`[FRS-8a.1 - FRS-8a.5]`)

The backend schedules a unified, idempotent `node-cron` job executing nightly at 03:00 AM UTC (`[FRS-8a.3]`). It sequentially purges all expired data categories across the database in a single pass without locking active user sessions (`[FRS-8a.4]`):

1. **Pass 1 — Stage 2 Trash Permanent Purge (`[FRS-2.2.6, FRS-8a.1]`)**:
   - Computes exact summation threshold:
     $$\text{stage2Cutoff} = \text{now()} - (\text{APP\_LIMITS.TRASH\_STAGE\_1\_DAYS} + \text{APP\_LIMITS.TRASH\_STAGE\_2\_DAYS}) \times 24 \times 60 \times 60 \times 1000$$
   - Executes `prisma.note.deleteMany({ where: { deletedAt: { not: null, lt: stage2Cutoff } } })`. Cascading foreign keys (`onDelete: Cascade`) permanently wipe all associated `NoteVersion`, `NoteTag`, and `ShareLink` records.

2. **Pass 2 — Expired Version History Purge (`[FRS-6.5, FRS-8a.1, BUG-3 Fix]`)**:
   - Computes version threshold: $\text{versionCutoff} = \text{now()} - \text{APP\_LIMITS.VERSION\_RETENTION\_DAYS (90d)}$.
   - Executes exact `$executeRaw` SQL deletion ensuring the absolute latest snapshot per note is strictly exempted (`[FRS-6.5]`):
     ```sql
     DELETE FROM note_versions
     WHERE created_at < $1
       AND id NOT IN (
         SELECT DISTINCT ON (note_id) id
         FROM note_versions
         ORDER BY note_id, created_at DESC
       );
     ```

3. **Pass 3 — Expired & Consumed OTP Purge (`[FRS §10 Row 17, FRS-8a.2, BUG-2 Fix]`)**:
   - Computes 24-hour retention threshold: $\text{otpCutoff} = \text{now()} - \text{APP\_LIMITS.STALE\_RECORD\_PURGE\_HOURS (24h)}$.
   - Strictly enforces that `CONSUMED` and `INVALIDATED` records must be at least 24 hours old before deletion (`[BUG-2 Fix]`):
     ```typescript
     await prisma.otpCode.deleteMany({
       where: {
         OR: [
           {
             status: { in: ["CONSUMED", "INVALIDATED"] },
             updatedAt: { lt: otpCutoff },
           },
           { status: "PENDING", expiresAt: { lt: otpCutoff } },
         ],
       },
     });
     ```

4. **Pass 4 — Revoked & Expired Refresh Session Purge (`[FRS-8a.2]`)**:
   - Computes session threshold: $\text{sessionCutoff} = \text{now()} - \text{APP\_LIMITS.STALE\_RECORD\_PURGE\_HOURS (24h)}$.
   - Executes:
     ```typescript
     await prisma.refreshSession.deleteMany({
       where: {
         OR: [
           { revokedAt: { not: null, lt: sessionCutoff } },
           { expiresAt: { lt: sessionCutoff } },
         ],
       },
     });
     ```

5. **Pass 5 — Stale Login Attempt Purge (`[FRS-1.3.4, FRS-8a.2]`)**:
   - Computes login threshold: $\text{loginCutoff} = \text{now()} - \text{APP\_LIMITS.STALE\_LOGIN\_PURGE\_HOURS (24h)}$.
   - Executes `prisma.loginAttempt.deleteMany({ where: { attemptedAt: { lt: loginCutoff } } })`.

---

## 6. OpenSpec AI Governance & Slash Commands (`[FRS §0.2, §0.3]`)

### 6.1 AI Governance Brain (`AGENTS.md` & `CLAUDE.md` — `[FRS-0.2]`)

To maintain strict compliance across all development phases (`Tickets AB-1001 to AB-1016`), the monorepo mounts strict AI context instructions:

- **`AGENTS.md` (Root AI Brain, `<200 lines`)**: Contains universal project rules, architecture layering boundaries, and mandatory reference pointers (`[Rule 11/12/13/14]`).
- **`CLAUDE.md` Hierarchy**: Root `CLAUDE.md` enforces permission models and commit rules (`[Rule 14]`). Domain `CLAUDE.md` files inside `apps/api/`, `apps/web/`, and `packages/shared/` enforce exact workspace rules (`[FRS-0.2]`).

---

### 6.2 Slash Commands & Sub-Agents Architecture (`/start - /pr`, `reviewer.md`, `test-writer.md` — `[FRS-0.3]`)

OpenSpec (`@fission-ai/openspec`) slash commands (`[FRS-0.3]`) orchestrate the development lifecycle inside `.claude/commands/`:

| Command      | Execution Workflow & Spec Task                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/start`     | Inspect workspace state, verify Node v24/PostgreSQL 16, run `pnpm install --frozen-lockfile`, and check active branch.                                  |
| `/spec`      | Parse target ticket `AB-10xx`, extract exact `[FRS-x.y.z]` requirements, and generate structured behavioral specification scenarios (`spec.md`).        |
| `/plan`      | Map `spec.md` against `SDS.md` architectural contracts and generate step-by-step technical implementation plan (`implementation_plan.md`).              |
| `/tasks`     | Deconstruct `implementation_plan.md` into granular, trackable `task.md` checklist items (`[ ]`, `[/]`, `[x]`).                                          |
| `/implement` | Execute code changes cleanly across layered architecture (`routers -> controllers -> services -> repositories -> shared`).                              |
| `/review`    | Dispatch read-only `reviewer.md` sub-agent to audit code changes against `FRS.md` and `SDS.md` for 100% compliance.                                     |
| `/pr`        | Run CI suite (`pnpm turbo run lint typecheck build test`), format canonical commit header (`feat(scope): description AB#ticket`), and generate PR body. |

#### Read-Only Sub-Agents (`.claude/agents/`)

- **`reviewer.md`**: Independent read-only compliance checker. Scans every pull request diff to verify that: (1) no token is written to `localStorage`, (2) every route uses `/api/v1`, (3) error codes match `API_ERROR_CODES`, and (4) exact `[FRS-x.y.z]` traceability IDs are documented in PR descriptions.
- **`test-writer.md`**: Dedicated test engineering sub-agent. Dispatched immediately upon `/spec` completion to autonomously write comprehensive unit, contract (`supertest`), and E2E (`playwright`) tests decoupled from implementation code.

---

### 6.3 Live Documentation Verification Rule (`[FRS-0.3.1]`)

To prevent AI hallucination of deprecated or non-existent library APIs across modern packages (`Prisma 5+`, `Express 5`, `TanStack Query v5`, `React 19`, `Zod`, `TipTap`), any agent or sub-agent must execute **Live Documentation Verification (`[FRS-0.3.1]`)**:

- Before generating code utilizing external framework methods, the agent MUST query the live documentation or context MCP server (`@modelcontextprotocol/server-fetch` or Context-MCP documentation lookup) to confirm exact method signatures, options enums, and return types.

---

## 7. API Route Matrix & Data Contract Mapping (`[Tickets AB-1001 through AB-1016]`)

Every HTTP route is namespace-versioned under `/api/v1` (`[FRS-8.6]`) and backed by interactive Swagger documentation at `/api/v1/docs` (`[FRS-8.7]`).

> **Architectural Note on `FRS.md` Ticket Mapping Table Row 8 (`AB-1016`):**  
> Row 8 of the `FRS.md` Ticket Mapping table cites `[FRS §10 DOD]` for E2E Full User Journey verification (`AB-1016`). Note that `FRS §10` is the **Open Decisions Log**, while the actual Definition of Done (`DOD`) lives in the main Assignment specification. When running `/spec AB-1016` and implementing verification tests (`playwright` / E2E), developers and AI sub-agents (`test-writer.md`) SHALL verify against the complete E2E user journey across all FRS sections (`§1` through `§8a`) alongside the Assignment DOD criteria (`[FRS §10 DOD citation note]`).

| Method     | Endpoint Path                             | Auth?       | Request DTO Schema (`packages/shared`)                                | Response DTO / Description & FRS Mapping                                                                                                                                                     |
| ---------- | ----------------------------------------- | ----------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **POST**   | `/api/v1/auth/register`                   | No          | `registerSchema` (`email, password`)                                  | `201 Created` (`New user [BUG-6 Fix]`) OR `200 OK` (`Re-triggered unverified account [FRS-1.1.5]`) `{ success: true, isReTriggered: boolean, userId }`. Logs OTP to console (`[FRS-1.2.1]`). |
| **POST**   | `/api/v1/auth/verify-otp`                 | No          | `verifyOtpSchema` (`userId` OR `email`, `code, type` — `[BUG-4 Fix]`) | `200 OK` `{ success: true, message }`. Enforces 3-attempt brute force & marks OTP `CONSUMED` (`[FRS-1.2.2, FRS-1.2.4a]`).                                                                    |
| **POST**   | `/api/v1/auth/resend-otp`                 | No          | `resendOtpSchema` (`userId` OR `email`, `type` — `[BUG-4 Fix]`)       | `200 OK` (`60s` cooldown checked `[FRS-1.2.3]`).                                                                                                                                             |
| **POST**   | `/api/v1/auth/login`                      | No          | `loginSchema` (`email, password`)                                     | `200 OK` `{ accessToken, user }` + `HttpOnly` refresh cookie. Rate-limited at 5 attempts (`[FRS-1.3.1, FRS-1.3.4, FRS-1.3.5]`).                                                              |
| **POST**   | `/api/v1/auth/refresh`                    | No (Cookie) | None (Reads `refreshToken` cookie)                                    | `200 OK` `{ accessToken, user }` + rotated `HttpOnly` cookie (`[FRS-1.3.3, FRS-1.3.5]`).                                                                                                     |
| **POST**   | `/api/v1/auth/logout`                     | Yes         | None                                                                  | `200 OK` (`Revokes refresh token & clears cookie [FRS-1.4.1]`).                                                                                                                              |
| **POST**   | `/api/v1/auth/forgot-password`            | No          | `forgotPasswordSchema` (`email`)                                      | `200 OK` `{ success: true, userId, message }` (`[BUG-4 Fix]`). Generates reset OTP (`[FRS-1.5.1, FRS-1.5.2]`).                                                                               |
| **POST**   | `/api/v1/auth/reset-password`             | No          | `resetPasswordSchema` (`email, code, newPassword`)                    | `200 OK`. Marks OTP `CONSUMED` & revokes all refresh sessions (`[FRS-1.5.4, FRS-1.5.6]`).                                                                                                    |
| **POST**   | `/api/v1/notes`                           | Yes         | `createNoteSchema` (`title, body, tagIds`)                            | `201 Created` `{ NoteResponse }`. Creates initial `NoteVersion` snapshot (`[FRS-2.1.1, FRS-6.1]`).                                                                                           |
| **GET**    | `/api/v1/notes`                           | Yes         | Query params (`sort, order, tags, tagMode, page, limit`)              | `200 OK` `{ PaginatedNotesResponse }`. Server-side sort and tag filter (`[FRS-2.3, FRS-8.4]`).                                                                                               |
| **GET**    | `/api/v1/notes/trash`                     | Yes         | Query params (`page, limit`)                                          | `200 OK` `{ PaginatedNotesResponse }`. Returns Stage 1 trashed notes (`[FRS-2.2.2, FRS-2.3.6]`).                                                                                             |
| **GET**    | `/api/v1/notes/:id`                       | Yes         | URL Param `id: UUID`                                                  | `200 OK` `{ NoteResponse }`. Returns `404` if note in Trash (`[FRS-2.1.2, FRS-2.2.3]`).                                                                                                      |
| **PATCH**  | `/api/v1/notes/:id`                       | Yes         | `updateNoteSchema` (`title?, body?, tagIds?`, `isExplicitSave?`)      | `200 OK` `{ NoteResponse }`. Applies 5-min snapshot throttling & checks `deleted_at IS NULL` (`[FRS-6.1]`).                                                                                  |
| **DELETE** | `/api/v1/notes/:id`                       | Yes         | URL Param `id: UUID`                                                  | `200 OK`. Sets `deletedAt = now()` (`Stage 1 Trash [FRS-2.2.1]`) and revokes share links (`revokedAt = now() [FRS-2.2.4]`).                                                                  |
| **POST**   | `/api/v1/notes/:id/restore`               | Yes         | URL Param `id: UUID`                                                  | `200 OK` `{ NoteResponse }`. Restores (`deletedAt = null`), requires `deletedAt >= now() - 30d` (`404 if Stage 2 [FRS-2.2.5]`).                                                              |
| **DELETE** | `/api/v1/notes/:id/permanent`             | Yes         | `permanentDeleteSchema` (`{ confirm: true }`)                         | `200 OK`. Deletes note forever (`[FRS-2.2.8]`), requires `deletedAt >= now() - 30d` (`404 if Stage 2 [FRS-2.2.5]`).                                                                          |
| **GET**    | `/api/v1/notes/:id/versions`              | Yes         | URL Param `id: UUID`                                                  | `200 OK` `{ versions: NoteVersionSummaryResponse[] }` (`[FRS-6.2]`).                                                                                                                         |
| **GET**    | `/api/v1/notes/:id/versions/:vId`         | Yes         | URL Params `id, vId: UUID`                                            | `200 OK` `{ NoteVersionResponse }` (`Full content [FRS-6.3]`).                                                                                                                               |
| **POST**   | `/api/v1/notes/:id/versions/:vId/restore` | Yes         | URL Params `id, vId: UUID`                                            | `200 OK` `{ NoteResponse }`. Appends restored content as brand new top version (`[FRS-6.4]`).                                                                                                |
| **POST**   | `/api/v1/notes/:id/share`                 | Yes         | `createShareLinkSchema` (`expiresInDays: 1..30`)                      | `201 Created` `{ ShareLinkResponse }` (`[FRS-5.1, FRS-5.2]`).                                                                                                                                |
| **DELETE** | `/api/v1/notes/:id/share`                 | Yes         | URL Param `id: UUID`                                                  | `200 OK`. Sets `revokedAt = now()` (`[FRS-5.3]`).                                                                                                                                            |
| **POST**   | `/api/v1/tags`                            | Yes         | `createTagSchema` (`name, color`)                                     | `201 Created` `{ TagResponse }`. Fly Tag dynamic creation (`[FRS-3.1, FRS-3.4]`).                                                                                                            |
| **GET**    | `/api/v1/tags`                            | Yes         | None                                                                  | `200 OK` `{ tags: TagResponse[] }`. Includes live non-deleted `noteCount` (`[FRS-3.2]`).                                                                                                     |
| **PATCH**  | `/api/v1/tags/:id`                        | Yes         | `updateTagSchema` (`name?, color?`)                                   | `200 OK` `{ TagResponse }` (`[FRS-3.1]`).                                                                                                                                                    |
| **DELETE** | `/api/v1/tags/:id`                        | Yes         | URL Param `id: UUID`                                                  | `200 OK`. Removes tag without deleting associated notes (`[FRS-3.3]`).                                                                                                                       |
| **GET**    | `/api/v1/search`                          | Yes         | Query params (`q, page, limit`)                                       | `200 OK` `{ PaginatedSearchResponse }`. Full-text search with sentinel highlights (`[FRS-4.1, FRS-4.2.1]`).                                                                                  |
| **GET**    | `/api/v1/public/share/:token`             | **No**      | URL Param `token: string`                                             | `200 OK` `{ PublicNoteResponse }`. Executes atomic view increment & live `deleted_at IS NULL` check (`[FRS-5.4, FRS-2.2.4, FRS-8.1]`).                                                       |

---

## 8. Complete FRS-to-SDS Traceability Matrix

Every requirement in `FRS.md` v1.2 maps directly to an architectural and data contract component in this specification:

| FRS Requirement ID     | Requirement Description Summary                                             | Exact Technical Mapping in `SDS.md`                                                                               |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `[FRS-0.1]`            | `pnpm workspaces` + `Turborepo` monorepo (`api`, `web`, `shared`, `config`) | Section 1.1: Complete monorepo tree, `turbo.json` (`^build`), and runtime boundaries.                             |
| `[FRS-0.2]`            | AI Governance Brain (`AGENTS.md`, `CLAUDE.md`)                              | Section 6.1: Exact lines and domain specific instructions across root and package `CLAUDE.md`.                    |
| `[FRS-0.3]`            | OpenSpec Slash commands & read-only sub-agents                              | Section 6.2: Complete slash command lifecycle table (`/start - /pr`) + `reviewer.md` and `test-writer.md`.        |
| `[FRS-0.3.1]`          | Live documentation verification rule against hallucination                  | Section 6.3: Mandatory MCP documentation query rule before third-party API code generation.                       |
| `[FRS-0.4]`            | PostgreSQL 16 + Docker + Prisma ORM baseline                                | Section 1.5 (`docker-compose.yml`) & Section 2.1 (`schema.prisma` plus raw SQL extensions migration).             |
| `[FRS-0.5, Rule 14]`   | Strict git hooks and canonical commit message format                        | Section 1.3: `Husky` + `lint-staged` + `commitlint.config.js` enforcing `feat(scope): description AB#ticket`.     |
| `[FRS-0.6, Rule 12]`   | GitHub Actions CI workflow (`lint, typecheck, tsup build, test`)            | Section 1.4: Concise `.github/workflows/ci.yml` (`pnpm turbo run ...` + `tsup` build + `tsc` typecheck).          |
| `[FRS-1.1.1 - 1.1.4]`  | Registration, case-insensitive email, password complexity                   | Section 2.1 (`citext`), Section 3.2, and `createNoteSchema` validation definitions.                               |
| `[FRS-1.1.5]`          | Duplicate registration with unverified account re-triggers OTP              | Section 3.2: Exact `AuthService.register` implementation returning `200 OK` + 60s cooldown check.                 |
| `[FRS-1.2.1 - 1.2.4]`  | 6-digit OTP verification, 10 min expiry, 3 max attempts                     | Section 1.2 (`APP_LIMITS`), Section 2.1 (`OtpCode` model), Section 3.2 (`verifyOtp` logic).                       |
| `[FRS-1.2.4a]`         | Distinct OTP terminal states (`CONSUMED` vs `INVALIDATED`)                  | Section 2.1 (`OtpStatus` enum) & Section 3.2 diagram and service state updates.                                   |
| `[FRS-1.3.1 - 1.3.5]`  | Login tokens, rate-limiting (5 in 15m), `HttpOnly` + JS memory              | Section 3.1 (`authStore` vs cookie strategy), Section 3.2 (`checkLoginRateLimit` middleware).                     |
| `[FRS-1.4.1]`          | Logout invalidates exact refresh token                                      | Section 7: `POST /api/v1/auth/logout` route matrix and database token revocation (`revokedAt = now()`).           |
| `[FRS-1.5.1 - 1.5.6]`  | Password reset OTP, single-use, revokes all user sessions                   | Section 2.1 (`OtpType.PASSWORD_RESET`), Section 3.2 (`verifyOtp`), Section 7 route contracts.                     |
| `[FRS-2.1.1 - 2.1.6]`  | Note CRUD, owner scoping, title/body length checks (`200 / 100k`)           | Section 2.1 (`@db.VarChar(200)`, `@db.Text`), Section 2.2 (`CHECK` constraints), Section 4.1 flow.                |
| `[FRS-2.2.1 - 2.2.8]`  | Two-stage Trash bin (`30d Stage 1 + 30d Stage 2`), instant delete           | Section 2.1 (`deletedAt`), Section 5.3 (`cleanup.job.ts`), Section 7 `trash/restore/permanent` endpoints.         |
| `[FRS-2.2.4, FRS-8.1]` | Live share-link access check verifying `deletedAt == null`                  | Section 2.2: Atomic `$queryRaw` query `accessAndIncrementShareLink` verifying `AND n.deleted_at IS NULL`.         |
| `[FRS-2.3.1 - 2.3.6]`  | Pagination, server tiebreakers, `tagMode=ALL` default, Trash 30d window     | Section 5.1 (`filterNotesSchema`, `listActiveNotes`), Section 5.2 (`listTrashNotes` Stage-1 window).              |
| `[FRS-3.1 - 3.4]`      | Tags CRUD, Fly Tag creation, unique names, live note counts                 | Section 2.1 (`Tag.name citext`), Section 4.2 (`TagCombobox`), Section 7 route matrix (`GET /api/v1/tags`).        |
| `[FRS-4.1 - 4.5]`      | Full-text search, `tsvector` GIN index, custom sentinel highlights          | Section 2.2 (`search_vector tsvector`), Section 4.3 (`ts_headline` sentinels & `SnippetHighlight.tsx`).           |
| `[FRS-5.1 - 5.6]`      | Public share links, 1-30d expiry, atomic view count, `404` errors           | Section 2.1 (`ShareLink`), Section 2.2 (`$queryRaw` atomic increment), Section 7 live access checks.              |
| `[FRS-6.1 - 6.5]`      | Version history snapshots, 5-minute autosave throttling, 90d purge          | Section 1.2 (`APP_LIMITS`), Section 4.4 (`updateNote` throttle logic), Section 5.3 (`cleanup.job.ts`).            |
| `[FRS-7.1 - 7.5]`      | Frontend TipTap background autosave, responsive UI, confirmations           | Section 4.5 (`Frontend UX Parity`), Section 4.4 (`updateNote` hook), Section 1.2 (`UI_COPY` prompts).             |
| `[FRS-8.1 - 8.7]`      | Cross-cutting rules: UTC timestamps, server-side search/filter, OpenAPI     | Section 1.1 (`app.ts` Swagger), Section 2.1 (`@db.Timestamptz(6)`), Section 5.1 TanStack Query refetching.        |
| `[FRS-8a.1 - 8a.5]`    | Unified automated nightly scheduled cleanup job (`0 3 * * *`)               | Section 5.3: Exact 5-pass `cleanup.job.ts` cron implementation purging Stage 2, versions, OTPs, sessions, logins. |

---

**This Software Design Specification is locked, rigorously complete, concise, and strictly traceable to `FRS.md` v1.2. Developers building Tickets `AB-1001` through `AB-1016` can begin code execution directly from this blueprint.**
