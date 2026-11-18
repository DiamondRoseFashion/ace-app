// Remembers how My Projects was filtered (search, column filters, sort and
// where the table was scrolled to) while you open a project, so
// "← Back to Projects" or the browser's Back button returns to the same
// filtered list. Clicking "My Projects" in the sidebar starts afresh.
// Kept for this browser tab only (sessionStorage).

const KEY = 'ace-dashboard-view';
export const KEEP_URL = '/dashboard?keep=1'; // a link back that keeps the view

export function saveView(view) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(view)); } catch { /* ignore */ }
}

export function loadView() {
  try { return JSON.parse(window.sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function clearView() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

// sidebar "My Projects": forget the view, and tell an open My Projects page to reset
export function resetView() {
  clearView();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ace-dashboard-reset'));
}
