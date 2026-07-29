'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';

const ROLES = ['admin', 'manager', 'employee', 'client', 'contractor'];

export default function TeamPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profiles, setProfiles] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [siteUrl, setSiteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSiteUrl(window.location.origin);
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

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [inviteError, setInviteError] = useState('');

  async function sendInviteEmail() {
    if (!inviteEmail.trim()) return;
    setInviteStatus('sending'); setInviteError('');

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), token: session?.access_token }),
    });
    const result = await res.json();

    if (res.ok) {
      setInviteStatus('sent');
      setInviteEmail('');
    } else {
      setInviteStatus('error');
      setInviteError(result.error || 'Something went wrong');
    }
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(`${siteUrl}/login`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canManage = myRole === 'admin' || myRole === 'manager';

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
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Invite someone</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            Send an email invite, or share the link directly. Anyone who signs up
            starts as "employee" until you assign them a role below.
          </p>

          <div className="form-row-2" style={{ marginBottom: 10 }}>
            <input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <button className="btn btn-primary" onClick={sendInviteEmail} disabled={inviteStatus === 'sending' || !inviteEmail.trim()}>
              {inviteStatus === 'sending' ? 'Sending…' : 'Send email invite'}
            </button>
          </div>
          {inviteStatus === 'sent' && <div style={{ fontSize: 12.5, color: 'var(--ok)', marginBottom: 10 }}>Invite sent!</div>}
          {inviteStatus === 'error' && <div className="error-text" style={{ marginBottom: 10 }}>{inviteError}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <input readOnly value={`${siteUrl}/login`} style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={copyInviteLink}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
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
          <strong>client</strong> and <strong>contractor</strong> roles only see projects they've been
          assigned to as the project owner — set that from a project's detail page.
        </p>
      </div>
    </div>
  );
}
