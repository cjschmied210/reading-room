// Mirrors the word-tokenization logic in src/app.jsx (paragraphs -> words)
// so builder-generated timestamps line up with the words the app renders.
export function tokenizeWords(rawText) {
  const t = rawText.trim();
  if (!t) return [];
  let parts = t.split(/\n[ \t]*\n+/);
  if (parts.length < 2) parts = t.split(/\n+/);
  parts = parts.map(p => p.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  const paragraphs = parts.length ? parts : [t];
  return paragraphs.flatMap(p => p.split(/\s+/).filter(Boolean));
}
