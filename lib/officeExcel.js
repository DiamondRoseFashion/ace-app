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
export async function downloadQuotationExcel({ q, images = new Map(), letterhead = {}, signature = null, filename }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ACE';
  const ws = wb.addWorksheet('Quotation', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 } },
    views: [{ showGridLines: false }],
  });
  // A Sl.No | B Type | C Model | D Make | E Description | F Image | G Qty | H Unit Price | I Total
  const widths = [6, 7, 15, 12, 36, 12, 7, 12, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const LAST = 9;
  const TOTAL_W = widths.reduce((a, b) => a + b, 0) * 7.2; // ≈ px across the page

  let r = 1;
  // ---- letterhead (top) ----
  if (letterhead.top) {
    for (let k = 0; k < 6; k++) ws.getRow(r + k).height = 18;
    await placeImage(wb, ws, letterhead.top, 0, 0, TOTAL_W, 108, 0, 0);
    r += 6;
  }
  r += 1;

  // ---- To / Ref / Date / Sales Person ----
  const bold = { bold: true, size: 11 };
  const put = (rr, c, value, font = bold, align = 'left') => {
    const cell = ws.getCell(rr, c);
    cell.value = value;
    cell.font = font;
    cell.alignment = { horizontal: align, vertical: 'middle' };
  };
  const right = (rr, value) => { ws.mergeCells(rr, 7, rr, LAST); put(rr, 7, value, bold, 'right'); };
  put(r, 1, 'To :'); ws.mergeCells(r, 2, r, 5); put(r, 2, `M/s.  ${q.to_company || ''}`); right(r, `Ref. ${q.ref_no || ''}`); r++;
  ws.mergeCells(r, 2, r, 5); put(r, 2, `P.O. Box : ${q.po_box || ''}`); right(r, `Date: ${quoteDate(q.quote_date)}`); r++;
  ws.mergeCells(r, 2, r, 5); put(r, 2, q.city || ''); if (q.sales_person) right(r, `Sales Person: ${q.sales_person}`); r++;
  ws.mergeCells(r, 1, r, 5); put(r, 1, `Tel:  ${q.tel || ''}`); r++;
  ws.mergeCells(r, 1, r, 5); put(r, 1, `Attn.: ${q.attn || ''}`); r += 2;

  ws.mergeCells(r, 1, r, LAST);
  put(r, 1, `Project : ${q.project_name || ''}`, { bold: true, size: 11.5, underline: true }, 'center');
  ws.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(r).height = String(q.project_name || '').length > 80 ? 32 : 18;
  r += 2;
  ws.mergeCells(r, 1, r, LAST); put(r, 1, q.salutation || 'Dear Sir,', { size: 10.5 }); r++;
  ws.mergeCells(r, 1, r, LAST); put(r, 1, q.intro || '', { size: 10.5 });
  ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(r).height = String(q.intro || '').length > 110 ? 30 : 16;
  r += 2;

  // ---- item table ----
  const heads = ['Sl.No', 'Type', 'Model', 'Make', 'Description', 'Image', 'Qty.', 'Unit Price\n( AED)', 'Total\n(AED)'];
  heads.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9.5 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BOX;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  });
  ws.getRow(r).height = 30;
  r++;
  const first = r;
  for (let i = 0; i < q.items.length; i++, r++) {
    const it = q.items[i];
    const R = r;
    ws.getRow(R).values = [i + 1, it.type || '', modelOf(it), it.make || '', it.description || '', '', it.qty ?? null, it.unit_price ?? null, null];
    ws.getCell(R, 9).value = { formula: `IF(OR(G${R}="",H${R}=""),"",ROUND(G${R}*H${R},2))`, result: val(it.total) };
    const img = it.image_path ? images.get(it.image_path) : null;
    ws.getRow(R).height = fitHeight(ws, [[2, it.type], [3, modelOf(it)], [4, it.make], [5, it.description]], { min: img ? 52 : 24 });
    for (let c = 1; c <= LAST; c++) {
      const cell = ws.getCell(R, c);
      cell.border = BOX;
      cell.font = { size: c === 5 ? 9 : 9.5 };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c === 5 ? 'left' : c >= 8 ? 'right' : 'center' };
      if (c >= 8) cell.numFmt = MONEY;
    }
    if (img) await placeImageInCell(wb, ws, img, 6, R);
  }
  const last = r - 1;

  // ---- totals ----
  const t = quotationTotals(q.items, q.vat_percent, q.discounts || []);
  const totalLine = (label, value, strong = false) => {
    ws.mergeCells(r, 5, r, 8);
    put(r, 5, label, { bold: true, size: strong ? 11 : 10.5 }, 'right');
    const cell = ws.getCell(r, 9);
    cell.value = value;
    cell.numFmt = MONEY;
    cell.font = { bold: true, size: strong ? 11 : 10.5 };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = BOX;
    return r++;
  };
  const totalRow = totalLine('Total in AED :', { formula: last >= first ? `SUM(I${first}:I${last})` : '0', result: t.total });
  let after = `I${totalRow}`;
  const discLines = t.discountLines;
  if (discLines.length) {
    const refs = [];
    (q.discounts || []).filter((d) => (num(d?.value) ?? 0) !== 0).forEach((d, i) => {
      const v = num(d.value);
      const rr = totalLine(`${discountLabel(d)} :`, d.mode === 'percent' ? { formula: `ROUND(I${totalRow}*${v}/100,2)`, result: discLines[i]?.amount ?? 0 } : round2(v));
      ws.getCell(rr, 9).numFmt = '"- "#,##0.00';
      refs.push(`I${rr}`);
    });
    const ad = totalLine('Total after Discount :', { formula: `I${totalRow}${refs.map((x) => `-${x}`).join('')}`, result: t.afterDiscount });
    after = `I${ad}`;
  }
  const vatP = num(q.vat_percent) ?? 5;
  const vatRow = totalLine(`VAT (${vatP}%) :`, { formula: `ROUND(${after}*${vatP}/100,2)`, result: t.vat });
  totalLine('Net Total in AED :', { formula: `${after}+I${vatRow}`, result: t.net }, true);
  r++;

  // ---- terms & general notes ----
  const points = (heading, list) => {
    const items = (list || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!items.length) return;
    ws.mergeCells(r, 1, r, LAST); put(r, 1, heading, { bold: true, size: 11, underline: true }); r++;
    for (const item of items) {
      ws.mergeCells(r, 1, r, LAST);
      put(r, 1, `* ${item}`, { size: 8.5 });
      ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = item.length > 140 ? 24 : 13;
      r++;
    }
    r++;
  };
  points('Terms & Conditions', q.terms);
  points('General Notes', q.notes);

  for (const [label, value] of [['Delivery :', q.delivery], ['Payment :', q.payment], ['Validity :', q.validity]]) {
    ws.mergeCells(r, 1, r, LAST);
    put(r, 1, `${label} ${value || ''}`.trim(), { bold: true, italic: true, underline: true, size: 10.5 });
    r++;
  }
  r++;
  ws.mergeCells(r, 1, r, LAST); put(r, 1, q.closing || '', { size: 10.5 }); r++;
  ws.mergeCells(r, 1, r, LAST); put(r, 1, 'Best Regards.', { size: 10.5 }); r++;
  ws.mergeCells(r, 1, r, LAST); put(r, 1, 'For GEMS Systems LLC', { bold: true, size: 10.5 }); r++;
  // signature space
  for (let k = 0; k < 3; k++) ws.getRow(r + k).height = 18;
  if (signature) await placeImage(wb, ws, signature, 0, r - 1, 150, 50, 10, 10);
  r += 3;
  if (q.salesman) { ws.mergeCells(r, 1, r, LAST); put(r, 1, q.salesman, { bold: true, size: 10.5 }); }
  r += 2;

  // ---- letterhead (bottom) ----
  if (letterhead.bottom) {
    for (let k = 0; k < 5; k++) ws.getRow(r + k).height = 17;
    await placeImage(wb, ws, letterhead.bottom, 0, r - 1, TOTAL_W, 82, 0, 0);
    r += 5;
  }
  ws.pageSetup.printArea = `A1:I${r}`;
  await save(wb, filename);
}
