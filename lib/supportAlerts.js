'use client';
// "New project to support": count of my assigned projects I haven't
// opened yet + the newest arrivals for the pop-up message.
import { useEffect, useRef, useState } from 'react';

export function useSupportAlerts(supabase) {
  const [items, setItems] = useState([]); // [{ project_id, project_name, sales_person, assigned_by }]
  const [toast, setToast] = useState(null);
  const known = useRef(null); // project ids already seen in this session

  async function refresh(announce = true) {
    const { data, error } = await supabase.rpc('my_new_support');
    if (error) return; // not set up yet: stay quiet
    const list = data || [];
    setItems(list);
    const ids = new Set(list.map((x) => x.project_id));
    if (known.current === null) {
      // first check after opening ACE: one gentle reminder per session
      let shown = false;
      try { shown = sessionStorage.getItem('ace-support-toast') === '1'; } catch { /* ignore */ }
      if (list.length && !shown && !window.location.pathname.startsWith('/support')) {
        setToast(list.length === 1 ? list[0] : { count: list.length });
        try { sessionStorage.setItem('ace-support-toast', '1'); } catch { /* ignore */ }
      }
    } else if (announce) {
      const fresh = list.filter((x) => !known.current.has(x.project_id));
      if (fresh.length && !window.location.pathname.startsWith('/support')) {
        setToast(fresh.length === 1 ? fresh[0] : { count: fresh.length });
      }
    }
    known.current = ids;
  }

  useEffect(() => {
    let ch = null;
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) return;
      await refresh(false);
      ch = supabase
        .channel(`support-alerts-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_supporters', filter: `user_id=eq.${user.id}` }, () => refresh())
        .subscribe();
    })();
    const onMsg = (e) => { if (e.data?.type === 'ace-support') refresh(); };
    const onSeen = () => { setItems([]); setToast(null); };
    const poll = setInterval(() => refresh(), 2 * 60 * 1000); // safety net
    navigator.serviceWorker?.addEventListener('message', onMsg);
    window.addEventListener('ace-support-seen', onSeen);
    return () => {
      alive = false;
      clearInterval(poll);
      if (ch) supabase.removeChannel(ch);
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      window.removeEventListener('ace-support-seen', onSeen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { count: items.length, toast, closeToast: () => setToast(null) };
}

// Tell the database this person has seen their new support projects.
export async function markSupportSeen(supabase) {
  const { error } = await supabase.rpc('mark_support_seen');
  if (!error) window.dispatchEvent(new Event('ace-support-seen'));
}

// After saving "Supported By": ask the server to notify the new people.
export async function notifySupporters(supabase, projectId, userIds) {
  if (!projectId || !userIds?.length) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/notify-support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ projectId, userIds }),
    });
  } catch { /* the badge inside ACE still shows it */ }
}
