import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tokenizeWords } from "./tokenize.js";
import { estimateTimestamps } from "./estimate-timestamps.js";
import "./load-env.js";

const CHUNK_WORDS = 450;
const MAX_ATTEMPTS = 3;
const SAMPLE_RATE_FALLBACK = 24000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

// One-time narration generation via Gemini's native TTS. Gemini returns raw
// PCM audio with no word-level alignment, so unlike the OpenAI/Whisper path
// this uses *estimated* per-word timing (see estimate-timestamps.js) rather
// than timing measured from the actual speech. Long texts are synthesized
// paragraph-group by paragraph-group (one long request risks timeouts and
// truncation) and the PCM is concatenated. Runs only at build time; the
// shared student instance makes no further API calls.
export async function generateNarration(rawText, { voice = "Kore", model = "gemini-2.5-flash-preview-tts" } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to .env before using --tts gemini.");

  const chunks = chunkByParagraph(rawText, CHUNK_WORDS);
  const pcmParts = [];
  let sampleRate = SAMPLE_RATE_FALLBACK;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) console.log(`  narration chunk ${i + 1}/${chunks.length}...`);
    const { pcm, rate } = await synthesizeWithRetry(chunks[i], { apiKey, voice, model });
    pcmParts.push(pcm);
    sampleRate = rate;
  }
  const pcm = Buffer.concat(pcmParts);

  const wav = wrapPcmAsWav(pcm, sampleRate);
  const totalDuration = pcm.length / (sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8));
  const wordTimestamps = estimateTimestamps(tokenizeWords(rawText), totalDuration);

  const m4a = tryEncodeAac(wav);
  return m4a
    ? { audioBuffer: m4a, wordTimestamps, extension: "m4a" }
    : { audioBuffer: wav, wordTimestamps, extension: "wav" };
}

function chunkByParagraph(rawText, maxWords) {
  const paragraphs = rawText.split(/\n[ \t]*\n+/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = [];
  let curWords = 0;
  for (const p of paragraphs) {
    const wc = p.split(/\s+/).length;
    if (cur.length && curWords + wc > maxWords) {
      chunks.push(cur.join("\n\n"));
      cur = [];
      curWords = 0;
    }
    cur.push(p);
    curWords += wc;
  }
  if (cur.length) chunks.push(cur.join("\n\n"));
  return chunks;
}

async function synthesizeWithRetry(text, opts) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await synthesize(text, opts);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

async function synthesize(text, { apiKey, voice, model }) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
        }
      })
    }
  );
  if (!res.ok) throw new Error(`Gemini TTS request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part?.data) throw new Error("Gemini TTS response had no audio data.");
  const rateMatch = /rate=(\d+)/.exec(part.mimeType || "");
  return { pcm: Buffer.from(part.data, "base64"), rate: rateMatch ? Number(rateMatch[1]) : SAMPLE_RATE_FALLBACK };
}

// macOS ships afconvert; speech at 64 kbps AAC is ~6x smaller than raw WAV.
// Returns null (caller keeps the WAV) anywhere afconvert isn't available.
function tryEncodeAac(wav) {
  let dir;
  try {
    dir = mkdtempSync(path.join(tmpdir(), "narration-"));
    const wavPath = path.join(dir, "in.wav");
    const m4aPath = path.join(dir, "out.m4a");
    writeFileSync(wavPath, wav);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", wavPath, m4aPath], { stdio: "ignore" });
    return readFileSync(m4aPath);
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function wrapPcmAsWav(pcm, sampleRate) {
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
