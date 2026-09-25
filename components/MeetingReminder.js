'use client';

// Alarm-style meeting reminder. Mounted in the sidebar, so it runs
// on every ACE page while the app is open (phone or computer).
// Shows a floating pop-up, rings a looping alarm and vibrates until
// the person stops it (Stop / Snooze / Done / Open), and, if the
// person allowed it, shows a system notification.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import {
  todayKey, addDays, parseKey, meetingStart, meetingTitle, formatTime, getPref,
  DEFAULT_REMINDER, ANYTIME_REMINDER_HOUR,
} from '@/lib/planner';

const CHECK_EVERY_MS = 15 * 1000;
const RELOAD_EVERY_MS = 2 * 60 * 1000;
const SHOW_UNTIL_AFTER_START_MS = 10 * 60 * 1000;
const VIBRATE_PATTERN = [600, 250, 600, 250, 600];

function storageGet(store, key) {
  try { return window[store].getItem(key); } catch { return null; }
}
function storageSet(store, key, value) {
  try { window[store].setItem(key, value); } catch { /* ignore */ }
}

// ---------- looping alarm sound ----------
// One shared audio context for the whole app. Browsers only allow
// sound after the person has tapped/clicked the page once, so we
// unlock it on the first interaction.
let audioCtx = null;
let alarmSource = null;
let alarmBuffer = null;
let wantAlarm = false;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

// A 2.4-second phrase: two rising three-note chimes, then a short
// pause; played on loop it sounds like a phone alarm.
function buildAlarmBuffer(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.4);
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const notes = [880, 1175, 1568];
  [0, 0.75].forEach((phraseStart) => {
    notes.forEach((freq, i) => {
      const start = Math.floor((phraseStart + i * 0.16) * sr);
      const dur = Math.floor(0.45 * sr);
      for (let n = 0; n < dur && start + n < len; n++) {
        const t = n / sr;
        const env = Math.min(1, t / 0.01) * Math.exp(-t * 7);
        data[start + n] += 0.32 * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t));
      }
    });
  });
  return buf;
}

function startAlarmSound() {
  wantAlarm = true;
  const ctx = getCtx();
  if (!ctx || alarmSource) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    if (!alarmBuffer) alarmBuffer = buildAlarmBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = alarmBuffer;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
    alarmSource = src;
  } catch { /* ignore */ }
}

function stopAlarmSound() {
  wantAlarm = false;
  try { alarmSource?.stop(); } catch { /* ignore */ }
  alarmSource = null;
  try { navigator.vibrate?.(0); } catch { /* ignore */ }
}

function unlockAudio() {
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(() => { if (wantAlarm && !alarmSource) startAlarmSound(); }).catch(() => {});
  }
}

async function showSystemNotification(m, whenText) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const body = `${whenText}${m.start_time ? ` · ${formatTime(m.start_time)}` : ''}${m.venue ? ` · ${m.venue}` : ''}`;
    const opts = {
      body, icon: '/icon-192.png', badge: '/icon-192.png', tag: `meeting-${m.id}`,
      requireInteraction: true, renotify: true, vibrate: VIBRATE_PATTERN, data: { url: '/planner' },
    };
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(`🔔 ${meetingTitle(m)}`, opts); return; }
    }
    new Notification(`🔔 ${meetingTitle(m)}`, opts);
  } catch { /* ignore */ }
}

// When should this meeting's reminder go off? null = never.
function reminderTimes(m, def) {
  const mins = m.reminder_minutes ?? def ?? DEFAULT_REMINDER;
  if (mins < 0) return null;
  const start = meetingStart(m);
  if (start) {
    return { mins, fireAt: start.getTime() - mins * 60000, until: start.getTime() + SHOW_UNTIL_AFTER_START_MS };
  }
  // no start time: ring in the morning of that day, show until end of day
  const day = parseKey(m.meeting_date);
  const fire = new Date(day); fire.setHours(ANYTIME_REMINDER_HOUR, 0, 0, 0);
  const end = new Date(day); end.setHours(23, 59, 59, 999);
  return { mins: 'anytime', fireAt: fire.getTime(), until: end.getTime() };
}

function alertKey(m, mins) {
  return `ace-alarm:${m.id}:${m.meeting_date}:${m.start_time || 'anytime'}:${mins}`;
}

function whenLabel(m, now) {
  const start = meetingStart(m);
  if (!start) return m.meeting_date === todayKey() ? 'Today · no set time' : 'Coming up';
  const minsLeft = Math.round((start.getTime() - now) / 60000);
  if (minsLeft >= 60) {
    const h = Math.floor(minsLeft / 60);
    const r = minsLeft % 60;
    return `Starts in ${h} hr${r ? ` ${r} min` : ''}`;
  }
  if (minsLeft > 0) return `Starts in ${minsLeft} min`;
  if (minsLeft === 0) return 'Starting now';
  return `Started ${-minsLeft} min ago`;
}

export default function MeetingReminder() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  const dataRef = useRef({ uid: null, def: DEFAULT_REMINDER, meetings: [] });
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
          .gte('meeting_date', today)
          .lte('meeting_date', addDays(today, 1)),
      ]);
      if (error) return; // e.g. database update not run yet
      dataRef.current = {
        uid: user.id,
        def: prof?.reminder_default_minutes ?? DEFAULT_REMINDER,
        meetings: meetings || [],
      };
      check();
    } catch { /* never break the page over a reminder */ }
  }

  function trigger(m) {
    setAlerts((list) => (list.some((a) => a.id === m.id) ? list : [...list, m]));
    const notifiedKey = `ace-notified:${m.id}:${m.meeting_date}:${m.start_time || 'anytime'}`;
    if (!storageGet('sessionStorage', notifiedKey)) {
      storageSet('sessionStorage', notifiedKey, '1');
      if (document.visibilityState !== 'visible') showSystemNotification(m, whenLabel(m, Date.now()));
    }
  }

  function check() {
    const t = Date.now();
    setNow(t);
    if (!getPref('alarm-popup', true)) return;
    const { def, meetings } = dataRef.current;
    for (const m of meetings) {
      const r = reminderTimes(m, def);
      if (!r) continue;
      if (t < r.fireAt || t > r.until) continue;
      if (storageGet('localStorage', alertKey(m, r.mins))) continue;
      if ((snoozeRef.current[m.id] || 0) > t) continue;
      trigger(m);
    }
  }

  function close(m, { markSeen }) {
    if (markSeen && !m.isTest) {
      const r = reminderTimes(m, dataRef.current.def);
      if (r) storageSet('localStorage', alertKey(m, r.mins), '1');
    }
    setAlerts((list) => list.filter((a) => a.id !== m.id));
  }

  function snooze(m) {
    snoozeRef.current[m.id] = Date.now() + 5 * 60000;
    try { window.sessionStorage.removeItem(`ace-notified:${m.id}:${m.meeting_date}:${m.start_time || 'anytime'}`); } catch { /* ignore */ }
    close(m, { markSeen: false });
  }

  async function markDone(m) {
    close(m, { markSeen: true });
    if (m.isTest) return;
    await supabase().from('meetings').update({ is_done: true }).eq('id', m.id);
    window.dispatchEvent(new Event('ace-meetings-changed'));
  }

  // Ring (and vibrate) for as long as any reminder is on screen
  useEffect(() => {
    if (alerts.length === 0) { stopAlarmSound(); return undefined; }
    if (!getPref('alarm-sound', true)) return undefined;
    startAlarmSound();
    const vib = () => { try { navigator.vibrate?.(VIBRATE_PATTERN); } catch { /* ignore */ } };
    vib();
    const timer = setInterval(vib, 3000);
    return () => clearInterval(timer);
  }, [alerts.length]);

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
      unlockAudio();
      const start = new Date(Date.now() + 60 * 60000);
      const hh = String(start.getHours()).padStart(2, '0');
      const mm = String(start.getMinutes()).padStart(2, '0');
      const test = {
        id: `test-${Date.now()}`, isTest: true, title: 'Test reminder — your alarm works',
        meeting_date: todayKey(), start_time: `${hh}:${mm}:00`, venue: 'Press Stop to silence it',
      };
      setAlerts((list) => [...list, test]);
      showSystemNotification(test, 'This is a test');
    };
    const unlockEvents = ['pointerdown', 'keydown', 'touchstart'];
    unlockEvents.forEach((e) => window.addEventListener(e, unlockAudio, { passive: true }));
    window.addEventListener('ace-meetings-changed', onChange);
    window.addEventListener('ace-test-alarm', onTest);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(checkTimer);
      clearInterval(reloadTimer);
      unlockEvents.forEach((e) => window.removeEventListener(e, unlockAudio));
      window.removeEventListener('ace-meetings-changed', onChange);
      window.removeEventListener('ace-test-alarm', onTest);
      document.removeEventListener('visibilitychange', onVisible);
      stopAlarmSound(); // the next page's sidebar picks the alarm back up
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="reminder-stack" role="alert" aria-live="assertive">
      {alerts.map((m) => (
        <div key={m.id} className="reminder-pop">
          <div className="reminder-bell" aria-hidden="true">🔔</div>
          <div className="reminder-body">
            <div className="reminder-when">{whenLabel(m, now)}</div>
            <div className="reminder-title">{meetingTitle(m)}</div>
            <div className="reminder-meta">
              {m.start_time ? formatTime(m.start_time) : 'Anytime'}
              {m.end_time ? ` – ${formatTime(m.end_time)}` : ''}
              {m.venue ? ` · 📍 ${m.venue}` : ''}
              {m.project?.name ? ` · 📁 ${m.project.name}` : ''}
            </div>
            <div className="reminder-actions">
              <button className="btn btn-stop" onClick={() => close(m, { markSeen: true })}>🔕 Stop</button>
              <button className="btn btn-ghost" onClick={() => snooze(m)}>Snooze 5 min</button>
              <button className="btn btn-ghost" onClick={() => markDone(m)}>Done</button>
              <button className="btn btn-ghost" onClick={() => { close(m, { markSeen: true }); router.push('/planner'); }}>Open</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
