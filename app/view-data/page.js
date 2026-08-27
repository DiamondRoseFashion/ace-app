'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];

function DataTable({ rows }) {
  if (!rows || rows.length === 0) {
    return <div style={{ padding: 24, color: 'var(--muted)' }}>No data yet.</div>;
  }
  const columns = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set()));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td key={col} style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                  {row[col] === null || row[col] === undefined || row[col] === '' ? '—' : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ViewData() {
  const router = useRouter();
  const supabase = createClient();

  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('projects');
  const [data, setData] = useState({ projects: [], quotations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    checkAndLoad();
  }, []);

  async function checkAndLoad() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    setAllowed(true);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/view-backup', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!res.ok) {
      setError('Failed to load data.');
      setLoading(false);
      return;
    }

    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main">
        <div className="eyebrow">Live Data</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 24 }}>View Backup Data</h1>

        {loading ? (
          <div className="card">Loading…</div>
        ) : allowed === false ? (
          <div className="card">You are not authorized to view this data.</div>
        ) : error ? (
          <div className="card error-text">{error}</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: 'flex', gap: 4, padding: '16px 20px 0' }}>
              <button
                className={tab === 'projects' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setTab('projects')}
                style={{ fontSize: 12.5 }}
              >
                Projects ({data.projects.length})
              </button>
              <button
                className={tab === 'quotations' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setTab('quotations')}
                style={{ fontSize: 12.5 }}
              >
                Quotations ({data.quotations.length})
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <DataTable rows={tab === 'projects' ? data.projects : data.quotations} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}