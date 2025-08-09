"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

// Types
type Player = {
  name: string;
  handicap: number; // 0-36
  scores: number[]; // length = numHoles
};

type Snapshot = {
  numPlayers: number;
  numHoles: number;
  players: Player[];
  pars: number[];
  si: number[];
  useStableford: boolean;
  course: string;
};

const MAX_PLAYERS = 4;
const MAX_HOLES = 18;
const STORAGE_KEY = "golf-card-v1";

// Kamloops, BC courses (city and nearby). Adjust as needed.
const KAMLOOPS_COURSES = [
  "Custom",
  "Kamloops Golf & Country Club",
  "The Dunes at Kamloops",
  "Rivershore Golf Links",
  "Big Horn (Sun Rivers) Golf Club",
  "Eaglepoint Golf Resort",
  "Mount Paul Golf Course",
  "Pineridge Golf Course",
  "McArthur Island Golf Park",
  "Tobiano (nearby)",
];

function defaultPars(n = MAX_HOLES) {
  const arr = Array(n).fill(4);
  // Typical pattern for 18 holes: mix of par 3/4/5. Keep simple defaults.
  [2, 7, 11, 16].forEach((idx) => (arr[idx] = 3));
  [4, 9, 13].forEach((idx) => (arr[idx] = 5));
  return arr.slice(0, n);
}

function defaultSI(n = MAX_HOLES) {
  // Stroke Index (1 hardest ... 18 easiest)
  return Array.from({ length: n }, (_, i) => i + 1);
}

function createPlayers(count: number, holes: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    handicap: 0,
    scores: Array(holes).fill(0),
  }));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function encodeState(snapshot: Snapshot): string {
  const json = JSON.stringify(snapshot);
  // Encode to base64 in a URI-safe way
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeState(code: string): Snapshot | null {
  try {
    const json = decodeURIComponent(escape(atob(code)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function strokesForHoleFromHandicap(handicap: number, si: number): number {
  // Allocate one stroke to the hardest holes first
  const base = Math.floor(handicap / 18);
  const remainder = handicap % 18;
  return base + (si <= remainder ? 1 : 0);
}

function stablefordPoints(gross: number, par: number, strokes: number) {
  if (!gross || gross <= 0) return 0; // treat 0 as not played yet
  const net = gross - strokes;
  const diff = net - par; // negative is better than par
  if (diff <= -3) return 5; // albatross or better
  if (diff === -2) return 4; // eagle
  if (diff === -1) return 3; // birdie
  if (diff === 0) return 2; // par
  if (diff === 1) return 1; // bogey
  return 0; // double bogey or worse
}

export default function Home() {
  // Core state
  const [numPlayers, setNumPlayers] = useState(2);
  const [numHoles, setNumHoles] = useState(18);
  const [players, setPlayers] = useState<Player[]>(createPlayers(2, 18));
  const [pars, setPars] = useState<number[]>(defaultPars(18));
  const [si, setSi] = useState<number[]>(defaultSI(18));
  const [useStableford, setUseStableford] = useState(false);
  const [course, setCourse] = useState<string>(KAMLOOPS_COURSES[0]);

  // UI helpers
  const [currentHole, setCurrentHole] = useState(1);

  // History for Undo/Redo
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [redo, setRedo] = useState<Snapshot[]>([]);

  // Timer / pace of play
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [holeDurations, setHoleDurations] = useState<number[]>(Array(MAX_HOLES).fill(0));

  // Load persisted or shared state on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    const shared = url.searchParams.get("s");
    if (shared) {
      const snap = decodeState(shared);
      if (snap) {
        applySnapshot(snap, false);
        return;
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const snap: Snapshot = JSON.parse(raw);
        applySnapshot(snap, false);
      } catch {
        // ignore
      }
    }
  }, []);

  // Persist on change
  useEffect(() => {
    const snap: Snapshot = {
      numPlayers,
      numHoles,
      players,
      pars,
      si,
      useStableford,
      course,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  }, [numPlayers, numHoles, players, pars, si, useStableford, course]);

  // Timer effect
  useEffect(() => {
    if (timerRunning) {
      if (startRef.current == null) startRef.current = Date.now();
      intervalRef.current = window.setInterval(() => {
        if (startRef.current != null) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 1000);
    }
    return () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timerRunning]);

  function currentSnapshot(): Snapshot {
    return {
      numPlayers,
      numHoles,
      players,
      pars,
      si,
      useStableford,
      course,
    };
  }

  function pushHistory() {
    setHistory((h) => [...h, deepClone(currentSnapshot())]);
    setRedo([]);
  }

  function applySnapshot(s: Snapshot, push = true) {
    if (push) pushHistory();
    setNumPlayers(clamp(s.numPlayers, 1, MAX_PLAYERS));
    setNumHoles(clamp(s.numHoles, 1, MAX_HOLES));
    setPlayers(
      s.players.slice(0, MAX_PLAYERS).map((p, i) => ({
        name: p.name || `Player ${i + 1}`,
        handicap: clamp(Math.round(p.handicap || 0), 0, 54),
        scores: (p.scores || []).slice(0, MAX_HOLES).concat(Array(MAX_HOLES).fill(0)).slice(0, s.numHoles),
      }))
    );
    setPars((s.pars || defaultPars(MAX_HOLES)).slice(0, s.numHoles));
    setSi((s.si || defaultSI(MAX_HOLES)).slice(0, s.numHoles));
    setUseStableford(!!s.useStableford);
    setCourse(s.course || KAMLOOPS_COURSES[0]);
    setCurrentHole(1);
  }

  function handlePlayersChange(n: number) {
    const next = clamp(n, 1, MAX_PLAYERS);
    pushHistory();
    setNumPlayers(next);
    setPlayers((ps) => {
      if (ps.length === next) return ps;
      if (ps.length < next) {
        return [...ps, ...createPlayers(next - ps.length, numHoles).map((p, i) => ({
          ...p,
          name: `Player ${ps.length + i + 1}`,
        }))];
      }
      return ps.slice(0, next);
    });
  }

  function handleHolesChange(n: number) {
    const next = clamp(n, 1, MAX_HOLES);
    pushHistory();
    setNumHoles(next);
    setPars((p) => p.slice(0, next).concat(defaultPars(MAX_HOLES).slice(p.length, next)));
    setSi((x) => x.slice(0, next).concat(defaultSI(MAX_HOLES).slice(x.length, next)));
    setPlayers((ps) => ps.map((p) => ({
      ...p,
      scores: p.scores.slice(0, next).concat(Array(next - p.scores.slice(0, next).length).fill(0)),
    })));
    setCurrentHole((h) => clamp(h, 1, next));
  }

  function setScore(pi: number, hi: number, val: number) {
    pushHistory();
    setPlayers((ps) => {
      const next = deepClone(ps);
      next[pi].scores[hi] = clamp(Math.round(val), 0, 20);
      return next;
    });
  }

  function setPar(hi: number, val: number) {
    pushHistory();
    setPars((p) => {
      const next = p.slice();
      next[hi] = clamp(Math.round(val), 3, 6);
      return next;
    });
  }

  function setSI(hi: number, val: number) {
    pushHistory();
    setSi((arr) => {
      const next = arr.slice();
      next[hi] = clamp(Math.round(val), 1, numHoles);
      return next;
    });
  }

  function setName(pi: number, name: string) {
    pushHistory();
    setPlayers((ps) => {
      const next = deepClone(ps);
      next[pi].name = name.slice(0, 20);
      return next;
    });
  }

  function setHandicap(pi: number, val: number) {
    pushHistory();
    setPlayers((ps) => {
      const next = deepClone(ps);
      next[pi].handicap = clamp(Math.round(val), 0, 54);
      return next;
    });
  }

  function handleUndo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setRedo((r) => [...r, deepClone(currentSnapshot())]);
      applySnapshot(prev, false);
      return h.slice(0, -1);
    });
  }

  function handleRedo() {
    setRedo((r) => {
      if (r.length === 0) return r;
      const nxt = r[r.length - 1];
      setHistory((h) => [...h, deepClone(currentSnapshot())]);
      applySnapshot(nxt, false);
      return r.slice(0, -1);
    });
  }

  function resetAll() {
    pushHistory();
    setNumPlayers(2);
    setNumHoles(18);
    setPlayers(createPlayers(2, 18));
    setPars(defaultPars(18));
    setSi(defaultSI(18));
    setUseStableford(false);
    setCourse(KAMLOOPS_COURSES[0]);
    setCurrentHole(1);
    setHoleDurations(Array(MAX_HOLES).fill(0));
  }

  function exportCSV() {
    const headers = ["Hole", ...Array.from({ length: numHoles }, (_, i) => `${i + 1}`), "Total"];
    const parRow = ["Par", ...pars.slice(0, numHoles).map(String), pars.slice(0, numHoles).reduce((a, b) => a + b, 0).toString()];
    const rows = [headers.join(","), parRow.join(",")];
    players.slice(0, numPlayers).forEach((p) => {
      const total = p.scores.slice(0, numHoles).reduce((a, b) => a + (b || 0), 0);
      rows.push([p.name, ...p.scores.slice(0, numHoles).map((x) => (x || 0).toString()), total.toString()].join(","));
    });
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `golf-scorecard-${course.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snap: Snapshot = JSON.parse(String(reader.result));
        applySnapshot(snap);
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  function shareLink() {
    const code = encodeState(currentSnapshot());
    const url = new URL(window.location.href);
    url.searchParams.set("s", code);
    const final = url.toString();
    navigator.clipboard?.writeText(final).then(
      () => alert("Shareable link copied to clipboard"),
      () => alert("Shareable link: " + final)
    );
  }

  function toggleTimer() {
    setTimerRunning((r) => !r);
    if (!timerRunning) {
      startRef.current = Date.now();
      setElapsed(0);
    } else {
      if (startRef.current != null) {
        const secs = Math.floor((Date.now() - startRef.current) / 1000);
        setHoleDurations((d) => {
          const next = d.slice();
          next[clamp(currentHole - 1, 0, MAX_HOLES - 1)] += secs;
          return next;
        });
      }
      startRef.current = null;
    }
  }

  function moveHole(delta: number) {
    setCurrentHole((h) => {
      const next = clamp(h + delta, 1, numHoles);
      if (timerRunning && startRef.current != null && next !== h) {
        const secs = Math.floor((Date.now() - startRef.current) / 1000);
        setHoleDurations((d) => {
          const arr = d.slice();
          arr[h - 1] += secs;
          return arr;
        });
        startRef.current = Date.now();
        setElapsed(0);
      }
      return next;
    });
  }

  function printCard() {
    window.print();
  }

  function toggleTheme() {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme");
    root.setAttribute("data-theme", current === "dark" ? "light" : "dark");
  }

  // Totals and derived
  const totals = useMemo(() => {
    const outIdx = Math.min(9, numHoles);
    return players.slice(0, numPlayers).map((p) => {
      const grossOut = p.scores.slice(0, outIdx).reduce((a, b) => a + (b || 0), 0);
      const grossIn = p.scores.slice(outIdx, numHoles).reduce((a, b) => a + (b || 0), 0);
      const gross = grossOut + grossIn;

      // Net using handicap with SI allocation
      let net = 0;
      for (let h = 0; h < numHoles; h++) {
        const strokes = strokesForHoleFromHandicap(p.handicap, si[h]);
        const g = p.scores[h] || 0;
        if (g > 0) net += g - strokes;
      }

      // Stableford
      let points = 0;
      for (let h = 0; h < numHoles; h++) {
        points += stablefordPoints(p.scores[h] || 0, pars[h], strokesForHoleFromHandicap(p.handicap, si[h]));
      }

      // Birdie/Eagle etc counts
      let birdies = 0, eagles = 0, parsC = 0, bogeys = 0;
      for (let h = 0; h < numHoles; h++) {
        const g = p.scores[h] || 0;
        if (!g) continue;
        const diff = g - pars[h];
        if (diff === -2) eagles++;
        else if (diff === -1) birdies++;
        else if (diff === 0) parsC++;
        else if (diff === 1) bogeys++;
      }

      return { grossOut, grossIn, gross, net, points, birdies, eagles, parsC, bogeys };
    });
  }, [players, numPlayers, numHoles, pars, si]);

  const avgPerHole = useMemo(() => {
    return Array.from({ length: numHoles }, (_, h) => {
      const vals = players.slice(0, numPlayers).map((p) => p.scores[h] || 0).filter((v) => v > 0);
      if (vals.length === 0) return 0;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    });
  }, [players, numPlayers, numHoles]);

  // Keyboard navigation among inputs
  function onScoreKeyDown(e: KeyboardEvent<HTMLInputElement>, pi: number, hi: number) {
    const key = e.key;
    const move = (p: number, h: number) => {
      const id = `score-p${p}-h${h}`;
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    };
    if (key === "ArrowRight" || (key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      const nh = hi + 1;
      if (nh < numHoles) move(pi, nh);
      else if (pi + 1 < numPlayers) move(pi + 1, 0);
    } else if (key === "ArrowLeft" || (key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      const ph = hi - 1;
      if (ph >= 0) move(pi, ph);
      else if (pi - 1 >= 0) move(pi - 1, numHoles - 1);
    } else if (key === "ArrowDown") {
      e.preventDefault();
      if (pi + 1 < numPlayers) move(pi + 1, hi);
    } else if (key === "ArrowUp") {
      e.preventDefault();
      if (pi - 1 >= 0) move(pi - 1, hi);
    }
  }

  return (
    <div className="wrapper">
      <header className="toolbar" role="banner">
        <div className="brand">
          <h1>Golf Scorecard</h1>
          <span className="subtitle">Universal, up to 4 players · 18 holes</span>
        </div>
        <div className="toolbar-actions" role="group" aria-label="Primary actions">
          <button className="btn" onClick={resetAll} title="Reset">Reset</button>
          <button className="btn" onClick={handleUndo} title="Undo" disabled={history.length === 0}>Undo</button>
          <button className="btn" onClick={handleRedo} title="Redo" disabled={redo.length === 0}>Redo</button>
          <button className="btn" onClick={exportCSV} title="Export CSV">Export</button>
          <label className="btn file-input" title="Import JSON">
            Import
            <input type="file" accept="application/json" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJSON(f);
            }} />
          </label>
          <button className="btn" onClick={shareLink} title="Copy shareable link">Share</button>
          <button className="btn" onClick={printCard} title="Print">Print</button>
          <button className="btn" onClick={toggleTheme} title="Toggle theme">Theme</button>
        </div>
      </header>

      <section className="controls" aria-label="Configuration">
        <div className="control">
          <label htmlFor="course">Course</label>
          <select id="course" value={course} onChange={(e) => { pushHistory(); setCourse(e.target.value); }}>
            {KAMLOOPS_COURSES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="control">
          <label htmlFor="players">Players</label>
          <input id="players" type="number" min={1} max={MAX_PLAYERS} value={numPlayers} onChange={(e) => handlePlayersChange(Number(e.target.value))} />
        </div>
        <div className="control">
          <label htmlFor="holes">Holes</label>
          <input id="holes" type="number" min={1} max={MAX_HOLES} value={numHoles} onChange={(e) => handleHolesChange(Number(e.target.value))} />
        </div>
        <div className="control">
          <label className="checkbox">
            <input type="checkbox" checked={useStableford} onChange={(e) => { pushHistory(); setUseStableford(e.target.checked); }} />
            Stableford points
          </label>
        </div>
        <div className="control hole-nav">
          <button className="btn ghost" onClick={() => moveHole(-1)} disabled={currentHole <= 1}>Prev</button>
          <span>Hole {currentHole}</span>
          <button className="btn ghost" onClick={() => moveHole(1)} disabled={currentHole >= numHoles}>Next</button>
        </div>
        <div className="control timer">
          <button className="btn" onClick={toggleTimer}>{timerRunning ? "Pause" : "Start"} Timer</button>
          <span aria-live="polite" className="mono">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
        </div>
      </section>

      <div className="table-wrapper">
        <table className="golf" role="table">
          <thead>
            <tr>
              <th className="sticky">Player</th>
              {Array.from({ length: numHoles }, (_, i) => (
                <th key={`h${i}`} className={i + 1 === currentHole ? "highlight" : undefined}>H{i + 1}</th>
              ))}
              <th>Out</th>
              {numHoles > 9 && <th>In</th>}
              <th>Total</th>
              <th>Net</th>
              {useStableford && <th>Pts</th>}
            </tr>
            <tr className="subhead">
              <th className="sticky">Par / SI</th>
              {Array.from({ length: numHoles }, (_, i) => (
                <th key={`p${i}`} className={i + 1 === currentHole ? "highlight" : undefined}>
                  <div className="par-si">
                    <input aria-label={`Par for hole ${i + 1}`} type="number" min={3} max={6} value={pars[i]}
                      onChange={(e) => setPar(i, Number(e.target.value))} />
                    <input aria-label={`Stroke index for hole ${i + 1}`} type="number" min={1} max={numHoles} value={si[i]}
                      onChange={(e) => setSI(i, Number(e.target.value))} />
                  </div>
                </th>
              ))}
              <th className="muted">—</th>
              {numHoles > 9 && <th className="muted">—</th>}
              <th className="muted">—</th>
              <th className="muted">—</th>
              {useStableford && <th className="muted">—</th>}
            </tr>
          </thead>
          <tbody>
            {players.slice(0, numPlayers).map((p, pi) => (
              <tr key={pi}>
                <th className="sticky player-cell">
                  <input className="player-name" value={p.name} onChange={(e) => setName(pi, e.target.value)} aria-label={`Name for player ${pi + 1}`} />
                  <div className="handicap">
                    <label>Hcp</label>
                    <input type="number" min={0} max={54} value={p.handicap} onChange={(e) => setHandicap(pi, Number(e.target.value))} aria-label={`Handicap for ${p.name}`} />
                  </div>
                </th>
                {Array.from({ length: numHoles }, (_, hi) => (
                  <td key={hi} className={hi + 1 === currentHole ? "highlight" : undefined}>
                    <input
                      id={`score-p${pi}-h${hi}`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Score for ${p.name} on hole ${hi + 1}`}
                      type="number"
                      min={0}
                      max={20}
                      value={p.scores[hi] || 0}
                      onKeyDown={(e) => onScoreKeyDown(e, pi, hi)}
                      onChange={(e) => setScore(pi, hi, Number(e.target.value))}
                    />
                  </td>
                ))}
                <td className="mono">{totals[pi]?.grossOut ?? 0}</td>
                {numHoles > 9 && <td className="mono">{totals[pi]?.grossIn ?? 0}</td>}
                <td className="mono strong">{totals[pi]?.gross ?? 0}</td>
                <td className="mono">{totals[pi]?.net ?? 0}</td>
                {useStableford && <td className="mono">{totals[pi]?.points ?? 0}</td>}
              </tr>
            ))}

            {/* Averages row */}
            <tr className="summary">
              <th className="sticky">Avg / hole</th>
              {avgPerHole.map((v, i) => (
                <td key={`avg${i}`} className={i + 1 === currentHole ? "highlight" : undefined}>{v || ""}</td>
              ))}
              <td colSpan={numHoles > 9 ? 4 : 3} className="muted">—</td>
              {useStableford && <td className="muted">—</td>}
            </tr>
          </tbody>
        </table>
      </div>

      <section className="badges" aria-label="Player stats">
        {players.slice(0, numPlayers).map((p, i) => (
          <div key={i} className="card">
            <div className="card-title">{p.name}</div>
            <div className="card-body">
              <div className="stat"><span>Birdies</span><strong>{totals[i]?.birdies ?? 0}</strong></div>
              <div className="stat"><span>Eagles</span><strong>{totals[i]?.eagles ?? 0}</strong></div>
              <div className="stat"><span>Pars</span><strong>{totals[i]?.parsC ?? 0}</strong></div>
              <div className="stat"><span>Bogeys</span><strong>{totals[i]?.bogeys ?? 0}</strong></div>
              {useStableford && <div className="stat"><span>Points</span><strong>{totals[i]?.points ?? 0}</strong></div>}
            </div>
          </div>
        ))}
      </section>

      <section className="pace" aria-label="Pace of play">
        <div className="card">
          <div className="card-title">Pace</div>
          <div className="card-body">
            <div className="stat"><span>Timer</span><strong>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</strong></div>
            <div className="hole-times">
              {holeDurations.slice(0, numHoles).map((sec, i) => (
                <div key={i} className="chip">H{i + 1}: {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="footer" role="contentinfo">
        <details>
          <summary>Features</summary>
          <ul>
            <li>Up to 4 players, 18 holes</li>
            <li>Editable player names</li>
            <li>Per-player handicap with SI allocation</li>
            <li>Editable par and stroke index per hole</li>
            <li>Gross, Out/Back, Total, Net totals</li>
            <li>Stableford points (toggle)</li>
            <li>Birdie/Eagle/Par/Bogey counters</li>
            <li>Average per hole row</li>
            <li>Current hole highlight + navigation</li>
            <li>Keyboard navigation across inputs</li>
            <li>Local storage autosave</li>
            <li>Share via URL</li>
            <li>Export CSV</li>
            <li>Import JSON</li>
            <li>Undo/Redo</li>
            <li>Reset/clear</li>
            <li>Pace timer and per-hole durations</li>
            <li>Print-friendly layout</li>
            <li>Sticky headers and first column</li>
            <li>Dark theme toggle</li>
            <li>Course selector for Kamloops, BC</li>
          </ul>
        </details>
      </footer>
    </div>
  );
}
