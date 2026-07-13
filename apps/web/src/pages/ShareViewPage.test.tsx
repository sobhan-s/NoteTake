import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UI_COPY } from "@shared/core/constants";
import type { PublicNoteResponseDto } from "@shared/core/types";
import * as shareApi from "@/api/share.api";
import { ShareViewPage } from "@/pages/ShareViewPage";

// Lightweight TipTap double mirroring the pattern used by NoteEditor.test.tsx: exposes
// just enough of the real `Editor`/`EditorContent` surface (commands.setContent/getHTML)
// for a read-only rendering assertion, without requiring a real ProseMirror DOM under jsdom.
vi.mock("@tiptap/react", () => ({
  useEditor: (options: { content?: string }) => {
    const ref = useRef<{
      commands: { setContent: (next: string) => void };
      getHTML: () => string;
    } | null>(null);
    if (!ref.current) {
      let html = options.content ?? "";
      ref.current = {
        commands: {
          setContent: (next: string) => {
            html = next;
          },
        },
        getHTML: () => html,
      };
    }
    return ref.current;
  },
  EditorContent: ({ editor }: { editor: { getHTML: () => string } | null }) => (
    <div
      data-testid="share-body"
      dangerouslySetInnerHTML={{ __html: editor?.getHTML() ?? "" }}
    />
  ),
}));

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildPublicNote(
  overrides: Partial<PublicNoteResponseDto> = {},
): PublicNoteResponseDto {
  return {
    title: "A Shared Note",
    body: "<p>Shared content</p>",
    updatedAt: new Date("2026-01-05T12:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function build404Error(code: string) {
  return {
    isAxiosError: true,
    response: {
      status: 404,
      data: { success: false, error: { code } },
    },
  };
}

function build500Error() {
  return {
    isAxiosError: true,
    response: {
      status: 500,
      data: { success: false, error: { code: "INTERNAL_ERROR" } },
    },
  };
}

function renderPage(token: string = "share-token-1") {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<ShareViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// [Requirement: Public Share Page Fetches and Renders Read-Only Content] `ShareViewPage` behavior.
describe("ShareViewPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("[Scenario: Loading state] SHALL render a skeleton placeholder while the public fetch is in flight", async () => {
    let resolveFetch!: (value: PublicNoteResponseDto) => void;
    const pending = new Promise<PublicNoteResponseDto>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(shareApi, "getPublicShareNote").mockReturnValue(pending);

    const { container } = renderPage();

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("A Shared Note")).toBeNull();

    resolveFetch(buildPublicNote());
    await waitFor(() =>
      expect(screen.getByText("A Shared Note")).toBeDefined(),
    );
  });

  it("[Scenario: Valid link] SHALL render the title as a heading, the body content, and the formatted updatedAt, with zero edit affordances", async () => {
    vi.spyOn(shareApi, "getPublicShareNote").mockResolvedValue(
      buildPublicNote({
        title: "Read-Only Note",
        body: "<p>Read-only body</p>",
        updatedAt: "2026-01-05T12:00:00.000Z",
      }),
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Read-Only Note" }),
    ).toBeDefined();
    expect(screen.getByTestId("share-body").innerHTML).toContain(
      "Read-only body",
    );
    expect(
      screen.getByText(
        `Updated ${new Date("2026-01-05T12:00:00.000Z").toLocaleString(
          undefined,
          { dateStyle: "medium", timeStyle: "short" },
        )}`,
      ),
    ).toBeDefined();

    // Zero edit affordances / owner-identity / navigation to other notes.
    expect(screen.queryByLabelText("Note title")).toBeNull();
    expect(screen.queryByLabelText("Share note")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("[Scenario: Invalid link (any cause)] a nonexistent-token 404 (SHARE_LINK_NOT_FOUND) SHALL render the identical SHARE_LINK_UNAVAILABLE state with no cause disclosed", async () => {
    vi.spyOn(shareApi, "getPublicShareNote").mockRejectedValue(
      build404Error("SHARE_LINK_NOT_FOUND"),
    );

    renderPage();

    expect(
      await screen.findByText(UI_COPY.SHARE_LINK_UNAVAILABLE),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("[Scenario: Invalid link (any cause)] an expired/revoked/trashed 404 (SHARE_LINK_UNAVAILABLE) SHALL render the exact same UI as the nonexistent-token case", async () => {
    vi.spyOn(shareApi, "getPublicShareNote").mockRejectedValue(
      build404Error("SHARE_LINK_UNAVAILABLE"),
    );

    renderPage();

    expect(
      await screen.findByText(UI_COPY.SHARE_LINK_UNAVAILABLE),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("[Scenario: Network/5xx failure] SHALL render ErrorFallback with a Retry action, distinct from the permanent SHARE_LINK_UNAVAILABLE state", async () => {
    const getSpy = vi
      .spyOn(shareApi, "getPublicShareNote")
      .mockRejectedValue(build500Error());
    const user = userEvent.setup();

    renderPage();

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText(UI_COPY.SHARE_LINK_UNAVAILABLE)).toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1);

    await user.click(retryButton);
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });
});
