'use client';

// Support: help and contact information for everyone using ACE.
// (Content is added step by step.)
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

export default function Support() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) router.push('/login');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="shell">
      <Sidebar active="support" />
      <div className="main">
        <div className="eyebrow">Help</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 24 }}>Support</h1>

        <div className="card">
          <p style={{ margin: 0, color: 'var(--muted)' }}>Support information will appear here soon.</p>
        </div>
      </div>
    </div>
  );
}
