'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { fmtDate } from '@/lib/dates';
import MonitorPanel from '@/components/MonitorPanel';

const ROLES = ['owner', 'admin', 'manager', 'employee'];

export default function TeamPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profiles, setProfiles] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [myId, setMyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    setMyRole(me?.role);
    setMyId(user.id);

    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    setProfiles(data || []);
    setLoading(false);
  }

  async function changeRole(p, newRole) {
    setNotice(null);
    const { data, error } = await supabase.from('profiles').update({ role: newRole }).eq('id', p.id).select('id');
    if (error || !data || data.length === 0) {
      setNotice({ ok: false, text: `Couldn't change ${p.full_name || 'this person'}'s role${error ? `: ${error.message.replace('You are not allowed to make this role change', "you don't have permission for that change")}` : ' — you may not have permission.'}` });
    } else {
      setNotice({ ok: true, text: `${p.full_name || 'Role'} is now ${newRole}.` });
    }
    load();
  }

  // Owner & admin: can set any role for anyone else.
  // Manager: can only switch other people between employee and manager.
  // Nobody changes their own role here (so you can't lock yourself out).
  function roleChoices(p) {
    if (!canManage || p.id === myId) return null;
    if (myRole === 'owner' || myRole === 'admin') return ROLES;
    if (myRole === 'manager' && ['manager', 'employee'].includes(p.role)) return ['manager', 'employee'];
    return null;
  }

  const canManage = myRole === 'admin' || myRole === 'manager' || myRole === 'owner';

  return (
    <div className="shell">
      <Sidebar active="team" />
      <div className="main">
        <div className="page-header">
          <div>
            <div className="eyebrow">People</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>Team & Access</h1>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24, marginTop: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Adding someone new</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>
            ACE is invite-only — there's no public sign-up. To add a team member, client, or
            contractor: in Supabase, go to <strong>Authentication → Users → Invite user</strong> and
            enter their email. They'll get a secure link to set their own password. Once they log in
            here for the first time, assign their role below.
          </p>
        </div>

        {notice && <div className={notice.ok ? 'notice ok' : 'notice err'}>{notice.text}</div>}
        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1fr', padding: '13px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', background: '#FBF7FD' }}>
                <div>Name</div><div>Joined</div><div>Role</div>
              </div>
              {profiles.map((p) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1fr', padding: '13px 20px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{p.full_name || '(no name set)'}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDate(p.created_at)}</div>
                  <div>
                    {roleChoices(p) ? (
                      <select value={p.role} onChange={(e) => changeRole(p, e.target.value)} style={{ padding: '6px 8px', fontSize: 13 }} aria-label={`Role for ${p.full_name || 'user'}`}>
                        {roleChoices(p).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13 }}>{p.role}{p.id === myId ? ' (you)' : ''}</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {canManage && <MonitorPanel />}

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
          <strong>Employees</strong> only see projects they created themselves.
          <strong> Owner, admin,</strong> and <strong>manager</strong> can view and review every project.
          Owner and admin can give anyone any role; managers can only switch people between employee and manager.
        </p>
      </div>
    </div>
  );
}
