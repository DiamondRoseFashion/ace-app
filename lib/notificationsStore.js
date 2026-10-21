'use client';
// One shared list of my notifications for every 🔔 bell on the page
// (so several bells never fetch or subscribe twice).
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

const LIMIT = 100;
const state = { items: [], unread: 0, loaded: false, missing: false, uid: null };
const listeners = new Set();
let supabase = null;
let started = false;
let channel = null;
let timer = null;
let pending = null;

const emit = () => listeners.forEach((fn) => fn({ ...state }));

async function refresh() {
  if (!supabase || !state.uid) return;
  if (pending) return pending;
  pending = (async () => {
    const [{ data, error }, { count }] = await Promise.all([
      supabase.from('notifications').select('id, kind, title, body, url, created_at, read_at')
        .order('created_at', { ascending: false }).limit(LIMIT),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message)) state.missing = true;
    } else {
      state.missing = false;
      state.items = data || [];
      state.unread = count ?? state.items.filter((n) => !n.read_at).length;
    }
    state.loaded = true;
    emit();
  })();
  try { await pending; } finally { pending = null; }
}

async function start() {
  if (started) return;
  started = true;
  supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { started = false; return; }
  state.uid = user.id;
  await refresh();
  channel = supabase.channel(`inbox-${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => refresh())
    .subscribe();
  // a push arrived on this device → refresh straight away
  try {
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (String(e.data?.type || '').startsWith('ace-')) setTimeout(refresh, 800);
    });
  } catch { /* ignore */ }
  window.addEventListener('focus', () => refresh());
  timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
}

// ---- actions (update the screen first, then the database) ----
function setItems(items, unread) {
  state.items = items;
  state.unread = Math.max(0, unread);
  emit();
}

export async function markRead(id, read = true) {
  const n = state.items.find((x) => x.id === id);
  if (!n || !!n.read_at === read) return;
  const at = read ? new Date().toISOString() : null;
  setItems(state.items.map((x) => (x.id === id ? { ...x, read_at: at } : x)), state.unread + (read ? -1 : 1));
  await supabase.from('notifications').update({ read_at: at }).eq('id', id);
}

export async function markAllRead() {
  const at = new Date().toISOString();
  setItems(state.items.map((x) => (x.read_at ? x : { ...x, read_at: at })), 0);
  await supabase.from('notifications').update({ read_at: at }).eq('user_id', state.uid).is('read_at', null);
}

export async function removeOne(id) {
  const n = state.items.find((x) => x.id === id);
  if (!n) return;
  setItems(state.items.filter((x) => x.id !== id), state.unread - (n.read_at ? 0 : 1));
  await supabase.from('notifications').delete().eq('id', id);
}

export async function removeAll() {
  setItems([], 0);
  await supabase.from('notifications').delete().eq('user_id', state.uid);
  refresh();
}

export function useNotifications() {
  const [s, setS] = useState({ ...state });
  useEffect(() => {
    listeners.add(setS);
    setS({ ...state });
    start();
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

// for tests / sign-out
export function resetNotifications() {
  if (channel && supabase) supabase.removeChannel(channel);
  clearInterval(timer);
  channel = null; started = false;
  Object.assign(state, { items: [], unread: 0, loaded: false, missing: false, uid: null });
  emit();
}
