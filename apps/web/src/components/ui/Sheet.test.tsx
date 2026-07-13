import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sheet } from "@/components/ui/Sheet";

// Radix `Dialog.Portal` renders `Dialog.Content` to `document.body`, so DOM assertions
// query `screen`/`document.body`, never the `render()` return's `container`.
describe("Sheet ([Requirement: `Sheet` Component Supports a Right-Side Panel Variant])", () => {
  afterEach(() => {
    cleanup();
  });

  it("[Scenario: Existing left-side usage is unaffected] SHALL render fixed-left, w-[260px] when neither `side` nor `widthClassName` is passed", () => {
    render(
      <Sheet open={true} onOpenChange={vi.fn()} title="Sidebar">
        <p>Sidebar content</p>
      </Sheet>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("left-0");
    expect(dialog.className).toContain("w-[260px]");
    expect(dialog.className).not.toContain("right-0");
  });

  it('[Scenario: `VersionHistoryDrawer` renders as a right-side panel] side="right" + a custom widthClassName SHALL render right-anchored with that exact width class, not the left/260px default', () => {
    render(
      <Sheet
        open={true}
        onOpenChange={vi.fn()}
        title="Version History"
        side="right"
        widthClassName="w-full sm:w-[420px]"
      >
        <p>Version history content</p>
      </Sheet>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("right-0");
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("sm:w-[420px]");
    expect(dialog.className).not.toContain("left-0");
    expect(dialog.className).not.toContain("w-[260px]");
  });

  it('[Scenario: Existing left-side usage is unaffected] side="left" passed explicitly SHALL render identically to the omitted-prop default', () => {
    render(
      <Sheet open={true} onOpenChange={vi.fn()} title="Sidebar" side="left">
        <p>Sidebar content</p>
      </Sheet>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("left-0");
    expect(dialog.className).toContain("w-[260px]");
  });

  it("SHALL render the provided `title` as an accessible (sr-only) Dialog.Title and the passed children", () => {
    render(
      <Sheet open={true} onOpenChange={vi.fn()} title="Version History">
        <p>Row content</p>
      </Sheet>,
    );

    expect(screen.getByText("Version History")).toBeDefined();
    expect(screen.getByText("Row content")).toBeDefined();
  });

  it("SHALL render nothing to the document when `open` is false", () => {
    render(
      <Sheet open={false} onOpenChange={vi.fn()} title="Sidebar">
        <p>Sidebar content</p>
      </Sheet>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
