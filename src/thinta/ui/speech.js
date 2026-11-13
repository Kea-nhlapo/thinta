// Reads the audio description aloud: /api/speak (Gemini TTS) in live mode, the device voice otherwise.

// Splits text at sentence ends into pieces /api/speak accepts (at most 400 characters).
export function chunkText(text, max = 400) {
  const sentences = String(text || '').match(/[^.!?]+[.!?]*\s*/g) || [];
  const out = [];
  let current = '';
  for (const raw of sentences) {
    let sentence = raw;
    while (sentence.length > max) { out.push(sentence.slice(0, max).trim()); sentence = sentence.slice(max); }
    if ((current + sentence).length > max) { if (current.trim()) out.push(current.trim()); current = ''; }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const LANGS = { en: ['en-ZA', 'en'], zu: ['zu-ZA', 'zu'], nso: ['nso-ZA', 'nso'] };

function deviceSpeak(text, lang, signal) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in globalThis)) return reject(Error('This phone has no voice to read aloud.'));
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const [code, prefix] = LANGS[lang] || LANGS.en;
    utterance.lang = code;
    const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
    // An English voice reading isiZulu or Sepedi is worse than saying so.
    if (!voice && lang !== 'en') return reject(Error(`This phone has no ${lang === 'zu' ? 'isiZulu' : 'Sepedi'} voice, and the voice service could not be reached.`));
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    signal?.addEventListener('abort', () => { speechSynthesis.cancel(); resolve(); }, { once: true });
    speechSynthesis.speak(utterance);
  });
}

// Phones only let a page start sound from a tap. The voice takes a few seconds to arrive from the server, by
// which time Android no longer counts the tap and blocks audio.play() silently. So the tap unlocks one shared
// Web Audio context straight away (call unlockAudio() first thing in the click handler), and every clip plays
// through it later, however long the download took.
let context = null;
export function unlockAudio() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    context ||= new AudioContextClass();
    if (context.state === 'suspended') context.resume();
    // iOS also wants a sound started inside the tap: an empty one is enough.
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22050);
    source.connect(context.destination);
    source.start(0);
  } catch { context = null; }
  return context;
}

async function playThroughContext(blob, signal) {
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  if (signal?.aborted) return;
  await new Promise(resolve => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = resolve;
    signal?.addEventListener('abort', () => { try { source.stop(); } catch { /* already stopped */ } resolve(); }, { once: true });
    source.start();
  });
}

function playBlob(blob, signal) {
  if (context && context.state !== 'closed') return playThroughContext(blob, signal);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const finish = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onended = finish;
    audio.onerror = () => { URL.revokeObjectURL(url); reject(Error('Could not play the audio.')); };
    signal?.addEventListener('abort', () => { audio.pause(); finish(); }, { once: true });
    audio.play().catch(error => { URL.revokeObjectURL(url); reject(error); });
  });
}

const cache = new Map();
async function serverAudio(text, lang, signal) {
  const key = `${lang}\u0000${text}`;
  if (!cache.has(key)) {
    const response = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }), signal });
    if (!response.ok) throw Error('The voice service is unavailable.');
    cache.set(key, await response.blob());
  }
  return cache.get(key);
}

// Plays every chunk in turn. offline=true (replay) never calls the network. Returns which voice was used.
export async function readAloud(text, lang, { signal, offline = false } = {}) {
  const pieces = chunkText(text);
  let i = 0;
  if (!offline) {
    try {
      // Ask for every piece at once, so piece 2 is ready by the time piece 1 finishes.
      const clips = pieces.map(piece => serverAudio(piece, lang, signal));
      clips.forEach(clip => clip.catch(() => {}));
      for (; i < pieces.length; i++) {
        if (signal?.aborted) return 'stopped';
        await playBlob(await clips[i], signal);
      }
      return 'server';
    } catch {
      if (signal?.aborted) return 'stopped';
    }
  }
  // Device voice picks up from the piece the server could not play.
  for (; i < pieces.length; i++) {
    if (signal?.aborted) return 'stopped';
    await deviceSpeak(pieces[i], lang, signal);
  }
  return 'device';
}
