'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

const MANAGEMENT_ROLES = ['owner', 'admin', 'manager'];
const PIE_COLORS = ['#6B2D82', '#8F3FA8', '#D8B968', '#3E8E5A', '#9A7213', '#B33A3A', '#4A1863', '#7A3592', '#C9A6E0', '#5C2570'];

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Builds SVG path data for one pie slice
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = {
    x: cx + r * Math.cos((Math.PI / 180) * (startAngle - 90)),
    y: cy + r * Math.sin((Math.PI / 180) * (startAngle - 90)),
  };
  const end = {
    x: cx + r * Math.cos((Math.PI / 180) * (endAngle - 90)),
    y: cy + r * Math.sin((Math.PI / 180) * (endAngle - 90)),
  };
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function PieChart({ data }) {
  const total = data.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return null;

  let cumulative = 0;
  const slices = data.map(([name, value], idx) => {
    const startAngle = (cumulative / total) * 360;
    cumulative += value;
    const endAngle = (cumulative / total) * 360;
    return {
      name,
      value,
      path: describeArc(100, 100, 90, startAngle, endAngle),
      color: PIE_COLORS[idx % PIE_COLORS.length],
      pct: Math.round((value / total) * 100),
    };
  });

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={200} height={200} viewBox="0 0 200 200">
        {slices.map((s) => (
          <path key={s.name} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1.5} />
        ))}
      </svg>
      <div style={{ flex: 1, minWidth: 180 }}>
        {slices.map((s) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, flex: 1 }}>{s.name}</span>
            <span className="mono" style={{ color: 'var(--muted)' }}>AED {s.value.toLocaleString()} ({s.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ExpensesPage() {
  const router = useRouter();
  const supabase = createClient();

  const [myRole, setMyRole] = useState(null);
  const [myId, setMyId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ employee_id: '', amount: '', expense_date: '', category: '', notes: '' });
  const [selectedMonth, setSelectedMonth] = useState('');

  const isManager = MANAGEMENT_ROLES.includes(myRole);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    setMyId(user.id);

    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    const role = me?.role || null;
    setMyRole(role);

    if (MANAGEMENT_ROLES.includes(role)) {
      const [{ data: profiles }, { data: exp }] = await Promise.all([
        supabase.from('profiles').select('id, full_name').order('full_name'),
        supabase.from('expenses').select('*, employee:profiles!employee_id(full_name)').order('expense_date', { ascending: false }),
      ]);
      setEmployees(profiles || []);
      setExpenses(exp || []);
    } else {
      setForm((f) => ({ ...f, employee_id: user.id }));
      const { data: exp } = await supabase
        .from('expenses')
        .select('*')
        .eq('employee_id', user.id)
        .order('expense_date', { ascending: false });
      setExpenses(exp || []);
    }

    setLoading(false);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!form.employee_id || !form.amount) { setError('Amount is required.'); return; }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('expenses').insert({
      employee_id: form.employee_id,
      amount: Number(form.amount),
      expense_date: form.expense_date || new Date().toISOString().slice(0, 10),
      category: form.category,
      notes: form.notes,
      created_by: user.id,
    });

    if (error) { setError(error.message); setSaving(false); return; }

    setForm((f) => ({ employee_id: isManager ? '' : f.employee_id, amount: '', expense_date: '', category: '', notes: '' }));
    setSaving(false);
    load();
  }

  async function handleDelete(id) {
    await supabase.from('expenses').delete().eq('id', id);
    load();
  }

  const monthlyTotals = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const key = monthKey(e.expense_date);
      map[key] = (map[key] || 0) + Number(e.amount);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  }, [expenses]);

  useEffect(() => {
    if (!selectedMonth && monthlyTotals.length > 0) {
      setSelectedMonth(monthlyTotals[monthlyTotals.length - 1][0]);
    }
  }, [monthlyTotals]);

  const maxMonthTotal = Math.max(1, ...monthlyTotals.map(([, total]) => total));

  const employeeTotalsForMonth = useMemo(() => {
    const map = {};
    expenses
      .filter((e) => monthKey(e.expense_date) === selectedMonth)
      .forEach((e) => {
        const name = e.employee?.full_name || 'Unknown';
        map[name] = (map[name] || 0) + Number(e.amount);
      });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [expenses, selectedMonth]);

  const selectedMonthTotal = employeeTotalsForMonth.reduce((sum, [, v]) => sum + v, 0);

  if (loading) return <div className="shell"><Sidebar active="expenses" /><div className="main">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar active="expenses" />
      <div className="main">
        <div className="eyebrow">Finance</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 24 }}>
          {isManager ? 'Expenses' : 'My Expenses'}
        </h1>

        {/* Add expense form */}
        <div className="card" style={{ marginBottom: 20, maxWidth: 560 }}>
          <form onSubmit={handleAdd}>
            {isManager ? (
              <div className="form-row-2" style={{ marginBottom: 12 }}>
                <div>
                  <label>Employee</label>
                  <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                    <option value="">Select…</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Amount (AED)</label>
                  <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 500" />
                </div>
              </div>
            ) : (
              <div className="field-group">
                <label>Amount (AED)</label>
                <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 500" />
              </div>
            )}
            <div className="form-row-2" style={{ marginBottom: 12 }}>
              <div>
                <label>Date</label>
                <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
              </div>
              <div>
                <label>Category</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Travel, Fuel, Supplies" />
              </div>
            </div>
            <div className="field-group">
              <label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add expense'}</button>
          </form>
        </div>

        {isManager && (
          <>
            {/* Monthly trend */}
            <div className="eyebrow" style={{ marginBottom: 8 }}>Monthly Trend</div>
            <div className="card" style={{ marginBottom: 20 }}>
              {monthlyTotals.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>No expenses recorded yet.</div>
              ) : (
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', height: 160 }}>
                  {monthlyTotals.map(([key, total]) => (
                    <div key={key} onClick={() => setSelectedMonth(key)} style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)', marginBottom: 4 }}>
                        AED {total.toLocaleString()}
                      </div>
                      <div
                        style={{
                          height: `${(total / maxMonthTotal) * 110}px`,
                          background: key === selectedMonth ? 'var(--violet)' : 'var(--lilac)',
                          borderRadius: '6px 6px 0 0',
                          transition: 'height .2s var(--ease), background .2s var(--ease)',
                        }}
                      />
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{monthLabel(key)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pie chart breakdown for selected month */}
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {selectedMonth ? `Breakdown by Employee — ${monthLabel(selectedMonth)}` : 'Breakdown by Employee'}
            </div>
            <div className="card" style={{ marginBottom: 20 }}>
              {employeeTotalsForMonth.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>No expenses for this month.</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>
                    Total: AED {selectedMonthTotal.toLocaleString()}
                  </div>
                  <PieChart data={employeeTotalsForMonth} />
                </>
              )}
            </div>
          </>
        )}

        {/* Entries list */}
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {isManager ? 'Recent Entries' : 'My Recent Entries'}
        </div>
        <div className="card" style={{ padding: 0 }}>
          {expenses.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>No expenses recorded yet.</div>
          ) : (
            expenses.slice(0, 20).map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                <div>
                  {isManager && <strong>{e.employee?.full_name || 'Unknown'}</strong>}
                  <span style={{ color: 'var(--muted)' }}> {isManager ? '· ' : ''}{e.expense_date} {e.category ? `· ${e.category}` : ''}</span>
                  {e.notes && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{e.notes}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="mono" style={{ fontWeight: 700 }}>AED {Number(e.amount).toLocaleString()}</span>
                  {isManager && (
                    <span onClick={() => handleDelete(e.id)} style={{ color: '#B33A3A', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}