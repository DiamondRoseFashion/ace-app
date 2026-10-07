'use client';

// Lets the arrow keys (and Page Up/Down, Home/End) scroll a wide table.
// Keys typed into a box (search, filters, forms) are left alone.
// If the table can't scroll up/down itself, ↑ ↓ scroll the page as usual.
import { useEffect } from 'react';

export default function useArrowScroll(ref) {
  useEffect(() => {
    const onKey = (e) => {
      const el = ref.current;
      if (!el || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target;
      if (t?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('.modal-backdrop')) return;
      const canX = el.scrollWidth > el.clientWidth + 1;
      const canY = el.scrollHeight > el.clientHeight + 1;
      const how = e.repeat ? 'auto' : 'smooth';
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case 'ArrowLeft': dx = -160; break;
        case 'ArrowRight': dx = 160; break;
        case 'ArrowUp': dy = -60; break;
        case 'ArrowDown': dy = 60; break;
        case 'PageUp': dy = -(el.clientHeight - 80); break;
        case 'PageDown': dy = el.clientHeight - 80; break;
        case 'Home': if (canX || canY) { e.preventDefault(); el.scrollTo({ left: 0, top: canY ? 0 : el.scrollTop, behavior: how }); } return;
        case 'End': if (canX || canY) { e.preventDefault(); el.scrollTo({ left: el.scrollWidth, top: canY ? el.scrollHeight : el.scrollTop, behavior: how }); } return;
        default: return;
      }
      if (dx && !canX) return;
      if (dy && !canY) return; // let the page scroll instead
      e.preventDefault();
      el.scrollBy({ left: dx, top: dy, behavior: how });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}
