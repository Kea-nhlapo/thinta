import React, { useLayoutEffect, useRef, useState } from 'react';
import VisionDemo from './DemoJourney.jsx';
import Brand from './Brand.jsx';
import { applyProfile } from './learnbridge/learner-profile.js';
import { redirectFor } from './learnbridge/accounts.js';
import { LANGUAGES, setQuestionLanguage, useQuestionLanguageCode } from './learnbridge/QuestionLanguage.jsx';
import en from './i18n/landing.en.js';
import zu from './i18n/landing.zu.js';
import nso from './i18n/landing.nso.js';
const NiaLab = React.lazy(() => import('./NiaLab.jsx'));
const NiaSign = React.lazy(() => import('./learnbridge/NiaSign.jsx'));
const SignIntroduction = React.lazy(() => import('./SignConversation.jsx'));
const SignCalibration = React.lazy(() => import('./SignCalibration.jsx'));
const ProfilePage = React.lazy(() => import('./learnbridge/ProfilePage.jsx'));
const ResultsPage = React.lazy(() => import('./learnbridge/ResultsPage.jsx'));
const ThintaApp = React.lazy(() => import('./thinta/ThintaApp.jsx'));
const LearnerHome = React.lazy(() => import('./learnbridge/LearnerHome.jsx'));

// The signed-in learner's large text and contrast settings, before anything is drawn.
applyProfile();

// A page for some roles only: anyone else is sent to the login page or to their own home. The server checks the
// same rule for every route that reads or writes teacher data.
function OnlyFor({ roles, children }) {
  const away = redirectFor(roles);
  React.useEffect(() => { if (away) window.location.replace(away); }, [away]);
  return away ? null : children;
}

const assets = '/assets/';

const logos = [
  { src: 'logo-egov.png', alt: 'Gauteng Province e-Government' },
  { src: 'logo-dbe.png', alt: 'Department of Basic Education' },
  { src: 'logo-dhet.png', alt: 'Department of Higher Education and Training' },
  { src: 'logo-sita.png', alt: 'SITA' },
  { src: 'logo-nsfas.png', alt: 'NSFAS' },
];

const stepImages = ['step-upload.png', 'step-review.png', 'step-assign.png'];

// One file of landing text per language; the choice is shared with the question screens and sign-in.
const landingText = { en, zu, nso };

// Text with "\n" where the desktop layout breaks a line.
function Lines({ text, breakClass }) {
  return text.split('\n').map((part, index) => <React.Fragment key={index}>{index > 0 && <br className={breakClass}/>}{part}</React.Fragment>);
}

function App() {
  // `/app` is the product experience reached from the public homepage.
  // Keep the original prototype URL working for existing bookmarks and demos.
  if (['/app', '/vision-demo'].includes(window.location.pathname)) return <VisionDemo />;
  if (window.location.pathname === '/nia-sign') return <React.Suspense fallback={<p>Loading Nia…</p>}><NiaSign /></React.Suspense>;
  if (window.location.pathname === '/nia-lab') return <React.Suspense fallback={<p>Loading Nia lab…</p>}><NiaLab /></React.Suspense>;
  if (window.location.pathname === '/sign-introduction') return <React.Suspense fallback={<p>Loading sign introduction…</p>}><SignIntroduction /></React.Suspense>;
  if (window.location.pathname === '/profile') return <React.Suspense fallback={<p>Loading settings…</p>}><ProfilePage /></React.Suspense>;
  if (window.location.pathname === '/results') return <OnlyFor roles={['teacher']}><React.Suspense fallback={<p>Loading results…</p>}><ResultsPage /></React.Suspense></OnlyFor>;
  // The agents are teacher tools; learners only ever get what a teacher assigns, on /learn.
  if (window.location.pathname === '/thinta') return <OnlyFor roles={['teacher']}><React.Suspense fallback={<p>Loading Thinta…</p>}><ThintaApp /></React.Suspense></OnlyFor>;
  if (window.location.pathname === '/learn') return <React.Suspense fallback={<p>Loading your lessons…</p>}><LearnerHome /></React.Suspense>;
  if (window.location.pathname === '/sign-calibration') return <React.Suspense fallback={<p>Loading calibration…</p>}><SignCalibration /></React.Suspense>;
  return <Landing />;
}

function Landing() {
  const language = useQuestionLanguageCode();
  const t = landingText[language] || en;
  const [contactOpen, setContactOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const start = () => { window.location.href = '/app?screen=login'; };
  const signIn = () => { window.location.href = '/app?screen=login'; };

  return <>
    <a className="skip-link" href="#main">{t.skip}</a>
    <header className="site-header" id="top">
      <div className="header-inner">
        <Brand label={t.home}/>
        <div className="header-actions">
          <label className="language-control"><svg className="globe" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="16" cy="16" r="12"/><path d="M4 16h24M16 4c-4 4-6 8-6 12s2 8 6 12M16 4c4 4 6 8 6 12s-2 8-6 12"/></svg><span>{t.language}: </span><select aria-label={t.language} value={language} onChange={event => setQuestionLanguage(event.target.value)}>{Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}</select></label>
          <span className="header-rule" aria-hidden="true" />
          <button className="sign-in" onClick={signIn}>{t.signIn}</button>
        </div>
      </div>
    </header>

    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1 id="hero-title"><Lines text={t.heroTitle}/></h1>
            <p><Lines text={t.heroText} breakClass="desktop-break"/></p>
            <div className="hero-buttons"><button className="button button-primary" onClick={start}>{t.getStarted}</button><button className="button button-outline" onClick={signIn}>{t.haveAccount}</button></div>
          </div>
          <img className="hero-illustration" src={`${assets}hero-educator.png`} alt={t.heroAlt} />
        </div>
      </section>

      <section className="collaborators" aria-label={t.logos}><LogoCarousel previous={t.previousLogos} next={t.nextLogos}/></section>

      <section className="how-section" aria-labelledby="how-title">
        <div className="section-heading"><span className="spark-left" aria-hidden="true">⌁</span><h2 id="how-title">{t.howTitle}</h2><span className="spark-right" aria-hidden="true">⌁</span><p>{t.howText}</p></div>
        <div className="steps">
          {t.steps.map((step, index) => <React.Fragment key={index}>
            {index > 0 && <span className="step-arrow" aria-hidden="true">⇢</span>}
            <article className="step-card"><span className="step-number">{index + 1}</span><img src={`${assets}${stepImages[index]}`} alt={step.alt}/><h3>{step.title}</h3><p><Lines text={step.text}/></p></article>
          </React.Fragment>)}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-title">
        <div className="dashboard-copy"><h2 id="dashboard-title"><Lines text={t.dashboardTitle}/></h2><p>{t.dashboardText}</p>
          {t.dashboardFeatures.map((feature, index) => <Feature key={index} icon={['book', 'lesson', 'chart'][index]} title={feature.title}>{feature.text}</Feature>)}
        </div>
        <img className="dashboard-preview" src={`${assets}dashboard-preview.png`} alt={t.dashboardAlt}/>
      </section>

      <section className="accessibility-section" aria-labelledby="access-title">
        <img className="access-preview" src={`${assets}accessibility-preview.png`} alt={t.accessAlt} />
        <div className="access-copy"><h2 id="access-title"><Lines text={t.accessTitle}/></h2><p>{t.accessText}</p>
          {t.accessFeatures.map((feature, index) => <Feature key={index} icon={['document', 'volume', 'hand'][index]} title={feature.title}>{feature.text}</Feature>)}
        </div>
      </section>

      <section className="progress-section" aria-labelledby="progress-title">
        <div className="progress-copy"><h2 id="progress-title"><Lines text={t.progressTitle}/></h2><p><Lines text={t.progressText}/></p></div>
        <img src={`${assets}progress-preview.png`} alt={t.progressAlt}/>
      </section>

      <section className="benefits-section" aria-labelledby="benefits-title"><h2 id="benefits-title">{t.benefitsTitle}</h2><div className="benefit-grid">{t.benefits.map((benefit, index) => <Benefit key={index} icon={['book', 'play', 'bulb'][index]} title={benefit.title}><Lines text={benefit.text}/></Benefit>)}</div></section>

      <section className="faq-section" aria-labelledby="faq-title"><h2 id="faq-title">{t.faqTitle}</h2><div className="faq-list">{t.faqs.map(([question, answer], index) => <div className="faq-row" key={index}><button aria-expanded={openFaq === index} onClick={() => setOpenFaq(openFaq === index ? null : index)}><span>{question}</span><span className={`chevron ${openFaq === index ? 'open' : ''}`} aria-hidden="true">⌄</span></button>{openFaq === index && <p>{answer}</p>}</div>)}</div></section>

      <section className="final-cta" aria-labelledby="cta-title"><h2 id="cta-title">{t.ctaTitle}</h2><button className="button button-white" onClick={start}>{t.getStarted}</button></section>
    </main>
    <footer className="footer"><Brand light label={t.home}/><nav aria-label={t.footer}><a href="#top">{t.about}</a><a href="#access-title">{t.accessibility}</a><button onClick={() => setContactOpen(true)}>{t.contact}</button></nav></footer>

    {contactOpen && <div className="dialog-backdrop" onMouseDown={() => setContactOpen(false)}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="contact-title" onMouseDown={event => event.stopPropagation()}><button className="dialog-close" onClick={() => setContactOpen(false)} aria-label={t.close}>×</button><Brand label={t.home}/><h2 id="contact-title">{t.contactTitle}</h2><p>{t.contactText}</p></div></div>}
  </>;
}

function LogoCarousel({ previous, next }) {
  const viewportRef = useRef(null);
  const pauseUntilRef = useRef(0);
  const hoveringRef = useRef(false);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const firstSet = viewport.querySelector('.logo-set');
    const setWidth = () => firstSet.getBoundingClientRect().width;
    const resetPosition = () => { viewport.scrollLeft = setWidth(); };
    resetPosition();
    const observer = new ResizeObserver(resetPosition);
    observer.observe(viewport);
    let frame;
    let previous = performance.now();
    const tick = now => {
      const elapsed = Math.min(now - previous, 50);
      previous = now;
      if (!media.matches && !document.hidden && !hoveringRef.current && now >= pauseUntilRef.current) viewport.scrollLeft += elapsed * 0.035;
      const width = setWidth();
      if (width > 0) {
        if (viewport.scrollLeft >= width * 2) viewport.scrollLeft -= width;
        if (viewport.scrollLeft < width) viewport.scrollLeft += width;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const move = direction => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const items = viewport.querySelectorAll('.logo-item');
    const step = items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().left;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pauseUntilRef.current = performance.now() + (reducedMotion ? 0 : 850);
    viewport.scrollBy({ left: direction * step, behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  return <div className="logo-carousel" onMouseEnter={() => { hoveringRef.current = true; }} onMouseLeave={() => { hoveringRef.current = false; }} onFocus={() => { hoveringRef.current = true; }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hoveringRef.current = false; }}>
    <button className="carousel-arrow" onClick={() => move(-1)} aria-label={previous}>‹</button>
    <div className="logo-viewport" ref={viewportRef} role="img" aria-label={logos.map(item => item.alt).join(', ')}>
      <div className="logo-track">{[0, 1, 2].map(copy => <div className="logo-set" aria-hidden="true" key={copy}>{logos.map(item => <div className="logo-item" key={`${copy}-${item.src}`}><img src={`${assets}${item.src}`} alt="" /></div>)}</div>)}</div>
    </div>
    <button className="carousel-arrow" onClick={() => move(1)} aria-label={next}>›</button>
  </div>;
}

function Icon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: '3.2', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    book: <><path d="M24 10C18 6 11 6 5 9v27c8-2 14-1 19 3 5-4 11-5 19-3V9c-6-3-13-3-19 1Z"/><path d="M24 10v29"/></>,
    lesson: <><rect x="7" y="7" width="34" height="34" rx="4"/><path d="M15 16h19M15 23h19M15 30h12"/></>,
    chart: <><path d="M7 40h35"/><rect x="10" y="25" width="6" height="13" rx="1"/><rect x="22" y="15" width="6" height="23" rx="1"/><rect x="34" y="8" width="6" height="30" rx="1"/></>,
    document: <><path d="M12 5h18l8 8v29H12Z"/><path d="M29 5v9h9M17 22h15M17 28h15M17 34h10"/></>,
    volume: <><path d="M6 19h9l9-8v26l-9-8H6Z"/><path d="M31 17c4 4 4 10 0 14M37 11c7 7 7 19 0 26"/></>,
    hand: <><path d="M14 42c-5-5-7-11-5-16 1-3 3-4 5-2l4 5V10c0-4 5-4 5 0v14-17c0-4 5-4 5 0v17-14c0-4 5-4 5 0v14-10c0-4 5-4 5 0v15c0 7-3 11-8 13Z"/></>,
    play: <><circle cx="24" cy="24" r="20" fill="currentColor" stroke="none"/><path d="m20 14 15 10-15 10Z" fill="#fff" stroke="none"/></>,
    bulb: <><path d="M15 31c-3-3-5-7-5-11a14 14 0 0 1 28 0c0 4-2 8-5 11l-2 3H17Z"/><path d="M18 39h12M20 44h8M24 10v-4M7 11l-3-3M41 11l3-3M5 24H2M43 24h3"/></>,
  };
  return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}>{paths[name]}</svg>;
}
function Feature({ icon, title, children }) { return <div className="feature"><span className="feature-icon" aria-hidden="true"><Icon name={icon}/></span><div><h3>{title}</h3><p>{children}</p></div></div>; }
function Benefit({ icon, title, children }) { return <article className="benefit"><span className="benefit-icon" aria-hidden="true"><Icon name={icon}/></span><div><h3>{title}</h3><p>{children}</p></div></article>; }

export default App;
