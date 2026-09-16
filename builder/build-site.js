// Assembles docs/ — the folder GitHub Pages serves — from every instance in out/.
// Run this after generating or updating readings with make-instance.js.
import { readdirSync, existsSync, rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");
const docsDir = path.join(root, "docs");
const DOMAIN = "bridgeviewfolio.com";

function titleOf(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1] : path.basename(path.dirname(htmlPath));
}

// Clear only what we generate — leave dotfiles alone (docs/.vercel holds the
// Vercel project link; wiping it would force re-linking on every rebuild).
mkdirSync(docsDir, { recursive: true });
for (const entry of readdirSync(docsDir)) {
  if (entry.startsWith(".")) continue;
  rmSync(path.join(docsDir, entry), { recursive: true, force: true });
}

const slugs = existsSync(outDir)
  ? readdirSync(outDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(path.join(outDir, d.name, "index.html")))
      .map(d => d.name)
      .sort()
  : [];

const readings = slugs.map(slug => {
  const src = path.join(outDir, slug);
  cpSync(src, path.join(docsDir, slug), { recursive: true });
  return { slug, title: titleOf(path.join(src, "index.html")) };
});

const listItems = readings.map(r =>
  `        <li><a class="reading-link" href="./${r.slug}/">${escapeHtml(r.title)}</a></li>`
).join("\n");

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bridgeview Folio — Readings</title>
<style>
  :root {
    --paper: #FAF7F2; --ink: #2C2825; --ink-muted: #767069;
    --accent: #C2593F; --accent-soft: #F7EBE8; --border: #E3DDD4;
  }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 64px 24px; }
  h1 { font-size: 34px; font-weight: 400; margin-bottom: 8px; }
  p.sub { color: var(--ink-muted); font-family: -apple-system, sans-serif; font-size: 14px; margin-top: 0; }
  ul { list-style: none; padding: 0; margin-top: 32px; }
  li { border-bottom: 1px solid var(--border); }
  .reading-link {
    display: block; padding: 16px 4px; color: var(--ink); text-decoration: none; font-size: 19px;
    transition: color 0.15s;
  }
  .reading-link:hover { color: var(--accent); }
  .empty { color: var(--ink-muted); font-family: -apple-system, sans-serif; font-size: 14px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Bridgeview Folio</h1>
    <p class="sub">Readings for class — pick one to open.</p>
    <ul>
${listItems || '      <li class="empty">No readings published yet.</li>'}
    </ul>
  </div>
</body>
</html>
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

writeFileSync(path.join(docsDir, "index.html"), indexHtml);
writeFileSync(path.join(docsDir, "CNAME"), DOMAIN + "\n");
writeFileSync(path.join(docsDir, ".nojekyll"), "");

console.log(`Built docs/ with ${readings.length} reading(s): ${readings.map(r => r.slug).join(", ") || "(none)"}`);
