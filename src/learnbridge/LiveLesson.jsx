// Live mode for the demo journey: a real PDF goes to the lesson backend (server/lesson-jobs.mjs), the
// generating screens follow the real job, and the learner answers the generated questions. A wrong answer
// opens the explanation with Nia signing it. Without an upload, the storyboard screens are unchanged.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createLessonApi } from '../lesson-integration/api.js';
import { validateLesson } from '../lesson-integration/contract.js';
import { useQuestionLanguage, LanguageSelect, ListenButton, TranslationNote, speakLines } from './QuestionLanguage.jsx';
import { NiaSigner } from './NiaSign.jsx';
import { VoiceAnswers, voiceAnswersOn } from './VoiceAnswers.jsx';
import { questionSpeech } from './voice-answers.js';
import { currentAccount } from './accounts.js';
import { activeProfile } from './learner-profile.js';
import { recordResult } from './results.js';
import { capsLabel } from './caps.js';
import { assignedLesson } from './assigned-lesson.js';
import './live-lesson.css';

const api = createLessonApi();
// A lesson a learner opened from their page starts here; otherwise a teacher's upload fills it in.
let live = { fileName: '', job: null, lesson: assignedLesson(), error: '', results: [], figures: [], figuresStatus: '' };
const listeners = new Set();
let describing = 0; // which upload's pictures are being described
const update = fields => { live = { ...live, ...fields }; listeners.forEach(l => l()); };
const useLive = () => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => live);

export const liveLesson = () => live.lesson;
// The journey's 1.2 s auto-advance must wait while a real job is running.
// True from the moment a real source is submitted (including when the lesson came back at once, or failed),
// so the journey shows the live generating screen instead of the storyboard's.
export const liveJobRunning = () => !!live.job;

// Library lessons: send the lesson's text to the generator and follow it on the generating screen.
export function startLessonFromText({ title, text, subject, grade, caps }, setId) {
  describing++;
  update({ fileName: title, lesson: null, results: [], error: '', figures: [], figuresStatus: '', job: { id: 'pending', status: 'generating_questions', pending: true, startedAt: Date.now(), stageAt: Date.now() } });
  setId('generating-lesson');
  api.createFromScript(text, { title, subject, grade: grade ? String(grade) : undefined, ...(caps ? { caps } : {}) })
    .then(job => update({ job, ...(job.status === 'failed' ? { error: job.error || 'The lesson could not be prepared.' } : {}) }))
    .catch(error => update({ job: { id: 'pending', status: 'failed' }, error: error.message }));
}

// Pages with pictures, as JPEG snapshots (at most 8), for /api/describe-images. A page counts when it
// draws an embedded image, or at least 6 filled or outlined shapes (diagrams in textbooks are often drawn, not pasted in).
async function pdfPictures(file) {
  const { pdfjs, pdf } = await openPdf(file);
  const images = [];
  try {
    const { OPS } = pdfjs;
    const drawsImage = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].filter(Boolean));
    const paints = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter(Boolean));
    for (let n = 1; n <= Math.min(pdf.numPages, 40) && images.length < 8; n++) {
      const page = await pdf.getPage(n);
      const { fnArray } = await page.getOperatorList();
      const shapes = fnArray.filter(fn => paints.has(fn)).length; // filled or outlined shapes (clipping paths do not count)
      if (!fnArray.some(fn => drawsImage.has(fn)) && shapes < 6) continue;
      const viewport = page.getViewport({ scale: Math.min(2, 1100 / page.getViewport({ scale: 1 }).width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      images.push({ page: n, data: canvas.toDataURL('image/jpeg', 0.7).split(',')[1] });
    }
  } finally { await pdf.destroy(); }
  return images;
}
// Describes the PDF's pictures alongside lesson generation; the result is kept only for the same upload.
function describePictures(file) {
  const run = ++describing;
  const done = fields => { if (run === describing) update(fields); };
  done({ figures: [], figuresStatus: 'working' });
  pdfPictures(file)
    .then(async images => {
      if (!images.length) return [];
      const response = await fetch('/api/describe-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'The pictures could not be described.');
      return data.figures;
    })
    .then(figures => done({ figures, figuresStatus: 'done' }), () => done({ figures: [], figuresStatus: 'failed' }));
}
// Descriptions of the pictures on a page, joined.
const figureOn = (figures, page) => figures.filter(f => f.page === page).map(f => f.description).join(' ');

const youtubeVideoId = url => String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/)?.[1] || null;
const SOURCES = [['pdf', 'PDF document'], ['youtube', 'YouTube video'], ['text', 'Paste text']];

// Vercel accepts request bodies up to about 4.5 MB. Smaller PDFs go to the server (Gemini also reads scanned
// pages); larger ones are read in the browser with PDF.js and only their text is sent.
const DIRECT_PDF_LIMIT = 4 * 1024 * 1024;
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const MAX_TEXT_CHARS = 60000;
let pdfjsModule = null;
// Starts downloading the PDF reader early (when the upload screen opens), so reading a file starts at once.
const loadPdfjs = () => pdfjsModule ??= import(/* @vite-ignore */ `${PDFJS}pdf.min.mjs`).catch(error => { pdfjsModule = null; throw error; });
async function openPdf(file) {
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  return { pdfjs, pdf: await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise };
}
async function pdfText(file, progress = () => {}) {
  const { pdf } = await openPdf(file);
  let text = '';
  try {
    for (let n = 1; n <= pdf.numPages && text.length < MAX_TEXT_CHARS; n++) {
      progress(`Reading page ${n} of ${pdf.numPages}…`);
      const content = await (await pdf.getPage(n)).getTextContent();
      const pageText = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      if (pageText) text += `[Page ${n}]\n${pageText}\n\n`;
    }
  } finally { await pdf.destroy(); }
  if (text.replace(/\[Page \d+\]/g, '').trim().split(/\s+/).length < 30) throw Object.assign(Error('This PDF has no readable text (it may be scanned). Use a PDF under 4 MB, or paste the text instead.'), { name: 'NoTextError' });
  return text.slice(0, MAX_TEXT_CHARS);
}

export function LiveUpload({ next, ui: { AppShell, Btn, Ic, UploadCloudIcon, PdfIcon, CheckCircleIcon } }) {
  const state = useLive();
  const input = useRef(null);
  const [mode, setMode] = useState('pdf');
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  useEffect(() => { loadPdfjs().catch(() => {}); }, []);
  const choose = f => { if (!f) return; if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { update({ error: 'Choose a PDF file.' }); return; } update({ error: '' }); setFile(f); };
  // Show the generating screen straight away and do the work behind it; `work` reports its stage as it goes.
  const begin = (fileName, work) => {
    describing++;
    update({ fileName, lesson: null, results: [], error: '', figures: [], figuresStatus: '', job: { id: 'pending', status: 'extracting', pending: true, startedAt: Date.now() } });
    next();
    const stage = status => update({ job: { ...live.job, status, stageAt: Date.now() } });
    work(stage).then(job => update({ job, ...(job.status === 'failed' ? { error: job.error || 'The lesson could not be prepared.' } : {}) }))
      .catch(error => update({ job: { id: 'pending', status: 'failed' }, error: error.message }));
  };
  const start = () => {
    update({ error: '' });
    // Problems the teacher can fix right away stay on this screen.
    if (mode === 'pdf') {
      if (!file) { input.current?.click(); return; }
      begin(file.name, async stage => {
        // Read the text on this device and send only the text: no file upload, and one Gemini request
        // instead of two. Scanned PDFs (no text) under 4 MB are sent to Gemini to read instead.
        let text = null;
        try { text = await pdfText(file); } catch (error) { if (file.size > DIRECT_PDF_LIMIT || error.name !== 'NoTextError') throw error; }
        if (text) { stage('generating_questions'); describePictures(file); }
        return text ? api.createFromScript(text, { title: '' }) : api.uploadPdf(file, { title: '' });
      });
    } else if (mode === 'youtube') {
      const videoId = youtubeVideoId(url);
      if (!videoId) { update({ error: 'Paste a YouTube video link.' }); return; }
      begin('your YouTube video', async stage => {
        const response = await fetch('/api/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, language: 'en' }) });
        const found = await response.json();
        if (!response.ok) throw Error(found.error || 'The video’s transcript could not be found.');
        if (found.title) update({ fileName: found.title });
        stage('generating_questions');
        return api.createFromYoutube(videoId, found.text, { title: '' });
      });
    } else {
      if (text.trim().split(/\s+/).length < 30) { update({ error: 'Paste at least a paragraph (30 words or more).' }); return; }
      begin('your text', async stage => { stage('generating_questions'); return api.createFromScript(text, { title: '' }); });
    }
  };
  const ready = mode === 'pdf' ? !!file : mode === 'youtube' ? !!youtubeVideoId(url) : text.trim().length > 0;
  return <AppShell active="Create"><main className="dj-content narrow"><h1>Add your learning material</h1><p>Upload a CAPS document or past paper, use a YouTube video, or paste your own lesson text.</p>
    <div className="lb-source-tabs" role="tablist">{SOURCES.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? 'on' : ''} onClick={() => { setMode(key); update({ error: '' }); }}>{label}</button>)}</div>
    {mode === 'pdf' && <>
      <section className={'dj-upload lb-dropzone' + (dragging ? ' dragging' : '')} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}>
        {UploadCloudIcon ? <UploadCloudIcon /> : <Ic>⇧</Ic>}<b>Drag and drop your PDF here</b><span>or</span><Btn className="outline" type="button">Choose a file</Btn>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => choose(e.target.files[0])} />
      </section>
      {file && !state.error && <div className="dj-file">{PdfIcon ? <PdfIcon /> : <Ic>PDF</Ic>}<div><b>{file.name}</b><span>{(file.size / 1e6).toFixed(1)} MB</span></div>{CheckCircleIcon ? <CheckCircleIcon /> : <strong>✓</strong>}</div>}
    </>}
    {mode === 'youtube' && <label className="lb-source-field">YouTube link<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /><span>We use the video’s captions, or transcribe it when it has none.</span></label>}
    {mode === 'text' && <label className="lb-source-field">Lesson text<textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Paste your lesson, notes or a transcript…" /></label>}
    {state.error && <div className="dj-upload-error"><b>We could not use that.</b><span>{state.error}</span></div>}
    <Btn className="next" onClick={start}>{ready ? 'Continue' : mode === 'pdf' ? 'Choose a PDF' : 'Continue'}</Btn></main></AppShell>;
}

const STEPS = [['extracting', 'Reading your document...'], ['generating_questions', 'Writing practice questions from it...'], ['ready', 'Checking every question against the document...']];
// Progress range for each stage; the bar eases towards the top of its range while the stage runs.
const PROGRESS = { extracting: [6, 38], generating_questions: [38, 92], ready: [100, 100] };
const TIPS = [
  'Every question quotes the sentence it comes from, and is checked against your document.',
  'Learners can switch questions to isiZulu or Sepedi and have them read aloud.',
  'A wrong answer opens the explanation, signed by Nia.',
  'Questions point to the page of your document they come from.',
  'You can also start a lesson from a YouTube video or your own notes.',
];
export function LiveGenerating({ setId, ui: { Brand, Ic } }) {
  const state = useLive();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!state.job || state.job.pending || state.job.status === 'failed') return;
    if (state.job.status === 'ready') {
      // Serverless hosts return the finished lesson with the job (see server/lesson-jobs.mjs, inline mode).
      if (state.job.lesson && !state.lesson) { try { update({ lesson: validateLesson(state.job.lesson) }); setId('review'); } catch (error) { update({ job: { ...state.job, status: 'failed' }, error: error.message }); } }
      return;
    }
    let stopped = false;
    const poll = async () => {
      try {
        const job = await api.getJob(state.job.id);
        if (stopped) return;
        if (job.status === 'ready') { update({ job, lesson: await api.getLesson(job.lessonId) }); setId('review'); return; }
        update({ job, ...(job.status === 'failed' ? { error: job.error || 'The lesson could not be prepared.' } : {}) });
        if (job.status !== 'failed') setTimeout(poll, 1000);
      } catch (error) { if (!stopped) update({ job: { ...state.job, status: 'failed' }, error: error.message }); }
    };
    const timer = setTimeout(poll, 800);
    return () => { stopped = true; clearTimeout(timer); };
  }, [state.job?.id, state.job?.pending, state.job?.status]);
  const status = state.job?.status || 'extracting';
  const at = Math.max(0, STEPS.findIndex(([s]) => s === status));
  if (status === 'failed') return <div className="dj-generating"><Brand /><Ic>!</Ic><h1>We could not prepare this lesson</h1><p>{state.error}</p><button type="button" className="dj-btn" onClick={() => setId('upload')}>Try again</button></div>;
  const [from, to] = PROGRESS[status] || PROGRESS.extracting;
  const elapsed = (now - (state.job?.stageAt || state.job?.startedAt || now)) / 1000;
  const width = from + (to - from) * (1 - Math.exp(-elapsed / 3));
  const tip = TIPS[Math.floor((now - (state.job?.startedAt || now)) / 4000) % TIPS.length];
  return <div className="dj-generating"><Brand /><Ic>▣</Ic><h1>{at ? 'Generating your questions...' : 'Generating your lesson...'}</h1><p>Using <b>{state.fileName}</b> to shape the lesson.</p>
    <div className="dj-progress"><span style={{ width: `${width.toFixed(1)}%`, transition: 'width .4s linear' }} /></div>
    {STEPS.map(([s, label], i) => <div className="dj-gen" key={s}><i className={i < at ? 'done' : ''}>{i < at ? '✓' : '○'}</i>{label}</div>)}
    <p className="lb-generating-tip" aria-live="polite">💡 {tip}</p></div>;
}

function FigureReview() {
  const { figures, figuresStatus } = useLive();
  if (!figuresStatus) return null;
  return <section className="lb-figures-review" aria-live="polite">
    <h3>Picture descriptions</h3>
    {figuresStatus === 'working' && <p>Describing the pictures in your PDF for learners who cannot see them…</p>}
    {figuresStatus === 'failed' && <p>The pictures could not be described this time.</p>}
    {figuresStatus === 'done' && (figures.length
      ? <><p>Written by AI for learners who cannot see the pictures. Check them before assigning.</p><ul>{figures.map((f, i) => <li key={i}><b>Page {f.page}:</b> {f.description}</li>)}</ul></>
      : <p>No diagrams or pictures were found.</p>)}
  </section>;
}

export function LiveReview({ next, ui: { AppShell, Btn, Ic } }) {
  const { lesson, fileName } = useLive();
  return <AppShell active="Lesson Plans"><main className="dj-content review"><div className="dj-reviewhead"><h1>Review your lesson plan</h1><p>Check the questions before assigning them.</p></div>
    <div className="dj-reviewbody"><nav>{['Overview', `Questions (${lesson.questions.length})`, 'Save'].map((x, i) => <div className={!i ? 'on' : ''} key={x} onClick={x === 'Save' ? next : undefined}>{x}</div>)}</nav>
      <section><div className="dj-lessontitle"><Ic>♟</Ic><div><h2>{lesson.title}</h2><p>Generated from {fileName}</p></div></div>
        {lesson.caps && <p className="lb-review-caps">{capsLabel(lesson.caps)}{lesson.caps.suggested ? ' (suggested by AI — check it)' : ''}</p>}
        <h3>Questions</h3><ol className="lb-review-questions">{lesson.questions.map(q => <li key={q.id}><b>{q.prompt}</b><span>Answer: {q.options.find(o => o.id === q.correctOptionId).label}{q.sourceRefs?.[0]?.page ? ` · page ${q.sourceRefs[0].page}` : ''}</span></li>)}</ol>
        <FigureReview />
        <Btn className="next" onClick={next}>Save and assign</Btn></section></div></main></AppShell>;
}

export function LiveQuiz({ setId, ui: { Btn } }) {
  const { lesson, figures } = useLive();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profile] = useState(activeProfile);
  const used = useRef({ help: false, voice: false }); // for the teacher's results
  const q = lesson.questions[index];
  const lang = useQuestionLanguage([q.prompt, ...q.options.map(o => o.label), q.explanation]);
  const tPrompt = lang.texts[0], tOptions = lang.texts.slice(1, -1), tExplanation = lang.texts.at(-1);
  const check = (choice = selected) => { if (!choice) return; setSelected(choice); setAttempts(a => a + 1); setResult(choice === q.correctOptionId ? 'correct' : 'incorrect'); };
  const tryAgain = () => { setResult(null); setSelected(null); setHelpOpen(false); };
  const next = () => {
    const account = currentAccount();
    recordResult({
      learner: account?.email || 'guest', learnerName: account?.name || 'Guest', lessonId: lesson.id, lessonTitle: lesson.title, caps: lesson.caps || null,
      questionId: q.id, prompt: q.prompt, firstTry: attempts === 1, attempts, helpUsed: used.current.help, voiceUsed: used.current.voice,
    });
    used.current = { help: false, voice: false };
    const results = [...live.results, { id: q.id, firstTry: attempts === 1 }];
    update({ results });
    if (index + 1 === lesson.questions.length) { setId('celebration'); return; }
    setIndex(index + 1); setSelected(null); setResult(null); setAttempts(0); setHelpOpen(false);
  };
  const page = q.sourceRefs?.[0]?.page;
  const figure = useQuestionLanguage([figureOn(figures, page)].filter(Boolean)).texts[0] || '';
  // Screen readers and keyboards: each new question's heading takes focus, the feedback's first button
  // takes focus when an answer is checked, and the help drawer behaves as a dialog (focus, Escape).
  const heading = useRef(null), feedback = useRef(null), drawerClose = useRef(null), watchButton = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [index]);
  useEffect(() => { if (result) feedback.current?.querySelector('button')?.focus(); }, [result]);
  // Profile: Deaf and hard-of-hearing learners get the signed explanation straight away after a wrong answer;
  // "read each question aloud" reads it when it appears (unless voice answers is already doing so).
  useEffect(() => { if (result === 'incorrect' && profile?.signedHelp) setHelpOpen(true); }, [result]);
  useEffect(() => { if (helpOpen) used.current.help = true; }, [helpOpen]);
  useEffect(() => {
    if (!profile?.readAloud || voiceAnswersOn() || lang.translating) return;
    const controller = new AbortController();
    speakLines(questionSpeech(tPrompt, tOptions), lang.language, controller.signal).catch(() => {});
    return () => { controller.abort(); window.speechSynthesis?.cancel(); };
  }, [index, lang.translating, lang.language]);
  useEffect(() => {
    if (!helpOpen) return;
    drawerClose.current?.focus();
    const onKey = event => { if (event.key === 'Escape') setHelpOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); watchButton.current?.focus(); };
  }, [helpOpen]);
  return <div className={'dj-question lb-live-question ' + (result || '')}>
    <header><button type="button" aria-label="Leave the quiz" onClick={() => setId('path')}>×</button><div className="dj-qbar"><span style={{ width: `${(index + 1) / lesson.questions.length * 100}%` }} /></div><b>Question {index + 1} of {lesson.questions.length}</b><LanguageSelect translating={lang.translating} /></header>
    <main><small>{lesson.title}{page ? ` · page ${page}` : ''}</small><h1 ref={heading} tabIndex={-1}>{tPrompt}</h1><ListenButton lines={[tPrompt, ...tOptions]} language={lang.language} /><VoiceAnswers question={{ number: index + 1, total: lesson.questions.length, prompt: tPrompt, options: tOptions, explanation: tExplanation, figure }} result={result} language={lang.language} onAnswer={i => { used.current.voice = true; check(q.options[i].id); }} onNext={next} onTryAgain={tryAgain} /><TranslationNote translated={lang.translated} error={lang.error} />
      {figure && <details className="lb-figure"><summary>🖼 Picture on page {page}: description</summary><p>{figure}</p><ListenButton lines={[figure]} language={lang.language} /></details>}
      <div className="dj-options" role="group" aria-label="Answers">{q.options.map((o, i) => {
        const cls = result === 'correct' && o.id === q.correctOptionId ? 'right' : result === 'incorrect' && o.id === selected ? 'wrong' : selected === o.id ? 'selected' : '';
        return <button type="button" key={o.id} className={cls} aria-pressed={selected === o.id} disabled={!!result} onClick={() => setSelected(o.id)}>{tOptions[i]}{cls === 'right' && <><i aria-hidden="true">✓</i><span className="lb-sr">, correct answer</span></>}{cls === 'wrong' && <><i aria-hidden="true">×</i><span className="lb-sr">, your answer, not correct</span></>}</button>;
      })}</div></main>
    {!result && <footer><span /><span /><Btn disabled={!selected} onClick={() => check()}>Check</Btn></footer>}
    {result === 'correct' && <section className="dj-feedback" role="alert" ref={feedback}><i aria-hidden="true">✓</i><div><h2>Correct!</h2><p>{tExplanation}</p></div><Btn onClick={next}>Continue</Btn></section>}
    {result === 'incorrect' && <section className="dj-feedback bad" role="alert" ref={feedback}><i aria-hidden="true">×</i><div><h2>Not quite</h2><p>Watch the explanation, then try again.</p></div><Btn className="outline" ref={watchButton} onClick={() => setHelpOpen(true)}>✋ Watch signed explanation</Btn><Btn onClick={tryAgain}>Try again</Btn></section>}
    {/* Always mounted so Nia and this explanation's signs load while the question is answered. */}
    <div className={'lb-help-overlay' + (helpOpen ? '' : ' preloading')} role="dialog" aria-modal={helpOpen || undefined} aria-label="Signed explanation" aria-hidden={!helpOpen} inert={!helpOpen || undefined}><aside>
      <button type="button" className="dj-close" ref={drawerClose} aria-label="Close the explanation" onClick={() => setHelpOpen(false)}>×</button>
      <h1>Why this is the answer</h1>
      <NiaSigner text={q.explanation} language="en" preload play={helpOpen} />
      <h3>Explanation</h3><p>{tExplanation}</p>
      <Btn onClick={tryAgain}>Try again</Btn>
    </aside></div>
  </div>;
}

export function LiveCelebration({ setId, ui: { Brand, Btn, Ic } }) {
  const { lesson, results } = useLive();
  const firstTry = results.filter(r => r.firstTry).length;
  return <div className="dj-celebrate"><header><Brand /><span><b className="dj-avatar">L</b> Learner</span></header><main><div className="dj-confetti">◆　▪　◆　▪　◆</div><div className="dj-medal"><img src="/assets/demo/completion-medal.png" alt="Gold achievement medal" /></div>
    <h1>Lesson complete!</h1><p>Great work! You've completed <b>{lesson.title}.</b></p>
    <div className="dj-awards"><article><Ic>☆</Ic><b>+{firstTry * 13}</b><span>XP earned</span></article><article><Ic>◎</Ic><b>{firstTry}/{lesson.questions.length}</b><span>Right first time</span></article><article><Ic>🏆</Ic><b>1</b><span>New badge</span></article></div>
    <div><Btn className="outline" onClick={() => { update({ results: [] }); setId('path'); }}>Back to path</Btn><Btn onClick={() => setId('upload')}>Make another lesson</Btn></div></main></div>;
}
