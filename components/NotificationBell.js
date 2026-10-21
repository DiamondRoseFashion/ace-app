'use client';

// 🔔 Notification bell with unread count and a drop-down inbox
// (like LinkedIn / Facebook / Slack): All / Unread tabs, grouped by
// day, click to open, mark read/unread, delete one, mark all read,
// delete all.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, markRead, markAllRead, removeOne, removeAll } from '@/lib/notificationsStore';

const KINDS = {
  reminder: { icon: '⏰', cls: 'k-reminder', label: 'Meeting reminder' },
  'meeting-copy': { icon: '⏰', cls: 'k-reminder', label: 'Meeting reminder' },
  'meeting-assigned': { icon: '📅', cls: 'k-meeting', label: 'Meeting' },
  support: { icon: '🛟', cls: 'k-support', label: 'Support' },
  note: { icon: '💬', cls: 'k-note', label: 'Project note' },
  todo: { icon: '✅', cls: 'k-todo', label: 'To-Do' },
  info: { icon: '🔔', cls: 'k-info', label: 'ACE' },
};
const kindOf = (k) => KINDS[k] || KINDS.info;

// "🔔 Site meeting" → "Site meeting" (the icon is shown in the circle)
const cleanTitle = (t) => String(t || '').replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '') || 'Notification';

function ago(ts, now) {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function dayGroup(ts) {
  const d = new Date(ts); const t = new Date();
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(t)) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (key(d) === key(y)) return 'Yesterday';
  const w = new Date(t); w.setDate(t.getDate() - 7);
  return d > w ? 'This week' : 'Earlier';
}

export default function NotificationBell({ variant = 'inline' }) {
  const router = useRouter();
  const { items, unread, loaded, missing } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [ring, setRing] = useState(false);
  const wrapRef = useRef(null);
  const lastUnread = useRef(unread);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
      clearInterval(t);
    };
  }, [open]);
  useEffect(() => { if (!open) setConfirmClear(false); }, [open]);

  // little shake when something new arrives
  useEffect(() => {
    if (unread > lastUnread.current) {
      setRing(true);
      const t = setTimeout(() => setRing(false), 1200);
      lastUnread.current = unread;
      return () => clearTimeout(t);
    }
    lastUnread.current = unread;
    return undefined;
  }, [unread]);

  // unread count in the browser tab title, e.g. "(3) ACE — Project Control"
  useEffect(() => {
    if (variant !== 'bar') return; // only one bell sets it
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
  }, [unread, variant]);

  if (missing) return null; // inbox not set up in the database yet

  const shown = tab === 'unread' ? items.filter((n) => !n.read_at) : items;
  const groups = [];
  for (const n of shown) {
    const g = dayGroup(n.created_at);
    if (!groups.length || groups[groups.length - 1].label !== g) groups.push({ label: g, items: [] });
    groups[groups.length - 1].items.push(n);
  }

  function openItem(n) {
    if (!n.read_at) markRead(n.id);
    setOpen(false);
    if (n.url) router.push(n.url);
  }

  const badge = unread > 99 ? '99+' : unread;

  return (
    <div className={`nb nb-${variant}`} ref={wrapRef}>
      <button
        type="button"
        className={`nb-btn${open ? ' on' : ''}${ring ? ' ring' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7Z" />
        </svg>
        {unread > 0 && <span className="nb-count">{badge}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <strong>Notifications</strong>
            <div className="nb-head-actions">
              <button type="button" className="nb-link" onClick={markAllRead} disabled={!unread}>✓ Mark all as read</button>
              <button type="button" className="nb-link danger" onClick={() => setConfirmClear(true)} disabled={!items.length}>🗑 Delete all</button>
            </div>
          </div>
          {confirmClear && (
            <div className="nb-confirm">
              <span>Delete all {items.length} notifications? This can&apos;t be undone.</span>
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
                <button type="button" className="btn btn-danger" onClick={() => { removeAll(); setConfirmClear(false); }}>Delete all</button>
              </div>
            </div>
          )}
          <div className="nb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>
            <button type="button" role="tab" aria-selected={tab === 'unread'} className={tab === 'unread' ? 'on' : ''} onClick={() => setTab('unread')}>
              Unread {unread > 0 && <span className="nb-tab-count">{badge}</span>}
            </button>
          </div>

          <div className="nb-list">
            {!loaded ? (
              <div className="nb-empty">Loading…</div>
            ) : shown.length === 0 ? (
              <div className="nb-empty">
                <div className="nb-empty-icon">🔔</div>
                <strong>{tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</strong>
                <span>Reminders, new meetings, to-dos, support projects and project notes will show here.</span>
              </div>
            ) : groups.map((g) => (
              <div key={g.label}>
                <div className="nb-group">{g.label}</div>
                {g.items.map((n) => {
                  const k = kindOf(n.kind);
                  return (
                    <div key={n.id} className={`nb-item${n.read_at ? '' : ' unread'}`}>
                      <button type="button" className="nb-item-main" onClick={() => openItem(n)}>
                        <span className={`nb-icon ${k.cls}`} aria-hidden="true">{k.icon}</span>
                        <span className="nb-text">
                          <span className="nb-title">{cleanTitle(n.title)}</span>
                          {n.body && <span className="nb-body">{n.body}</span>}
                          <span className="nb-meta">{k.label} · {ago(n.created_at, now)}</span>
                        </span>
                      </button>
                      <div className="nb-item-actions">
                        <button type="button" onClick={() => markRead(n.id, !n.read_at)} title={n.read_at ? 'Mark as unread' : 'Mark as read'} aria-label={n.read_at ? 'Mark as unread' : 'Mark as read'}>
                          {n.read_at ? '○' : '✓'}
                        </button>
                        <button type="button" onClick={() => removeOne(n.id)} title="Delete" aria-label="Delete notification">✕</button>
                      </div>
                      {!n.read_at && <span className="nb-dot" aria-label="Unread" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {items.length > 0 && <div className="nb-foot">Showing the latest {items.length}. Notifications are kept for 90 days.</div>}
        </div>
      )}
    </div>
  );
}
