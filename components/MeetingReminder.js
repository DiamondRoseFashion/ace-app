'use client';

// Alarm-style meeting reminder. Mounted in the sidebar, so it runs
// on every ACE page while the app is open (phone or computer).
// Shows a floating pop-up, plays a chime, vibrates on phones and,
// if the person allowed it, shows a system notification.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import {
  todayKey, addDays, meetingStart, meetingTitle, formatTime, getPref,
} from '@/lib/planner';

const CHECK_EVERY_MS = 15 * 1000;
const RELOAD_EVERY_MS = 2 * 60 * 1000;
const SHOW_UNTIL_AFTER_START_MS = 10 * 60 * 1000;

function storageGet(store, key) {
  try { return window[store].getItem(key); } catch { return null; }
}
function storageSet(store, key, value) {
  try { window[store].setItem(key, value); } catch { /* ignore */ }
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1175, 1568];
    for (let round = 0; round < 3; round++) {
      notes.forEach((freq, i) => {
        const t = ctx.currentTime + round * 1.1 + i * 0.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      });
    }
    setTimeout(() => ctx.close(), 4000);
  } catch { /* audio blocked until the user taps the page — ignore */ }
}

async function showSystemNotification(m, minutesLeft) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const body = `${minutesLeft > 0 ? `Starts in ${minutesLeft} min` : 'Starting now'} · ${formatTime(m.start_time)}${m.venue ? ` · ${m.venue}` : ''}`;
    const opts = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: `meeting-${m.id}`, requireInteraction: true, data: { url: '/planner' } };
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(`🔔 ${meetingTitle(m)}`, opts); return; }
    }
    new Notification(`🔔 ${meetingTitle(m)}`, opts);
  } catch { /* ignore */ }
}

function alertKey(m, mins) {
  return `ace-alarm:${m.id}:${m.meeting_date}:${m.start_time}:${mins}`;
}

export default function MeetingReminder() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  const dataRef = useRef({ uid: null, def: 30, meetings: [] });
  const snoozeRef = useRef({});
  const [alerts, setAlerts] = useState([]);
  const [now, setNow] = useState(Date.now());

  function supabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  async function load() {
    try {
      const sb = supabase();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const today = todayKey();
      const [{ data: prof }, { data: meetings, error }] = await Promise.all([
        sb.from('profiles').select('reminder_default_minutes').eq('id', user.id).single(),
        sb.from('meetings')
          .select('id, title, meeting_date, start_time, end_time, venue, reminder_minutes, is_done, project:projects(name)')
          .eq('assigned_to', user.id)
          .eq('is_done', false)
          .not('start_time', 'is', null)
          .gte('meeting_date', today)
          .lte('meeting_date', addDays(today, 1)),
      ]);
      if (error) return; // e.g. database update not run yet
      dataRef.current = {
        uid: user.id,
        def: prof?.reminder_default_minutes ?? 30,
        meetings: meetings || [],
      };
      check();
    } catch { /* never break the page over a reminder */ }
  }

  function trigger(m, minutesLeft) {
    setAlerts((list) => (list.some((a) => a.id === m.id) ? list : [...list, m]));
    const soundKey = `ace-sounded:${m.id}:${m.meeting_date}:${m.start_time}`;
    if (!storageGet('sessionStorage', soundKey)) {
      storageSet('sessionStorage', soundKey, '1');
      if (getPref('alarm-sound', true)) playChime();
      try { navigator.vibrate?.([400, 150, 400, 150, 800]); } catch { /* ignore */ }
      if (document.visibilityState !== 'visible') showSystemNotification(m, minutesLeft);
    }
  }

  function check() {
    const t = Date.now();
    setNow(t);
    if (!getPref('alarm-popup', true)) return;
    const { def, meetings } = dataRef.current;
    for (const m of meetings) {
      const mins = m.reminder_minutes ?? def;
      if (mins == null || mins < 0) continue;
      const start = meetingStart(m);
      if (!start) continue;
      const fireAt = start.getTime() - mins * 60000;
      if (t < fireAt || t > start.getTime() + SHOW_UNTIL_AFTER_START_MS) continue;
      if (storageGet('localStorage', alertKey(m, mins))) continue;
      if ((snoozeRef.current[m.id] || 0) > t) continue;
      trigger(m, Math.max(0, Math.round((start.getTime() - t) / 60000)));
    }
  }

  function close(m, { markSeen }) {
    if (markSeen && !m.isTest) {
      const mins = m.reminder_minutes ?? dataRef.current.def;
      storageSet('localStorage', alertKey(m, mins), '1');
    }
    setAlerts((list) => list.filter((a) => a.id !== m.id));
  }

  function snooze(m) {
    snoozeRef.current[m.id] = Date.now() + 5 * 60000;
    const soundKey = `ace-sounded:${m.id}:${m.meeting_date}:${m.start_time}`;
    try { window.sessionStorage.removeItem(soundKey); } catch { /* ignore */ }
    close(m, { markSeen: false });
  }

  async function markDone(m) {
    close(m, { markSeen: true });
    if (m.isTest) return;
    await supabase().from('meetings').update({ is_done: true }).eq('id', m.id);
    window.dispatchEvent(new Event('ace-meetings-changed'));
  }

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    load();
    const checkTimer = setInterval(check, CHECK_EVERY_MS);
    const reloadTimer = setInterval(load, RELOAD_EVERY_MS);
    const onChange = () => load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    const onTest = () => {
      const start = new Date(Date.now() + 30 * 60000);
      const hh = String(start.getHours()).padStart(2, '0');
      const mm = String(start.getMinutes()).padStart(2, '0');
      const test = {
        id: `test-${Date.now()}`, isTest: true, title: 'Test reminder — your alarm works',
        meeting_date: todayKey(), start_time: `${hh}:${mm}:00`, venue: 'This is only a test',
      };
      setAlerts((list) => [...list, test]);
      if (getPref('alarm-sound', true)) playChime();
      try { navigator.vibrate?.([400, 150, 400, 150, 800]); } catch { /* ignore */ }
      showSystemNotification(test, 30);
    };
    window.addEventListener('ace-meetings-changed', onChange);
    window.addEventListener('ace-test-alarm', onTest);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(checkTimer);
      clearInterval(reloadTimer);
      window.removeEventListener('ace-meetings-changed', onChange);
      window.removeEventListener('ace-test-alarm', onTest);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="reminder-stack" role="alert" aria-live="assertive">
      {alerts.map((m) => {
        const start = meetingStart(m);
        const minsLeft = start ? Math.round((start.getTime() - now) / 60000) : null;
        const when = minsLeft == null ? '' : minsLeft > 0 ? `Starts in ${minsLeft} min` : minsLeft === 0 ? 'Starting now' : `Started ${-minsLeft} min ago`;
        return (
          <div key={m.id} className="reminder-pop">
            <div className="reminder-bell" aria-hidden="true">🔔</div>
            <div className="reminder-body">
              <div className="reminder-when">{when}</div>
              <div className="reminder-title">{meetingTitle(m)}</div>
              <div className="reminder-meta">
                {formatTime(m.start_time)}
                {m.end_time ? ` – ${formatTime(m.end_time)}` : ''}
                {m.venue ? ` · 📍 ${m.venue}` : ''}
                {m.project?.name ? ` · 📁 ${m.project.name}` : ''}
              </div>
              <div className="reminder-actions">
                <button className="btn btn-primary" onClick={() => { close(m, { markSeen: true }); router.push('/planner'); }}>Open</button>
                <button className="btn btn-ghost" onClick={() => snooze(m)}>Snooze 5 min</button>
                <button className="btn btn-ghost" onClick={() => markDone(m)}>Done</button>
                <button className="reminder-x" aria-label="Dismiss" onClick={() => close(m, { markSeen: true })}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
