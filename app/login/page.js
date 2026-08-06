'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checkingInvite, setCheckingInvite] = useState(true);
  const [invitedEmail, setInvitedEmail] = useState(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If someone arrives here via an invite link, Supabase automatically
  // signs them into a temporary session so they can set a password.
  // Detect that case and show the "set password" form instead of sign-in.
  useEffect(() => {
    checkForInvite();
  }, []);

  async function checkForInvite() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setInvitedEmail(session.user.email);
    }
    setCheckingInvite(false);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else router.push('/dashboard');

    setLoading(false);
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setError('');

    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else router.push('/dashboard');
    setLoading(false);
  }

  if (checkingInvite) {
    return <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }} />;
  }

  // ---- Invited user: show "set your password" ----
  if (invitedEmail) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: 380 }}>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>ACE</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
            Welcome — set a password for <strong>{invitedEmail}</strong>
          </p>

          <form onSubmit={handleSetPassword}>
            <div className="field-group">
              <label>New password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="field-group">
              <label>Confirm password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
            </div>

            {error && <div className="error-text">{error}</div>}

            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Saving…' : 'Set password & continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Normal sign-in ----
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 380 }}>
        <h1 style={{ fontSize: 26, marginBottom: 4 }}>ACE</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
          Sign in to your projects
        </p>

        <form onSubmit={handleSignIn}>
          <div className="field-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
            {loading ? 'Please wait…' : 'Sign in'}
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 18, textAlign: 'center' }}>
          Need access? Ask your admin to invite you.
        </p>
      </div>
    </div>
  );
}
