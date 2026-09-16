import { tokenizeWords } from "./tokenize.js";
import { estimateTimestamps } from "./estimate-timestamps.js";
import "./load-env.js";

// One-time narration generation: synthesize speech for the whole text, then
// transcribe it back with word-level timestamps so the reader can highlight
// in sync with pre-baked, human-like audio. Runs only at build time — the
// shared student instance makes no further API calls.
export async function generateNarration(rawText, { voice = "alloy", model = "gpt-4o-mini-tts" } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Export it before using --tts openai.");

  const speechRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: rawText, response_format: "mp3" })
  });
  if (!speechRes.ok) throw new Error(`OpenAI TTS request failed: ${speechRes.status} ${await speechRes.text()}`);
  const audioBuffer = Buffer.from(await speechRes.arrayBuffer());

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "narration.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const transcribeRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!transcribeRes.ok) throw new Error(`OpenAI transcription failed: ${transcribeRes.status} ${await transcribeRes.text()}`);
  const transcript = await transcribeRes.json();
  const whisperWords = transcript.words || [];

  const targetWords = tokenizeWords(rawText);
  const wordTimestamps = alignTimestamps(targetWords, whisperWords, estimateDuration(whisperWords));

  return { audioBuffer, wordTimestamps, extension: "mp3" };
}

function estimateDuration(whisperWords) {
  if (!whisperWords.length) return 0;
  return whisperWords[whisperWords.length - 1].end;
}

// Fast path: if Whisper's word count matches our tokenization, use its
// timestamps directly. Otherwise fall back to proportional timing (weighted
// by word length) so playback still advances at a believable pace.
function alignTimestamps(targetWords, whisperWords, totalDuration) {
  if (targetWords.length === whisperWords.length) {
    return targetWords.map((w, i) => ({ word: w, start: whisperWords[i].start, end: whisperWords[i].end }));
  }
  return estimateTimestamps(targetWords, totalDuration);
}
