#!/usr/bin/env node
// Builds a standalone, text-specific reader: one HTML file (plus an optional
// narration.mp3) that runs entirely in the browser with zero further API
// calls. Usage:
//   node builder/make-instance.js --title "The Raven" --file raven.txt --out out/the-raven
//   node builder/make-instance.js --title "The Raven" --file raven.txt --out out/the-raven --tts openai --voice alloy
//   node builder/make-instance.js ... --unlock   (keep the edit/presets UI visible; default is locked for students)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { compileBundle, composeHtml } from "./compile.js";
import { generateNarration } from "./tts-openai.js";

function parseArgs(argv) {
  const args = { lock: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--unlock") args.lock = false;
    else if (a.startsWith("--")) { args[a.slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.out) {
    console.error("Required: --file <text file> --out <output dir> [--title \"...\"] [--tts openai] [--voice alloy] [--unlock]");
    process.exit(1);
  }

  const rawText = readFileSync(args.file, "utf8");
  const title = args.title || path.basename(args.file, path.extname(args.file));
  const outDir = path.resolve(args.out);
  mkdirSync(outDir, { recursive: true });

  let narration = null;
  if (args.tts === "openai") {
    console.log("Generating narration via OpenAI (one-time build-time call)...");
    const { audioBuffer, wordTimestamps } = await generateNarration(rawText, { voice: args.voice || "alloy" });
    writeFileSync(path.join(outDir, "narration.mp3"), audioBuffer);
    narration = { audioSrc: "narration.mp3", wordTimestamps };
    console.log(`Narration saved: ${outDir}/narration.mp3 (${wordTimestamps.length} words aligned)`);
  }

  const { js, css } = await compileBundle();
  const html = composeHtml({
    js, css, title,
    data: { title, text: rawText, locked: args.lock, narration }
  });
  writeFileSync(path.join(outDir, "index.html"), html);

  console.log(`\nDone: ${outDir}/index.html (${Math.round(html.length / 1024)} KB)`);
  console.log(narration
    ? "Includes pre-baked neural narration — students get humanlike audio with zero API calls."
    : "No narration baked in — students still get free browser text-to-speech (Read Aloud) with zero API calls.");
  console.log(args.lock ? "Locked: students can't edit the text or switch presets." : "Unlocked: edit/preset controls are visible.");
}

main().catch(err => { console.error(err.message); process.exit(1); });
