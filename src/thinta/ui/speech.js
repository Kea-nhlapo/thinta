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

const LANGS = { en: ['en-ZA', 'en'], zu: ['zu-ZA', 'zu'] };

function deviceSpeak(text, lang, signal) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in globalThis)) return reject(Error('This phone has no voice to read aloud.'));
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const [code, prefix] = LANGS[lang] || LANGS.en;
    utterance.lang = code;
    const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    signal?.addEventListener('abort', () => { speechSynthesis.cancel(); resolve(); }, { once: true });
    speechSynthesis.speak(utterance);
  });
}

function playBlob(blob, signal) {
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
      for (; i < pieces.length; i++) {
        if (signal?.aborted) return 'stopped';
        await playBlob(await serverAudio(pieces[i], lang, signal), signal);
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
