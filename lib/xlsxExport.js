// Real Excel (.xlsx) downloads made in the browser.
// - Phone-type columns are stored as TEXT, so Excel never turns
//   0506714518 into 5.07E+08 or drops the leading 0.
// - "dd/mm/yyyy" or "yyyy-mm-dd" values become real Excel dates shown
//   as dd/mm/yyyy (sortable, no day/month mix-ups).
// - Bold header, frozen top row, filter arrows, sensible widths.
// ExcelJS is loaded only when someone clicks Download.

const PHONE_COL = /(^|_)(tel|telephone|phone|mobile|mob|fax|whatsapp)(_|$)/i;
const TEXT_COL = /(^|_)(number|no|ref|reference|id)(_|$)/i; // e.g. quotation_number

function toExcelDate(v) {
  if (typeof v !== 'string') return null;
  let m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

function cellText(v) {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * rows:     array of plain objects
 * columns:  [{ key, header? }] or ['key', ...]
 * options:  { sheetName, phoneCols: [...], textCols: [...] }
 */
export async function downloadXlsx(rows, columns, filename, options = {}) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const cols = columns.map((c) => (typeof c === 'string' ? { key: c, header: c } : { header: c.key, ...c }));
  const phone = new Set([...(options.phoneCols || []), ...cols.filter((c) => PHONE_COL.test(c.key)).map((c) => c.key)]);
  const text = new Set([...(options.textCols || []), ...cols.filter((c) => TEXT_COL.test(c.key)).map((c) => c.key)]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ACE';
  wb.created = new Date();
  const ws = wb.addWorksheet((options.sheetName || 'Data').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = cols.map((c) => ({ header: c.header, key: c.key }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F3D' } };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.getRow(1).height = 20;

  rows.forEach((r) => {
    const values = {};
    cols.forEach((c) => {
      const v = r[c.key];
      if (v === null || v === undefined || v === '') { values[c.key] = null; return; }
      if (phone.has(c.key) || text.has(c.key)) { values[c.key] = cellText(v).trim(); return; }
      const d = toExcelDate(v);
      if (d) { values[c.key] = d; return; }
      values[c.key] = v;
    });
    const row = ws.addRow(values);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (phone.has(c.key) || text.has(c.key)) cell.numFmt = '@';
      else if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
    });
  });

  // Text format for the whole phone column too, so new numbers typed
  // later in Excel also keep their leading 0
  cols.forEach((c, i) => {
    if (phone.has(c.key) || text.has(c.key)) ws.getColumn(i + 1).numFmt = '@';
  });

  // Widths from content (min 10, max 50)
  cols.forEach((c, i) => {
    let w = String(c.header).length;
    rows.forEach((r) => {
      const v = r[c.key];
      const len = v instanceof Date ? 10 : cellText(v).length;
      if (len > w) w = len;
    });
    ws.getColumn(i + 1).width = Math.min(50, Math.max(10, w + 2));
  });

  if (rows.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
