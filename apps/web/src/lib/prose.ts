/** Plain-text rendering helpers. Article bodies are stored as text, never HTML. */

/** Remove control characters that would corrupt the page, but keep newlines. */
export function cleanText(input: string | null | undefined): string {
  if (!input) return '';
  return (
    input
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- removing C0/C1 controls is the entire point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
  );
}

/** Split a stored body into paragraphs. Never returns an empty paragraph. */
export function paragraphs(body: string | null | undefined): string[] {
  return cleanText(body)
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

/** Plain-text excerpt trimmed on a word boundary. */
export function excerptFrom(input: string | null | undefined, maxChars = 220): string {
  const text = cleanText(input).replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars).trimEnd()}…`;
}

/** First sentence of a body, used when a story has no dek. */
export function firstSentence(input: string | null | undefined, maxChars = 200): string {
  const text = cleanText(input).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = /^(.{20,}?[.!?])(\s|$)/.exec(text);
  return excerptFrom(match?.[1] ?? text, maxChars);
}

/** Count words without allocating an array for very long bodies. */
export function wordCount(input: string | null | undefined): number {
  const text = cleanText(input);
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/** Normalise a tag for links and comparisons. */
export function normaliseTag(tag: string): string {
  return tag.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').trim();
}

/** A headline must never break the layout: trim absurd strings defensively. */
export function clampHeadline(input: string | null | undefined, maxChars = 180): string {
  const text = cleanText(input).replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}
