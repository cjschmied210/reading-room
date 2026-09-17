import React from "react";
import ReactDOM from "react-dom/client";

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const MODES = [
  { id: "page", label: "Page", blurb: "The whole text at once, set like a printed page.", keys: "Scroll or read at your leisure." },
  { id: "guide", label: "Moving guide", blurb: "A smooth highlight sweeps forward at your set pace.", keys: "Space starts or pauses the guide." },
  { id: "phrase", label: "Phrases", blurb: "One phrase at a time, stepped at your own pace.", keys: "Space / Right Arrow reveals next phrase. Left Arrow steps back." },
  { id: "word", label: "One word", blurb: "Words arrive in place. Your eyes stay fixed in position.", keys: "Space starts or pauses playback." },
  { id: "window", label: "Focus window", blurb: "A few lines lit; text outside the window dims.", keys: "Up / Down Arrow keys move the focus window." }
];

const PRESETS = [
  {
    title: "The width of the creek",
    text: `Nobody in Halfway Creek agreed on how wide the creek actually was. The mayor said forty feet. The blacksmith said sixty. A girl named Ada, who was eleven and owned a measuring tape exactly twelve feet long, said that both of them were guessing, and that guessing was not the same as knowing.She walked to the bank, laid the tape down, and marked the ground with a stone. Then she picked up the tape and did it again. Four lengths and a bit brought her to the water. She wrote 51 in the dirt and drew a circle around it.The mayor laughed at her. The blacksmith did not. He had ordered timber for a sixty foot bridge and was suddenly nine feet richer than he had planned to be, which is the kind of arithmetic that changes a man's opinion of children with measuring tapes. The bridge went up that August. Ada's stone is still there, under the third post, holding nothing up and proving something anyway.`
  },
  {
    title: "Walden (Excerpt)",
    text: `I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.`
  },
  {
    title: "The Art of Reading",
    text: `Reading is an active process of constructing meaning from written text. It requires coordination of multiple complex cognitive processes including word recognition, comprehension, fluency, and motivation.When we read deep prose, our brain builds vivid sensory mental simulations. Pace control allows readers to calibrate their intake according to complexity, rhythm, and tone.`
  }
];

// Injected by the builder for a baked, text-specific instance.
// Shape: { title, text, locked, narration: { audioSrc, wordTimestamps: [{word,start,end}, ...] } | null }
const DATA = typeof window !== "undefined" ? window.__READER_DATA__ || null : null;

function clampRate(wpm) {
  const r = wpm / 180;
  return Math.max(0.5, Math.min(3, r));
}

function ReadingRoom() {
  const [title, setTitle] = useState(DATA?.title || PRESETS[0].title);
  const [rawText, setRawText] = useState(DATA?.text || PRESETS[0].text);
  const locked = !!DATA?.locked;
  const narration = DATA?.narration || null;

  const [mode, setMode] = useState("page");
  const [playing, setPlaying] = useState(false);
  const [wi, setWi] = useState(0);
  const [chunk, setChunk] = useState(0);
  const [line, setLine] = useState(0);
  const [wpm, setWpm] = useState(220);
  const [size, setSize] = useState(21);
  const [measure, setMeasure] = useState(62);
  const [phraseWords, setPhraseWords] = useState(3);
  const [isEditing, setIsEditing] = useState(false);

  // --- TTS state ---
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [ttsOn, setTtsOn] = useState(false);
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [useNarration, setUseNarration] = useState(!!narration);

  const timerRef = useRef(null);
  const wiRef = useRef(0);
  const audioRef = useRef(null);
  const [listenState, setListenState] = useState("idle"); // idle | playing | paused
  useEffect(() => { wiRef.current = wi; }, [wi]);

  // Track the narration <audio> element's own play/pause/ended state, so the
  // Listen button (available in every mode) can show Listen / Pause / Resume
  // accurately instead of guessing from a locally-tracked flag that can drift.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setListenState("playing");
    const onPause = () => setListenState(a.ended ? "idle" : "paused");
    const onEnded = () => setListenState("idle");
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [narration]);

  // Load available browser voices (list populates async in most browsers)
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      if (!voiceURI && list.length) {
        const preferred = list.find(v => /en/i.test(v.lang) && /premium|enhanced|natural|neural/i.test(v.name)) || list.find(v => /en/i.test(v.lang)) || list[0];
        setVoiceURI(preferred.voiceURI);
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSupported]);

  // Cleaned text paragraphs
  const paragraphs = useMemo(() => {
    const t = rawText.trim();
    if (!t) return [];
    let parts = t.split(/\n[ \t]*\n+/);
    if (parts.length < 2) parts = t.split(/\n+/);
    parts = parts.map(p => p.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
    return parts.length ? parts : [t];
  }, [rawText]);

  const wordGroups = useMemo(() => {
    let gi = 0;
    return paragraphs.map(p => p.split(/\s+/).filter(Boolean).map(t => ({ t, i: gi++ })));
  }, [paragraphs]);

  const words = useMemo(() => wordGroups.reduce((acc, g) => acc.concat(g.map(x => x.t)), []), [wordGroups]);

  const phraseGroups = useMemo(() => {
    let gi = 0;
    return paragraphs.map(p => {
      const out = [];
      let cur = [];
      p.split(/\s+/).filter(Boolean).forEach(w => {
        cur.push(w);
        const breaks = /[.,;:!?—–"')]$/.test(w);
        if (cur.length >= phraseWords || (breaks && cur.length >= Math.max(2, phraseWords - 1))) {
          out.push({ t: cur.join(" "), i: gi++ });
          cur = [];
        }
      });
      if (cur.length) out.push({ t: cur.join(" "), i: gi++ });
      return out;
    });
  }, [paragraphs, phraseWords]);

  const phrases = useMemo(() => phraseGroups.reduce((acc, g) => acc.concat(g), []), [phraseGroups]);

  const sentences = useMemo(() => {
    const flat = rawText.replace(/\s+/g, " ").trim();
    const m = flat.match(/[^.!?]+[.!?]*\s*/g);
    return (m || [flat]).map(s => s.trim()).filter(Boolean);
  }, [rawText]);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const stopSpeech = () => { if (ttsSupported) window.speechSynthesis.cancel(); };
  const stopNarrationAudio = () => {
    const a = audioRef.current;
    if (a) { a.pause(); a.ontimeupdate = null; a.onended = null; }
  };

  const speakSpeech = useCallback((text, { onWord, onEnd, rate } = {}) => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const v = voices.find(v => v.voiceURI === voiceURI);
    if (v) utter.voice = v;
    utter.rate = rate ?? clampRate(wpm);
    if (onWord) utter.onboundary = (e) => { if (!e.name || e.name === "word") onWord(); };
    if (onEnd) utter.onend = onEnd;
    window.speechSynthesis.speak(utter);
  }, [ttsSupported, voices, voiceURI, wpm]);

  const narrationActive = !!narration && useNarration;

  // Continuous playback driver for guide / word modes. Deliberately does not
  // sync to narration audio — estimated (non-measured) word timings drift
  // noticeably, so narration is offered separately as a plain Listen track
  // instead (see toggleListen) rather than driving this highlight.
  useEffect(() => {
    if (!playing || (mode !== "guide" && mode !== "word")) { stopTimer(); stopSpeech(); return; }

    if (ttsOn && ttsSupported) {
      const startIdx = wiRef.current;
      const text = words.slice(startIdx).join(" ");
      speakSpeech(text, {
        onWord: () => setWi(prev => Math.min(prev + 1, words.length)),
        onEnd: () => setPlaying(false)
      });
      return () => stopSpeech();
    }
    const stepCount = mode === "guide" ? phraseWords : 1;
    const intervalMs = (stepCount * 60000) / wpm;
    stopTimer();
    timerRef.current = setInterval(() => {
      setWi(prev => {
        const next = prev + stepCount;
        if (next >= words.length) { setPlaying(false); stopTimer(); return 0; }
        return next;
      });
    }, intervalMs);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, wpm, mode, phraseWords, words.length, ttsOn]);

  // Reset state on text change
  useEffect(() => {
    setPlaying(false); setWi(0); setChunk(0); setLine(0);
    stopListen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : "";
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(activeTag) || document.activeElement.isContentEditable) {
        if (e.code === "Space" && activeTag === "BUTTON") return;
        if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
      }
      if (e.code === "Space" || e.key === " ") {
        if (mode === "guide" || mode === "word") { e.preventDefault(); setPlaying(p => !p); }
        else if (mode === "phrase") { e.preventDefault(); advancePhrase(1); }
      }
      if (mode === "phrase") {
        if (e.key === "ArrowRight") { e.preventDefault(); advancePhrase(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); advancePhrase(-1); }
      }
      if (mode === "window") {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moveLine(1); }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveLine(-1); }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phrases.length, sentences.length, narrationActive, ttsOn]);

  const advancePhrase = (dir) => {
    setChunk(c => {
      const next = Math.max(0, Math.min(phrases.length, c + dir));
      if (dir > 0 && next > 0 && ttsOn) {
        const p = phrases[next - 1];
        if (p) speakSpeech(p.t);
      }
      return next;
    });
  };

  const moveLine = (dir) => {
    setLine(l => {
      const next = Math.max(0, Math.min(sentences.length - 1, l + dir));
      if (ttsOn && sentences[next]) speakSpeech(sentences[next]);
      return next;
    });
  };

  const activeMode = MODES.find(m => m.id === mode) || MODES[0];

  // Deliberately don't touch narration playback here — Listen runs
  // independently of the pacing mode now, so switching modes or resetting
  // pacing progress shouldn't interrupt it.
  const handleReset = () => {
    setPlaying(false); setWi(0); setChunk(0); setLine(0);
    stopSpeech();
  };
  const handleModeSelect = (mId) => {
    setPlaying(false); setMode(mId); setWi(0); setChunk(0); setLine(0);
    stopSpeech();
  };

  const stopListen = () => {
    stopSpeech(); stopNarrationAudio(); setListenState("idle");
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const getProgressText = () => {
    if (mode === "phrase") return `${chunk} of ${phrases.length} phrases`;
    if (mode === "window") return `Line ${line + 1} of ${sentences.length}`;
    if (mode === "page") return "";
    return `Word ${Math.min(wi + 1, words.length)} of ${words.length}`;
  };

  const toggleListen = () => {
    if (narrationActive) {
      const a = audioRef.current;
      if (!a) return;
      if (!a.paused) { a.pause(); return; } // -> "paused" via the play/pause listener
      if (a.ended) a.currentTime = 0; // only rewind after a full run-through
      a.playbackRate = clampRate(wpm);
      a.ontimeupdate = null;
      a.onended = null;
      a.play().catch(() => {});
      return;
    }
    if (!ttsSupported) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setListenState("paused");
      return;
    }
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setListenState("playing");
      return;
    }
    if (!ttsOn) return;
    setListenState("playing");
    speakSpeech(paragraphs.join(". "), { onEnd: () => setListenState("idle") });
  };

  return (
    <div className="wrap">
      <div>
        <div className="topbar">
          <div className="topbar-left">
            <span className="brand">Reading Room</span>
            <span className="pill">{words.length} words</span>
            {narration && <span className="pill">🔊 narrated</span>}
          </div>
          <div className="topbar-right">
            {(ttsSupported || narration) && (
              <button
                className={`btn-ghost ${ttsOn || narrationActive ? "on" : ""}`}
                onClick={() => {
                  if (narration) setUseNarration(u => !u);
                  else setTtsOn(t => !t);
                  handleReset();
                  stopListen();
                }}
                title="Toggle text-to-speech"
              >
                {narrationActive ? "🔊 Narration on" : ttsOn ? "🔊 Read aloud on" : "🔈 Read aloud"}
              </button>
            )}
            {!locked && (
              <button className="btn-ghost" onClick={() => setIsEditing(true)}>✎ Edit Text / Presets</button>
            )}
          </div>
        </div>

        <h1 className="doc-title">{title}</h1>

        {(ttsOn || narrationActive) && ttsSupported && !narration && (
          <div className="section-label" style={{ marginTop: -16, marginBottom: 20 }}>
            <label className="slider-label" style={{ display: "inline-flex" }}>
              Voice
              <select value={voiceURI} onChange={e => setVoiceURI(e.target.value)}>
                {voices.filter(v => /en/i.test(v.lang)).map(v => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="section-label">How do you want it presented?</div>
        <div className="mode-grid">
          {MODES.map(m => {
            const active = m.id === mode;
            return (
              <button key={m.id} type="button" onClick={() => handleModeSelect(m.id)} className={`mode-card ${active ? "active" : ""}`}>
                <span className="mode-title">{m.label}</span>
                <span className="mode-blurb">{m.blurb}</span>
              </button>
            );
          })}
        </div>

        <div className="toolbar">
          {(mode === "guide" || mode === "word") && (
            <div className="transport">
              <button type="button" onClick={() => setPlaying(!playing)} className="btn-primary">
                {playing ? "Pause" : wi > 0 ? "Resume" : "Start"}
              </button>
              <button type="button" onClick={handleReset} className="btn-secondary">Reset</button>
              <span className="progress-text">{getProgressText()}</span>
            </div>
          )}
          {mode === "phrase" && (
            <div className="transport">
              <button type="button" onClick={() => advancePhrase(-1)} className="btn-secondary">← Back</button>
              <button type="button" onClick={() => advancePhrase(1)} className="btn-primary">Next phrase →</button>
              <span className="progress-text">{getProgressText()}</span>
            </div>
          )}
          {mode === "window" && (
            <div className="transport">
              <button type="button" onClick={() => moveLine(-1)} className="btn-secondary">↑ Up</button>
              <button type="button" onClick={() => moveLine(1)} className="btn-primary">Down ↓</button>
              <span className="progress-text">{getProgressText()}</span>
            </div>
          )}
          {(narrationActive || (mode === "page" && ttsOn)) && (
            <div className="transport">
              <button type="button" onClick={toggleListen} className="btn-primary">
                {listenState === "playing" ? "Pause" : listenState === "paused" ? "Resume" : "Listen"}
              </button>
            </div>
          )}

          <div className="sliders">
            {(mode === "guide" || mode === "word") && (
              <label className="slider-label">
                Pace
                <input type="range" min="80" max="520" step="20" value={wpm} onChange={e => setWpm(Number(e.target.value))} style={{ width: 112 }} />
                <span className="slider-value">{wpm} wpm</span>
              </label>
            )}
            {(mode === "phrase" || mode === "guide") && (
              <label className="slider-label">
                Chunk
                <input type="range" min="1" max="5" step="1" value={phraseWords} onChange={e => setPhraseWords(Number(e.target.value))} style={{ width: 80 }} />
                <span className="slider-value">{phraseWords} words</span>
              </label>
            )}
            <label className="slider-label">
              Size
              <input type="range" min="16" max="36" step="1" value={size} onChange={e => setSize(Number(e.target.value))} style={{ width: 96 }} />
              <span className="slider-value">{size}px</span>
            </label>
            <label className="slider-label">
              Measure
              <input type="range" min="36" max="84" step="2" value={measure} onChange={e => setMeasure(Number(e.target.value))} style={{ width: 96 }} />
              <span className="slider-value">{measure}ch</span>
            </label>
          </div>
        </div>

        <div className="stage">
          {mode === "page" && (
            <div style={{ fontSize: `${size}px`, maxWidth: `${measure}ch` }} className="stage-inner">
              {paragraphs.map((p, idx) => <p key={idx} className="page-p">{p}</p>)}
            </div>
          )}

          {mode === "guide" && (
            <div style={{ fontSize: `${size}px`, maxWidth: `${measure}ch` }} className="stage-inner">
              {wordGroups.map((group, pIdx) => (
                <p key={pIdx}>
                  {group.map(w => {
                    const active = playing && w.i >= wi && w.i < wi + phraseWords;
                    const passed = wi > 0 && w.i < wi;
                    return (
                      <span key={w.i} className="word-token" style={{
                        backgroundColor: active ? "#F7EBE8" : "transparent",
                        borderBottom: active ? "2px solid #C2593F" : "2px solid transparent",
                        color: active ? "#2C2825" : passed ? "#9A938A" : "#44403C"
                      }}>{w.t} </span>
                    );
                  })}
                </p>
              ))}
            </div>
          )}

          {mode === "phrase" && (
            <div style={{ fontSize: `${size}px`, maxWidth: `${measure}ch` }} className="stage-inner">
              {phraseGroups.map((group, pIdx) => (
                <p key={pIdx}>
                  {group.map(c => {
                    const isCurrent = c.i === chunk - 1;
                    const isPast = c.i < chunk - 1;
                    return (
                      <span key={c.i} className="chunk-token" style={{
                        backgroundColor: isCurrent ? "#F7EBE8" : "transparent",
                        borderBottom: isCurrent ? "2px solid #C2593F" : "2px solid transparent",
                        color: isCurrent ? "#2C2825" : isPast ? "#B0A89E" : "transparent"
                      }}>{c.t} </span>
                    );
                  })}
                </p>
              ))}
            </div>
          )}

          {mode === "word" && (
            <div className="word-stage">
              <div style={{ fontSize: `${Math.round(size * 2.6)}px` }} className="word-big">
                {words[Math.min(wi, words.length - 1)] || "Ready"}
              </div>
              <div className="word-context">{words.slice(Math.max(0, wi - 5), wi).join(" ")}</div>
            </div>
          )}

          {mode === "window" && (
            <div style={{ fontSize: `${size}px`, maxWidth: `${measure}ch`, lineHeight: 1.6 }} className="stage-inner">
              {sentences.map((sent, i) => {
                const dist = Math.abs(i - line);
                let opacity = 0.1;
                if (i < line) opacity = 0.15;
                else if (dist === 0) opacity = 1;
                else if (dist === 1) opacity = 0.65;
                else if (dist === 2) opacity = 0.35;
                return (
                  <div key={i} className="window-line" style={{ opacity, borderLeftColor: dist === 0 ? "#C2593F" : "transparent" }}>
                    {sent}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="hint-bar">
          <span className="hint-text">💡 {activeMode.keys}</span>
          <button type="button" onClick={handleReset} className="link-btn">Start over</button>
        </div>
      </div>

      {isEditing && !locked && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <h3>Load Text / Presets</h3>
              <button onClick={() => setIsEditing(false)} className="modal-close">✕</button>
            </div>
            <div className="preset-row">
              <span className="section-label" style={{ marginBottom: 0 }}>Presets:</span>
              {PRESETS.map((p, idx) => (
                <button key={idx} className="preset-tag" onClick={() => { setTitle(p.title); setRawText(p.text); }}>{p.title}</button>
              ))}
            </div>
            <div className="field">
              <label>Title</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>Text Content</label>
              <textarea rows={8} value={rawText} onChange={e => setRawText(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button onClick={() => setIsEditing(false)} className="btn-primary">Done &amp; Read</button>
            </div>
          </div>
        </div>
      )}

      {narration && <audio ref={audioRef} src={narration.audioSrc} preload="auto" />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ReadingRoom />);
