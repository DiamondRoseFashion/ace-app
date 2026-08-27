'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];

export default function ViewDataButton() {
  const supabase = createClient();
  const [allowed, setAllowed] = useState(false);

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

  if (!allowed) return null;

  return (
    <Link href="/view-data">
      <button className="btn btn-ghost">View Data</button>
    </Link>
  );
}