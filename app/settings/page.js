'use client';

// Settings: one place for personal choices.
//  • Appearance: Classic / Light / Dark / Match my device (this device)
//  • Notifications & reminders (same panel as Meetings → ⚙️ Reminders)
//  • Calendar & start page (this device)
//  • Outlook connection (same panel as Meetings → 📆 Outlook)
//  • Account & security: change password, log out of all devices
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import ReminderSettings from '@/components/ReminderSettings';
import OutlookConnect from '@/components/OutlookConnect';
import { getPref, setPref, notifyMeetingsChanged } from '@/lib/planner';
import { THEMES, getTheme, applyTheme } from '@/lib/theme';
import { START_PAGES, getStartPage, setStartPage } from '@/lib/startPage';
import { releasePush } from '@/lib/pushClient';
import { resetNotifications } from '@/lib/notificationsStore';

export default function SettingsPage() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [me, setMe] = useState(null); // profile
  const [email, setEmail] = useState('');
  const [todoOn, setTodoOn] = useState(false);
  const [theme, setTheme] = useState('classic');
  const [mondayFirst, setMondayFirst] = useState(false);
  const [holidays, setHolidays] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [startPage, setStart] = useState('/dashboard');
  const [saved, setSaved] = useState('');
  const [section, setSection] = useState(null); // open heading, or null = the list

  // /settings?s=<heading> opens that heading; the browser Back button returns to the list
  useEffect(() => {
    const read = () => { setSection(new URLSearchParams(window.location.search).get('s')); window.scrollTo(0, 0); };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const pushed = useRef(false); // opened from the list (so "‹ Settings" = Back)
  function openSection(key) {
    setSection(key);
    window.history.pushState(null, '', `/settings?s=${key}`);
    pushed.current = true;
    window.scrollTo(0, 0);
  }

  function closeSection() {
    if (pushed.current) { pushed.current = false; window.history.back(); return; }
    setSection(null);
    window.history.replaceState(null, '', '/settings');
    window.scrollTo(0, 0);
  }

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwMsg, setPwMsg] = useState(null); // { ok, text }
  const [pwBusy, setPwBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const [allErr, setAllErr] = useState('');

  useEffect(() => {
    setTheme(getTheme());
    setMondayFirst(getPref('week-monday', false));
    setHolidays(getPref('cal-holidays', true));
    setShowDone(getPref('cal-done', false));
    setStart(getStartPage());
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setEmail(user.email || '');
      const [{ data: prof }, { data: ok }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.rpc('has_todo_access'),
      ]);
      setTodoOn(!!ok);
      setMe(prof || { id: user.id, role: 'employee', full_name: user.email });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flash(text) {
    setSaved(text);
    setTimeout(() => setSaved((s) => (s === text ? '' : s)), 2000);
  }

  function pickTheme(v) {
    setTheme(v);
    applyTheme(v);
    flash('Look changed on this device.');
  }

  function toggle(name, value, set) {
    set(value);
    setPref(name, value);
    flash('Saved on this device.');
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.length < 6) { setPwMsg({ ok: false, text: 'Password must be at least 6 characters.' }); return; }
    if (pw !== pw2) { setPwMsg({ ok: false, text: 'The two passwords do not match.' }); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) { setPwMsg({ ok: false, text: error.message }); return; }
    setPw(''); setPw2('');
    setPwMsg({ ok: true, text: 'Password changed. Use the new one next time you log in.' });
  }

  async function logoutEverywhere() {
    setAllErr('');
    setAllBusy(true);
    await releasePush(supabase); // this device stops getting my reminders
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) { setAllBusy(false); setAllErr(error.message); return; }
    resetNotifications();
    router.push('/login');
  }

  const startOptions = START_PAGES.filter((p) => p.value !== '/todo' || todoOn);

  // the list of headings; tapping one opens just that section
  const SECTIONS = [
    { key: 'appearance', icon: '🎨', title: 'Appearance', sub: THEMES.find((t) => t.value === theme)?.label || 'Classic' },
    { key: 'notifications', icon: '🔔', title: 'Notifications & reminders', sub: 'Default reminder, alarm, phone notifications' },
    { key: 'calendar', icon: '🗓️', title: 'Calendar & start page', sub: 'Week start, holidays, first page' },
    { key: 'outlook', icon: '📆', title: 'Outlook', sub: 'Show your meetings in Outlook' },
    { key: 'account', icon: '🔒', title: 'Account & security', sub: 'Password, log out of all devices' },
  ];
  const current = SECTIONS.find((x) => x.key === section);

  function content(key) {
    switch (key) {
      case 'appearance': return (
    <section className="card set-card" aria-label="Appearance">
      <div className="modal-head"><h2>🎨 Appearance</h2></div>
      <div className="hint" style={{ marginBottom: 12 }}>Changes straight away, on this device.</div>
      <div className="set-themes" role="radiogroup" aria-label="Look">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            className={`set-theme${theme === t.value ? ' on' : ''}`}
            onClick={() => pickTheme(t.value)}
          >
            <span className={`set-swatch sw-${t.value}`} aria-hidden="true"><i /><b /></span>
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>
    </section>
      );
      case 'calendar': return (
    <section className="card set-card" aria-label="Calendar and start page">
      <div className="modal-head"><h2>🗓️ Calendar &amp; start page</h2></div>
      <div className="hint" style={{ marginBottom: 12 }}>Saved on this device.</div>
      <div className="field-group">
        <label>Week starts on</label>
        <div className="seg set-seg" role="radiogroup" aria-label="Week starts on">
          <button type="button" role="radio" aria-checked={!mondayFirst} className={!mondayFirst ? 'on' : ''} onClick={() => toggle('week-monday', false, setMondayFirst)}>Sunday</button>
          <button type="button" role="radio" aria-checked={mondayFirst} className={mondayFirst ? 'on' : ''} onClick={() => toggle('week-monday', true, setMondayFirst)}>Monday</button>
        </div>
      </div>
      <label className="toggle-row">
        <input type="checkbox" checked={holidays} onChange={(e) => toggle('cal-holidays', e.target.checked, setHolidays)} />
        <span>Show UAE public holidays on the Calendar</span>
      </label>
      {todoOn && (
        <label className="toggle-row">
          <input type="checkbox" checked={showDone} onChange={(e) => toggle('cal-done', e.target.checked, setShowDone)} />
          <span>Show finished to-dos on the Calendar</span>
        </label>
      )}
      <div className="field-group" style={{ marginTop: 14, marginBottom: 0 }}>
        <label htmlFor="set-start">Open ACE on</label>
        <select id="set-start" value={startPage} onChange={(e) => { setStart(e.target.value); setStartPage(e.target.value); flash('Saved on this device.'); }}>
          {startOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <div className="hint">The page you see first when you open ACE or log in.</div>
      </div>
    </section>
      );
      case 'notifications': return me ? (
        <ReminderSettings
          inline
          me={me}
          supabase={supabase}
          onSaved={(mins, rep) => { setMe({ ...me, reminder_default_minutes: mins, reminder_repeat: rep }); notifyMeetingsChanged(); }}
        />
      ) : (
        <section className="card set-card"><div className="hint">Loading…</div></section>
      );
      case 'outlook': return <OutlookConnect inline supabase={supabase} />;
      case 'account': return (
    <section className="card set-card" aria-label="Account and security">
      <div className="modal-head"><h2>🔒 Account &amp; security</h2></div>
      {email && <div className="hint" style={{ marginBottom: 14 }}>Logged in as <strong>{email}</strong></div>}
      <form onSubmit={changePassword}>
        <div className="field-group">
          <label htmlFor="set-pw">New password</label>
          <input id="set-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" />
        </div>
        <div className="field-group">
          <label htmlFor="set-pw2">Type it again</label>
          <input id="set-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {pwMsg && <div className={pwMsg.ok ? 'notice ok' : 'notice err'}>{pwMsg.text}</div>}
        <button type="submit" className="btn btn-primary" disabled={pwBusy || !pw}>{pwBusy ? 'Changing…' : 'Change password'}</button>
      </form>

      <div className="set-divider" />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Log out of all devices</div>
      <div className="hint" style={{ marginBottom: 10 }}>Logs you out on every phone and computer, including this one. Useful if a phone is lost or you logged in on someone else&apos;s computer.</div>
      {allErr && <div className="notice err">{allErr}</div>}
      {confirmAll ? (
        <div className="modal-actions">
          <button type="button" className="btn btn-danger" disabled={allBusy} onClick={logoutEverywhere}>{allBusy ? 'Logging out…' : 'Yes, log out everywhere'}</button>
          <button type="button" className="btn btn-ghost" disabled={allBusy} onClick={() => setConfirmAll(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirmAll(true)}>Log out of all devices</button>
      )}
    </section>
      );
      default: return null;
    }
  }

  return (
    <div className="shell">
      <Sidebar active="settings" />
      <div className="main settings">
        {saved && <div className="set-saved" role="status">✓ {saved}</div>}
        {current ? (
          <div className="set-detail">
            <button type="button" className="set-back" onClick={closeSection}>‹ Settings</button>
            <h1 style={{ fontSize: 28, marginTop: 6, marginBottom: 18 }}><span aria-hidden="true">{current.icon}</span> {current.title}</h1>
            {content(current.key)}
          </div>
        ) : (
          <>
            <div className="eyebrow">Settings</div>
            <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 6 }}>Settings</h1>
            <p className="page-intro">Choose how ACE looks and works for you.</p>
            <nav className="card set-menu" aria-label="Settings">
              {SECTIONS.map((x) => (
                <button key={x.key} type="button" className="set-menu-row" onClick={() => openSection(x.key)}>
                  <span className="set-menu-icon" aria-hidden="true">{x.icon}</span>
                  <span className="set-menu-text">
                    <strong>{x.title}</strong>
                    <span>{x.sub}</span>
                  </span>
                  <span className="set-menu-arrow" aria-hidden="true">›</span>
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
