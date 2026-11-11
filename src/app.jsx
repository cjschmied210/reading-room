import React from "react";
import ReactDOM from "react-dom/client";

const { useState, useEffect, useRef, useMemo } = React;

const MODES = [
  { id: "page", label: "Page", blurb: "The whole text at once, set like a printed page.", keys: "Scroll or read at your leisure." },
  { id: "guide", label: "Moving guide", blurb: "A smooth highlight sweeps forward at your set pace.", keys: "Space starts or pauses the guide." },
  { id: "phrase", label: "Phrases", blurb: "One phrase at a time, stepped at your own pace.", keys: "Space / Right Arrow reveals next phrase. Left Arrow steps back." },
  { id: "word", label: "One word", blurb: "Words arrive in place. Your eyes stay fixed in position.", keys: "Space starts or pauses playback." },
  { id: "window", label: "Focus window", blurb: "A few lines lit; text outside the window dims.", keys: "Up / Down Arrow keys move the focus window. Click a line to jump to it." }
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
// Shape: { title, text, locked, narration: { audioSrc, timing, wordTimestamps: [{start,end}, ...] } | null }
// narration.timing === "measured" means the word times were measured from the
// audio itself (builder/align.py). Anything else is a rough estimate that
// drifts, so the reader still plays the audio but keeps word-synced features
// (highlighting, read-aloud in the stepped modes) switched off.
const DATA = typeof window !== "undefined" ? window.__READER_DATA__ || null : null;

const SENTENCE_END = /[.!?…]["'”’»)\]]*$/;
const ABBREVIATION = /^(?:dr|dra|mr|mrs|ms|prof|sr|sra|srta|jr|st|vs|etc|no|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|\p{L})\.$/iu;

function isAbbreviation(token) {
  return ABBREVIATION.test(token.replace(/^[^\p{L}\p{N}]+/u, ""));
}

function startsLowercase(token) {
  const m = token.match(/\p{L}/u);
  return !!m && m[0] === m[0].toLowerCase() && m[0] !== m[0].toUpperCase();
}

const PageParagraph = React.memo(function PageParagraph({ group, active }) {
  return (
    <p className="page-p">
      {group.map(w => (
        <React.Fragment key={w.i}>
          <span data-w={w.i} className={w.i === active ? "page-word on" : "page-word"}>{w.t}</span>{" "}
        </React.Fragment>
      ))}
    </p>
  );
});

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
  const [rate, setRate] = useState(1);
  const [size, setSize] = useState(21);
  const [measure, setMeasure] = useState(62);
  const [phraseWords, setPhraseWords] = useState(3);
  const [isEditing, setIsEditing] = useState(false);
  const [listenState, setListenState] = useState("idle"); // idle | playing | paused
  const [toolbarInView, setToolbarInView] = useState(true);

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const stopAtRef = useRef(null);
  const toolbarRef = useRef(null);
  const onKeyRef = useRef(null);

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

  // Phrases and sentences carry their word range [ws, we) so each one can be
  // matched to its stretch of narration audio.
  const phraseGroups = useMemo(() => {
    let gi = 0;
    let wordPos = 0;
    return wordGroups.map(group => {
      const out = [];
      let cur = [];
      const flush = () => {
        out.push({ t: cur.join(" "), i: gi++, ws: wordPos, we: wordPos + cur.length });
        wordPos += cur.length;
        cur = [];
      };
      group.forEach(w => {
        cur.push(w.t);
        const breaks = /[.,;:!?—–"')]$/.test(w.t);
        if (cur.length >= phraseWords || (breaks && cur.length >= Math.max(2, phraseWords - 1))) flush();
      });
      if (cur.length) flush();
      return out;
    });
  }, [wordGroups, phraseWords]);

  const phrases = useMemo(() => phraseGroups.reduce((acc, g) => acc.concat(g), []), [phraseGroups]);

  const sentences = useMemo(() => {
    const out = [];
    let wordPos = 0;
    wordGroups.forEach(group => {
      let cur = [];
      group.forEach((w, k) => {
        cur.push(w.t);
        const next = group[k + 1];
        const ends = !next || (SENTENCE_END.test(w.t) && !isAbbreviation(w.t) && !startsLowercase(next.t));
        if (ends) {
          out.push({ t: cur.join(" "), ws: wordPos, we: wordPos + cur.length });
          wordPos += cur.length;
          cur = [];
        }
      });
    });
    return out;
  }, [wordGroups]);

  const ts = narration?.wordTimestamps || null;
  const synced = !!narration && narration.timing === "measured" && !!ts && ts.length === words.length;

  // Page mode always plays through the audio (or browser speech); the paced
  // modes do too once word times are trustworthy, otherwise they run on a timer.
  const audioDriven = synced || mode === "page";
  const isPlaying = audioDriven ? listenState === "playing" : playing;
  const canResume = synced ? wi > 0 : mode === "page" ? listenState === "paused" : wi > 0;

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const stopSpeech = () => { if (ttsSupported) window.speechSynthesis.cancel(); };
  const pauseAudio = () => {
    stopAtRef.current = null;
    const a = audioRef.current;
    if (a && !a.paused) a.pause();
  };

  const seekToWord = (i) => {
    setWi(i);
    const a = audioRef.current;
    if (a && synced) a.currentTime = i <= 0 ? 0 : ts[i].start;
  };

  const playRange = (ws, we) => {
    const a = audioRef.current;
    if (!a || !synced || we <= ws) return;
    const lastEnd = ts[we - 1].end;
    stopAtRef.current = we < ts.length ? Math.max(lastEnd, Math.min(lastEnd + 0.12, ts[we].start)) : null;
    a.currentTime = Math.max(0, ts[ws].start - 0.03);
    a.playbackRate = rate;
    a.play().catch(() => {});
  };

  // Track the narration <audio> element's own play/pause/ended state rather
  // than a locally-kept flag that can drift from what is actually sounding.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setListenState("playing");
    const onPause = () => setListenState(a.ended || a.currentTime === 0 ? "idle" : "paused");
    const onEnded = () => { stopAtRef.current = null; a.currentTime = 0; setWi(0); setListenState("idle"); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [narration]);

  // While narration plays: move the word cursor with it, and stop at the end
  // of a phrase/sentence when only that stretch was asked for. timeupdate is
  // the backstop for background tabs, where animation frames are paused.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !synced || listenState !== "playing") return;
    const check = () => {
      const t = a.currentTime;
      const stopAt = stopAtRef.current;
      if (stopAt != null) {
        if (t >= stopAt) { stopAtRef.current = null; a.pause(); }
        return;
      }
      let lo = 0, hi = ts.length - 1, at = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ts[mid].start <= t) { at = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      setWi(prev => (prev === at ? prev : at));
    };
    let raf;
    const tick = () => { check(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    a.addEventListener("timeupdate", check);
    return () => { cancelAnimationFrame(raf); a.removeEventListener("timeupdate", check); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced, listenState]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // Timer-paced playback for guide / word modes when there is no synced audio.
  useEffect(() => {
    if (synced || !playing || (mode !== "guide" && mode !== "word")) { stopTimer(); return; }

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
  }, [synced, playing, wpm, mode, phraseWords, words.length]);

  // Best-effort default voice for the browser-TTS fallback (no picker UI —
  // this only matters for a reading with no baked narration).
  const pickVoice = () => {
    if (!ttsSupported) return null;
    const list = window.speechSynthesis.getVoices();
    return list.find(v => /en/i.test(v.lang) && /premium|enhanced|natural|neural/i.test(v.name))
      || list.find(v => /en/i.test(v.lang))
      || list[0]
      || null;
  };

  const toggleBrowserSpeech = () => {
    if (!ttsSupported) return;
    const synth = window.speechSynthesis;
    if (synth.speaking && !synth.paused) { synth.pause(); setListenState("paused"); return; }
    if (synth.paused) { synth.resume(); setListenState("playing"); return; }
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(paragraphs.join(". "));
    const v = pickVoice();
    if (v) utter.voice = v;
    utter.rate = rate;
    utter.onend = () => setListenState("idle");
    setListenState("playing");
    synth.speak(utter);
  };

  const toggleNarration = () => {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    stopAtRef.current = null;
    a.playbackRate = rate;
    a.play().catch(() => {});
  };

  const togglePlay = () => {
    if (narration && audioDriven) toggleNarration();
    else if (mode === "page") toggleBrowserSpeech();
    else setPlaying(p => !p);
  };

  const resetAll = () => {
    setPlaying(false); setWi(0); setChunk(0); setLine(0);
    stopSpeech(); pauseAudio();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setListenState("idle");
  };

  // Reset state on text change
  useEffect(() => {
    resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText]);

  const goPhrase = (next) => {
    const n = Math.max(0, Math.min(phrases.length, next));
    setChunk(n);
    if (!synced) return;
    if (n > 0) playRange(phrases[n - 1].ws, phrases[n - 1].we);
    else pauseAudio();
  };

  const goLine = (next) => {
    const n = Math.max(0, Math.min(sentences.length - 1, next));
    setLine(n);
    if (synced && sentences[n]) playRange(sentences[n].ws, sentences[n].we);
  };

  // Switching modes keeps your place in the text instead of starting over.
  const handleModeSelect = (mId) => {
    let w = Math.min(wi, Math.max(0, words.length - 1));
    if (mode === "phrase") w = chunk > 0 ? phrases[chunk - 1].ws : 0;
    if (mode === "window") w = sentences[line] ? sentences[line].ws : 0;
    setPlaying(false); stopSpeech(); pauseAudio();
    if (!narration) setListenState("idle");
    setMode(mId);
    seekToWord(w);
    setChunk(w > 0 ? phrases.findIndex(p => w < p.we) + 1 : 0);
    setLine(Math.max(0, sentences.findIndex(s => w < s.we)));
  };

  onKeyRef.current = (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(activeTag) || document.activeElement.isContentEditable) {
      if (e.code === "Space" && activeTag === "BUTTON") return;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    }
    if (e.code === "Space" || e.key === " ") {
      if (mode === "guide" || mode === "word") { e.preventDefault(); togglePlay(); }
      else if (mode === "phrase") { e.preventDefault(); goPhrase(chunk + 1); }
      else if (mode === "window" && synced) { e.preventDefault(); goLine(line); }
    }
    if (mode === "phrase") {
      if (e.key === "ArrowRight") { e.preventDefault(); goPhrase(chunk + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPhrase(chunk - 1); }
    }
    if (mode === "window") {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); goLine(line + 1); }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); goLine(line - 1); }
    }
  };
  useEffect(() => {
    const handler = (e) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Keep the spot being read on screen.
  useEffect(() => {
    let selector = null;
    if ((mode === "page" || mode === "guide") && isPlaying) selector = `[data-w="${wi}"]`;
    else if (mode === "phrase" && chunk > 0) selector = `[data-c="${chunk - 1}"]`;
    else if (mode === "window") selector = `[data-l="${line}"]`;
    const el = selector && document.querySelector(selector);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 120) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [mode, isPlaying, wi, chunk, line]);

  // Once the page has scrolled past the toolbar, a floating Pause/Resume
  // stands in for the button that is no longer reachable.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setToolbarInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const activeMode = MODES.find(m => m.id === mode) || MODES[0];
  const showSpeed = narration ? audioDriven : mode === "page" && ttsSupported;
  const showPageMark = synced && (isPlaying || wi > 0);
  const showFloatingTransport = !toolbarInView && (mode === "page" || mode === "guide") && (isPlaying || canResume);

  const getProgressText = () => {
    if (mode === "phrase") return `${chunk} of ${phrases.length} phrases`;
    if (mode === "window") return `Line ${line + 1} of ${sentences.length}`;
    if (mode === "page") return "";
    return `Word ${Math.min(wi + 1, words.length)} of ${words.length}`;
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
            {!locked && (
              <button className="btn-ghost" onClick={() => setIsEditing(true)}>✎ Edit Text / Presets</button>
            )}
          </div>
        </div>

        <h1 className="doc-title">{title}</h1>

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

        <div className="toolbar" ref={toolbarRef}>
          {(mode === "guide" || mode === "word") && (
            <div className="transport">
              <button type="button" onClick={togglePlay} className="btn-primary">
                {isPlaying ? "Pause" : canResume ? "Resume" : "Start"}
              </button>
              <button type="button" onClick={resetAll} className="btn-secondary">Reset</button>
              <span className="progress-text">{getProgressText()}</span>
            </div>
          )}
          {mode === "phrase" && (
            <div className="transport">
              <button type="button" onClick={() => goPhrase(chunk - 1)} className="btn-secondary">← Back</button>
              <button type="button" onClick={() => goPhrase(chunk + 1)} className="btn-primary">Next phrase →</button>
              <span className="progress-text">{getProgressText()}</span>
            </div>
          )}
          {mode === "window" && (
            <div className="transport">
              <button type="button" onClick={() => goLine(line - 1)} className="btn-secondary">↑ Up</button>
              <button type="button" onClick={() => goLine(line + 1)} className="btn-primary">Down ↓</button>
              <span className="progress-text">{getProgressText()}</span>
            </div>
          )}
          {mode === "page" && (narration || ttsSupported) && (
            <div className="transport">
              <button type="button" onClick={togglePlay} className="btn-primary">
                {isPlaying ? "Pause" : canResume ? "Resume" : "Listen"}
              </button>
              {synced && canResume && (
                <button type="button" onClick={resetAll} className="btn-secondary">Reset</button>
              )}
            </div>
          )}

          <div className="sliders">
            {showSpeed && (
              <label className="slider-label">
                Speed
                <input type="range" min="0.5" max="1.5" step="0.1" value={rate} onChange={e => setRate(Number(e.target.value))} style={{ width: 112 }} />
                <span className="slider-value">{rate.toFixed(1)}×</span>
              </label>
            )}
            {(mode === "guide" || mode === "word") && !synced && (
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
              {synced
                ? wordGroups.map((group, idx) => {
                    const here = showPageMark && wi >= group[0].i && wi <= group[group.length - 1].i;
                    return <PageParagraph key={idx} group={group} active={here ? wi : -1} />;
                  })
                : paragraphs.map((p, idx) => <p key={idx} className="page-p">{p}</p>)}
            </div>
          )}

          {mode === "guide" && (
            <div style={{ fontSize: `${size}px`, maxWidth: `${measure}ch` }} className="stage-inner">
              {wordGroups.map((group, pIdx) => (
                <p key={pIdx}>
                  {group.map(w => {
                    const active = isPlaying && w.i >= wi && w.i < wi + phraseWords;
                    const passed = wi > 0 && w.i < wi;
                    return (
                      <span key={w.i} data-w={w.i} className="word-token" style={{
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
                      <span key={c.i} data-c={c.i} className="chunk-token" style={{
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
                  <div key={i} data-l={i} onClick={() => goLine(i)} className="window-line" style={{ opacity, borderLeftColor: dist === 0 ? "#C2593F" : "transparent" }}>
                    {sent.t}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="hint-bar">
          <span className="hint-text">💡 {activeMode.keys}</span>
          <button type="button" onClick={resetAll} className="link-btn">Start over</button>
        </div>
      </div>

      {showFloatingTransport && (
        <button type="button" onClick={togglePlay} className="btn-primary float-transport">
          {isPlaying ? "Pause" : "Resume"}
        </button>
      )}

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
