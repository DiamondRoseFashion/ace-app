'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];

export default function DownloadBackupButton() {
  const supabase = createClient();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile && ALLOWED_ROLES.includes(profile.role)) {
        setAllowed(true);
      }
    };
    checkRole();
  }, []);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/export-backup', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        alert('You are not authorized to download this backup.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'projects-backup.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!allowed) return null;

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      style={{
        padding: '10px 16px',
        borderRadius: '6px',
        border: 'none',
        background: '#f5860a',
        color: '#fff',
        fontWeight: 600,
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? 'Preparing file...' : 'Download Backup (Excel)'}
    </button>
  );
}