import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];
const ID_LIKE_KEYS = new Set(['id', 'project_id']);

function stripIds(row) {
  const cleaned = {};
  for (const [key, value] of Object.entries(row)) {
    if (ID_LIKE_KEYS.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { data: rawProjects, error: projectsError } = await supabaseAdmin
    .from('projects')
    .select('*, creator:profiles!created_by(full_name)');

  if (projectsError) {
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }

  const { data: rawQuotations, error: quotationsError } = await supabaseAdmin
    .from('quotations')
    .select('*');

  const quotations = quotationsError ? [] : (rawQuotations || []);

  const latestQuotationByProject = {};
  quotations.forEach((q) => {
    const existing = latestQuotationByProject[q.project_id];
    if (!existing || new Date(q.created_at) > new Date(existing.created_at)) {
      latestQuotationByProject[q.project_id] = q;
    }
  });

  const projects = (rawProjects || []).map((p) => {
    const { creator, created_by, ...rest } = p;

    const matchedQuotation = latestQuotationByProject[p.id];
    let quotationFields = {};
    if (matchedQuotation) {
      const { id, project_id, created_at, quotation_number, ...qRest } = matchedQuotation;
      quotationFields = {
        quotation_id: quotation_number || '',
        quotation_number,
        ...qRest,
        quotation_created_at: created_at,
      };
    }

    return stripIds({
      ...rest,
      created_by: creator?.full_name || '',
      ...quotationFields,
    });
  });

  const quotationRows = quotations.map((q) => {
    const { created_by, ...rest } = q;
    return stripIds(rest);
  });

  return NextResponse.json({ projects, quotations: quotationRows });
}