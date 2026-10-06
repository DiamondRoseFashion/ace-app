'use client';

// Quietly reports problems people hit in ACE (page crashes, failed
// database saves/loads, server errors) to the ACE monitor, so they can
// be fixed even if nobody mentions them.
import { useEffect } from 'react';
import { createClient } from '@/lib/supabaseClient';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// statuses that are normal (not signed in, no rows, duplicate, …)
const IGNORE_STATUS = new Set([401, 403, 406, 409, 416]);
const recent = new Map();
let installed = false;

async function authHeader() {
  try {
    const { data } = await createClient().auth.getSession();
    const t = data?.session?.access_token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

export async function reportError({ message, stack, kind = 'crash', status, endpoint }) {
  try {
    const key = `${kind}|${status || ''}|${endpoint || ''}|${message}`;
    const last = recent.get(key) || 0;
    if (Date.now() - last < 60 * 1000) return; // once a minute per problem
    recent.set(key, Date.now());
    const body = JSON.stringify({
      message: String(message || 'Unknown error').slice(0, 500),
      stack: stack ? String(stack).slice(0, 2000) : null,
      kind, status: status ?? null, endpoint: endpoint ?? null,
      path: window.location.pathname,
    });
    await (window.__aceRealFetch || fetch)('/api/report-error', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body,
    });
  } catch { /* never let reporting break anything */ }
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    if (!e?.message || /ResizeObserver loop/i.test(e.message)) return;
    reportError({ message: e.message, stack: e.error?.stack, kind: 'crash' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    const message = r?.message || String(r || 'Unhandled promise rejection');
    if (/AbortError|Load failed|Failed to fetch|NetworkError/i.test(message)) return; // offline blips
    reportError({ message, stack: r?.stack, kind: 'promise' });
  });

  // Watch database + ACE server calls for failures
  const realFetch = window.fetch.bind(window);
  window.__aceRealFetch = realFetch;
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const isDb = SUPABASE_URL && url.startsWith(SUPABASE_URL);
      const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      const bad = isDb ? (res.status >= 400 && !IGNORE_STATUS.has(res.status)) : (isApi && res.status >= 500);
      if (bad && !url.includes('/api/report-error')) {
        const endpoint = url.replace(SUPABASE_URL, '').replace(window.location.origin, '').split('?')[0];
        let message = `${res.status} ${res.statusText || ''}`.trim();
        try {
          const text = await res.clone().text();
          const j = JSON.parse(text);
          message = j.message || j.error_description || j.error || message;
        } catch { /* not JSON */ }
        reportError({ message, kind: isDb ? 'database' : 'api', status: res.status, endpoint });
      }
    } catch { /* ignore */ }
    return res;
  };
}

export default function ErrorReporter() {
  useEffect(() => { install(); }, []);
  return null;
}
