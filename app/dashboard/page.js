'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import DownloadBackupButton from '@/components/DownloadBackupButton';
import ViewDataButton from '@/components/ViewDataButton';

export default function Dashboard() {
  const router = useRouter();
  const supabase = createClient();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
      // (Employees only see their own; owner/admin/manager see everyone's.)
      const { data, error } = await supabase
        .from('projects')
        .select('*, creator:profiles!created_by(full_name)')
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

  const STATUS_LABELS = { design: 'Design', tender: 'Tender', job_in_hand: 'Job in Hand' };

  const filteredProjects = projects.filter((p) => {
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name?.toLowerCase().includes(q) ||
      p.location?.toLowerCase().includes(q) ||
      p.creator?.full_name?.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main">
        <div className="page-header">
          <div>
            <div className="eyebrow">Overview</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>My Projects</h1>
          </div>
          <div className="header-actions">
	    <ViewDataButton />
            <DownloadBackupButton />
            <Link href="/new-project"><button className="btn btn-primary">+ New Project</button></Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search by name, location, or creator…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 260px', minWidth: 0 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All statuses</option>
            <option value="design">Design</option>
            <option value="tender">Tender</option>
            <option value="job_in_hand">Job in Hand</option>
          </select>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>
              No projects yet. Click "New Project" to add your first one.
            </div>
          ) : filteredProjects.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>
              No projects match your search.
            </div>
          ) : (
            filteredProjects.map((p) => (
              <Link href={`/project/${p.id}`} key={p.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="project-row" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div><span className={`pill pill-${p.status}`}>{STATUS_LABELS[p.status] || p.status}</span></div>
                  <div className="mono" style={{ fontSize: 13 }}>{p.percent_complete}%</div>
                  <div>{p.location}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{p.creator?.full_name || '—'}</div>
                </div>
              </Link>
            ))
          )}
        </div>
        {!loading && projects.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            Showing {filteredProjects.length} of {projects.length} projects
          </div>
        )}
      </div>
    </div>
  );
}
