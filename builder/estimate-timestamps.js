// Approximate per-word timing when no real speech-to-text alignment is
// available: each word gets a slice of the total audio duration
// proportional to its character length (longer words take longer to say).
// Good enough to keep playback roughly on pace; not a substitute for real
// forced alignment (see tts-openai.js's Whisper-based path for that).
export function estimateTimestamps(words, totalDuration) {
  const totalChars = words.reduce((s, w) => s + w.length + 1, 0) || 1;
  let t = 0;
  return words.map(w => {
    const dur = ((w.length + 1) / totalChars) * totalDuration;
    const start = t;
    const end = t + dur;
    t = end;
    return { word: w, start, end };
  });
}
