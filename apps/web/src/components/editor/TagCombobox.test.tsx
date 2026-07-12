import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TagListResponseDto, TagResponseDto } from "@shared/core/types";
import * as tagsApi from "@/api/tags.api";
import { TagCombobox } from "@/components/editor/TagCombobox";

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

function buildTag(overrides: Partial<TagResponseDto> = {}): TagResponseDto {
  return {
    id: "tag-work",
    name: "Work",
    color: "#111111",
    noteCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderCombobox(
  onAttach: (tagId: string) => void,
  attachedTagIds: string[] = [],
) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TagCombobox attachedTagIds={attachedTagIds} onAttach={onAttach} />
    </QueryClientProvider>,
  );
}

// [FRS-3.1, FRS-3.4] Fly Tag combobox — create-vs-select paths, case-insensitive dedupe.
describe("TagCombobox ([FRS-3.1] Fly Tag creation/attachment, [FRS-3.4] case-insensitive uniqueness)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("[FRS-3.1] SHALL call onAttach with an existing tag's id and clear the query when that tag is selected from the dropdown", async () => {
    const tagsResponse: TagListResponseDto = { tags: [buildTag()] };
    vi.spyOn(tagsApi, "listTags").mockResolvedValue(tagsResponse);
    const onAttach = vi.fn();
    const user = userEvent.setup();

    renderCombobox(onAttach);

    const input = screen.getByLabelText("Add a tag");
    await user.type(input, "Work");

    const option = await screen.findByRole("button", { name: "Work" });
    await user.click(option);

    expect(onAttach).toHaveBeenCalledWith("tag-work");
    expect(onAttach).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("[FRS-3.4] SHALL show 'Create new tag' only when there is no case-insensitive exact match, and selecting it SHALL createTag then onAttach with the new id", async () => {
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({
      tags: [buildTag({ id: "tag-work", name: "Work" })],
    });
    const createTagSpy = vi
      .spyOn(tagsApi, "createTag")
      .mockResolvedValue(buildTag({ id: "tag-research", name: "Research" }));
    const onAttach = vi.fn();
    const user = userEvent.setup();

    renderCombobox(onAttach);

    const input = screen.getByLabelText("Add a tag");
    await user.type(input, "Research");

    expect(screen.queryByRole("button", { name: "Research" })).toBeNull();
    const createOption = await screen.findByRole("button", {
      name: "Create new tag: 'Research'",
    });

    await user.click(createOption);

    await waitFor(() => expect(createTagSpy).toHaveBeenCalled());
    expect(createTagSpy.mock.calls[0]![0]).toEqual({
      name: "Research",
      color: expect.any(String),
    });
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith("tag-research"));
  });

  it("[FRS-3.4] a query exactly (case-insensitively) matching an existing tag SHALL NOT render the 'Create new tag' option", async () => {
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({
      tags: [buildTag({ id: "tag-work", name: "Work" })],
    });
    const user = userEvent.setup();

    renderCombobox(vi.fn());

    const input = screen.getByLabelText("Add a tag");
    await user.type(input, "WORK");

    await screen.findByRole("button", { name: "Work" });
    expect(screen.queryByRole("button", { name: /Create new tag/ })).toBeNull();
  });

  it("[Error Scenario] when createTag rejects with a non-conflict error code, SHALL toast.error via the centralized dictionary and SHALL NOT call onAttach", async () => {
    vi.spyOn(tagsApi, "listTags").mockResolvedValue({ tags: [] });
    const serverError = {
      isAxiosError: true,
      response: {
        status: 500,
        data: { success: false, error: { code: "INTERNAL_ERROR" } },
      },
    };
    vi.spyOn(tagsApi, "createTag").mockRejectedValue(serverError);
    const onAttach = vi.fn();
    const user = userEvent.setup();

    renderCombobox(onAttach);

    const input = screen.getByLabelText("Add a tag");
    await user.type(input, "Personal");

    const createOption = await screen.findByRole("button", {
      name: "Create new tag: 'Personal'",
    });
    await user.click(createOption);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onAttach).not.toHaveBeenCalled();
  });

  it("[Error Scenario, spec.md 'Fly Tag creation and attachment'] when createTag rejects with TAG_NAME_CONFLICT (409), SHALL fall back to attaching the pre-existing tag by case-insensitive name match instead of showing an error toast", async () => {
    // No exact local match at type-time (the only state in which the "Create new tag"
    // option renders at all), but the server rejects as a duplicate (race with another
    // session/tab, or a citext-collation match the client's simple toLowerCase() missed).
    vi.spyOn(tagsApi, "listTags")
      .mockResolvedValueOnce({ tags: [] })
      .mockResolvedValue({
        tags: [buildTag({ id: "tag-research", name: "Research" })],
      });
    const conflictError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { success: false, error: { code: "TAG_NAME_CONFLICT" } },
      },
    };
    vi.spyOn(tagsApi, "createTag").mockRejectedValue(conflictError);
    const onAttach = vi.fn();
    const user = userEvent.setup();

    renderCombobox(onAttach, []);

    const input = screen.getByLabelText("Add a tag");
    await user.type(input, "Research");

    const createOption = await screen.findByRole("button", {
      name: "Create new tag: 'Research'",
    });
    await user.click(createOption);

    await waitFor(() => expect(tagsApi.createTag).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(onAttach).toHaveBeenCalledTimes(1);
  });
});
