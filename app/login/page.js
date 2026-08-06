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

  // If someone arrives here via an invite link, the link carries a fresh
  // access token in the URL. We must use THAT token explicitly, rather
  // than trusting whatever session might already be saved in this browser
  // (e.g. if an admin is already logged in on the same device) — otherwise
  // the invited person would see the admin's account instead of their own.
  useEffect(() => {
    checkForInvite();
  }, []);

  async function checkForInvite() {
    const hash = window.location.hash?.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const type = params.get('type');

    if (access_token && (type === 'invite' || type === 'recovery' || type === 'signup')) {
      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (!error && data?.user) {
        setInvitedEmail(data.user.email);
        // Clear the token out of the visible URL now that it's been used.
        window.history.replaceState(null, '', window.location.pathname);
      }
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
