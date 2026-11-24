'use client';

// Banner: "Turn on notifications on this device" (shown only when this
// device isn't set up yet). Same switch as on the Meetings page.
import { useEffect, useState } from 'react';
import { enablePush, pushStatus } from '@/lib/pushClient';
import Icon from '@/components/Icon';

const SNOOZE_KEY = 'ace-push-prompt-closed';
const SNOOZE_DAYS = 14;

// floating: a small card in the corner of every page (closing it hides it
// for two weeks on this device). The "blocked" help stays in Settings only.
export default function PushPrompt({ supabase, what = 'meeting reminders and new projects to support', floating = false }) {
  const [closed, setClosed] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    pushStatus().then(setStatus).catch(() => setStatus('unsupported'));
    if (floating) {
      try {
        const t = Number(localStorage.getItem(SNOOZE_KEY) || 0);
        if (Date.now() - t < SNOOZE_DAYS * 24 * 3600 * 1000) setClosed(true);
      } catch { /* ignore */ }
    }
  }, [floating]);

  function close() {
    setClosed(true);
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* ignore */ }
  }

  async function turnOn() {
    setBusy(true); setMsg('');
    try {
      const r = await enablePush(supabase);
      setStatus(r);
      if (r === 'on') {
        setMsg('Done. This device will now be notified, even when ACE is closed.');
        if (floating) setTimeout(() => setClosed(true), 5000);
      }
    } catch (e) {
      setMsg(`Couldn't turn on notifications: ${e.message}`);
    }
    setBusy(false);
  }

  if (!status || (status === 'on' && !msg) || closed) return null;
  if (floating && !['off', 'needs-home-screen', 'on'].includes(status)) return null;
  return (
    <div className={`push-prompt${floating ? ' floating' : ''}`} role="status">
      <span className="pp-bell" aria-hidden="true"><Icon name="bell" size={20} className="ii only" /></span>
      <div className="pp-text">
        {status === 'on' ? <b>{msg}</b> : (
          <>
            <b>Get notified on this device</b>
            <span>
              {status === 'off' && `Turn on notifications to hear about ${what} even when ACE is closed.`}
              {status === 'denied' && 'Notifications are blocked for ACE in this browser. Click the 🔒 lock icon next to the web address → Notifications → Allow, then refresh.'}
              {status === 'needs-home-screen' && 'On iPhone: tap Share → "Add to Home Screen", open ACE from the Home Screen, then turn on notifications here.'}
              {status === 'unsupported' && 'This browser can\'t show notifications. Use Chrome, Edge or Safari.'}
            </span>
            {msg && <span className="pp-err">{msg}</span>}
          </>
        )}
      </div>
      {status === 'off' && (
        <button type="button" className="btn btn-primary" onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
      )}
      {floating && <button type="button" className="pp-close" aria-label="Close" title="Ask me again in two weeks" onClick={close}>✕</button>}
    </div>
  );
}
