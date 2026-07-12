import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NoteResponseDto } from "@shared/core/types";
import { NoteCard } from "@/components/notes/NoteCard";

function buildNote(overrides: Partial<NoteResponseDto> = {}): NoteResponseDto {
  return {
    id: "note-1",
    title: "My Note",
    body: "<p>Some body content</p>",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
    ...overrides,
  };
}

function renderCard(
  note: NoteResponseDto,
  variant: "active" | "trash" = "active",
) {
  return render(
    <MemoryRouter>
      <NoteCard note={note} variant={variant} />
    </MemoryRouter>,
  );
}

describe("NoteCard ([FRS-7.2] Per-note share-status indicator scenario)", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render the Shared badge with an aria-label when hasActiveShareLink is true", () => {
    renderCard(buildNote({ hasActiveShareLink: true }));

    const badge = screen.getByLabelText("This note has an active share link");
    expect(badge).toBeDefined();
    expect(screen.getByText("Shared")).toBeDefined();
  });

  it("should completely omit the Shared badge from the DOM (not merely hide it) when hasActiveShareLink is false", () => {
    renderCard(buildNote({ hasActiveShareLink: false }));

    expect(screen.queryByText("Shared")).toBeNull();
    expect(
      screen.queryByLabelText("This note has an active share link"),
    ).toBeNull();
  });
});
