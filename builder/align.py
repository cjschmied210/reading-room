"""Measure when each word of a known text is spoken in a narration file.

Usage: align.py <audio file> <text file> [model]
Prints JSON to stdout: {"timestamps": [{"start": s, "end": s}, ...], "matched": 0..1}
with one entry per whitespace-separated word of the text, in order.

Whisper transcribes the audio with per-word times; its words are then aligned
to the real text (they differ on numbers, abbreviations and mishearings), and
any word Whisper missed is placed between its matched neighbours.
"""
import difflib
import json
import os
import re
import sys
import unicodedata

from faster_whisper import WhisperModel

SUBWORD = re.compile(r"[^\W_]+", re.UNICODE)


def subwords(token):
    plain = unicodedata.normalize("NFKD", token.lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return SUBWORD.findall(plain)


def main():
    audio_path, text_path = sys.argv[1], sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "small"

    with open(text_path, encoding="utf-8") as f:
        tokens = f.read().split()

    threads = max(1, (os.cpu_count() or 2) // 2)
    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=threads)
    segments, _ = model.transcribe(audio_path, word_timestamps=True, beam_size=5)
    heard = []  # (subword, start, end)
    duration = 0.0
    for seg in segments:
        duration = max(duration, seg.end)
        for w in seg.words or []:
            for sw in subwords(w.word):
                heard.append((sw, w.start, w.end))

    target = []  # (subword, token index)
    for i, tok in enumerate(tokens):
        for sw in subwords(tok):
            target.append((sw, i))

    matcher = difflib.SequenceMatcher(
        a=[t[0] for t in target], b=[h[0] for h in heard], autojunk=False
    )
    starts = [None] * len(tokens)
    ends = [None] * len(tokens)
    matched_subwords = 0
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            _, tok_i = target[block.a + k]
            _, s, e = heard[block.b + k]
            matched_subwords += 1
            if starts[tok_i] is None or s < starts[tok_i]:
                starts[tok_i] = s
            if ends[tok_i] is None or e > ends[tok_i]:
                ends[tok_i] = e

    # Fill words Whisper missed: share the gap between the matched neighbours
    # in proportion to word length.
    i = 0
    n = len(tokens)
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        j = i
        while j < n and starts[j] is None:
            j += 1
        gap_start = ends[i - 1] if i > 0 else 0.0
        gap_end = starts[j] if j < n else max(duration, gap_start)
        weights = [len(tokens[k]) + 1 for k in range(i, j)]
        total = float(sum(weights))
        t = gap_start
        for k in range(i, j):
            span = (gap_end - gap_start) * weights[k - i] / total
            starts[k], ends[k] = t, t + span
            t += span
        i = j

    # Word times must never run backwards.
    prev = 0.0
    out = []
    for s, e in zip(starts, ends):
        s = max(s, prev)
        e = max(e, s)
        prev = s
        out.append({"start": round(s, 2), "end": round(e, 2)})

    matched = matched_subwords / float(len(target) or 1)
    json.dump({"timestamps": out, "matched": round(matched, 4)}, sys.stdout)


if __name__ == "__main__":
    main()
