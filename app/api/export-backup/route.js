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

 const { data: rawProjects, error: projectsError } = await supabaseAdmin
    .from('projects')
    .select('*, creator:profiles!created_by(full_name)');

  if (projectsError) {
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
// Flatten the joined creator name into a plain column, and drop the raw nested object
  const projects = (rawProjects || []).map((p) => {
    const { creator, ...rest } = p;
    return {
      ...rest,
      created_by_name: creator?.full_name || '',
    };
  });

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
const { data: quotations, error: quotationsError } = await supabaseAdmin
    .from('quotations')
    .select('*');

  if (!quotationsError && quotations && quotations.length > 0) {
    const qKeys = new Set();
    quotations.forEach((q) => Object.keys(q).forEach((k) => qKeys.add(k)));
    const qColumns = Array.from(qKeys);

    let qSheetIndex = 1;
    let qSheet = workbook.addWorksheet(`Quotations_${qSheetIndex}`);
    qSheet.columns = qColumns.map((key) => ({ header: key, key, width: 22 }));
    qSheet.getRow(1).font = { bold: true };

    let qRowCount = 0;
    quotations.forEach((q) => {
      if (qRowCount >= ROWS_PER_SHEET) {
        qSheetIndex += 1;
        qSheet = workbook.addWorksheet(`Quotations_${qSheetIndex}`);
        qSheet.columns = qColumns.map((key) => ({ header: key, key, width: 22 }));
        qSheet.getRow(1).font = { bold: true };
        qRowCount = 0;
      }
      qSheet.addRow(q);
      qRowCount += 1;
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