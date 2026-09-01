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
  const [menuOpen, setMenuOpen] = useState(false);

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

  const isManagerRole = ['owner', 'admin', 'manager'].includes(role);

  const links = [
    { key: 'dashboard', href: '/dashboard', label: 'My Projects', icon: '📁' },
    { key: 'new-project', href: '/new-project', label: 'New Project', icon: '➕' },
    { key: 'team', href: '/team', label: 'Team & Access', icon: '👥' },
    { key: 'expenses', href: '/expenses', label: isManagerRole ? 'Expenses' : 'My Expenses', icon: '💰' },
    { key: 'profile', href: '/profile', label: 'My Profile', icon: '👤' },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <img src="/logo.png" alt="ACE" className="sidebar-logo" />
        <button
          className="menu-toggle"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      <nav className={`sidebar-nav${menuOpen ? ' mobile-open' : ''}`}>
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={`nav-item${active === l.key ? ' active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            <span aria-hidden="true">{l.icon}</span> {l.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button className={`user-chip${menuOpen ? ' mobile-open' : ''}`} onClick={handleLogout} title="Log out">
        <span className="avatar">{initials}</span>
        <span className="user-chip-text">
          <span className="user-chip-name">{name || '\u00A0'}</span>
          <span className="user-chip-role">{role ? `${role} · Log out` : 'Log out'}</span>
        </span>
      </button>
    </div>
  );
}