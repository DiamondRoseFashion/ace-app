'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

export default function MyProfile() {
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    setUserId(user.id);
    setEmail(user.email);

    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, phone, designation, avatar_url')
      .eq('id', user.id)
      .single();

    if (!error && data) {
      setFullName(data.full_name || '');
      setPhone(data.phone || '');
      setDesignation(data.designation || '');
      setAvatarUrl(data.avatar_url || '');
    }
    setLoading(false);
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setError('');
    setUploading(true);

    const ext = file.name.split('.').pop();
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
    // Cache-bust so the new picture shows immediately instead of a stale cached one
    const freshUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: freshUrl })
      .eq('id', userId);

    if (updateError) {
      setError(updateError.message);
    } else {
      setAvatarUrl(freshUrl);
    }
    setUploading(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        designation: designation.trim(),
      })
      .eq('id', userId);

    if (error) {
      setError(error.message);
    } else {
      setSuccess('Profile updated.');
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="shell">
        <Sidebar active="profile" />
        <div className="main" />
      </div>
    );
  }

  const initials = (fullName || email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="shell">
      <Sidebar active="profile" />
      <div className="main">
        <div className="eyebrow">Account</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 24 }}>My Profile</h1>

        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 28 }}>
            <div style={{ position: 'relative' }}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)' }}
                />
              ) : (
                <div
                  style={{
                    width: 84, height: 84, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--violet-2), var(--gold))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, fontWeight: 700, color: '#2A0C3B',
                  }}
                >
                  {initials}
                </div>
              )}
            </div>
            <div>
              <label
                htmlFor="avatar-upload"
                className="btn btn-ghost"
                style={{ display: 'inline-block', cursor: 'pointer' }}
              >
                {uploading ? 'Uploading…' : 'Change photo'}
              </label>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                disabled={uploading}
                style={{ display: 'none' }}
              />
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>JPG or PNG, up to a few MB</p>
            </div>
          </div>

          <form onSubmit={handleSave}>
            <div className="field-group">
              <label>Email</label>
              <input value={email} disabled style={{ opacity: 0.65, cursor: 'not-allowed' }} />
            </div>
            <div className="field-group">
              <label>Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Amal Siby" />
            </div>
            <div className="field-group">
              <label>Job title</label>
              <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Site Engineer" />
            </div>
            <div className="field-group">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 050 123 4567" />
            </div>

            {error && <div className="error-text">{error}</div>}
            {success && <div style={{ color: 'var(--ok)', fontSize: 12.5, marginTop: 8 }}>{success}</div>}

            <button className="btn btn-primary" disabled={saving} style={{ marginTop: 8 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}