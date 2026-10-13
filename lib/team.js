'use client';
// Everyone with an ACE account (name + id), for "Supported By".
import { useEffect, useState } from 'react';

export function useTeam(supabase) {
  const [team, setTeam] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role').order('full_name');
      if (alive) setTeam((data || []).map((p) => ({ id: p.id, name: (p.full_name || '').trim() || 'Unnamed', role: p.role })));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return team;
}

export const teamName = (team, id) => team.find((t) => t.id === id)?.name || 'Someone';
