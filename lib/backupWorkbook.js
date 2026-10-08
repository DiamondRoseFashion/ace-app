// Builds the projects / quotations / contacts Excel workbook (used by
// the Export Backup button and the weekly report email).
import ExcelJS from 'exceljs';
import { buildBackupData } from '@/lib/backupData';

const ROWS_PER_SHEET = 5000;

// Phone numbers and reference numbers stay as text (keeps leading 0,
// never 5.07E+08); dd/mm/yyyy strings become real Excel dates.
const TEXT_COL = /(^|_)(tel|telephone|phone|mobile|mob|fax|whatsapp|number|no|ref|reference|id)(_|$)/i;
function isTextCol(key) {
  return TEXT_COL.test(key);
}
function prepareRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === '') { out[key] = null; continue; }
    if (isTextCol(key)) { out[key] = String(value).trim(); continue; }
    const m = typeof value === 'string' && value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    out[key] = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : value;
  }
  return out;
}

function addSheetHeader(sheet, columns) {
  sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
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
  addSheetHeader(sheet, columns);
  let rowCount = 0;
  rows.forEach((row) => {
    if (rowCount >= ROWS_PER_SHEET) {
      sheetIndex += 1;
      sheet = workbook.addWorksheet(`${baseName}_${sheetIndex}`);
      addSheetHeader(sheet, columns);
      rowCount = 0;
    }
    const added = sheet.addRow(prepareRow(row));
    columns.forEach((key, i) => {
      const cell = added.getCell(i + 1);
      if (isTextCol(key)) cell.numFmt = '@';
      else if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
    });
    rowCount += 1;
  });
}

const p2 = (n) => String(n).padStart(2, '0');
function dmy(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
const hm = (t) => (t ? String(t).slice(0, 5) : '');

async function rowsOf(admin, table) {
  const { data, error } = await admin.from(table).select('*');
  return error ? null : (data || []);
}

// Meetings, Expenses and Team, readable (names instead of ids)
async function extraSheets(admin) {
  const [profiles, projects, meetings, expenses] = await Promise.all(
    ['profiles', 'projects', 'meetings', 'expenses'].map((t) => rowsOf(admin, t))
  );
  const who = Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name || '']));
  const proj = Object.fromEntries((projects || []).map((p) => [p.id, p.name || '']));
  const out = {};
  if (meetings) {
    out.Meetings = [...meetings]
      .sort((a, b) => String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')))
      .map((m) => ({
        date: dmy(m.meeting_date), start: hm(m.start_time), end: hm(m.end_time),
        title: m.title || '', project: proj[m.project_id] || m.project_name || '',
        assigned_to: who[m.assigned_to] || '', status: m.status || (m.is_done ? 'completed' : 'pending'),
        venue: m.venue || '', notes: m.notes || '', course_of_actions: m.actions || '',
        created_by: who[m.created_by] || '', added_on: dmy(m.created_at),
      }));
  }
  if (expenses) {
    out.Expenses = [...expenses]
      .sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')))
      .map((e) => ({
        date: dmy(e.expense_date), employee: who[e.employee_id] || who[e.created_by] || '',
        category: e.category || '', amount: e.amount === null || e.amount === undefined ? null : Number(e.amount),
        notes: e.notes || '', added_on: dmy(e.created_at),
      }));
  }
  if (profiles) {
    out.Team = profiles.map((p) => ({
      name: p.full_name || '', role: p.role || '', job_title: p.job_title || '', phone: p.phone || '',
      joined: dmy(p.created_at),
    }));
  }
  return out;
}

// → { buffer } or { error }.  full: also Meetings, Expenses and Team sheets.
export async function buildBackupWorkbook(admin, { full = false } = {}) {
  const built = await buildBackupData(admin);
  if (built.error) return { error: built.error };
  const workbook = new ExcelJS.Workbook();
  addDynamicSheet(workbook, 'Projects', built.projects);
  addDynamicSheet(workbook, 'Quotations', built.quotations);
  addDynamicSheet(workbook, 'Contacts', built.contacts);
  if (full) {
    const extra = await extraSheets(admin);
    for (const [name, rows] of Object.entries(extra)) addDynamicSheet(workbook, name, rows);
  }
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}
