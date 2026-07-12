import { describe, it, expect } from "vitest";
import { getPlainTextPreview } from "@/lib/textPreview";

describe("getPlainTextPreview ([FRS-2.1.1, Note preview & XSS-safe plain-text extraction scenario])", () => {
  it("should strip HTML tags via DOMParser rather than regex, including nested elements", () => {
    const result = getPlainTextPreview(
      "<p>Hello <b>World</b></p>",
      Number.MAX_SAFE_INTEGER,
    );

    expect(result).toBe("Hello World");
  });

  it("should correctly parse malformed-tag-like text a naive regex would mishandle", () => {
    // A regex like /<[^>]+>/g would treat "< 2 and 3 >" as a tag and strip real content.
    // DOMParser follows real HTML tokenizer rules: "<" followed by a space is literal text.
    const result = getPlainTextPreview(
      "<p>1 < 2 and 3 > 4</p>",
      Number.MAX_SAFE_INTEGER,
    );

    expect(result).toBe("1 < 2 and 3 > 4");
  });

  it("should collapse internal whitespace/newlines into single spaces and trim ends", () => {
    const result = getPlainTextPreview(
      "  <p>Hello\n\n   World</p>  ",
      Number.MAX_SAFE_INTEGER,
    );

    expect(result).toBe("Hello World");
  });

  it("should never re-execute inline <script> content — it is inert plain text, never re-inserted as HTML", () => {
    const result = getPlainTextPreview(
      "<div>a<script>alert('x')</script>b</div>",
      Number.MAX_SAFE_INTEGER,
    );

    expect(result).toBe("aalert('x')b");
    expect(result).not.toContain("<script>");
  });

  it("should return the full plain text with no ellipsis when length is exactly equal to maxChars", () => {
    const result = getPlainTextPreview("<p>Hello</p>", 5);

    expect(result).toBe("Hello");
  });

  it("should truncate and append a single ellipsis when length exceeds maxChars by exactly one character", () => {
    const result = getPlainTextPreview("<p>Hellox</p>", 5);

    expect(result).toBe("Hello…");
  });

  it("should trim trailing whitespace before appending the ellipsis on truncation", () => {
    // "Hello World" sliced to 6 chars is "Hello " (trailing space) -- must not render "Hello …"
    const result = getPlainTextPreview("<p>Hello World</p>", 6);

    expect(result).toBe("Hello…");
  });

  it("should return an empty string for empty or whitespace-only body content", () => {
    expect(getPlainTextPreview("", 20)).toBe("");
    expect(getPlainTextPreview("<p>   </p>", 20)).toBe("");
  });
});
