#!/usr/bin/env node
// One-command publish: bake a text into an instance, rebuild the site index,
// deploy to Vercel, and push the source to GitHub.
//   node builder/publish.js --title "The Raven" --file raven.txt --teacher "J. Smith" [--tts openai] [--voice alloy] [--unlock]

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--unlock") args.unlock = true;
    else if (a.startsWith("--")) { args[a.slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
}

const args = parseArgs(process.argv.slice(2));
if (!args.file || !args.title || !args.teacher) {
  console.error('Required: --title "..." --file <text file> --teacher "Name" [--tts openai] [--voice alloy] [--unlock]');
  process.exit(1);
}

const slug = (args.out || args.title)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
const outPath = `out/${slug}`;

const instanceArgs = ["builder/make-instance.js", "--title", args.title, "--file", args.file, "--out", outPath, "--teacher", args.teacher];
if (args.tts) instanceArgs.push("--tts", args.tts);
if (args.voice) instanceArgs.push("--voice", args.voice);
if (args.unlock) instanceArgs.push("--unlock");
run("node", instanceArgs);

run("node", ["builder/build-site.js"]);

run("npx", ["--yes", "vercel", "deploy", "--prod", "--cwd", "docs"]);

run("git", ["add", "-A"]);
try {
  run("git", ["commit", "-m", `Add: ${args.title}`]);
  run("git", ["push"]);
} catch {
  console.log("\nNothing new to commit (site content may be unchanged).");
}

console.log(`\nPublished: https://bridgeviewfolio.com/${slug}/`);
