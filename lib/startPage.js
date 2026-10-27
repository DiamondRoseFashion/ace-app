// Settings → "Open ACE on": the page this device opens first.
// ACE always starts on My Projects (/dashboard); if another page is
// chosen, My Projects sends you there once each time ACE is opened.

export const START_PAGES = [
  { value: '/dashboard', label: 'My Projects' },
  { value: '/planner', label: 'Meetings' },
  { value: '/calendar', label: 'Calendar' },
  { value: '/todo', label: 'To-Do' },
];

const KEY = 'ace-start-page';
const DONE = 'ace-start-done'; // this visit has already started

export function getStartPage() {
  try {
    const v = window.localStorage.getItem(KEY);
    return START_PAGES.some((p) => p.value === v) ? v : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export function setStartPage(path) {
  try { window.localStorage.setItem(KEY, path); } catch { /* ignore */ }
}

// Any other page opened first (e.g. from a notification) counts as started
export function markStarted() {
  try { window.sessionStorage.setItem(DONE, '1'); } catch { /* ignore */ }
}

// Called by My Projects when it opens: the page to go to instead, or null
export function startRedirect() {
  try {
    if (window.sessionStorage.getItem(DONE)) return null;
    window.sessionStorage.setItem(DONE, '1');
  } catch {
    return null;
  }
  const page = getStartPage();
  return page === '/dashboard' ? null : page;
}
