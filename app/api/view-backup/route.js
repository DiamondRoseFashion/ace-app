import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildBackupData } from '@/lib/backupData';
import { dataAccess } from '@/lib/dataAccess';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Management: every project. Employees: only their own projects.
export async function GET(request) {
  const access = await dataAccess(supabaseAdmin, request);
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const built = await buildBackupData(supabaseAdmin, { ownerId: access.ownerId });
  if (built.error) return NextResponse.json({ error: built.error }, { status: 500 });

  return NextResponse.json({
    scope: access.ownerId ? 'own' : 'all',
    projects: built.projects, quotations: built.quotations, contacts: built.contacts,
  });
}
