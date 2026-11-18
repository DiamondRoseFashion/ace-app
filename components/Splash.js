'use client';

// The opening animation: a premium white screen (about 3 s) with the ACE
// mark drawing itself, the gold dot dropping in and the name fading up,
// then it fades away to the app (which keeps loading behind it).
//  • after logging in, and when ACE is opened while logged in (once per
//    tab); never between pages (see lib/splash.js)
//  • a click or a key press skips it
//  • devices with animations turned off see a still version (about 2 s)
import { useEffect, useState } from 'react';

const TOTAL_MS = 3300; // animation + fade (see .ace-splash in globals.css)
const STILL_MS = 2200; // the still version, for devices with animations turned off

export default function Splash() {
  const [run, setRun] = useState(1); // 0 = not showing; changes restart it
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (document.documentElement.getAttribute('data-splash') !== 'show') setRun(0);
    const onShow = () => { setLeaving(false); setRun((r) => r + 1); };
    window.addEventListener('ace-splash-show', onShow);
    return () => window.removeEventListener('ace-splash-show', onShow);
  }, []);

  useEffect(() => {
    if (!run) return undefined;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const done = setTimeout(() => setRun(0), still ? STILL_MS : TOTAL_MS);
    const skip = () => { setLeaving(true); setTimeout(() => setRun(0), 300); };
    window.addEventListener('keydown', skip, { once: true });
    return () => { clearTimeout(done); window.removeEventListener('keydown', skip); };
  }, [run]);

  if (!run) return null;
  return (
    <div
      key={run}
      className={`ace-splash${leaving ? ' leaving' : ''}`}
      aria-hidden="true"
      onClick={() => { setLeaving(true); setTimeout(() => setRun(0), 300); }}
    >
      <div className="ace-splash-inner">
        <svg className="ace-splash-mark" viewBox="0 0 168 190" width="112" height="127">
          <path className="as-a" d="M84 4 L164 182 L128 182 L84 72 L40 182 L4 182 Z" />
          <circle className="as-dot" cx="84" cy="136" r="15" />
        </svg>
        <div className="ace-splash-word">ACE</div>
        <div className="ace-splash-line" />
        <div className="ace-splash-tag">Project Control · GEMS Systems L.L.C.</div>
      </div>
    </div>
  );
}
