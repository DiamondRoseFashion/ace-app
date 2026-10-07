'use client';

// App-wide keyboard scrolling, on every page:
//   ← → ↑ ↓  scroll whatever you're working in — the table or box you last
//             clicked / pointed at, otherwise the page (← → go to the page's
//             widest sideways-scrolling table)
//   Page Up / Page Down / Home / End  likewise
// Keys typed into a box (search, filters, forms) are never taken over.
import { useEffect } from 'react';

const TYPING = 'input, select, textarea, [contenteditable="true"], [contenteditable=""]';
let lastPointed = null;

function canScroll(el, axis) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const cs = getComputedStyle(el);
  const ov = axis === 'x' ? cs.overflowX : cs.overflowY;
  if (ov !== 'auto' && ov !== 'scroll') return false;
  return axis === 'x' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
}

function scrollableFrom(el, axis) {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (canScroll(n, axis)) return n;
  return null;
}

// the biggest visible sideways-scrolling area (e.g. a wide table)
function widestScroller(root) {
  let best = null;
  let bestArea = 0;
  root.querySelectorAll('div, section, main, table, ul').forEach((el) => {
    if (!canScroll(el, 'x')) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) return;
    const area = r.width * Math.min(r.height, window.innerHeight);
    if (area > bestArea) { best = el; bestArea = area; }
  });
  return best;
}

export default function ArrowScroll() {
  useEffect(() => {
    const remember = (e) => { lastPointed = e.target; };
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t?.closest?.(TYPING)) return;

      const keys = {
        ArrowLeft: ['x', -160], ArrowRight: ['x', 160], ArrowUp: ['y', -60], ArrowDown: ['y', 60],
        PageUp: ['y', 'pageUp'], PageDown: ['y', 'pageDown'], Home: ['xy', 'start'], End: ['xy', 'end'],
      };
      const k = keys[e.key];
      if (!k) return;
      const [axis, amount] = k;

      // inside an open pop-up, stay inside it
      const modal = document.querySelector('.modal-backdrop');
      const root = modal || document;
      const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      const start = [active, lastPointed].find((n) => n && n.isConnected && (!modal || modal.contains(n)));

      const ax = axis === 'xy' ? 'x' : axis;
      let target = start ? scrollableFrom(start, ax) : null;
      if (!target && axis === 'xy' && start) target = scrollableFrom(start, 'y');
      if (!target && ax === 'x') target = widestScroller(root === document ? document.body : root);
      if (!target && modal && canScroll(modal, 'y')) target = modal;
      if (!target) return; // nothing special: the browser scrolls the page as usual

      const how = e.repeat ? 'auto' : 'smooth';
      e.preventDefault();
      if (amount === 'start') target.scrollTo({ left: 0, top: canScroll(target, 'y') ? 0 : target.scrollTop, behavior: how });
      else if (amount === 'end') target.scrollTo({ left: target.scrollWidth, top: canScroll(target, 'y') ? target.scrollHeight : target.scrollTop, behavior: how });
      else if (amount === 'pageUp' || amount === 'pageDown') {
        if (!canScroll(target, 'y')) { return; }
        target.scrollBy({ top: (amount === 'pageUp' ? -1 : 1) * (target.clientHeight - 80), behavior: how });
      } else if (ax === 'y' && !canScroll(target, 'y')) {
        window.scrollBy({ top: amount, behavior: how });
      } else {
        target.scrollBy({ left: ax === 'x' ? amount : 0, top: ax === 'y' ? amount : 0, behavior: how });
      }
    };
    window.addEventListener('pointerdown', remember, true);
    window.addEventListener('pointerover', remember, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', remember, true);
      window.removeEventListener('pointerover', remember, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
