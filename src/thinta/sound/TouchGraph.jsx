// Touch-the-graph for blind learners: drag a finger across the graph and the pitch follows the curve, with
// ticks, vibration (Android) and spoken announcements at the roots and turning point. Screen reader users,
// whose drags TalkBack and VoiceOver take over, step through x with a native slider and key-point buttons.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sonify, yAt, yRange, pitchFor, crossedKeyPoints, nearestKeyPoint, describeKeyPoint, describeX, stopsFor, spokenNumber, curveSide } from './sonify.js';
import { createAudioEngine, vibrate, canVibrate, buzzOffCurve, stopBuzz } from './audio-engine.js';
import './touch-graph.css';

const W = 360, H = 280, PAD = { left: 44, right: 14, top: 16, bottom: 34 };
// How far (in graph units, about a fingertip) the finger may stray from the curve before the phone buzzes.
const OFF_CURVE = 30;
const BUZZ_EVERY_MS = 220;
const SHAPE_NAMES = { root: 'circle', 'turning-point': 'square', 'y-intercept': 'triangle' };

// A key point's marker. Shapes, not colours, say what kind it is.
function Marker({ kind, cx, cy, size = 9 }) {
  if (kind === 'turning-point') return <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} className="th-touch-mark" />;
  if (kind === 'y-intercept') return <polygon points={`${cx},${cy - size * 1.2} ${cx + size * 1.1},${cy + size * 0.8} ${cx - size * 1.1},${cy + size * 0.8}`} className="th-touch-mark" />;
  return <circle cx={cx} cy={cy} r={size} className="th-touch-mark" />;
}

// Round tick spacing (1, 2, 5, 10 …) giving about six ticks.
function tickStep(span) {
  const raw = span / 6, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
}

// "Rainfall (mm)" → "mm", so bars are read with their unit.
const unitOf = label => (label?.match(/\(([^)]+)\)/) || [])[1] || '';

export default function TouchGraph({ job, durationMs = 4000 }) {
  const proof = job?.proof;
  const sound = useMemo(() => {
    const s = job?.sound?.samples?.length ? job.sound : sonify(proof);
    return { samples: s.samples.slice().sort((a, b) => a.x - b.x), keyPoints: s.keyPoints.slice().sort((a, b) => a.x - b.x) };
  }, [job?.sound, proof]);
  const bars = proof?.bars || job?.reading?.bars || [];
  const isBar = sound.keyPoints.some(p => p.kind === 'bar');
  const context = { samples: sound.samples, bars, unit: unitOf(job?.reading?.axes?.y?.label) };
  const stops = useMemo(() => stopsFor(sound), [sound]);
  const range = useMemo(() => yRange(sound), [sound]);
  const title = isBar ? (job?.reading?.labels?.[0] || 'Bar chart') : (proof?.equation || 'Graph');

  // Drawing scale: bars sit at x = 0, 1, 2 … with half a bar of room either side.
  const [x0, x1] = isBar ? [-0.5, sound.samples.length - 0.5] : [sound.samples[0]?.x ?? -1, sound.samples.at(-1)?.x ?? 1];
  const [lo, hi] = [Math.min(range[0], 0), Math.max(range[1], 0)];
  const yPad = (hi - lo) * 0.06;
  const [y0, y1] = [isBar ? lo : lo - yPad, hi + yPad];
  const sx = x => PAD.left + (x - x0) / (x1 - x0) * (W - PAD.left - PAD.right);
  const sy = y => H - PAD.bottom - (y - y0) / (y1 - y0) * (H - PAD.top - PAD.bottom);
  const pan = x => Math.max(-1, Math.min(1, -1 + 2 * (x - x0) / (x1 - x0)));

  const engine = useRef(null);
  const getEngine = () => (engine.current ||= createAudioEngine());
  const [audio, setAudio] = useState({ supported: true, running: false, muted: false });
  const [cursor, setCursor] = useState(null); // x being explored or played
  const [playing, setPlaying] = useState(false);
  const [said, setSaid] = useState({ text: '', n: 0 });
  const [vibrates, setVibrates] = useState(true);
  const lastX = useRef(null);
  const dragging = useRef(false);

  const announce = text => setSaid(s => ({ text, n: s.n + 1 }));

  useEffect(() => {
    const e = getEngine();
    setAudio(e.state()); setVibrates(canVibrate());
    const off = e.subscribe(setAudio);
    // iOS Safari only starts audio from a gesture: unlock on the first touch or key anywhere on the page.
    const unlock = () => e.unlock();
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => { off(); document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('keydown', unlock, true); e.close(); engine.current = null; };
  }, []);

  // A key point reached: tick, buzz and say it.
  const reach = point => {
    getEngine().tick(point.kind);
    vibrate(point.kind);
    announce(describeKeyPoint(point, context));
  };

  const valueAt = x => (isBar ? sound.samples[Math.round(Math.max(0, Math.min(sound.samples.length - 1, x)))]?.y : yAt(sound.samples, x));

  const xFromPointer = event => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width * W;
    const x = x0 + (px - PAD.left) / (W - PAD.left - PAD.right) * (x1 - x0);
    return isBar ? Math.max(0, Math.min(sound.samples.length - 1, Math.round(x))) : Math.max(x0, Math.min(x1, x));
  };

  const follow = x => {
    const e = getEngine();
    e.setTone(pitchFor(valueAt(x), range), pan(x));
    if (isBar) { if (x !== lastX.current) reach(sound.keyPoints[x]); }
    else for (const point of crossedKeyPoints(lastX.current, x, sound.keyPoints)) reach(point);
    lastX.current = x;
    setCursor(x);
  };

  const onPointerDown = event => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const e = getEngine();
    e.unlock();
    e.stopSweep(); setPlaying(false);
    dragging.current = true;
    const x = xFromPointer(event);
    lastX.current = null;
    e.startTone(pitchFor(valueAt(x), range), pan(x));
    // Touching down right on a key point counts as reaching it.
    const near = !isBar && nearestKeyPoint(x, sound.keyPoints, (x1 - x0) / 60);
    if (near) { reach(near); lastX.current = x; setCursor(x); } else follow(x);
  };
  // While tracing, a finger that drifts off the curve gets a repeating buzz and a spoken "move up" or "move down".
  const offCurve = useRef({ side: null, last: 0 });
  const guide = (event, x) => {
    if (isBar) return;
    const box = event.currentTarget.getBoundingClientRect();
    const side = curveSide((event.clientY - box.top) / box.height * H, sy(valueAt(x)), OFF_CURVE);
    const state = offCurve.current;
    const now = performance.now();
    if (side) {
      if (side !== state.side) announce(`Off the curve. Move ${side === 'above' ? 'down' : 'up'}`);
      if (now - state.last > BUZZ_EVERY_MS) { buzzOffCurve(); state.last = now; }
    } else if (state.side) { stopBuzz(); announce('Back on the curve'); }
    state.side = side;
  };
  const onPointerMove = event => { if (!dragging.current) return; const x = xFromPointer(event); follow(x); guide(event, x); };
  const onPointerUp = () => { dragging.current = false; lastX.current = null; offCurve.current = { side: null, last: 0 }; stopBuzz(); getEngine().stopTone(); };

  // Slider and buttons: move to an x, play a short note there and tick if it is a key point.
  const goTo = (x, { speak = false } = {}) => {
    const e = getEngine();
    e.unlock(); e.stopSweep(); setPlaying(false);
    setCursor(x);
    e.note(pitchFor(valueAt(x), range), pan(x));
    const at = nearestKeyPoint(x, sound.keyPoints, 1e-6);
    if (at) { e.tick(at.kind); vibrate(at.kind); }
    if (speak) announce(describeX(x, sound, context));
  };

  const stopIndex = cursor === null ? 0 : stops.reduce((best, s, i) => (Math.abs(s - cursor) < Math.abs(stops[best] - cursor) ? i : best), 0);
  const jump = direction => {
    const from = cursor ?? (direction > 0 ? -Infinity : Infinity);
    const list = direction > 0 ? sound.keyPoints : sound.keyPoints.slice().reverse();
    const next = list.find(p => (direction > 0 ? p.x > from + 1e-9 : p.x < from - 1e-9)) || list[0];
    if (next) goTo(next.x, { speak: true });
  };

  const togglePlay = async () => {
    const e = getEngine();
    if (playing) { e.stopSweep(); setPlaying(false); return; }
    await e.unlock();
    setPlaying(true);
    announce(`Playing ${isBar ? 'the bars' : 'the curve'} from left to right`);
    await e.playSweep(sound, { durationMs, onProgress: x => setCursor(x), onKeyPoint: point => announce(describeKeyPoint(point, context)) });
    setPlaying(false);
  };

  // Curve path, axes and ticks.
  const path = sound.samples.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const xAxisY = sy(Math.min(Math.max(0, y0), y1));
  const yAxisX = isBar ? PAD.left : sx(Math.min(Math.max(0, x0), x1));
  const xTicks = [], yTicks = [];
  if (!isBar) { const s = tickStep(x1 - x0); for (let t = Math.ceil(x0 / s) * s; t <= x1 + 1e-9; t += s) if (Math.abs(t) > 1e-9) xTicks.push(+t.toFixed(6)); }
  { const s = tickStep(y1 - y0); for (let t = Math.ceil(y0 / s) * s; t <= y1 + 1e-9; t += s) if (Math.abs(t) > 1e-9 || isBar) yTicks.push(+t.toFixed(6)); }
  const cursorY = cursor === null ? null : valueAt(cursor);
  const kinds = [...new Set(sound.keyPoints.map(p => p.kind))].filter(k => k !== 'bar');
  // One toggle: sound is on unless the learner turned it off (it starts playing at the first touch).
  const soundOn = audio.supported && !audio.muted;
  const toggleSound = () => { const e = getEngine(); e.unlock(); e.setMuted(soundOn); announce(soundOn ? 'Sound off' : 'Sound on'); };

  if (!sound.samples.length) return <p className="th-touch-empty">No graph to play yet.</p>;

  return (
    <section className="th-touch" aria-label={`Touch the graph: ${title}`}>
      <div className="th-touch-status">
        <button type="button" className={`th-touch-sound ${soundOn ? 'is-on' : ''}`} aria-pressed={soundOn} disabled={!audio.supported} onClick={toggleSound}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={soundOn ? 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z' : 'M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z'} /></svg>
          {!audio.supported ? 'Sound not supported here' : soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>
      {!vibrates && <p className="th-touch-note">Vibration works on Android only. You will hear a tick at each key point instead.</p>}

      <svg
        className="th-touch-graph" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${title}. Drag a finger across to hear it. With a screen reader on, use the Explore slider and key point buttons below.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      >
        <rect x="0" y="0" width={W} height={H} className="th-touch-bg" />
        <line x1={PAD.left} x2={W - PAD.right} y1={xAxisY} y2={xAxisY} className="th-touch-axis" />
        <line x1={yAxisX} x2={yAxisX} y1={PAD.top} y2={H - PAD.bottom} className="th-touch-axis" />
        {xTicks.map(t => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={xAxisY - 4} y2={xAxisY + 4} className="th-touch-axis" /><text x={sx(t)} y={Math.min(H - 4, xAxisY + 28)} className="th-touch-tick" textAnchor="middle">{t}</text></g>)}
        {yTicks.map(t => <g key={`y${t}`}><line x1={yAxisX - 4} x2={yAxisX + 4} y1={sy(t)} y2={sy(t)} className="th-touch-axis" /><text x={PAD.left - 8} y={sy(t) + 6} className="th-touch-tick" textAnchor="end">{t}</text></g>)}
        {isBar
          ? sound.samples.map((p, i) => (
            <g key={i}>
              <rect x={sx(i) - 0.32 * (sx(1) - sx(0))} width={0.64 * (sx(1) - sx(0))} y={sy(p.y)} height={sy(y0) - sy(p.y)} className={`th-touch-bar ${cursor === i ? 'is-current' : ''}`} />
              <text x={sx(i)} y={H - 10} className="th-touch-tick" textAnchor="middle">{bars[i]?.label ?? i + 1}</text>
            </g>))
          : <path d={path} className="th-touch-curve" />}
        {!isBar && sound.keyPoints.map(p => <Marker key={`${p.kind}${p.x}`} kind={p.kind} cx={sx(p.x)} cy={sy(p.y)} />)}
        {cursor !== null && cursorY !== null && (
          <g className="th-touch-cursor" aria-hidden="true">
            <line x1={sx(cursor)} x2={sx(cursor)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={sx(cursor)} cy={sy(cursorY)} r="7" />
          </g>
        )}
      </svg>

      {kinds.length > 0 && (
        <ul className="th-touch-legend" aria-label="Key point shapes">
          {kinds.map(k => (
            <li key={k}><svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><Marker kind={k} cx={0} cy={0} size={8} /></svg>{SHAPE_NAMES[k]}: {k.replace('-', ' ')}</li>
          ))}
        </ul>
      )}

      <p className="th-touch-said" aria-live="assertive" aria-atomic="true">{said.text}{said.n % 2 ? ' ' : ''}</p>

      <label className="th-touch-slider">
        <span>Explore {isBar ? 'the bars' : 'x'}, one step at a time</span>
        <input
          type="range" min="0" max={Math.max(0, stops.length - 1)} step="1" value={stopIndex}
          aria-valuetext={describeX(stops[stopIndex], sound, context)}
          onChange={event => goTo(stops[+event.target.value])}
        />
      </label>
      {cursor !== null && <p className="th-touch-readout" aria-hidden="true">{isBar ? describeX(cursor, sound, context) : `x = ${spokenNumber(cursor).replace('minus ', '−')}, y = ${spokenNumber(cursorY).replace('minus ', '−')}`}</p>}

      <div className="th-touch-buttons">
        <button type="button" className="th-touch-play" onClick={togglePlay} aria-pressed={playing}>{playing ? 'Stop playing' : `Play the whole ${isBar ? 'chart' : 'curve'}`}</button>
        <button type="button" onClick={() => jump(-1)}>Previous key point</button>
        <button type="button" onClick={() => jump(1)}>Next key point</button>
      </div>
    </section>
  );
}
