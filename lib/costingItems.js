// Costing sheet product list ("Create an item"): one entry per Code.
// Same for every use of a code: Model, Type, Housing, Diffuser, Image.
// Lists of choices (variations): Wattage, Lumen, Dimension, CCT, IP.

// the lists, in the order they appear in the pop-up
export const VARIANT_FIELDS = [
  { key: 'wattage', list: 'wattages', label: 'Wattage', placeholder: 'e.g. 30W' },
  { key: 'lumen', list: 'lumens', label: 'Lumen', placeholder: 'e.g. 120lm/W' },
  { key: 'dimension', list: 'dimensions', label: 'Dimension', placeholder: 'e.g. 600*85*75' },
  { key: 'cct', list: 'ccts', label: 'CCT', placeholder: 'e.g. 3000K' },
  { key: 'ip', list: 'ips', label: 'IP', placeholder: 'e.g. IP66' },
];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// add a value to a list once (case-insensitive), keeping the order
export function addTo(list, value) {
  const v = clean(value);
  if (!v) return list || [];
  return (list || []).some((x) => same(x, v)) ? list : [...(list || []), v];
}

export function hasValue(list, value) {
  return (list || []).some((x) => same(x, value));
}

// "LED Weather Proof" → "LED Weather Proof light fitting";
// a type that already says light / fitting / lamp is kept as it is
function typeText(t) {
  const v = clean(t);
  if (!v) return '';
  return /fitting|light|lamp|luminaire|fixture/i.test(v) ? v : `${v} light fitting`;
}
const withWord = (v, word) => {
  const s = clean(v);
  if (!s) return '';
  return new RegExp(`\\b${word}\\b`, 'i').test(s) ? s : `${s} ${word}`;
};

// The description made from an item and the chosen variations:
// Wattage, Type, Housing, Diffuser, IP, Lumen, CCT, Dimension
// e.g. "30W, LED Weather Proof light fitting, Polycarbonate housing,
//       PC Opal diffuser, IP66, 120lm/W, 3000K, 600*85*75"
export function buildDescription(item, pick) {
  return [
    clean(pick?.wattage),
    typeText(item?.item_type),
    withWord(item?.housing, 'housing'),
    withWord(item?.diffuser, 'diffuser'),
    clean(pick?.ip),
    clean(pick?.lumen),
    clean(pick?.cct),
    clean(pick?.dimension),
  ].filter(Boolean).join(', ');
}

export const findItem = (items, code) => (items || []).find((x) => same(x.code, code)) || null;
