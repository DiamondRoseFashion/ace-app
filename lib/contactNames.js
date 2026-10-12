'use client';
// Company / Name suggestions, one list per contact section (contractor,
// client, consultant, main_contractor), filled by the database from every
// saved contact. Loaded once per page.
import { useEffect, useState } from 'react';

export function useContactNames(supabase) {
  const [list, setList] = useState({ companies: [], people: [] });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('contact_names').select('*') // '*' keeps working before/after the per-section database update.limit(5000);
      if (!alive || error || !data) return; // list not set up yet: plain typing still works
      const sort = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
      setList({
        companies: data.filter((r) => r.kind === 'company').map((r) => ({ name: r.name, role: r.role || '' }))
          .sort((a, b) => sort(a.name, b.name)),
        people: data.filter((r) => r.kind === 'person').map((r) => ({ name: r.name, company: r.company, role: r.role || '' }))
          .sort((a, b) => sort(a.name, b.name)),
      });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return list;
}

const norm = (s) => String(s || '').trim().toLowerCase();

// a row belongs to this section (rows saved before sections existed show everywhere)
const inRole = (row, role) => !row.role || row.role === role;

// Company suggestions for one section, plus anything typed in that section.
export function companyOptions(list, role, typedHere = []) {
  const seen = new Map();
  [...list.companies.filter((c) => inRole(c, role)).map((c) => c.name), ...typedHere].forEach((c) => { if (norm(c)) seen.set(norm(c), String(c).trim()); });
  return [...seen.values()];
}

// Name suggestions: people from the chosen company first, then everyone else.
export function personOptions(list, role, company, typedHere = []) {
  const co = norm(company);
  const first = new Map(); const rest = new Map();
  list.people.filter((p) => inRole(p, role)).forEach((p) => {
    const key = norm(p.name);
    if (!key) return;
    if (co && norm(p.company) === co) first.set(key, p.name);
    else if (!first.has(key)) rest.set(key, p.name);
  });
  typedHere.forEach((n) => { if (norm(n) && !first.has(norm(n))) rest.set(norm(n), String(n).trim()); });
  first.forEach((_, k) => rest.delete(k));
  return { first: [...first.values()], rest: [...rest.values()] };
}
