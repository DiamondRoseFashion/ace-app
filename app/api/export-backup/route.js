import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ROLES = ['owner', 'admin', 'manager'];
const ROWS_PER_SHEET = 5000;

// Turns any ISO date/datetime string (e.g. 2026-07-29T05:50:53...) into a
// simple DD/MM/YYYY string for the Excel file. Leaves everything else as-is.
function formatRowDates(row) {
  const formatted = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        const day = String(d.getUTCDate()).padStart(2, '0');
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const year = d.getUTCFullYear();
        formatted[key] = `${day}/${month}/${year}`;
        continue;
      }
    }
    formatted[key] = value;
  }
  return formatted;
}

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

  // Map each project to its most recent quotation (if it has one)
  const latestQuotationByProject = {};
  quotations.forEach((q) => {
    const existing = latestQuotationByProject[q.project_id];
    if (!existing || new Date(q.created_at) > new Date(existing.created_at)) {
      latestQuotationByProject[q.project_id] = q;
    }
  });

  // Flatten the joined creator name, and merge in that project's quotation details
  const projects = (rawProjects || []).map((p) => {
    const { creator, ...rest } = p;

    const matchedQuotation = latestQuotationByProject[p.id];
    let quotationFields = {};
    if (matchedQuotation) {
      const { id, project_id, created_at, ...qRest } = matchedQuotation;
      quotationFields = {
        ...qRest,
        quotation_id: id,
        quotation_created_at: created_at,
      };
    }

    return formatRowDates({
      ...rest,
      created_by_name: creator?.full_name || '',
      ...quotationFields,
    });
  });

  const workbook = new ExcelJS.Workbook();

  addDynamicSheet(workbook, 'Projects', projects);
  addDynamicSheet(workbook, 'Quotations', quotations.map((q) => formatRowDates(q)));

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
