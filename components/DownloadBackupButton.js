'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import { MANAGEMENT_ROLES } from '@/lib/dataAccess';

// Everyone gets it: management downloads all projects, employees their own.

export default function DownloadBackupButton() {
  const supabase = createClient();
  const [role, setRole] = useState(null);
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

      if (profile) setRole(profile.role || 'employee');
    };
    checkRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = MANAGEMENT_ROLES.includes(role);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/export-backup', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        alert('Download failed. Please try again.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = all ? 'projects-backup.xlsx' : 'my-projects.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!role) return null;

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
      {loading ? 'Preparing file...' : all ? 'Download Backup (Excel)' : 'Download My Projects (Excel)'}
    </button>
  );
}