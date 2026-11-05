// Costing sheet maths, in one place so every screen (and later the
// quotation) uses exactly the same numbers.
//
// Per item row (money is in AED and kept to fils, 2 decimals, at every
// step, so what you see is what is added up):
//   Unit Price (AED)    = Mfctr's offer × exchange rate (AED for 1 unit)
//   Total Unit Price    = Unit Price × Customs+Freight
//   Total Price         = Total Unit Price × Qty
//   Selling Unit Price  = Mark up × Total Unit Price
//   Selling Total Price = Selling Unit Price × Qty
// Sheet:
//   Total Cost   = sum of every row's Total Price
//   Total (sell) = sum of every row's Selling Total Price
//   each special discount = an AED amount, or a % of that side's total
//   Gross        = Total − all special discounts   (buying and selling)
//   Gross Profit = Selling Gross − Buying Gross

// Exact decimal rounding to 2 places (1.005 → 1.01, not 1.00)
export function round2(n) {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  if (abs >= 1e15) return n; // beyond fils precision anyway
  if (String(abs).includes('e')) return 0; // smaller than 1e-7
  return sign * Number(`${Math.round(Number(`${abs}e2`))}e-2`);
}

// "1,250.5" / " 25 " / "" → number (or null when empty / not a number)
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

const mul = (a, b) => (a === null || b === null ? null : round2(a * b));

export function calcItem(it) {
  const qty = num(it.qty);
  const offer = num(it.offer_price);
  const rate = num(it.exchange_rate);
  const cf = num(it.customs_freight);
  const markup = num(it.markup);
  const unitAed = mul(offer, rate);
  const totalUnit = mul(unitAed, cf);
  const totalPrice = mul(totalUnit, qty);
  const sellUnit = mul(markup, totalUnit);
  const sellTotal = mul(sellUnit, qty);
  return { unitAed, totalUnit, totalPrice, sellUnit, sellTotal };
}

// a discount line: { label, mode: 'amount' | 'percent', value }
export function discountAed(d, base) {
  const v = num(d?.value);
  if (v === null) return 0;
  return d.mode === 'percent' ? round2((base * v) / 100) : round2(v);
}

const sum = (list) => round2(list.reduce((a, b) => a + (b || 0), 0));

// a row counts once anything is typed in it
export function isBlankItem(it) {
  return !['type', 'qty', 'make', 'model', 'code', 'description', 'image_path', 'make_oem', 'oem_code', 'offer_price', 'customs_freight', 'markup', 'remarks']
    .some((k) => String(it?.[k] ?? '').trim() !== '');
}

export function calcSheet(items, discountsBuy = [], discountsSell = []) {
  const rows = items.map(calcItem);
  const totalCost = sum(rows.map((r) => r.totalPrice));
  const totalSell = sum(rows.map((r) => r.sellTotal));
  const buyLines = discountsBuy.map((d) => discountAed(d, totalCost));
  const sellLines = discountsSell.map((d) => discountAed(d, totalSell));
  const grossBuy = round2(totalCost - sum(buyLines));
  const grossSell = round2(totalSell - sum(sellLines));
  const grossProfit = round2(grossSell - grossBuy);
  return {
    rows,
    totalCost,
    totalSell,
    buyLines,
    sellLines,
    grossBuy,
    grossSell,
    grossProfit,
    // extra guides (like the Excel's overall mark-up cell)
    overallMarkup: grossBuy ? grossSell / grossBuy : null,
    profitPercent: grossSell ? (grossProfit / grossSell) * 100 : null,
  };
}

// 10350 → "10,350.00"
export function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function emptyItem() {
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `i${Date.now()}${Math.random()}`,
    type: '', qty: '', make: '', model: '', code: '', description: '', image_path: '',
    make_oem: '', oem_code: '', offer_price: '', offer_currency: 'AED', exchange_rate: '1',
    customs_freight: '', markup: '', remarks: '',
  };
}

export function emptyDiscount(n = 1) {
  return { label: `Special discount${n > 1 ? ` ${n}` : ''}`, mode: 'amount', value: '' };
}
