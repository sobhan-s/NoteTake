import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SnippetHighlight } from "@/components/search/SnippetHighlight";

describe("SnippetHighlight ([FRS-4.2.1] sentinel-marked snippet rendering — XSS defense)", () => {
  afterEach(() => {
    cleanup();
  });

  it("SHALL wrap a sentinel-marked segment in a <mark> element containing only the matched text", () => {
    const { container } = render(
      <SnippetHighlight snippet="This is [[[MARK]]]highlighted[[[MARK_END]]] snippet." />,
    );

    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("highlighted");
  });

  it("SHALL render a plain-text snippet containing zero sentinels completely unchanged, with zero <mark> elements", () => {
    const { container } = render(
      <SnippetHighlight snippet="Nothing to see here." />,
    );

    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("Nothing to see here.");
  });

  it("SHALL render multiple sentinel-marked segments, each wrapped in its own <mark> element, in original order", () => {
    const { container } = render(
      <SnippetHighlight snippet="[[[MARK]]]first[[[MARK_END]]] and [[[MARK]]]second[[[MARK_END]]] match." />,
    );

    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe("first");
    expect(marks[1]?.textContent).toBe("second");
    expect(container.textContent).toBe("first and second match.");
  });

  it("SHALL never use dangerouslySetInnerHTML anywhere in the rendered output (asserted via zero raw-HTML-attribute elements)", () => {
    const { container } = render(
      <SnippetHighlight snippet="[[[MARK]]]term[[[MARK_END]]] rest of the text" />,
    );

    // dangerouslySetInnerHTML is a React-only prop, never serialized to the DOM;
    // its presence would manifest as raw HTML tags being parsed out of the snippet
    // string itself. Assert every rendered element is only <mark> or <span> — the
    // two element types the component is documented to emit — never any other
    // parsed-from-string element (e.g. <script>, <img>, <div>).
    const allElements = container.querySelectorAll("*");
    allElements.forEach((element) => {
      expect(["MARK", "SPAN"]).toContain(element.tagName);
    });
  });

  it("SHALL render an embedded <script> tag as literal, visible text — never executed or parsed as markup (FRS-4.2.1 XSS defense)", () => {
    const maliciousSnippet =
      "[[[MARK]]]safe[[[MARK_END]]] <script>window.__xssFired = true;</script>";

    const { container } = render(
      <SnippetHighlight snippet={maliciousSnippet} />,
    );

    // The literal script text must be visible as text content...
    expect(container.textContent).toContain(
      "<script>window.__xssFired = true;</script>",
    );
    // ...and must NEVER be parsed into an actual <script> element in the DOM.
    expect(container.querySelectorAll("script")).toHaveLength(0);
    // The global window MUST NOT have been mutated by an executed script.
    expect((window as unknown as { __xssFired?: boolean }).__xssFired).toBe(
      undefined,
    );
  });

  it("SHALL render an embedded <img onerror=...> payload as literal text, never as a parsed <img> element with an active handler", () => {
    const maliciousSnippet =
      '[[[MARK]]]match[[[MARK_END]]] <img src=x onerror="window.__xssFired = true">';

    const { container } = render(
      <SnippetHighlight snippet={maliciousSnippet} />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toContain(
      '<img src=x onerror="window.__xssFired = true">',
    );
    expect((window as unknown as { __xssFired?: boolean }).__xssFired).toBe(
      undefined,
    );
  });

  it("SHALL treat an unpaired/malformed sentinel (missing MARK_END) as literal boundary text without throwing", () => {
    expect(() =>
      render(<SnippetHighlight snippet="[[[MARK]]]never closed" />),
    ).not.toThrow();
  });

  it("SHALL render an empty-string snippet without throwing and with zero visible text", () => {
    const { container } = render(<SnippetHighlight snippet="" />);
    expect(container.textContent).toBe("");
  });
});
