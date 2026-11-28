// Excel (.xlsx) downloads of a costing sheet and a quotation, laid out like
// the company's own Excel files. Money cells are real Excel formulas (with
// the same rounding to fils as ACE), so changing a quantity or price in
// Excel updates the totals; each formula also carries ACE's value, so the
// file shows the right numbers the moment it opens.
// ExcelJS is loaded only when someone clicks the button.
import { calcSheet, num, round2 } from '@/lib/costing';
import { quotationTotals, quoteDate, modelOf, discountLabel } from '@/lib/quotation';

const NAVY = 'FF0F1F3D';
const LILAC = 'FFF3EEF7';
const BUY = 'FFEEF2FA';
const SELL = 'FFEEF7F0';
const MONEY = '#,##0.00';
const thin = { style: 'thin', color: { argb: 'FF9E9E9E' } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default || mod;
}

function base64Of(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const isPng = (buf) => { const b = new Uint8Array(buf); return b[0] === 0x89 && b[1] === 0x50; };

// add a picture (ArrayBuffer) fitted into a box (px), placed at a cell (0-based col / row)
async function placeImage(wb, ws, buf, col, row, boxW, boxH, offX = 4, offY = 4) {
  if (!buf) return;
  const ext = isPng(buf) ? 'png' : 'jpeg';
  const id = wb.addImage({ base64: `data:image/${ext};base64,${base64Of(buf)}`, extension: ext });
  let w = boxW;
  let h = boxH;
  try {
    const bmp = await createImageBitmap(new Blob([buf]));
    const s = Math.min(boxW / bmp.width, boxH / bmp.height);
    w = Math.round(bmp.width * s);
    h = Math.round(bmp.height * s);
    if (bmp.close) bmp.close();
  } catch { /* keep the box size */ }
  // offsets in EMU-free units: ExcelJS takes fractional cell positions
  ws.addImage(id, { tl: { col: col + offX / 100, row: row + offY / 100 }, ext: { width: w, height: h }, editAs: 'oneCell' });
}

// a picture centred inside one cell (1-based column / row), never bigger than the cell
const colPx = (ws, c) => Math.round((ws.getColumn(c).width || 9) * 7 + 5);
const rowPx = (ws, r) => Math.round(((ws.getRow(r).height || 15) * 96) / 72);
async function placeImageInCell(wb, ws, buf, col, row, pad = 5) {
  if (!buf) return;
  const ext = isPng(buf) ? 'png' : 'jpeg';
  const id = wb.addImage({ base64: `data:image/${ext};base64,${base64Of(buf)}`, extension: ext });
  const cw = colPx(ws, col);
  const rh = rowPx(ws, row);
  let w = cw - pad * 2;
  let h = rh - pad * 2;
  try {
    const bmp = await createImageBitmap(new Blob([buf]));
    const sc = Math.min(w / bmp.width, h / bmp.height);
    w = Math.max(1, Math.round(bmp.width * sc));
    h = Math.max(1, Math.round(bmp.height * sc));
    if (bmp.close) bmp.close();
  } catch { /* fill the cell */ }
  ws.addImage(id, {
    tl: { col: col - 1 + (cw - w) / 2 / cw, row: row - 1 + (rh - h) / 2 / rh },
    ext: { width: w, height: h },
    editAs: 'oneCell',
  });
}

// how tall a row must be (points) so every wrapped text cell fits
function fitHeight(ws, texts, { min = 20, lineH = 12.5, pad = 7 } = {}) {
  let lines = 1;
  for (const [col, text] of texts) {
    const width = ws.getColumn(col).width || 9; // characters
    const perLine = Math.max(4, Math.floor(width * 1.05));
    let n = 0;
    for (const part of String(text ?? '').split('\n')) n += Math.max(1, Math.ceil(part.length / perLine));
    lines = Math.max(lines, n);
  }
  return Math.max(min, lines * lineH + pad);
}

function save(wb, filename) {
  return wb.xlsx.writeBuffer().then((buf) => {
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

const val = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
const numOrBlank = (v) => { const n = num(v); return n === null ? null : n; };
const dmy = (iso) => quoteDate(iso).replace(/-/g, '/');

// ============================================================
// Costing sheet
// ============================================================
// head: { project_name, client, contractor, consultant, quotation_no, quotation_date, revision }
// items: costing rows (strings as typed); discBuy / discSell: [{ label, mode, value }]
// images: Map(image_path → ArrayBuffer)
export async function downloadCostingExcel({ head, items, discBuy = [], discSell = [], note = '', images = new Map(), filename }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ACE';
  const ws = wb.addWorksheet('Costing', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  // A Sl | B Type | C Qty | D Make | E Code | F Model | G Description | H Image | I Make (OEM) | J OEM Code |
  // K Mfctr's Offer | L Currency | M Rate (AED) | N Unit Price (AED) | O Customs+Freight | P Total Unit Price |
  // Q Total Price | R Mark up | S U.P | T T.P | U Remarks
  const widths = [5, 7, 6, 11, 15, 11, 32, 12, 11, 11, 10, 9, 7, 11, 9, 11, 12, 7, 11, 12, 16];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const LAST = 21;

  // ---- title + details ----
  ws.mergeCells(1, 1, 1, LAST);
  const t = ws.getCell(1, 1);
  t.value = 'COSTING SHEET';
  t.font = { bold: true, size: 16, color: { argb: NAVY }, underline: true };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;
  const detail = (r, c1, c2, label, value) => {
    ws.mergeCells(r, c1, r, c2);
    const cell = ws.getCell(r, c1);
    cell.value = { richText: [{ text: `${label} `, font: { bold: true } }, { text: value || '' }] };
    cell.alignment = { vertical: 'middle', wrapText: true };
    for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = BOX;
  };
  detail(2, 1, 13, 'Project :', head.project_name);
  detail(2, 14, LAST, 'Quotation No :', head.quotation_no);
  detail(3, 1, 8, 'Client :', head.client);
  detail(3, 9, 13, 'Contractor :', head.contractor);
  detail(3, 14, LAST, 'Date :', head.quotation_date ? dmy(head.quotation_date) : '');
  detail(4, 1, 13, 'Consultant :', head.consultant);
  detail(4, 14, LAST, 'Revision :', head.revision);
  [2, 3, 4].forEach((r) => { ws.getRow(r).height = 20; });

  // ---- table header (2 rows) ----
  const H1 = 6;
  const H2 = 7;
  const single = [[1, 'Sl No'], [2, 'Type'], [3, 'Qty'], [4, 'Make'], [5, 'Code'], [6, 'Model'], [7, 'Description'], [8, 'Image'],
    [9, 'Make (OEM)'], [10, 'OEM Code'], [11, "Mfctr's Offer"], [12, 'Currency'], [13, 'Rate (AED)'], [18, 'Mark up'], [21, 'Remarks']];
  for (const [c, label] of single) { ws.mergeCells(H1, c, H2, c); ws.getCell(H1, c).value = label; }
  ws.mergeCells(H1, 14, H1, 17); ws.getCell(H1, 14).value = 'Buying Cost';
  ws.mergeCells(H1, 19, H1, 20); ws.getCell(H1, 19).value = 'Selling Cost';
  ws.getCell(H2, 14).value = 'Unit Price (AED)';
  ws.getCell(H2, 15).value = 'Customs + Freight';
  ws.getCell(H2, 16).value = 'Total Unit Price';
  ws.getCell(H2, 17).value = 'Total Price (Unit Rate x Qty)';
  ws.getCell(H2, 19).value = 'U.P (Mark up x Total Unit Price)';
  ws.getCell(H2, 20).value = 'T.P (U.P x Qty)';
  for (const r of [H1, H2]) {
    ws.getRow(r).height = r === H1 ? 18 : 30;
    for (let c = 1; c <= LAST; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, size: 9, color: { argb: NAVY } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c >= 14 && c <= 17 ? BUY : c >= 19 && c <= 20 ? SELL : LILAC } };
    }
  }
  ws.views = [{ state: 'frozen', ySplit: H2 }];
  ws.pageSetup.printTitlesRow = `${H1}:${H2}`;

  // ---- items ----
  const rows = items;
  const calc = calcSheet(rows, discBuy, discSell);
  let r = H2 + 1;
  const first = r;
  for (let i = 0; i < rows.length; i++, r++) {
    const it = rows[i];
    const c = calc.rows[i];
    const R = r;
    const row = ws.getRow(R);
    row.values = [i + 1, it.type || '', numOrBlank(it.qty), it.make || '', it.code || '', it.model || '', it.description || '', '',
      it.make_oem || '', it.oem_code || '', numOrBlank(it.offer_price), it.offer_currency || 'AED', numOrBlank(it.exchange_rate),
      null, numOrBlank(it.customs_freight), null, null, numOrBlank(it.markup), null, null, it.remarks || ''];
    ws.getCell(R, 14).value = { formula: `IF(OR(K${R}="",M${R}=""),"",ROUND(K${R}*M${R},2))`, result: val(c.unitAed) };
    ws.getCell(R, 16).value = { formula: `IF(OR(N${R}="",O${R}=""),"",ROUND(N${R}*O${R},2))`, result: val(c.totalUnit) };
    ws.getCell(R, 17).value = { formula: `IF(OR(P${R}="",C${R}=""),"",ROUND(P${R}*C${R},2))`, result: val(c.totalPrice) };
    ws.getCell(R, 19).value = { formula: `IF(OR(R${R}="",P${R}=""),"",ROUND(R${R}*P${R},2))`, result: val(c.sellUnit) };
    ws.getCell(R, 20).value = { formula: `IF(OR(S${R}="",C${R}=""),"",ROUND(S${R}*C${R},2))`, result: val(c.sellTotal) };
    const img = it.image_path ? images.get(it.image_path) : null;
    row.height = fitHeight(ws, [[2, it.type], [4, it.make], [5, it.code], [6, it.model], [7, it.description], [9, it.make_oem], [10, it.oem_code], [21, it.remarks]], { min: img ? 56 : 22 });
    for (let col = 1; col <= LAST; col++) {
      const cell = ws.getCell(R, col);
      cell.border = BOX;
      cell.font = { size: 9 };
      cell.alignment = { vertical: 'middle', wrapText: true, indent: 0, horizontal: [1, 2, 3, 8, 12, 13, 15, 18].includes(col) ? 'center' : (col >= 11 && col <= 20 ? 'right' : 'left') };
      if ([14, 16, 17, 19, 20].includes(col) || col === 11) cell.numFmt = MONEY;
      if ([17, 20].includes(col)) cell.font = { size: 9, bold: true };
    }
    if (img) await placeImageInCell(wb, ws, img, 8, R);
  }
  const lastItem = r - 1;
  const hasItems = lastItem >= first;

  // ---- totals, discounts, gross, gross profit ----
  const totalRow = r;
  const labelCell = (rr, c1, c2, text) => {
    ws.mergeCells(rr, c1, rr, c2);
    const cell = ws.getCell(rr, c1);
    cell.value = text;
    cell.font = { bold: true, size: 9, color: { argb: NAVY } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
  };
  const moneyCell = (rr, col, value, bold = true) => {
    const cell = ws.getCell(rr, col);
    cell.value = value;
    cell.numFmt = MONEY;
    cell.font = { size: 9, bold };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = BOX;
  };
  labelCell(totalRow, 14, 16, 'Total Cost :');
  moneyCell(totalRow, 17, { formula: hasItems ? `SUM(Q${first}:Q${lastItem})` : '0', result: calc.totalCost });
  ws.getCell(totalRow, 18).value = { formula: `IF(Q${totalRow}=0,"",T${totalRow}/Q${totalRow})`, result: calc.totalCost ? calc.totalSell / calc.totalCost : '' };
  ws.getCell(totalRow, 18).numFmt = '"×"0.00';
  ws.getCell(totalRow, 18).font = { size: 9, italic: true, color: { argb: 'FF7A6C86' } };
  ws.getCell(totalRow, 18).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(totalRow, 18).note = 'Overall mark up = Total ÷ Total Cost';
  labelCell(totalRow, 19, 19, 'Total :');
  moneyCell(totalRow, 20, { formula: hasItems ? `SUM(T${first}:T${lastItem})` : '0', result: calc.totalSell });

  const discRows = Math.max(discBuy.length, discSell.length);
  const buyRefs = [];
  const sellRefs = [];
  for (let i = 0; i < discRows; i++) {
    const rr = totalRow + 1 + i;
    const db = discBuy[i];
    const ds = discSell[i];
    if (db) {
      const v = num(db.value);
      labelCell(rr, 14, 16, `${db.label || 'Special discount'}${db.mode === 'percent' && v !== null ? ` (${v}%)` : ''} :`);
      moneyCell(rr, 17, db.mode === 'percent' && v !== null ? { formula: `ROUND(Q${totalRow}*${v}/100,2)`, result: calc.buyLines[i] } : (v ?? 0), false);
      buyRefs.push(`Q${rr}`);
    }
    if (ds) {
      const v = num(ds.value);
      labelCell(rr, 18, 19, `${ds.label || 'Special discount'}${ds.mode === 'percent' && v !== null ? ` (${v}%)` : ''} :`);
      moneyCell(rr, 20, ds.mode === 'percent' && v !== null ? { formula: `ROUND(T${totalRow}*${v}/100,2)`, result: calc.sellLines[i] } : (v ?? 0), false);
      sellRefs.push(`T${rr}`);
    }
  }
  const grossRow = totalRow + 1 + discRows;
  labelCell(grossRow, 14, 16, 'Gross :');
  moneyCell(grossRow, 17, { formula: `Q${totalRow}${buyRefs.map((x) => `-${x}`).join('')}`, result: calc.grossBuy });
  labelCell(grossRow, 18, 19, 'Gross :');
  moneyCell(grossRow, 20, { formula: `T${totalRow}${sellRefs.map((x) => `-${x}`).join('')}`, result: calc.grossSell });
  const profitRow = grossRow + 1;
  labelCell(profitRow, 14, 19, 'Gross Profit :');
  moneyCell(profitRow, 20, { formula: `T${grossRow}-Q${grossRow}`, result: calc.grossProfit });
  ws.getCell(profitRow, 20).font = { size: 10, bold: true, color: { argb: calc.grossProfit < 0 ? 'FFB33A3A' : 'FF2E7048' } };

  // ---- note ----
  ws.mergeCells(totalRow, 1, profitRow, 12);
  const n = ws.getCell(totalRow, 1);
  n.value = { richText: [{ text: 'Note\n', font: { bold: true, size: 9 } }, { text: note || '', font: { size: 9 } }] };
  n.alignment = { vertical: 'top', wrapText: true };

  ws.pageSetup.printArea = `A1:U${profitRow}`;
  await save(wb, filename);
}

// ============================================================
// Quotation
// ============================================================
// q: the quotation (as saved: to_company … items, discounts, terms, notes …)
// images: Map(image_path → ArrayBuffer); letterhead: { top, bottom } ArrayBuffers; signature: ArrayBuffer | null
export async function downloadQuotationExcel(args) {
  const wb = await buildQuotationWorkbook(args);
  await save(wb, args.filename);
}

// Laid out like the PDF: A4 portrait at 100 %, the letterhead across the
// full width at the top of every page and its footer at the very bottom,
// the item table header repeated on each page, "Page X of Y".
export async function buildQuotationWorkbook({ q, images = new Map(), letterhead = {}, signature = null }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ACE';
  const M = 0.2; // page margins (inches)
  const ws = wb.addWorksheet('Quotation', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: M, right: M, top: M, bottom: M, header: 0, footer: 0 } },
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 13 },
  });

  // ---- columns (px at 96 dpi; Excel width = (px − 5) / 7 characters) ----
  // A pad | B Sl.No | C Type | D Model | E Make | F Description | G Image | H Qty | I Unit Price | J Total | K pad
  const PAGE_W = Math.floor((8.27 - 2 * M) * 96) - 10; // printable width, a little slack
  const tablePt = [26, 32, 66, 58, 133, 60, 32, 54, 62]; // same as the PDF
  const tablePx = tablePt.map((pt) => Math.round((pt * 96) / 72));
  const pad = Math.floor((PAGE_W - tablePx.reduce((x, y) => x + y, 0)) / 2);
  const colsPx = [pad, ...tablePx, pad];
  colsPx.forEach((px, i) => { ws.getColumn(i + 1).width = Math.max(0.5, (px - 5) / 7); });
  const FIRST = 2; // first table column (B)
  const LAST = 10; // last table column (J)
  const C = (n) => FIRST + n - 1; // table column n (1 = Sl.No … 9 = Total) → sheet column
  const L = (c) => String.fromCharCode(64 + c); // column letter
  const SHEET_PX = colsPx.reduce((x, y) => x + y, 0);

  // ---- page geometry (points) ----
  const PAGE_H = (11.69 - 2 * M) * 72 - 8; // printable height, a little slack
  const imgH = async (buf, fallback) => {
    try { const b = await createImageBitmap(new Blob([buf])); const h = b.height / b.width; if (b.close) b.close(); return h; } catch { return fallback; }
  };
  const TOP_H = letterhead.top ? ((SHEET_PX * (await imgH(letterhead.top, 219 / 1241))) * 72) / 96 : 0;
  const BOT_H = letterhead.bottom ? ((SHEET_PX * (await imgH(letterhead.bottom, 167 / 1241))) * 72) / 96 : 0;
  const PAGENO_H = 16;
  const LIMIT = PAGE_H - PAGENO_H - BOT_H; // content must end above the page number + footer

  let r = 1;
  let used = 0; // points used on the current page
  const pageNoCells = [];
  let onNewPage = null; // e.g. repeat the table header

  async function topOfPage() {
    used = 0;
    if (letterhead.top) {
      ws.getRow(r).height = TOP_H;
      const id = wb.addImage({ base64: `data:image/png;base64,${base64Of(letterhead.top)}`, extension: 'png' });
      ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width: SHEET_PX, height: (TOP_H * 96) / 72 }, editAs: 'oneCell' });
      used += TOP_H; r++;
    }
    ws.getRow(r).height = 10; used += 10; r++;
  }
  async function bottomOfPage(final = false) {
    const gap = LIMIT - used;
    if (gap > 0.5) { ws.getRow(r).height = gap; r++; }
    ws.mergeCells(r, FIRST, r, LAST);
    ws.getRow(r).height = PAGENO_H;
    const cell = ws.getCell(r, FIRST);
    cell.font = { name: 'Calibri', size: 8 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    pageNoCells.push(cell);
    r++;
    if (letterhead.bottom) {
      ws.getRow(r).height = BOT_H;
      const id = wb.addImage({ base64: `data:image/png;base64,${base64Of(letterhead.bottom)}`, extension: 'png' });
      ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width: SHEET_PX, height: (BOT_H * 96) / 72 }, editAs: 'oneCell' });
      r++;
    }
    if (!final) ws.getRow(r - 1).addPageBreak();
  }
  // a row of height h on this page (or the next page if it doesn't fit)
  async function line(h) {
    if (used + h > LIMIT && used > TOP_H + 10) {
      await bottomOfPage();
      await topOfPage();
      if (onNewPage) await onNewPage();
    }
    ws.getRow(r).height = h;
    used += h;
    return r++;
  }
  const gap = async (h) => { await line(h); };

  // text helpers
  const font = (o = {}) => ({ name: 'Calibri', size: 10, ...o });
  const put = (rr, c1, c2, value, f, align = 'left', wrap = false) => {
    if (c2 > c1) ws.mergeCells(rr, c1, rr, c2);
    const cell = ws.getCell(rr, c1);
    cell.value = value;
    if (f) cell.font = f;
    cell.alignment = { horizontal: align, vertical: wrap ? 'top' : 'middle', wrapText: wrap };
    return cell;
  };
  const rich = (label, value) => ({ richText: [{ text: `${label} `, font: font({ bold: true }) }, { text: value || '', font: font() }] });
  const linesFor = (text, charsPerLine) => String(text || '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / charsPerLine)), 0);

  await topOfPage();

  // ---- To / Ref / Date / Sales Person ----
  const LH = 13;
  let R = await line(LH);
  put(R, C(1), C(2), 'To :', font({ bold: true }));
  put(R, C(3), C(6), `M/s.  ${q.to_company || ''}`, font());
  put(R, C(7), C(9), `Ref.${q.ref_no ? ` ${q.ref_no}` : ''}`, font({ bold: true }), 'right');
  R = await line(LH);
  put(R, C(3), C(6), `P.O. Box : ${q.po_box || ''}`, font());
  put(R, C(7), C(9), `Date: ${quoteDate(q.quote_date)}`, font({ bold: true }), 'right');
  R = await line(LH);
  put(R, C(3), C(6), q.city || '', font());
  if (q.sales_person) put(R, C(7), C(9), `Sales Person: ${q.sales_person}`, font({ bold: true }), 'right');
  R = await line(LH); put(R, C(1), C(6), rich('Tel:', q.tel));
  R = await line(LH); put(R, C(1), C(6), rich('Attn.:', q.attn));
  await gap(10);

  // ---- Project ----
  const projLines = linesFor(`Project : ${q.project_name || ''}`, 95);
  R = await line(projLines * 14.5);
  put(R, C(1), C(9), `Project : ${q.project_name || ''}`, font({ bold: true, size: 11, underline: true }), 'center', true);
  ws.getCell(R, C(1)).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  await gap(6);

  // ---- Dear Sir / intro ----
  R = await line(LH); put(R, C(1), C(9), q.salutation || 'Dear Sir,', font());
  R = await line(linesFor(q.intro, 120) * LH); put(R, C(1), C(9), q.intro || '', font(), 'left', true);
  await gap(8);

  // ---- item table ----
  const heads = ['Sl.No', 'Type', 'Model', 'Make', 'Description', 'Image', 'Qty.', 'Unit Price\n( AED)', 'Total\n(AED)'];
  async function tableHead() {
    const hr = await line(30);
    heads.forEach((h, i) => {
      const cell = ws.getCell(hr, C(i + 1));
      cell.value = h;
      cell.font = font({ bold: true, size: 9.5 });
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB19CB8' } };
    });
  }
  if (used + 30 + 50 > LIMIT) { await bottomOfPage(); await topOfPage(); }
  await tableHead();
  onNewPage = tableHead;
  const itemRows = [];
  for (let i = 0; i < q.items.length; i++) {
    const it = q.items[i];
    const img = it.image_path ? images.get(it.image_path) : null;
    // 9 pt text: about 1.3 × as many characters per line as Excel's width unit
    const nLines = Math.max(...[[C(2), it.type], [C(3), modelOf(it)], [C(4), it.make], [C(5), it.description]].map(([c, txt]) => linesFor(txt, Math.max(4, Math.floor((ws.getColumn(c).width || 9) * 1.3)))));
    const h = Math.max(img ? 50 : 22, nLines * 11.5 + 9);
    const RR = await line(h);
    itemRows.push(RR);
    const vals = [i + 1, it.type || '', modelOf(it), it.make || '', it.description || '', '', it.qty ?? null, it.unit_price ?? null, null];
    vals.forEach((v, k) => { ws.getCell(RR, C(k + 1)).value = v; });
    ws.getCell(RR, C(9)).value = { formula: `IF(OR(${L(C(7))}${RR}="",${L(C(8))}${RR}=""),"",ROUND(${L(C(7))}${RR}*${L(C(8))}${RR},2))`, result: val(it.total) };
    for (let k = 1; k <= 9; k++) {
      const cell = ws.getCell(RR, C(k));
      cell.border = BOX;
      cell.font = font({ size: 9 });
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: k === 5 ? 'left' : k >= 8 ? 'right' : 'center', indent: k === 5 ? 1 : 0 };
      if (k >= 8) cell.numFmt = MONEY;
    }
    if (img) await placeImageInCell(wb, ws, img, C(6), RR);
  }
  onNewPage = null;

  // ---- totals ----
  const t = quotationTotals(q.items, q.vat_percent, q.discounts || []);
  const TOT = L(C(9));
  const totalLine = async (label, value) => {
    const rr = await line(17);
    put(rr, C(5), C(8), label, font({ bold: true }), 'right');
    const cell = ws.getCell(rr, C(9));
    cell.value = value;
    cell.numFmt = MONEY;
    cell.font = font({ bold: true });
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = BOX;
    return rr;
  };
  const sumF = itemRows.length ? itemRows.map((x) => `${TOT}${x}`).join(',') : '0';
  const totalRow = await totalLine('Total in AED :', { formula: itemRows.length ? `SUM(${sumF})` : '0', result: t.total });
  let after = `${TOT}${totalRow}`;
  if (t.discountLines.length) {
    const refs = [];
    const list = (q.discounts || []).filter((d) => (num(d?.value) ?? 0) !== 0);
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const v = num(d.value);
      const rr = await totalLine(`${discountLabel(d)} :`, d.mode === 'percent' ? { formula: `ROUND(${TOT}${totalRow}*${v}/100,2)`, result: t.discountLines[i]?.amount ?? 0 } : round2(v));
      ws.getCell(rr, C(9)).numFmt = '"- "#,##0.00';
      refs.push(`${TOT}${rr}`);
    }
    const ad = await totalLine('Total after Discount :', { formula: `${TOT}${totalRow}${refs.map((x) => `-${x}`).join('')}`, result: t.afterDiscount });
    after = `${TOT}${ad}`;
  }
  const vatP = num(q.vat_percent) ?? 5;
  const vatRow = await totalLine(`VAT (${vatP}%) :`, { formula: `ROUND(${after}*${vatP}/100,2)`, result: t.vat });
  await totalLine('Net Total in AED :', { formula: `${after}+${TOT}${vatRow}`, result: t.net });
  await gap(8);

  // ---- terms & general notes ----
  const points = async (heading, list) => {
    const items = (list || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!items.length) return;
    R = await line(14); put(R, C(1), C(9), heading, font({ bold: true, underline: true }));
    for (const item of items) {
      R = await line(linesFor(`* ${item}`, 135) * 11 + 0.5);
      put(R, C(1), C(9), `* ${item}`, font({ size: 9 }), 'left', true);
    }
    await gap(4);
  };
  await points('Terms & Conditions', q.terms);
  await points('General Notes', q.notes);

  // ---- delivery / payment / validity ----
  for (const [label, value] of [['Delivery :', q.delivery], ['Payment :', q.payment], ['Validity :', q.validity]]) {
    R = await line(13);
    put(R, C(1), C(9), `${label} ${value || ''}`.trim(), font({ bold: true, italic: true, underline: true }));
  }
  await gap(6);

  // ---- closing + signature (kept together) ----
  const closingH = linesFor(q.closing, 120) * 13;
  const SIG_H = 46;
  const block = closingH + 4 + 13 + 13 + SIG_H + 4 + 13;
  if (used + block > LIMIT) { await bottomOfPage(); await topOfPage(); }
  R = await line(closingH); put(R, C(1), C(9), q.closing || '', font(), 'left', true);
  await gap(4);
  R = await line(13); put(R, C(1), C(9), 'Best Regards.', font());
  R = await line(13); put(R, C(1), C(9), 'For GEMS Systems LLC', font({ bold: true }));
  const sigRow = await line(SIG_H + 4);
  if (signature) {
    const ext = isPng(signature) ? 'png' : 'jpeg';
    const id = wb.addImage({ base64: `data:image/${ext};base64,${base64Of(signature)}`, extension: ext });
    let w = 140; let h = SIG_H;
    try { const b = await createImageBitmap(new Blob([signature])); const s = Math.min(140 / b.width, SIG_H / b.height); w = Math.round(b.width * s); h = Math.round(b.height * s); if (b.close) b.close(); } catch { /* box size */ }
    ws.addImage(id, { tl: { col: C(1) - 1, row: sigRow - 1 + 0.04 }, ext: { width: w * (96 / 72), height: h * (96 / 72) }, editAs: 'oneCell' });
  }
  if (q.salesman) { R = await line(13); put(R, C(1), C(9), q.salesman, font({ bold: true })); }

  await bottomOfPage(true);
  const n = pageNoCells.length;
  pageNoCells.forEach((cell, i) => { cell.value = `Page ${i + 1} of ${n}`; });
  ws.pageSetup.printArea = `A1:K${r - 1}`;
  return wb;
}
