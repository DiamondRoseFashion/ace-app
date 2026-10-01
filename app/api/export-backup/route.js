import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { buildBackupData } from '@/lib/backupData';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];
const ROWS_PER_SHEET = 5000;

function addDynamicSheet(workbook, baseName, rows) {
  if (!rows || rows.length === 0) {
    workbook.addWorksheet(`${baseName}_1`);
    return;
  }

  const allKeys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const columns = Array.from(allKeys);

  let sheetIndex = 1;
  let sheet = workbook.addWorksheet(`${baseName}_${sheetIndex}`);
  sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  let rowCount = 0;
  rows.forEach((row) => {
    if (rowCount >= ROWS_PER_SHEET) {
      sheetIndex += 1;
      sheet = workbook.addWorksheet(`${baseName}_${sheetIndex}`);
      sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
      sheet.getRow(1).font = { bold: true };
      rowCount = 0;
    }
    sheet.addRow(row);
    rowCount += 1;
  });
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

  const built = await buildBackupData(supabaseAdmin);
  if (built.error) {
    return NextResponse.json({ error: built.error }, { status: 500 });
  }
  const { projects, quotations: quotationRows, contacts: contactRows } = built;

  const workbook = new ExcelJS.Workbook();

  addDynamicSheet(workbook, 'Projects', projects);
  addDynamicSheet(workbook, 'Quotations', quotationRows);
  addDynamicSheet(workbook, 'Contacts', contactRows);

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