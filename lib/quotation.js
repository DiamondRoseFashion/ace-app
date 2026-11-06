// Quotation made from a costing sheet: its defaults, the items taken
// from the sheet (selling prices only, never costs) and its totals.
// The PDF itself is drawn by lib/quotationPdf.js.
import { calcItem, isBlankItem, round2, num, discountAed } from '@/lib/costing';

export const DEFAULT_INTRO = 'Further to your inquiry, we would like to quote our best offer for the supply of light fittings as mentioned below.';

export const DEFAULT_TERMS = [
  'No additional accessories included until otherwise mentioned.',
  'Our prices are based on the complete material offered above, any changes in material will effect the prices.',
  'L.O.I or Order confirmation will not lead to processed ahead with our manufacturer till the final approval is received',
  'The delivery up to your site without off loading, Security pass for delivery shall be arranged by the contractor.',
  'The prices are valid for single order for the quantity and items as stated there in',
  'Our offer includes only those material which is clearly stated there in.',
  'The prices are for supply only any technical assistance during installation will be charged separately.',
  'No penalty will be accepted.',
  'Once the quantity ordered can not be reduced or taken back.',
  'Any variation in VAT rate by Government authorities shall be applicable and will be considered at the time of order/ invoice.',
];

export const DEFAULT_CLOSING = 'Should you require any further clarification please feel free to contact us.';

// costing sheet rows → quotation rows (Unit Price = selling U.P, Total = selling T.P)
export function itemsFromCosting(costingItems = []) {
  return costingItems.filter((it) => !isBlankItem(it)).map((it) => {
    const c = calcItem(it);
    return {
      type: String(it.type || '').trim(),
      model: String(it.model || '').trim(),
      make: String(it.make || '').trim(),
      code: String(it.code || '').trim(),
      description: String(it.description || '').trim(),
      image_path: it.image_path || '',
      qty: num(it.qty),
      unit_price: c.sellUnit,
      total: c.sellTotal,
    };
  });
}

// the costing sheet's selling special discounts (empty / zero ones left out)
export function discountsFromCosting(list = []) {
  return list
    .filter((d) => (num(d?.value) ?? 0) !== 0)
    .map((d) => ({ label: String(d.label || '').trim(), mode: d.mode === 'percent' ? 'percent' : 'amount', value: String(d.value).trim() }));
}

// "Special Discount (5%)" / "Special Discount 2"
export function discountLabel(d) {
  const base = d.label || 'Special Discount';
  const name = base.replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase()); // "special discount" → "Special Discount"
  return d.mode === 'percent' ? `${name} (${num(d.value)}%)` : name;
}

// Total → special discounts (a % is of the Total, as on the costing sheet)
// → Total after Discount → VAT on that → Net Total
export function quotationTotals(items = [], vatPercent = 5, discounts = []) {
  const total = round2(items.reduce((a, it) => a + (Number.isFinite(it.total) ? it.total : 0), 0));
  const lines = discounts.map((d) => ({ label: discountLabel(d), amount: discountAed(d, total) })).filter((l) => l.amount !== 0);
  const afterDiscount = round2(total - lines.reduce((a, l) => a + l.amount, 0));
  const vat = round2((afterDiscount * (num(vatPercent) ?? 0)) / 100);
  return { total, discountLines: lines, afterDiscount, vat, net: round2(afterDiscount + vat) };
}

// "2026-04-07" → "07-04-2026" (as on the printed quotation)
export function quoteDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}-${m}-${y}` : '';
}

// the quotation's "Model" column shows the product Code (as on the
// sample quotation), or the model when there's no code
export const modelOf = (it) => it.code || it.model || '';

// qty shown without needless decimals: 50 → "50", 2.5 → "2.5"
export function qtyText(q) {
  if (q === null || q === undefined || !Number.isFinite(q)) return '';
  return String(round2(q));
}
