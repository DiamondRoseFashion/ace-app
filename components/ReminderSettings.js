'use client';

// Reminder settings: default meeting reminder, repeat, pop-up/sound on
// this device and background notifications. Used as a pop-up on
// Meetings and as a section on Settings (inline).
import { useEffect, useState } from 'react';
import {
  REMINDER_OPTIONS, DEFAULT_REMINDER, ANYTIME_REMINDER_HOUR, getPref, setPref, friendlyDbError,
} from '@/lib/planner';
import { enablePush, disablePush, pushStatus } from '@/lib/pushClient';

export default function ReminderSettings({ me, onClose, onSaved, supabase, inline = false }) {
  const [mins, setMins] = useState(String(me.reminder_default_minutes ?? DEFAULT_REMINDER));
  const [popup, setPopup] = useState(true);
  const [repeat, setRepeat] = useState(me.reminder_repeat !== false);
  const [sound, setSound] = useState(true);
  const [push, setPush] = useState('checking'); // on | off | denied | unsupported | needs-home-screen
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPopup(getPref('alarm-popup', true));
    setSound(getPref('alarm-sound', true));
    pushStatus().then(setPush).catch(() => setPush('unsupported'));
  }, []);

  async function save() {
    setErr(''); setMsg('');
    setSaving(true);
    setPref('alarm-popup', popup);
    setPref('alarm-sound', sound);
    const value = Number(mins);
    const patch = { reminder_default_minutes: value };
    if ('reminder_repeat' in me || repeat === false) patch.reminder_repeat = repeat;
    const { data, error } = await supabase
      .from('profiles').update(patch).eq('id', me.id).select('id');
    setSaving(false);
    if (error) { setErr(friendlyDbError(error.message)); return; }
    if (!data || data.length === 0) { setErr('Could not save your default. Please ask your admin to run the planner database update.'); return; }
    onSaved(value, repeat);
    setMsg('Saved.');
  }

  async function turnOnPush() {
    setPushMsg(''); setPushBusy(true);
    try {
      const r = await enablePush(supabase);
      setPush(r);
      if (r === 'on') setPushMsg('✅ This device will now get meeting reminders, even when ACE is closed.');
    } catch (e) {
      setPushMsg(friendlyDbError(e.message) || 'Could not turn on notifications.');
    }
    setPushBusy(false);
  }

  async function turnOffPush() {
    setPushMsg(''); setPushBusy(true);
    try { await disablePush(supabase); setPush('off'); setPushMsg('Notifications turned off for this device.'); } catch { /* ignore */ }
    setPushBusy(false);
  }

  async function sendTest() {
    setPushMsg(''); setPushBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/push-test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setPushMsg(body.error || 'Could not send a test.');
      else setPushMsg(`Test sent to ${body.delivered} of your device${body.devices === 1 ? '' : 's'}. It should appear within a few seconds.`);
    } catch {
      setPushMsg('Could not send a test.');
    }
    setPushBusy(false);
  }

  const content = (
      <>
        <div className="modal-head">
          <h2>{inline ? '🔔 Notifications & reminders' : 'Reminder settings'}</h2>
          {!inline && <button className="reminder-x" aria-label="Close" onClick={onClose}>✕</button>}
        </div>

        <div className="field-group">
          <label>Default reminder for my meetings</label>
          <select value={mins} onChange={(e) => setMins(e.target.value)}>
            {REMINDER_OPTIONS.map((r) => <option key={r.value} value={String(r.value)}>{r.label}</option>)}
          </select>
          <div className="hint">Used for any meeting where you didn&apos;t choose a reminder. Each meeting can also have its own time. Meetings without a start time remind you at {ANYTIME_REMINDER_HOUR}:00 AM that day. The alarm keeps ringing until you stop it.</div>
        </div>

        <div className="eyebrow" style={{ margin: '18px 0 10px' }}>On this device</div>
        <label className="toggle-row">
          <input type="checkbox" checked={popup} onChange={(e) => setPopup(e.target.checked)} />
          <span>Pop-up alarm before meetings</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
          <span>Play a sound and vibrate</span>
        </label>

        <div className="notif-box">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Reminders when ACE is closed</div>
          {push === 'checking' && <div className="hint">Checking this device…</div>}
          {push === 'on' && (
            <>
              <div className="hint">✅ On for this device. Reminders arrive as a phone/computer notification even when ACE is closed.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" disabled={pushBusy} onClick={sendTest}>Send test notification</button>
                <button type="button" className="btn btn-ghost danger-text" disabled={pushBusy} onClick={turnOffPush}>Turn off on this device</button>
              </div>
            </>
          )}
          {push === 'off' && (
            <>
              <div className="hint" style={{ marginBottom: 8 }}>Get meeting reminders on this phone or computer even when ACE is closed.</div>
              <button type="button" className="btn btn-primary" disabled={pushBusy} onClick={turnOnPush}>{pushBusy ? 'Turning on…' : 'Turn on notifications'}</button>
            </>
          )}
          {push === 'denied' && <div className="hint">Notifications are blocked for ACE in this browser. Tap the icon to the left of the web address → Site settings → Notifications → Allow, then reload ACE.</div>}
          {push === 'needs-home-screen' && <div className="hint">On iPhone: tap the Share button <strong>⬆︎</strong> in Safari → <strong>Add to Home Screen</strong>. Then open ACE from its new icon and come back here to turn on notifications.</div>}
          {push === 'unsupported' && <div className="hint">This browser can&apos;t receive background notifications. Please use Chrome, Edge or Safari (on iPhone, from the Home Screen icon).</div>}
          {pushMsg && <div className="hint" style={{ marginTop: 8, color: 'var(--ink)' }}>{pushMsg}</div>}
        </div>

        {err && <div className="error-text" style={{ marginBottom: 10 }}>{err}</div>}
        {msg && <div className="ok-text">{msg}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => window.dispatchEvent(new Event('ace-test-alarm'))}>Test alarm</button>
          <span style={{ flex: 1 }} />
          {!inline && <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </>
  );
  if (inline) return <section className="card set-card" aria-label="Notifications and reminders">{content}</section>;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Reminder settings" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
