// Draws a quotation as an A4 PDF on the company letterhead (every page),
// like the "Quotation _Final_R" sample: To / Ref / Date, Project, the
// item table (header repeated on each page), Total / VAT / Net Total,
// Terms & Conditions, Delivery / Payment / Validity, closing and the
// salesman's name, and "Page X of Y".
// Works in the browser and in Node: give it the letterhead PDF bytes, the
// four Carlito fonts and the item images (image path → JPEG/PNG bytes).
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { money } from '@/lib/costing';
import { quotationTotals, quoteDate, modelOf, qtyText } from '@/lib/quotation';

const W = 595.32;
const H = 842.04;
const LEFT = 36;
const RIGHT = W - 36;
const TOP = H - 112; // below the letterhead's top block
const BOTTOM = 112; // above the letterhead's branch-office footer
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.85, 0.85, 0.85);

// Sl.No, Type, Model, Make, Description, Image, Qty., Unit Price, Total
const COLS = [26, 32, 66, 58, 133, 60, 32, 54, 62];
const HEADS = ['Sl.No', 'Type', 'Model', 'Make', 'Description', 'Image', 'Qty.', 'Unit Price\n( AED)', 'Total\n(AED)'];

export async function buildQuotationPdf({ q, letterhead, fonts, images = new Map() }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Quotation ${q.ref_no || ''}`.trim());
  pdf.setAuthor('GEMS Systems L.L.C.');
  const F = {
    r: await pdf.embedFont(fonts.regular, { subset: false }),
    b: await pdf.embedFont(fonts.bold, { subset: false }),
    i: await pdf.embedFont(fonts.italic, { subset: false }),
    bi: await pdf.embedFont(fonts.boldItalic, { subset: false }),
  };
  const [lh] = await pdf.embedPdf(letterhead, [0]);

  // item images: JPEG or PNG bytes → embedded once each (unreadable ones are skipped)
  const embedded = new Map();
  for (const [path, bytes] of images) {
    try {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const png = b[0] === 0x89 && b[1] === 0x50;
      embedded.set(path, png ? await pdf.embedPng(b) : await pdf.embedJpg(b));
    } catch { /* not a JPEG/PNG: leave the cell empty */ }
  }

  // characters the font can't draw become "?" instead of breaking the PDF
  const known = new Set(F.r.getCharacterSet());
  const safe = (s) => [...String(s ?? '').replace(/\t/g, ' ').replace(/\r/g, '')]
    .map((ch) => (ch === '\n' || known.has(ch.codePointAt(0)) ? ch : '?')).join('');

  const pages = [];
  let page;
  let y;
  function newPage() {
    page = pdf.addPage([W, H]);
    page.drawPage(lh, { x: 0, y: 0, width: W, height: H });
    pages.push(page);
    y = TOP;
  }
  const room = (h) => y - h >= BOTTOM;
  function ensure(h, after) { if (!room(h)) { newPage(); if (after) after(); } }

  // word-wrap to a width (long words are broken too)
  function wrap(text, font, size, width) {
    const out = [];
    for (const para of safe(text).split('\n')) {
      const words = para.split(/ +/);
      let line = '';
      for (let w of words) {
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const test = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(test, size) <= width) line = test;
        else { if (line) out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }
  const text = (s, x, yy, font, size, opts = {}) => page.drawText(safe(s), { x, y: yy, font, size, color: opts.color || BLACK });
  const textRight = (s, xr, yy, font, size) => text(s, xr - font.widthOfTextAtSize(safe(s), size), yy, font, size);
  const textCenter = (s, xc, yy, font, size) => text(s, xc - font.widthOfTextAtSize(safe(s), size) / 2, yy, font, size);
  const underline = (x, yy, w) => page.drawLine({ start: { x, y: yy - 1.6 }, end: { x: x + w, y: yy - 1.6 }, thickness: 0.6, color: BLACK });
  const rect = (x, yy, w, h, fill) => page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: BLACK, borderWidth: 0.6, color: fill });

  newPage();

  // ---------- To / Ref / Date ----------
  const S = 11;
  const lineH = 14;
  const toX = LEFT + 46;
  text('To :', LEFT, y, F.b, S);
  text('M/s.', toX, y, F.b, S);
  const company = wrap(q.to_company || '', F.b, S, 250);
  company.forEach((l, i) => text(l, toX + 26, y - i * lineH, F.b, S));
  textRight(`Ref.${q.ref_no ? ` ${q.ref_no}` : ''}`, RIGHT, y, F.b, S);
  textRight(`Date: ${quoteDate(q.quote_date)}`, RIGHT, y - lineH, F.b, S);
  y -= Math.max(company.length, 1) * lineH;
  text(`P.O. Box : ${q.po_box || ''}`, toX, y, F.b, S); y -= lineH;
  for (const l of wrap(q.city || '', F.b, S, 300)) { text(l, toX, y, F.b, S); y -= lineH; }
  text(`Tel:  ${q.tel || ''}`, LEFT, y, F.b, S); y -= lineH;
  text(`Attn.: ${q.attn || ''}`, LEFT, y, F.b, S); y -= lineH * 1.8;

  // ---------- Project ----------
  const projLines = wrap(`Project : ${q.project_name || ''}`, F.b, 11.5, RIGHT - LEFT - 40);
  for (const l of projLines) {
    const w = F.b.widthOfTextAtSize(l, 11.5);
    textCenter(l, W / 2, y, F.b, 11.5);
    underline(W / 2 - w / 2, y, w);
    y -= 15;
  }
  y -= 4;

  // ---------- Dear Sir / intro ----------
  text(q.salutation || 'Dear Sir,', LEFT, y, F.r, 10.5); y -= 13.5;
  for (const l of wrap(q.intro || '', F.r, 10.5, RIGHT - LEFT)) { text(l, LEFT, y, F.r, 10.5); y -= 13.5; }
  y -= 6;

  // ---------- item table ----------
  const xs = [LEFT];
  for (const w of COLS) xs.push(xs[xs.length - 1] + w);
  const tableW = xs[xs.length - 1] - LEFT;
  const HEAD_H = 30;
  function drawHead() {
    rect(LEFT, y - HEAD_H, tableW, HEAD_H, GREY);
    HEADS.forEach((h, i) => {
      if (i > 0) page.drawLine({ start: { x: xs[i], y }, end: { x: xs[i], y: y - HEAD_H }, thickness: 0.6, color: BLACK });
      const parts = h.split('\n');
      const top = y - HEAD_H / 2 + (parts.length - 1) * 5.5 - 3.5;
      parts.forEach((p, k) => textCenter(p, xs[i] + COLS[i] / 2, top - k * 11, F.b, 9));
    });
    y -= HEAD_H;
  }
  ensure(HEAD_H + 50);
  drawHead();

  const FS = 9;
  const PAD = 5;
  const IMG_W = COLS[5] - 8;
  const IMG_H = 40;
  for (let n = 0; n < q.items.length; n++) {
    const it = q.items[n];
    const cells = [
      { t: String(n + 1), c: true },
      { t: it.type, c: true },
      { t: modelOf(it), c: true },
      { t: it.make, c: true, size: 10 },
      { t: it.description, c: false, size: 8.6 },
      null,
      { t: qtyText(it.qty), c: true },
      { t: money(it.unit_price), r: true },
      { t: money(it.total), r: true },
    ];
    const lines = cells.map((cell, i) => (cell ? wrap(cell.t || '', F.r, cell.size || FS, COLS[i] - PAD * 2) : []));
    const img = it.image_path ? embedded.get(it.image_path) : null;
    const textH = Math.max(...lines.map((l, i) => l.length * ((cells[i]?.size || FS) + 2)));
    const rowH = Math.max(textH + PAD * 2, img ? IMG_H + 8 : 0, 22);
    ensure(rowH, drawHead);
    rect(LEFT, y - rowH, tableW, rowH);
    for (let i = 1; i < xs.length - 1; i++) page.drawLine({ start: { x: xs[i], y }, end: { x: xs[i], y: y - rowH }, thickness: 0.6, color: BLACK });
    cells.forEach((cell, i) => {
      if (!cell) return;
      const size = cell.size || FS;
      const lh = size + 2;
      const blockH = lines[i].length * lh;
      let ty = y - (rowH - blockH) / 2 - size + 1.5;
      for (const l of lines[i]) {
        if (cell.c) textCenter(l, xs[i] + COLS[i] / 2, ty, F.r, size);
        else if (cell.r) textRight(l, xs[i + 1] - PAD, ty, F.r, size);
        else text(l, xs[i] + PAD, ty, F.r, size);
        ty -= lh;
      }
    });
    if (img) {
      const s = Math.min(IMG_W / img.width, IMG_H / img.height);
      const w = img.width * s;
      const h = img.height * s;
      page.drawImage(img, { x: xs[5] + (COLS[5] - w) / 2, y: y - rowH / 2 - h / 2, width: w, height: h });
    }
    y -= rowH;
  }

  // ---------- totals ----------
  const t = quotationTotals(q.items, q.vat_percent, q.discounts || []);
  const vatLabel = `VAT (${Number(q.vat_percent ?? 5)}%) :`;
  const rows = [['Total in AED :', money(t.total)]];
  if (t.discountLines.length) {
    for (const l of t.discountLines) rows.push([`${l.label} :`, `- ${money(l.amount)}`]);
    rows.push(['Total after Discount :', money(t.afterDiscount)]);
  }
  rows.push([vatLabel, money(t.vat)], ['Net Total in AED :', money(t.net)]);
  const TROW = 17;
  ensure(TROW * rows.length + 4);
  rows.forEach(([label, v], k) => {
    const size = k === rows.length - 1 ? 11 : 10.5;
    rect(xs[8], y - TROW, COLS[8], TROW);
    textRight(label, xs[8] - 6, y - TROW + 5, F.b, size);
    textRight(v, xs[9] - 4, y - TROW + 5, F.b, size);
    y -= TROW;
  });
  y -= 14;

  // ---------- terms ----------
  const terms = (q.terms || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (terms.length) {
    ensure(30);
    const tw = F.b.widthOfTextAtSize('Terms & Conditions', 11);
    text('Terms & Conditions', LEFT, y, F.b, 11);
    underline(LEFT, y, tw);
    y -= 13;
    for (const term of terms) {
      const ls = wrap(`* ${term}`, F.r, 8, RIGHT - LEFT);
      ensure(ls.length * 10);
      for (const l of ls) { text(l, LEFT, y, F.r, 8); y -= 10; }
    }
    y -= 8;
  }

  // ---------- delivery / payment / validity (kept together) ----------
  ensure(14 * 3);
  for (const [label, value] of [['Delivery :', q.delivery], ['Payment :', q.payment], ['Validity :', q.validity]]) {
    const ls = wrap(`${label} ${value || ''}`.trim(), F.bi, 10.5, RIGHT - LEFT);
    ensure(ls.length * 14);
    for (const l of ls) {
      text(l, LEFT, y, F.bi, 10.5);
      underline(LEFT, y, F.bi.widthOfTextAtSize(l, 10.5));
      y -= 14;
    }
  }
  y -= 8;

  // ---------- closing ----------
  const closing = wrap(q.closing || '', F.r, 10.5, RIGHT - LEFT);
  ensure(closing.length * 13.5 + 13.5 * 2 + 40 + 14);
  for (const l of closing) { text(l, LEFT, y, F.r, 10.5); y -= 13.5; }
  y -= 4;
  text('Best Regards.', LEFT, y, F.r, 10.5); y -= 13.5;
  text('For GEMS Systems LLC', LEFT, y, F.b, 10.5); y -= 44; // room for signature / stamp
  if (q.salesman) text(q.salesman, LEFT, y, F.b, 10.5);

  // ---------- Page X of Y ----------
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: W / 2 - F.r.widthOfTextAtSize(label, 8) / 2, y: 96, size: 8, font: F.r, color: BLACK });
  });
  return pdf.save();
}
