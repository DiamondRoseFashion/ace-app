'use client';

// Owner / admin / manager: check that ACE's alert emails reach you
import { useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

export default function MonitorPanel() {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  async function run(what) {
    setBusy(what); setMsg(null);
    try {
      const { data } = await createClient().auth.getSession();
      const res = await fetch('/api/monitor-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` },
        body: JSON.stringify({ what }),
      });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: j.message } : { ok: false, text: j.error || `Failed (${res.status})` });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy('');
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>🛡️ ACE Monitor</div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
        ACE watches itself around the clock. You get an <strong>instant email</strong> if anything goes wrong
        (errors, reminders stopping, a failed backup, several projects deleted at once) and a{' '}
        <strong>weekly report every Monday at 8:00 AM</strong> with that week&apos;s backup attached
        (an Excel file you can open, plus a restore file).
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => run('alert')}>
          {busy === 'alert' ? 'Sending…' : 'Send a test alert'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => run('weekly')}>
          {busy === 'weekly' ? 'Preparing report…' : 'Send the weekly report now'}
        </button>
      </div>
      {msg && <div className={msg.ok ? 'notice ok' : 'notice err'} style={{ marginTop: 12, marginBottom: 0 }}>{msg.text}</div>}
    </div>
  );
}
