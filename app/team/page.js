'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';

const ROLES = ['owner', 'admin', 'manager', 'employee'];

export default function TeamPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profiles, setProfiles] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    setMyRole(me?.role);

    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    setProfiles(data || []);
    setLoading(false);
  }

  async function changeRole(id, newRole) {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    if (!error) load();
    else alert('Could not update role: ' + error.message);
  }

  const canManage = myRole === 'admin' || myRole === 'manager' || myRole === 'owner';

  return (
    <div className="shell">
      <div className="main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--violet-2)', fontWeight: 600 }}>
              People
            </div>
            <h1 style={{ fontSize: 28 }}>Team & Access</h1>
          </div>
          <Link href="/dashboard"><button className="btn btn-ghost">← Back to Projects</button></Link>
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
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{new Date(p.created_at).toLocaleDateString()}</div>
                  <div>
                    {canManage ? (
                      <select value={p.role} onChange={(e) => changeRole(p.id, e.target.value)} style={{ padding: '6px 8px', fontSize: 13 }}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13 }}>{p.role}</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
          <strong>Employees</strong> only see projects they created themselves.
          <strong> Owner, admin,</strong> and <strong>manager</strong> can view and review every project.
        </p>
      </div>
    </div>
  );
}
