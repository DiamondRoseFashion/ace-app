import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildBackupWorkbook } from '@/lib/backupWorkbook';
import { dataAccess } from '@/lib/dataAccess';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Management: every project. Employees: only their own projects.
export async function GET(request) {
  const access = await dataAccess(supabaseAdmin, request);
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const built = await buildBackupWorkbook(supabaseAdmin, { ownerId: access.ownerId });
  if (built.error) return NextResponse.json({ error: built.error }, { status: 500 });
  const { buffer } = built;

  let filename = 'projects-backup.xlsx';
  if (access.ownerId) {
    filename = 'my-projects.xlsx'; // employee copy: never saved to the company backups
  } else {
    await supabaseAdmin.storage.from('backups').upload('projects-backup.xlsx', buffer, { contentType: XLSX, upsert: true });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${filename}"` },
  });
}
