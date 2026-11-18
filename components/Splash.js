'use client';

// The opening animation: a short (about 1.5 s) premium white screen with
// the ACE mark drawing itself, the gold dot dropping in and the name
// fading up, then it fades away to the app (which keeps loading behind it).
//  • only when ACE is opened (once per browser tab), never between pages
//  • a click or a key press skips it
//  • skipped for people who turn off motion on their device
// SPLASH_SCRIPT (lib/splash.js, in <head>) decides before anything is drawn whether to
// show it, so it never flashes up when it shouldn't.
import { useEffect, useState } from 'react';

const TOTAL_MS = 1900; // animation length + fade (see .ace-splash in globals.css)

export default function Splash() {
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (document.documentElement.getAttribute('data-splash') !== 'show') { setGone(true); return undefined; }
    const done = setTimeout(() => setGone(true), TOTAL_MS);
    const skip = () => { setLeaving(true); setTimeout(() => setGone(true), 250); };
    window.addEventListener('keydown', skip, { once: true });
    return () => { clearTimeout(done); window.removeEventListener('keydown', skip); };
  }, []);

  if (gone) return null;
  return (
    <div
      className={`ace-splash${leaving ? ' leaving' : ''}`}
      aria-hidden="true"
      onClick={() => { setLeaving(true); setTimeout(() => setGone(true), 250); }}
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
