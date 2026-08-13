'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/new-project', label: 'New Project' },
  { href: '/team', label: 'Team' },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <aside
      style={{
        width: '220px',
        minHeight: '100vh',
        background: '#0d1b3e',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
      }}
    >
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <Image
          src="/logo.png"
          alt="ACE - Project Management Application"
          width={160}
          height={80}
          style={{ width: '100%', height: 'auto' }}
          priority
        />
      </div>

      <nav style={{ flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                padding: '10px 12px',
                marginBottom: '6px',
                borderRadius: '6px',
                textDecoration: 'none',
                color: '#fff',
                background: isActive ? '#f5860a' : 'transparent',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={handleLogout}
        style={{
          padding: '10px 12px',
          borderRadius: '6px',
          border: 'none',
          background: '#1e2f5c',
          color: '#fff',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Log out
      </button>
    </aside>
  );
}