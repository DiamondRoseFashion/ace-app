'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import MeetingReminder from '@/components/MeetingReminder';
import AutoUpdate from '@/components/AutoUpdate';
import { releasePush } from '@/lib/pushClient';
import { useSupportAlerts, useMeetingAlerts } from '@/lib/supportAlerts';
import PushPrompt from '@/components/PushPrompt';
import NotificationBell from '@/components/NotificationBell';
import { resetNotifications } from '@/lib/notificationsStore';

export default function Sidebar({ active, bell = true }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [photo, setPhoto] = useState('');
  const [photoBroken, setPhotoBroken] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [todoOn, setTodoOn] = useState(false);
  const [todoDue, setTodoDue] = useState(0);
  const support = useSupportAlerts(supabase);
  const meetingsNew = useMeetingAlerts(supabase);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('full_name, role, avatar_url').eq('id', user.id).single();
      setName(data?.full_name || user.email);
      setRole(data?.role || '');
      setPhoto(data?.avatar_url || '');
      // To-Do: only for people given access; badge = my open to-dos due today or overdue
      const { data: todoOk } = await supabase.rpc('has_todo_access');
      if (todoOk) {
        setTodoOn(true);
        const t = new Date();
        const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        const { count } = await supabase.from('todos').select('id', { count: 'exact', head: true })
          .eq('assigned_to', user.id).is('done_at', null).lte('due_date', today);
        setTodoDue(count || 0);
      }
    })();
    // a new photo on My Profile shows here straight away
    const onPhoto = (e) => { setPhotoBroken(false); setPhoto(e.detail || ''); };
    window.addEventListener('ace-avatar', onPhoto);
    const onTodo = (e) => setTodoDue(Number(e.detail) || 0);
    window.addEventListener('ace-todo-due', onTodo);
    return () => { window.removeEventListener('ace-avatar', onPhoto); window.removeEventListener('ace-todo-due', onTodo); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await releasePush(supabase); // this device stops getting my reminders
    await supabase.auth.signOut();
    resetNotifications();
    router.push('/login');
  }

  const initials = (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isManagerRole = ['owner', 'admin', 'manager'].includes(role);

  const links = [
    { key: 'dashboard', href: '/dashboard', label: 'My Projects', icon: '📁' },
    { key: 'new-project', href: '/new-project', label: 'New Project', icon: '➕' },
    { key: 'planner', href: '/planner', label: 'Meetings', icon: '📅' },
    ...(todoOn ? [{ key: 'todo', href: '/todo', label: 'To-Do', icon: '✅' }] : []), // only people given To-Do access
    ...(isManagerRole ? [{ key: 'team', href: '/team', label: 'Team & Access', icon: '👥' }] : []), // management only
    { key: 'profile', href: '/profile', label: 'My Profile', icon: '👤' },
    { key: 'support', href: '/support', label: 'Support', icon: '🛟' },
  ];

  const t = support.toast;
  return (
    <>
    {active !== 'planner' && <PushPrompt supabase={supabase} floating />}
    {meetingsNew.toast && (
      <div className="support-toast meeting-toast" role="status">
        <div className="st-icon" aria-hidden="true">📅</div>
        <div className="st-text">
          <strong>{meetingsNew.toast.count ? `${meetingsNew.toast.count} new meetings for you` : `New meeting from ${meetingsNew.toast.assigned_by || 'your manager'}`}</strong>
          {!meetingsNew.toast.count && (
            <span>
              {meetingsNew.toast.title || 'Meeting'}
              {meetingsNew.toast.meeting_date ? ` · ${meetingsNew.toast.meeting_date.split('-').reverse().join('/')}` : ''}
              {meetingsNew.toast.start_time ? `, ${(() => { const [h, mi] = meetingsNew.toast.start_time.split(':').map(Number); return `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; })()}` : ''}
            </span>
          )}
        </div>
        <Link href="/planner" className="btn btn-primary st-open" onClick={meetingsNew.closeToast}>Open</Link>
        <button type="button" className="st-close" aria-label="Close" onClick={meetingsNew.closeToast}>✕</button>
      </div>
    )}
    {t && (
      <div className="support-toast" role="status">
        <div className="st-icon" aria-hidden="true">🛟</div>
        <div className="st-text">
          <strong>{t.count ? `${t.count} new projects to support` : 'New project to support'}</strong>
          {!t.count && <span>From {t.sales_person || t.assigned_by || 'a salesperson'}: {t.project_name}</span>}
        </div>
        <Link href="/support" className="btn btn-primary st-open" onClick={support.closeToast}>Open</Link>
        <button type="button" className="st-close" aria-label="Close" onClick={support.closeToast}>✕</button>
      </div>
    )}
    {bell && <NotificationBell variant="float" />}
    <div className="sidebar">
      <MeetingReminder />
      <AutoUpdate />
      <div className="sidebar-top">
        <img src="/logo.png" alt="ACE" className="sidebar-logo" />
        <img src="/icon-192.png" alt="" aria-hidden="true" className="sidebar-mark" />
        <NotificationBell variant="bar" />
        <button
          className="menu-toggle"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      <nav className={`sidebar-nav${menuOpen ? ' mobile-open' : ''}`}>
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={`nav-item${active === l.key ? ' active' : ''}`}
            title={l.label}
            onClick={() => setMenuOpen(false)}
          >
            <span className="nav-icon" aria-hidden="true">{l.icon}</span>
            <span className="nav-label">{l.label}</span>
            {l.key === 'support' && support.count > 0 && (
              <span className="nav-badge" aria-label={`${support.count} new`}>{support.count > 9 ? '9+' : support.count}</span>
            )}
            {l.key === 'todo' && todoDue > 0 && (
              <span className="nav-badge" aria-label={`${todoDue} due`}>{todoDue > 9 ? '9+' : todoDue}</span>
            )}
            {l.key === 'planner' && meetingsNew.count > 0 && (
              <span className="nav-badge" aria-label={`${meetingsNew.count} new`}>{meetingsNew.count > 9 ? '9+' : meetingsNew.count}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button className={`user-chip${menuOpen ? ' mobile-open' : ''}`} onClick={handleLogout} title="Log out">
        {photo && !photoBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar avatar-img" src={photo} alt="" onError={() => setPhotoBroken(true)} />
        ) : (
          <span className="avatar">{initials}</span>
        )}
        <span className="user-chip-text">
          <span className="user-chip-name">{name || '\u00A0'}</span>
          <span className="user-chip-role">{role ? `${role} · Log out` : 'Log out'}</span>
        </span>
      </button>
    </div>
    </>
  );
}