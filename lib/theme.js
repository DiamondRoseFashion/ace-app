// Look of ACE on this device (Settings → Appearance).
//   classic = the usual ACE look (starry navy page, white cards)
//   light   = light page, white cards
//   dark    = navy page, dark cards
//   system  = light or dark, following the phone/computer setting
// Saved per device. THEME_SCRIPT runs before the page draws, so there's no flash.

export const THEMES = [
  { value: 'classic', label: 'Classic', hint: 'The usual ACE look' },
  { value: 'light', label: 'Light', hint: 'Light page and cards' },
  { value: 'dark', label: 'Dark', hint: 'Dark page and cards' },
  { value: 'system', label: 'Match my device', hint: 'Light or dark, like your phone/computer' },
];

const KEY = 'ace-theme';

export function getTheme() {
  try {
    const v = window.localStorage.getItem(KEY);
    return THEMES.some((t) => t.value === v) ? v : 'classic';
  } catch {
    return 'classic';
  }
}

function resolve(theme) {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let unwatch = null;
export function applyTheme(theme) {
  try { window.localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  document.documentElement.dataset.theme = resolve(theme);
  unwatch?.();
  unwatch = null;
  if (theme === 'system' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { document.documentElement.dataset.theme = resolve('system'); };
    mq.addEventListener?.('change', onChange);
    unwatch = () => mq.removeEventListener?.('change', onChange);
  }
}

// Inline in <head>: set the saved look before anything is drawn
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}')||'classic';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(['classic','light','dark'].indexOf(t)<0)t='classic';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
