import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { APP_LIMITS, UI_COPY } from "@shared/core/constants";
import type { ShareLinkResponseDto } from "@shared/core/types";
import * as shareApi from "@/api/share.api";
import { ShareModal } from "@/components/sharing/ShareModal";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildShareLink(
  overrides: Partial<ShareLinkResponseDto> = {},
): ShareLinkResponseDto {
  return {
    noteId: "note-1",
    token: "shared-token-123",
    expiresAt: new Date("2026-02-08T00:00:00.000Z").toISOString(),
    viewCount: 3,
    createdAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function build404Error() {
  return {
    isAxiosError: true,
    response: {
      status: 404,
      data: { success: false, error: { code: "SHARE_LINK_NOT_FOUND" } },
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

function renderModal(onOpenChange: (open: boolean) => void = vi.fn()) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ShareModal noteId="note-1" open={true} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

// [Requirement: Share Modal Fetches Current Link State on Open, Generate Share Link From the Modal,
//  Copy Share Link to Clipboard, Revoke Share Link Requires Explicit Confirmation] `ShareModal` behavior.
// Note: `ShareModal`'s `Dialog.Content`/`ConfirmModal` are portalled to `document.body` by Radix,
// so DOM assertions query `screen`/`document.body`, never the `render()` return's `container`.
describe("ShareModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("[Scenario: Loading state respects minimum display timer] SHALL render a skeleton placeholder while the share-link fetch is in flight", async () => {
    let resolveFetch!: (value: ShareLinkResponseDto) => void;
    const pending = new Promise<ShareLinkResponseDto>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(shareApi, "getShareLink").mockReturnValue(pending);

    renderModal();

    expect(
      document.body.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Copy Link")).toBeNull();
    expect(screen.queryByText("Create Link")).toBeNull();

    resolveFetch(buildShareLink());
    await waitFor(() => expect(screen.getByText("Copy Link")).toBeDefined());
  });

  it("[Scenario: Modal opens for a note with no active link] SHALL render the generate form defaulted to SHARE_LINK_DEFAULT_EXPIRY_DAYS when the fetch returns 404", async () => {
    vi.spyOn(shareApi, "getShareLink").mockRejectedValue(build404Error());

    renderModal();

    const expiryInput = await screen.findByLabelText("Expires in (days)");
    expect((expiryInput as HTMLInputElement).value).toBe(
      String(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS),
    );
    expect(screen.getByRole("button", { name: "Create Link" })).toBeDefined();
    expect(screen.queryByText("Copy Link")).toBeNull();
  });

  it("[Scenario: Modal opens for a note with an active link] SHALL render the shareable URL, formatted expiresAt, viewCount, Copy Link, and Revoke, with no generate form", async () => {
    vi.spyOn(shareApi, "getShareLink").mockResolvedValue(
      buildShareLink({ token: "shared-token-123", viewCount: 3 }),
    );

    renderModal();

    const linkInput = (await screen.findByLabelText(
      "Shareable link",
    )) as HTMLInputElement;
    expect(linkInput.value).toBe(
      `${window.location.origin}/share/shared-token-123`,
    );
    expect(linkInput.readOnly).toBe(true);
    expect(screen.getByText("3 views")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy Link" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined();
    expect(screen.queryByLabelText("Expires in (days)")).toBeNull();
  });

  it("[Scenario: Modal fetch fails on open] SHALL render an inline retry affordance (not the generate form) on a network/5xx error, and Retry SHALL re-invoke the fetch", async () => {
    const getSpy = vi
      .spyOn(shareApi, "getShareLink")
      .mockRejectedValue(build500Error());
    const user = userEvent.setup();

    renderModal();

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByLabelText("Expires in (days)")).toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1);

    await user.click(retryButton);
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["0", "at the exact lower out-of-range boundary"],
    ["31", "at the exact upper out-of-range boundary"],
    ["-5", "negative"],
    ["3.5", "non-integer"],
  ])(
    "[Scenario: Owner enters an out-of-range value] expiry '%s' (%s) SHALL disable Create Link, render an inline validation message, and send no request",
    async (value) => {
      vi.spyOn(shareApi, "getShareLink").mockRejectedValue(build404Error());
      const createSpy = vi.spyOn(shareApi, "createShareLink");
      const user = userEvent.setup();

      renderModal();

      const expiryInput = await screen.findByLabelText("Expires in (days)");
      await user.clear(expiryInput);
      await user.type(expiryInput, value);

      const submitButton = screen.getByRole("button", {
        name: "Create Link",
      }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);
      expect(
        screen.getByText(
          `Enter a whole number between ${APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS} and ${APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS}.`,
        ),
      ).toBeDefined();

      await user.click(submitButton);
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it("[Scenario: Owner submits a valid expiry] SHALL call createShareLink with the chosen expiresInDays and replace the generate form with the active-link view", async () => {
    vi.spyOn(shareApi, "getShareLink").mockRejectedValue(build404Error());
    const createSpy = vi
      .spyOn(shareApi, "createShareLink")
      .mockResolvedValue(buildShareLink({ token: "new-token", viewCount: 0 }));
    const user = userEvent.setup();

    renderModal();

    const expiryInput = await screen.findByLabelText("Expires in (days)");
    await user.clear(expiryInput);
    await user.type(expiryInput, "14");

    await user.click(screen.getByRole("button", { name: "Create Link" }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith("note-1", { expiresInDays: 14 }),
    );
    const linkInput = (await screen.findByLabelText(
      "Shareable link",
    )) as HTMLInputElement;
    expect(linkInput.value).toBe(`${window.location.origin}/share/new-token`);
    expect(screen.queryByLabelText("Expires in (days)")).toBeNull();
  });

  it("[Scenario: Generate request fails] SHALL toast an error via mapApiError and leave the generate form visible unchanged", async () => {
    vi.spyOn(shareApi, "getShareLink").mockRejectedValue(build404Error());
    vi.spyOn(shareApi, "createShareLink").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "NOTE_NOT_FOUND" } },
      },
    });
    const user = userEvent.setup();

    renderModal();

    await screen.findByLabelText("Expires in (days)");
    await user.click(screen.getByRole("button", { name: "Create Link" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText("Expires in (days)")).toBeDefined();
    expect(screen.queryByLabelText("Shareable link")).toBeNull();
  });

  it("[Scenario: Copy succeeds] Copy Link SHALL call navigator.clipboard.writeText with the full share URL and toast SHARE_LINK_COPIED_SUCCESS for 3000ms", async () => {
    vi.spyOn(shareApi, "getShareLink").mockResolvedValue(
      buildShareLink({ token: "copy-me" }),
    );
    // `userEvent.setup()` attaches its own clipboard stub to `navigator.clipboard`
    // (unconditionally, regardless of the `writeToClipboard` option) — so the stub
    // must be spied on AFTER setup(), never assigned/defined beforehand.
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    renderModal();

    await screen.findByLabelText("Shareable link");
    await user.click(screen.getByRole("button", { name: "Copy Link" }));

    await waitFor(() =>
      expect(writeTextSpy).toHaveBeenCalledWith(
        `${window.location.origin}/share/copy-me`,
      ),
    );
    expect(toast.success).toHaveBeenCalledWith(
      UI_COPY.SHARE_LINK_COPIED_SUCCESS,
      { duration: 3000 },
    );
  });

  it("[Scenario: Copy fails (clipboard API unavailable or permission denied)] SHALL toast a generic error for 5000ms and no fallback UI", async () => {
    vi.spyOn(shareApi, "getShareLink").mockResolvedValue(buildShareLink());
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );

    renderModal();

    await screen.findByLabelText("Shareable link");
    await user.click(screen.getByRole("button", { name: "Copy Link" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [message, options] = (toast.error as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(message).toBe("Something went wrong. Please try again.");
    expect(options).toEqual({ duration: 5000 });
  });

  it("[Scenario: Owner clicks Revoke] SHALL open a ConfirmModal with heading 'Revoke Public Share Link' and the exact CONFIRM_REVOKE_SHARE_LINK body", async () => {
    vi.spyOn(shareApi, "getShareLink").mockResolvedValue(buildShareLink());
    const user = userEvent.setup();

    renderModal();

    await screen.findByLabelText("Shareable link");
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("Revoke Public Share Link")).toBeDefined();
    expect(screen.getByText(UI_COPY.CONFIRM_REVOKE_SHARE_LINK)).toBeDefined();
  });

  it("[Scenario: Owner cancels the confirmation] SHALL send no DELETE request and leave the active-link view unchanged", async () => {
    vi.spyOn(shareApi, "getShareLink").mockResolvedValue(buildShareLink());
    const revokeSpy = vi.spyOn(shareApi, "revokeShareLink");
    const user = userEvent.setup();

    renderModal();

    await screen.findByLabelText("Shareable link");
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await screen.findByText("Revoke Public Share Link");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("Revoke Public Share Link")).toBeNull(),
    );
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Shareable link")).toBeDefined();
  });

  it("[Scenario: Owner confirms revoke] the destructive confirm button SHALL call DELETE, close the confirm modal, and re-render the generate form", async () => {
    vi.spyOn(shareApi, "getShareLink")
      .mockResolvedValueOnce(buildShareLink())
      .mockRejectedValue(build404Error());
    const revokeSpy = vi
      .spyOn(shareApi, "revokeShareLink")
      .mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderModal();

    await screen.findByLabelText("Shareable link");
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const confirmDialog = (await screen.findAllByRole("dialog")).find((d) =>
      within(d).queryByText("Revoke Public Share Link"),
    );
    expect(confirmDialog).toBeDefined();

    await user.click(
      within(confirmDialog!).getByRole("button", { name: "Revoke" }),
    );

    await waitFor(() => expect(revokeSpy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("Revoke Public Share Link")).toBeNull(),
    );
    expect(await screen.findByLabelText("Expires in (days)")).toBeDefined();
  });

  it("[Scenario: Revoke request fails] SHALL toast an error via mapApiError and re-fetch current state rather than assume success (active link remains)", async () => {
    vi.spyOn(shareApi, "getShareLink").mockResolvedValue(
      buildShareLink({ token: "still-active" }),
    );
    vi.spyOn(shareApi, "revokeShareLink").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { success: false, error: { code: "SHARE_LINK_NOT_FOUND" } },
      },
    });
    const user = userEvent.setup();

    renderModal();

    await screen.findByLabelText("Shareable link");
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const confirmDialog = (await screen.findAllByRole("dialog")).find((d) =>
      within(d).queryByText("Revoke Public Share Link"),
    );

    await user.click(
      within(confirmDialog!).getByRole("button", { name: "Revoke" }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const linkInput = (await screen.findByLabelText(
      "Shareable link",
    )) as HTMLInputElement;
    expect(linkInput.value).toBe(
      `${window.location.origin}/share/still-active`,
    );
  });
});
