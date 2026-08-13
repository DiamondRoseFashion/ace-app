import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];
const ROWS_PER_SHEET = 5000;

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

  const { data: projects, error: projectsError } = await supabaseAdmin
    .from('projects')
    .select('*');

  if (projectsError) {
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();

  if (!projects || projects.length === 0) {
    workbook.addWorksheet('Projects_1');
  } else {
    const allKeys = new Set();
    projects.forEach((p) => Object.keys(p).forEach((k) => allKeys.add(k)));
    const columns = Array.from(allKeys);

    let sheetIndex = 1;
    let sheet = workbook.addWorksheet(`Projects_${sheetIndex}`);
    sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
    sheet.getRow(1).font = { bold: true };

    let rowCountOnSheet = 0;

    projects.forEach((project) => {
      if (rowCountOnSheet >= ROWS_PER_SHEET) {
        sheetIndex += 1;
        sheet = workbook.addWorksheet(`Projects_${sheetIndex}`);
        sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
        sheet.getRow(1).font = { bold: true };
        rowCountOnSheet = 0;
      }
      sheet.addRow(project);
      rowCountOnSheet += 1;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  await supabaseAdmin.storage
    .from('backups')
    .upload('projects-backup.xlsx', buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="projects-backup.xlsx"',
    },
  });
}