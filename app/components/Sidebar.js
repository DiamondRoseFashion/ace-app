'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';

export default function Sidebar({ active }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('full_name, role').eq('id', user.id).single();
      setName(data?.full_name || user.email);
      setRole(data?.role || '');
    })();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const initials = (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const links = [
    { key: 'dashboard', href: '/dashboard', label: 'My Projects', icon: '📁' },
    { key: 'new-project', href: '/new-project', label: 'New Project', icon: '➕' },
    { key: 'team', href: '/team', label: 'Team & Access', icon: '👥' },
    { key: 'profile', href: '/profile', label: 'My Profile', icon: '👤' },
  ];
  return (
    <div className="sidebar">
      <Link href="/dashboard" className="brand">
        <svg className="facet-mark" viewBox="0 0 100 90" aria-hidden="true">
          <polygon points="50,0 100,30 75,90 25,90 0,30" fill="#C9A6E0" />
          <polygon points="50,0 75,30 25,30" fill="#8F3FA8" />
          <polygon points="0,30 25,30 25,90" fill="#6B2D82" />
          <polygon points="100,30 75,30 75,90" fill="#4A1863" />
          <polygon points="25,30 75,30 75,90 25,90" fill="#7A3592" />
        </svg>
        <div>
          <div className="brand-name">ACE</div>
          <div className="brand-sub">Project Control</div>
        </div>
      </Link>

      <nav className="sidebar-nav">
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={`nav-item${active === l.key ? ' active' : ''}`}
          >
            <span aria-hidden="true">{l.icon}</span> {l.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button className="user-chip" onClick={handleLogout} title="Log out">
        <span className="avatar">{initials}</span>
        <span className="user-chip-text">
          <span className="user-chip-name">{name || '\u00A0'}</span>
          <span className="user-chip-role">{role ? `${role} · Log out` : 'Log out'}</span>
        </span>
      </button>
    </div>
  );
}
