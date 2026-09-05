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
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  // If someone arrives here via an invite link, the link carries a fresh
  // access token in the URL. We must use THAT token explicitly, rather
  // than trusting whatever session might already be saved in this browser
  // (e.g. if an admin is already logged in on the same device) — otherwise
  // the invited person would see the admin's account instead of their own.
  useEffect(() => {
    checkForInvite();
  }, []);

 async function checkForInvite() {
    // Older-style links: token in the URL hash
    const hash = window.location.hash?.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash);
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');
    const hashType = hashParams.get('type');

    if (access_token && (hashType === 'invite' || hashType === 'recovery' || hashType === 'signup')) {
      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (!error && data?.user) {
        setInvitedEmail(data.user.email);
        window.history.replaceState(null, '', window.location.pathname);
      }
      setCheckingInvite(false);
      return;
    }

    // Newer-style links: a "code" in the regular URL query string
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.user) {
        setInvitedEmail(data.user.email);
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
async function handleForgotPassword(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/login`,
    });

    if (error) setError(error.message);
    else setForgotSent(true);

    setLoading(false);
  }
async function handleResetWithCode(e) {
    e.preventDefault();
    setError('');

    if (resetPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (resetPassword !== resetConfirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: forgotEmail,
      token: resetCode,
      type: 'recovery',
    });

    if (verifyError) { setError(verifyError.message); setLoading(false); return; }

    const { error: pwError } = await supabase.auth.updateUser({ password: resetPassword });
    if (pwError) { setError(pwError.message); setLoading(false); return; }

    setLoading(false);
    router.push('/dashboard');
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) { setError('Please enter your name.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const { error: pwError } = await supabase.auth.updateUser({ password });
    if (pwError) { setError(pwError.message); setLoading(false); return; }

    await supabase.rpc('update_my_name', { new_name: fullName.trim() });

    router.push('/dashboard');
    setLoading(false);
  }

  if (checkingInvite) {
    return <div className="auth-shell" />;
  }

  const Mark = () => (
    <img src="/logo.png" alt="ACE" className="auth-logo" />
  );
  // ---- Invited user: show "set your password" ----
  if (invitedEmail) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <Mark />
          <div className="auth-title">ACE</div>
          <p className="auth-sub">
            Welcome — set a password for <strong>{invitedEmail}</strong>
          </p>

          <form onSubmit={handleSetPassword}>
            <div className="field-group">
              <label>Your name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="e.g. Amal Siby" />
            </div>
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
// ---- Forgot password ----
  if (forgotMode) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <Mark />
          <div className="auth-title">ACE</div>
          <p className="auth-sub">Reset your password</p>

          {forgotSent ? (
            <form onSubmit={handleResetWithCode}>
              <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 12 }}>
                Enter the code sent to <strong>{forgotEmail}</strong>
              </p>
              <div className="field-group">
                <label>Code from email</label>
                <input value={resetCode} onChange={(e) => setResetCode(e.target.value)} required maxLength={8} />
              </div>
              <div className="field-group">
                <label>New password</label>
                <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="field-group">
                <label>Confirm password</label>
                <input type="password" value={resetConfirmPassword} onChange={(e) => setResetConfirmPassword(e.target.value)} required minLength={6} />
              </div>

              {error && <div className="error-text">{error}</div>}

              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
                {loading ? 'Saving…' : 'Reset password'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword}>
              <div className="field-group">
                <label>Email</label>
                <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required />
              </div>

              {error && <div className="error-text">{error}</div>}

              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14, textAlign: 'center' }}>
                <span onClick={() => setForgotMode(false)} style={{ color: 'var(--violet-2)', cursor: 'pointer', fontWeight: 600 }}>
                  ← Back to sign in
                </span>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ---- Normal sign-in ----
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Mark />
        <div className="auth-title">ACE</div>
        <p className="auth-sub">Sign in to your projects</p>

        <form onSubmit={handleSignIn}>
          <div className="field-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
	<p style={{ textAlign: 'right', marginTop: -8, marginBottom: 8 }}>
            <span onClick={() => { setForgotMode(true); setError(''); }} style={{ fontSize: 12.5, color: 'var(--violet-2)', cursor: 'pointer', fontWeight: 600 }}>
              Forgot password?
            </span>
          </p>

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
