import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SearchResultResponseDto } from "@shared/core/types";
import { SearchResultRow } from "@/components/search/SearchResultRow";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function buildResult(
  overrides: Partial<SearchResultResponseDto> = {},
): SearchResultResponseDto {
  return {
    id: "note-42",
    title: "Architecture Notes",
    snippet: "This is an [[[MARK]]]architecture[[[MARK_END]]] note.",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SearchResultRow ([FRS-4.3] clicking a search result opens the note editor)", () => {
  afterEach(() => {
    cleanup();
    navigateMock.mockClear();
  });

  it("SHALL navigate to /notes/:id using that result's own id when clicked", async () => {
    const user = userEvent.setup();
    render(<SearchResultRow result={buildResult({ id: "note-42" })} />);

    await user.click(screen.getByRole("button"));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/notes/note-42");
  });

  it("SHALL navigate using a different result's exact id, never a hardcoded or previous id", async () => {
    const user = userEvent.setup();
    render(<SearchResultRow result={buildResult({ id: "note-999" })} />);

    await user.click(screen.getByRole("button"));

    expect(navigateMock).toHaveBeenCalledWith("/notes/note-999");
  });

  it("SHALL render the result's title and formatted snippet content", () => {
    render(
      <SearchResultRow result={buildResult({ title: "My Great Note" })} />,
    );

    expect(screen.getByText("My Great Note")).toBeDefined();
    expect(screen.getByText("architecture")).toBeDefined();
  });
});
