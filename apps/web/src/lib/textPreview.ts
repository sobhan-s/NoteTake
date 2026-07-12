export function getPlainTextPreview(body: string, maxChars: number): string {
  const parsed = new DOMParser().parseFromString(body, "text/html");
  const plainText = (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim();

  if (plainText.length <= maxChars) {
    return plainText;
  }

  return `${plainText.slice(0, maxChars).trimEnd()}…`;
}
