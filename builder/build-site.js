// Assembles docs/ — the folder GitHub Pages/Vercel serves — from every
// instance in out/, grouped by teacher into disclosure cards on the home
// page. Run this after generating or updating readings with make-instance.js.
import { readdirSync, existsSync, rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOOTER_HTML, FOOTER_CSS } from "./footer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");
const docsDir = path.join(root, "docs");
const DOMAIN = "bridgeviewfolio.com";
const UNSORTED = "Unsorted";

function unescapeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function titleOf(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? unescapeHtml(m[1]) : fallback;
}

function teacherOf(html) {
  const m = html.match(/<meta name="reading-teacher" content="([^"]*)">/);
  const name = m ? unescapeHtml(m[1]).trim() : "";
  return name || UNSORTED;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
  const html = readFileSync(path.join(src, "index.html"), "utf8");
  return { slug, title: titleOf(html, slug), teacher: teacherOf(html) };
});

const byTeacher = new Map();
for (const r of readings) {
  if (!byTeacher.has(r.teacher)) byTeacher.set(r.teacher, []);
  byTeacher.get(r.teacher).push(r);
}

const teacherNames = [...byTeacher.keys()]
  .filter(t => t !== UNSORTED)
  .sort((a, b) => a.localeCompare(b));
if (byTeacher.has(UNSORTED)) teacherNames.push(UNSORTED);

const cards = teacherNames.map(teacher => {
  const list = byTeacher.get(teacher)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(r => `        <li><a class="reading-link" href="./${r.slug}/">${escapeHtml(r.title)}</a></li>`)
    .join("\n");
  const count = byTeacher.get(teacher).length;
  return `    <details class="teacher-card">
      <summary>
        <span class="teacher-name">${escapeHtml(teacher)}</span>
        <span class="teacher-count">${count} reading${count === 1 ? "" : "s"}</span>
      </summary>
      <ul>
${list}
      </ul>
    </details>`;
}).join("\n");

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
    min-height: 100vh; display: flex; flex-direction: column;
  }
  .wrap { max-width: 720px; width: 100%; margin: 0 auto; padding: 64px 24px; flex: 1 0 auto; box-sizing: border-box; }
  h1 { font-size: 34px; font-weight: 400; margin-bottom: 8px; }
  p.sub { color: var(--ink-muted); font-family: -apple-system, sans-serif; font-size: 14px; margin-top: 0; }
  .cards { margin-top: 32px; display: flex; flex-direction: column; gap: 10px; }
  .teacher-card {
    border: 1px solid var(--border); border-radius: 8px; background: white; overflow: hidden;
  }
  .teacher-card summary {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 18px 20px; cursor: pointer; list-style: none; font-size: 20px;
  }
  .teacher-card summary::-webkit-details-marker { display: none; }
  .teacher-card summary::after {
    content: "+"; font-family: -apple-system, sans-serif; font-size: 20px; color: var(--ink-muted);
    transition: transform 0.15s;
  }
  .teacher-card[open] summary::after { transform: rotate(45deg); }
  .teacher-card summary:hover { background: var(--accent-soft); }
  .teacher-name { font-weight: 400; }
  .teacher-count { font-family: -apple-system, sans-serif; font-size: 12px; color: var(--ink-muted); white-space: nowrap; }
  .teacher-card ul { list-style: none; margin: 0; padding: 0 20px 12px; border-top: 1px solid var(--border); }
  .teacher-card li { border-bottom: 1px solid var(--border); }
  .teacher-card li:last-child { border-bottom: none; }
  .reading-link {
    display: block; padding: 14px 4px; color: var(--ink); text-decoration: none; font-size: 17px;
    transition: color 0.15s;
  }
  .reading-link:hover { color: var(--accent); }
  .empty { color: var(--ink-muted); font-family: -apple-system, sans-serif; font-size: 14px; margin-top: 32px; }
${FOOTER_CSS}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Bridgeview Folio</h1>
    <p class="sub">Readings for class — pick a teacher to see their list.</p>
    ${cards ? `<div class="cards">\n${cards}\n    </div>` : '<p class="empty">No readings published yet.</p>'}
  </div>
  ${FOOTER_HTML}
</body>
</html>
`;

writeFileSync(path.join(docsDir, "index.html"), indexHtml);
writeFileSync(path.join(docsDir, "CNAME"), DOMAIN + "\n");
writeFileSync(path.join(docsDir, ".nojekyll"), "");

console.log(`Built docs/ with ${readings.length} reading(s) across ${teacherNames.length} teacher(s): ${teacherNames.join(", ") || "(none)"}`);
