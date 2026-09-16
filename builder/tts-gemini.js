import { tokenizeWords } from "./tokenize.js";
import { estimateTimestamps } from "./estimate-timestamps.js";
import "./load-env.js";

// One-time narration generation via Gemini's native TTS. Gemini returns raw
// PCM audio with no word-level alignment, so unlike the OpenAI/Whisper path
// this uses *estimated* per-word timing (see estimate-timestamps.js) rather
// than timing measured from the actual speech — good enough to track along,
// not frame-perfect. Runs only at build time; the shared student instance
// makes no further API calls.
export async function generateNarration(rawText, { voice = "Kore", model = "gemini-2.5-flash-preview-tts" } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to .env before using --tts gemini.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: rawText }] }],
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

  const pcm = Buffer.from(part.data, "base64");
  const sampleRateMatch = /rate=(\d+)/.exec(part.mimeType || "");
  const sampleRate = sampleRateMatch ? Number(sampleRateMatch[1]) : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;

  const audioBuffer = wrapPcmAsWav(pcm, sampleRate, numChannels, bitsPerSample);
  const totalDuration = pcm.length / (sampleRate * numChannels * (bitsPerSample / 8));

  const targetWords = tokenizeWords(rawText);
  const wordTimestamps = estimateTimestamps(targetWords, totalDuration);

  return { audioBuffer, wordTimestamps, extension: "wav" };
}

function wrapPcmAsWav(pcm, sampleRate, numChannels, bitsPerSample) {
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
