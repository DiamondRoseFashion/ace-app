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

// → { buffer } or { error }
export async function buildBackupWorkbook(admin) {
  const built = await buildBackupData(admin);
  if (built.error) return { error: built.error };
  const workbook = new ExcelJS.Workbook();
  addDynamicSheet(workbook, 'Projects', built.projects);
  addDynamicSheet(workbook, 'Quotations', built.quotations);
  addDynamicSheet(workbook, 'Contacts', built.contacts);
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}
