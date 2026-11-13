// Thinta's Sonifier, the browser half: Web Audio for the curve tone, key-point ticks and the whole-curve
// sweep, plus Android vibration. Kept apart from sonify.js so the pure maths still loads in Node.
import { sweepPlan, pitchFor, yRange } from './sonify.js';

// Distinct buzz rhythms so a learner can feel which key point it is without hearing it.
export const VIBRATION = { root: [70], 'turning-point': [40, 50, 40, 50, 140], 'y-intercept': [30, 40, 30], bar: [50] };

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// iPhones have no vibrate; calling it is skipped silently there.
export function vibrate(kind) {
  if (!canVibrate()) return false;
  try { return navigator.vibrate(VIBRATION[kind] || [50]); } catch { return false; }
}

// A short pulse, repeated while the finger stays off the curve: a rumble that feels different from the key-point patterns.
export function buzzOffCurve() {
  if (!canVibrate()) return false;
  try { return navigator.vibrate(25); } catch { return false; }
}
export function stopBuzz() {
  if (canVibrate()) try { navigator.vibrate(0); } catch { /* nothing to stop */ }
}

export function createAudioEngine() {
  let ctx = null, master = null, tone = null, sweep = null, muted = false;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn(state()));
  const state = () => ({ supported: !!audioClass(), running: ctx?.state === 'running', muted });

  function audioClass() { return typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); }

  function ensure() {
    if (ctx) return ctx;
    const Ctx = audioClass();
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    ctx.onstatechange = notify;
    return ctx;
  }

  // Must run inside a tap or key press: iOS Safari keeps the context suspended until then, and also wants
  // one sound started in the same gesture, so a silent one-sample buffer is played.
  function unlock() {
    const c = ensure();
    if (!c) return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    try { const src = c.createBufferSource(); src.buffer = c.createBuffer(1, 1, 22050); src.connect(c.destination); src.start(0); } catch { /* old Safari */ }
    return c.resume().then(() => { notify(); return true; }, () => false);
  }

  function panner(value) {
    if (!ctx.createStereoPanner) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = value;
    return p;
  }

  // A chain oscillator → gain → (pan) → master. Triangle waves are soft enough for long listening.
  function voice(type, freq, pan = 0) {
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pn = panner(pan);
    osc.connect(gain); if (pn) { gain.connect(pn); pn.connect(master); } else gain.connect(master);
    return { osc, gain, pan: pn };
  }

  // Short ticks with different timbres: roots a bright click, the turning point a low double "boop",
  // the y-intercept a woodblock, bars a soft pluck.
  function tick(kind, at = null) {
    if (!ensure() || ctx.state !== 'running') return;
    const t0 = at ?? ctx.currentTime;
    const blip = (type, freq, start, length, level) => {
      const v = voice(type, freq);
      v.gain.gain.setValueAtTime(0, start);
      v.gain.gain.linearRampToValueAtTime(level, start + 0.004);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      v.osc.start(start); v.osc.stop(start + length + 0.02);
    };
    if (kind === 'root') { blip('square', 1800, t0, 0.04, 0.35); blip('square', 2400, t0 + 0.005, 0.03, 0.2); }
    else if (kind === 'turning-point') { blip('sine', 330, t0, 0.12, 0.8); blip('sine', 330, t0 + 0.16, 0.12, 0.8); }
    else if (kind === 'y-intercept') { blip('triangle', 1100, t0, 0.06, 0.6); }
    else { blip('sine', 1300, t0, 0.05, 0.5); }
  }

  // The continuous tone that follows a finger.
  function startTone(freq, pan = 0) {
    if (!ensure()) return;
    stopSweep();
    if (!tone) {
      tone = voice('triangle', freq, pan);
      tone.osc.start();
    }
    setTone(freq, pan);
    tone.gain.gain.setTargetAtTime(0.35, ctx.currentTime, 0.02);
  }

  function setTone(freq, pan = 0) {
    if (!tone) return;
    const now = ctx.currentTime;
    tone.osc.frequency.setTargetAtTime(freq, now, 0.015);
    tone.pan?.pan.setTargetAtTime(pan, now, 0.02);
  }

  function stopTone() {
    if (!tone) return;
    const t = tone; tone = null;
    t.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    t.osc.stop(ctx.currentTime + 0.25);
  }

  // A short note for one step of the slider or one bar.
  function note(freq, pan = 0, length = 0.25) {
    if (!ensure() || ctx.state !== 'running') return;
    const v = voice('triangle', freq, pan), t0 = ctx.currentTime;
    v.gain.gain.setValueAtTime(0, t0);
    v.gain.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
    v.gain.gain.setValueAtTime(0.35, t0 + length - 0.05);
    v.gain.gain.linearRampToValueAtTime(0, t0 + length);
    v.osc.start(t0); v.osc.stop(t0 + length + 0.02);
  }

  // Plays the whole graph left to right (and left ear to right ear). onProgress gets the x being played,
  // onKeyPoint each key point as its tick sounds. Resolves when finished or stopped.
  function playSweep(sound, { durationMs = 4000, onProgress = () => {}, onKeyPoint = () => {} } = {}) {
    if (!ensure()) return Promise.resolve(false);
    stopSweep(); stopTone();
    const plan = sweepPlan(sound, { durationMs });
    const t0 = ctx.currentTime + 0.08;
    const nodes = [];
    if (plan.glide) {
      const v = voice('triangle', plan.glide[0].freq, -1);
      v.osc.frequency.setValueAtTime(plan.glide[0].freq, t0);
      for (const g of plan.glide) v.osc.frequency.linearRampToValueAtTime(g.freq, t0 + g.t);
      if (v.pan) { v.pan.pan.setValueAtTime(-1, t0); v.pan.pan.linearRampToValueAtTime(1, t0 + plan.seconds); }
      v.gain.gain.setValueAtTime(0, t0);
      v.gain.gain.linearRampToValueAtTime(0.3, t0 + 0.05);
      v.gain.gain.setValueAtTime(0.3, t0 + plan.seconds - 0.05);
      v.gain.gain.linearRampToValueAtTime(0, t0 + plan.seconds);
      v.osc.start(t0); v.osc.stop(t0 + plan.seconds + 0.05);
      nodes.push(v);
    }
    for (const n of plan.tones) {
      const v = voice('triangle', n.freq, n.pan);
      v.gain.gain.setValueAtTime(0, t0 + n.start);
      v.gain.gain.linearRampToValueAtTime(0.35, t0 + n.start + 0.02);
      v.gain.gain.setValueAtTime(0.35, t0 + n.end - 0.04);
      v.gain.gain.linearRampToValueAtTime(0, t0 + n.end);
      v.osc.start(t0 + n.start); v.osc.stop(t0 + n.end + 0.02);
      nodes.push(v);
    }
    for (const t of plan.ticks) tick(t.kind, t0 + t.t);

    const xs = sound.samples.map(p => p.x), x0 = xs[0], x1 = xs.at(-1);
    return new Promise(resolve => {
      const pending = plan.ticks.slice();
      let frame = 0;
      const finish = done => { cancelAnimationFrame(frame); sweep = null; onProgress(null); resolve(done); };
      const step = () => {
        const elapsed = ctx.currentTime - t0;
        if (elapsed >= plan.seconds) return finish(true);
        if (elapsed >= 0) {
          onProgress(plan.glide ? x0 + (x1 - x0) * elapsed / plan.seconds : Math.min(x1, Math.floor(elapsed / (plan.seconds / xs.length))));
          while (pending.length && pending[0].t <= elapsed) { const t = pending.shift(); vibrate(t.kind); onKeyPoint(t.point); }
        }
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      sweep = { stop: () => { for (const v of nodes) { try { v.gain.gain.cancelScheduledValues(ctx.currentTime); v.gain.gain.setValueAtTime(0, ctx.currentTime); v.osc.stop(); } catch { /* already stopped */ } } finish(false); } };
    });
  }

  function stopSweep() { sweep?.stop(); }

  function setMuted(value) {
    muted = value;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
    notify();
  }

  function close() { stopSweep(); stopTone(); ctx?.close?.(); ctx = null; tone = null; listeners.clear(); }

  return {
    unlock, tick, startTone, setTone, stopTone, note, playSweep, stopSweep, setMuted, close, state,
    isPlaying: () => !!sweep,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Pitch for a y on this sound's own range, for callers that only have the sound object.
    pitch: (sound, y) => pitchFor(y, yRange(sound)),
  };
}

// The brief's name for the whole-curve playback, for callers that do not keep an engine around.
let shared = null;
export function playSweep(sound, options) {
  shared ||= createAudioEngine();
  return shared.unlock().then(() => shared.playSweep(sound, options));
}
