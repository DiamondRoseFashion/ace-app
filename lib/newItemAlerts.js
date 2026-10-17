'use client';
// Shared logic for "something new for you" alerts (badge + pop-up):
// new projects to support, new meetings given to you.
import { useEffect, useRef, useState } from 'react';

// rpc: database function listing my unseen items; idKey: their id field;
// table/column: realtime watch on rows for me; swType: message from the
// service worker when a push arrives; seenEvent: fired when the page marks
// them seen; path: the page that shows them; sessionKey: one reminder per visit.
export function useNewItems(supabase, { rpc, idKey, table, column, swType, seenEvent, path, sessionKey }) {
  const [items, setItems] = useState([]);
  const [toast, setToast] = useState(null);
  const known = useRef(null);

  async function refresh(announce = true) {
    const { data, error } = await supabase.rpc(rpc);
    if (error) return; // not set up yet: stay quiet
    const list = data || [];
    setItems(list);
    const onPage = window.location.pathname.startsWith(path);
    if (known.current === null) {
      let shown = false;
      try { shown = sessionStorage.getItem(sessionKey) === '1'; } catch { /* ignore */ }
      if (list.length && !shown && !onPage) {
        setToast(list.length === 1 ? list[0] : { count: list.length });
        try { sessionStorage.setItem(sessionKey, '1'); } catch { /* ignore */ }
      }
    } else if (announce) {
      const fresh = list.filter((x) => !known.current.has(x[idKey]));
      if (fresh.length && !onPage) setToast(fresh.length === 1 ? fresh[0] : { count: fresh.length });
    }
    known.current = new Set(list.map((x) => x[idKey]));
  }

  useEffect(() => {
    let ch = null;
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) return;
      await refresh(false);
      ch = supabase
        .channel(`${rpc}-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, filter: `${column}=eq.${user.id}` }, () => refresh())
        .subscribe();
    })();
    const onMsg = (e) => { if (e.data?.type === swType) refresh(); };
    const onSeen = () => { setItems([]); setToast(null); };
    const poll = setInterval(() => refresh(), 2 * 60 * 1000);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    window.addEventListener(seenEvent, onSeen);
    return () => {
      alive = false;
      clearInterval(poll);
      if (ch) supabase.removeChannel(ch);
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      window.removeEventListener(seenEvent, onSeen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { count: items.length, toast, closeToast: () => setToast(null) };
}
