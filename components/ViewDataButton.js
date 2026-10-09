'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';
import { MANAGEMENT_ROLES } from '@/lib/dataAccess';

// Everyone gets it: management sees all projects, employees their own.
export default function ViewDataButton() {
  const supabase = createClient();
  const [role, setRole] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile) setRole(profile.role || 'employee');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!role) return null;
  return (
    <Link href="/view-data">
      <button className="btn btn-ghost">{MANAGEMENT_ROLES.includes(role) ? 'View Data' : 'View My Data'}</button>
    </Link>
  );
}
