'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';

export default function Dashboard() {
  const router = useRouter();
  const supabase = createClient();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setUserEmail(user.email);

      // Row-Level Security automatically limits this to
      // whatever rows this signed-in user is allowed to see.
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error) setProjects(data);
      setLoading(false);
    }
    load();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="shell">
      <div className="main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--violet-2)', fontWeight: 600 }}>
              Overview
            </div>
            <h1 style={{ fontSize: 28 }}>My Projects</h1>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{userEmail}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/team"><button className="btn btn-ghost">Team</button></Link>
            <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
            <Link href="/new-project"><button className="btn btn-primary">+ New Project</button></Link>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>
              No projects yet. Click "New Project" to add your first one.
            </div>
          ) : (
            projects.map((p) => (
              <Link href={`/project/${p.id}`} key={p.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2.4fr 1fr 1fr 1fr',
                    padding: '15px 20px',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div>{p.status}</div>
                  <div>{p.percent_complete}%</div>
                  <div>{p.location}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
