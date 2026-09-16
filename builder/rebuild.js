#!/usr/bin/env node
// Recompiles every existing instance in out/ with the current app bundle,
// keeping each instance's baked data (text, narration, lock state) as-is —
// no narration is regenerated, so this makes no API calls. Run this after
// changing src/app.jsx or src/style.css.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileBundle, composeHtml } from "./compile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");

function extractData(html) {
  const marker = "window.__READER_DATA__ = ";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("Could not find __READER_DATA__ in existing HTML.");
  const from = start + marker.length;
  const end = html.indexOf("\n  </script>", from);
  let blob = html.slice(from, end).trim();
  if (blob.endsWith(";")) blob = blob.slice(0, -1);
  return JSON.parse(blob);
}

async function main() {
  if (!existsSync(outDir)) { console.log("No instances in out/ yet."); return; }
  const slugs = readdirSync(outDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(path.join(outDir, d.name, "index.html")))
    .map(d => d.name);

  if (!slugs.length) { console.log("No instances in out/ yet."); return; }

  const { js, css } = await compileBundle();
  for (const slug of slugs) {
    const file = path.join(outDir, slug, "index.html");
    const data = extractData(readFileSync(file, "utf8"));
    const html = composeHtml({ js, css, title: data.title, data });
    writeFileSync(file, html);
    console.log(`Rebuilt ${slug}`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
