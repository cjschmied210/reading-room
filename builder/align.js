import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const python = path.resolve(__dirname, "../.venv/bin/python");

// Measures when each word of rawText is spoken in the audio file (local
// Whisper, no API calls). Returns { timestamps, matched } or null when the
// aligner isn't installed or fails — callers then keep estimated timings and
// the reader leaves word-synced features off.
export function alignWords(audioPath, rawText) {
  if (!existsSync(python)) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "align-"));
  try {
    const textPath = path.join(dir, "text.txt");
    writeFileSync(textPath, rawText);
    const out = execFileSync(python, [path.join(__dirname, "align.py"), audioPath, textPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return JSON.parse(out);
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
