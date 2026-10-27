'use client';

// "Show my meetings in Outlook": the private calendar link and how to add it.
// Used as a pop-up on Meetings and as a section on Settings (inline).
import { useEffect, useState } from 'react';

export default function OutlookConnect({ supabase, onClose, inline = false }) {
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  function toUrl(token) {
    return `${window.location.origin}/api/calendar/${token}.ics`;
  }

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_my_calendar_token');
      if (error) {
        setErr(/function|schema cache|does not exist/i.test(error.message)
          ? 'The Outlook connection needs a one-time database update. Please ask your admin to run it in Supabase.'
          : error.message);
        return;
      }
      setLink(toUrl(data));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.getElementById('ace-cal-link');
      el?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function reset() {
    setBusy(true);
    const { data, error } = await supabase.rpc('reset_my_calendar_token');
    setBusy(false);
    setConfirmReset(false);
    if (error) { setErr(error.message); return; }
    setLink(toUrl(data));
  }

  const content = (
      <>
        <div className="modal-head">
          <h2>Show my meetings in Outlook</h2>
          {!inline && <button className="reminder-x" aria-label="Close" onClick={onClose}>✕</button>}
        </div>
        <p className="hint" style={{ marginTop: 0, fontSize: 13 }}>
          Your ACE meetings appear in your Outlook calendar on computer, phone and web, and stay updated when meetings change.
        </p>

        <label>Your private calendar link</label>
        {err ? (
          <div className="error-text" style={{ marginBottom: 12 }}>{err}</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input id="ace-cal-link" readOnly value={link || 'Loading…'} onFocus={(e) => e.target.select()} className="mono" style={{ fontSize: 12 }} />
            <button type="button" className="btn btn-primary" disabled={!link} onClick={copy} style={{ flexShrink: 0 }}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
        )}
        <div className="hint" style={{ marginBottom: 16 }}>Keep this link private: anyone who has it can see your meetings.</div>

        <div className="notif-box" style={{ marginTop: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Add it to Outlook (once)</div>
          <ol className="steps">
            <li>Open <strong>outlook.office.com</strong> (or the new Outlook app) and go to <strong>Calendar</strong>.</li>
            <li>Click <strong>Add calendar</strong> → <strong>Subscribe from web</strong>.</li>
            <li>Paste the link, name it <strong>ACE Meetings</strong>, then click <strong>Import</strong>.</li>
          </ol>
          <div className="hint" style={{ marginTop: 6 }}>
            Classic Outlook on Windows: <strong>Calendar → Add Calendar → From Internet</strong>, paste, <strong>OK</strong>.
            It then shows on Outlook on your phone too.
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Outlook checks for changes every few hours. To put one meeting in Outlook right away, open it and tap <strong>📆 Add to Outlook</strong>.
          </div>
        </div>

        <div className="modal-actions">
          {confirmReset ? (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={reset}>Yes, make a new link</button>
          ) : (
            <button type="button" className="btn btn-ghost danger-text" disabled={!link} onClick={() => setConfirmReset(true)}>Reset link</button>
          )}
          <span style={{ flex: 1 }} />
          {!inline && <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
        </div>
        {confirmReset && <div className="hint">The old link stops working, and you&apos;ll need to add the new one to Outlook again.</div>}
      </>
  );
  if (inline) return <section className="card set-card" aria-label="Connect to Outlook">{content}</section>;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Connect to Outlook" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
