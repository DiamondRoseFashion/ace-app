// Builds app/theme-dark.css from app/globals.css.
// Dark mode = every light surface (cards, inputs, rows, chips…) turned
// dark and dark text turned light, keeping each colour's hue.
// Re-run after changing colours in globals.css:
//   node scripts/make-dark-theme.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../app/globals.css', import.meta.url);
const OUT = new URL('../app/theme-dark.css', import.meta.url);
const PREFIX = 'html[data-theme="dark"]';

// ---------- colours ----------
const NAMED = { white: '#ffffff', black: '#000000' };
function parseColor(str) {
  let s = str.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
const fmt = ({ h, s, l }, a) => `hsl${a < 1 ? 'a' : ''}(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${a < 1 ? ` / ${a}` : ''})`;

// light surface -> dark surface (white cards become deep navy)
function darkSurface(c) {
  if (c.a < 0.5) return null; // see-through tints stay as they are
  const hsl = toHsl(c);
  if (hsl.l < 0.78) return null; // already dark or a strong colour (buttons, badges)
  if (hsl.s < 0.06) { hsl.h = 222; hsl.s = 0.3; } // plain white/grey -> ACE navy
  else hsl.s = Math.min(hsl.s, 0.2); // soft tints stay soft
  return fmt({ h: hsl.h, s: hsl.s, l: 0.13 + (1 - hsl.l) * 0.8 }, c.a);
}
// dark text -> light text
function lightText(c) {
  if (c.a < 0.5) return null;
  const hsl = toHsl(c);
  if (hsl.l >= 0.5) return null; // already light
  return fmt({ h: hsl.h, s: Math.min(hsl.s, 0.55), l: 0.9 - hsl.l * 0.45 }, c.a);
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b/g;
const TEXT_PROPS = /^(color|fill|stroke|caret-color|-webkit-text-fill-color|text-decoration-color)$/;
const SURFACE_PROPS = /^(background|background-color|background-image|border|border-(top|right|bottom|left)|border-(top-|right-|bottom-|left-)?color|outline|outline-color)$/;

// ---------- a small CSS reader (rules, @media blocks; @keyframes skipped) ----------
function strip(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function blocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1; let j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out.push({ head, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
function decls(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const k = d.indexOf(':');
    return k < 0 ? null : { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() };
  }).filter(Boolean);
}

const src = strip(readFileSync(SRC, 'utf8'));
// :root variables (var(--deep) etc. used as text are resolved through these)
const rootVars = {};
for (const b of blocks(src)) {
  if (b.head === ':root') for (const d of decls(b.body)) if (d.prop.startsWith('--')) rootVars[d.prop] = d.value;
}
// variables recoloured once at the top (so every use follows)
const VAR_TEXT = /^--(ink|muted)$/;
const VAR_SURFACE = /^--(panel|paper|line|[a-z-]*-bg)$/;

function mapValue(value, fn) {
  let changed = false;
  const v = value.replace(COLOR_RE, (m) => {
    const c = parseColor(m);
    const n = c && fn(c);
    if (n) { changed = true; return n; }
    return m;
  });
  return changed ? v : null;
}

const resolveVars = (v) => v.replace(/var\((--[\w-]+)\)/g, (m, name) => rootVars[name] || m);
// left as they are: the starry page backgrounds and the Settings look previews
const SKIP = /\.shell::before|\.auth-shell\b|\.sw-/;

function convertRule(head, body) {
  if (SKIP.test(head)) return '';
  const ds = decls(body);
  // a rule that keeps a light-but-strong background (gold button, badge) keeps its dark text
  const keepsBg = ds.some((d) => SURFACE_PROPS.test(d.prop) && /^background/.test(d.prop)
    && (resolveVars(d.value).match(COLOR_RE) || []).some((m) => { const c = parseColor(m); return c && c.a >= 0.5 && !darkSurface(c) && toHsl(c).l > 0.45; }));
  const out = [];
  for (const d of ds) {
    const important = /!important$/.test(d.value);
    const value = d.value.replace(/\s*!important$/, '');
    let n = null;
    if (d.prop.startsWith('--')) {
      if (head === ':root') {
        if (VAR_TEXT.test(d.prop)) n = mapValue(value, lightText);
        else if (VAR_SURFACE.test(d.prop)) n = mapValue(value, darkSurface);
      } else if (VAR_TEXT.test(d.prop) && !keepsBg) n = mapValue(value, lightText);
    } else if (TEXT_PROPS.test(d.prop)) {
      if (keepsBg) continue;
      // resolve var(--deep) / var(--violet) etc. that aren't recoloured at the top
      const resolved = value.replace(/var\((--[\w-]+)\)/g, (m, name) => (VAR_TEXT.test(name) || !rootVars[name] ? m : rootVars[name]));
      n = mapValue(resolved, lightText);
    } else if (SURFACE_PROPS.test(d.prop)) {
      n = mapValue(value, darkSurface);
    }
    if (n) out.push(`${d.prop}:${n}${important ? ' !important' : ''}`);
  }
  if (!out.length) return '';
  const sel = head.split(',').map((s) => {
    s = s.trim();
    if (s.startsWith(':root')) return PREFIX + s.slice(5);
    if (/^html\b/.test(s)) return PREFIX + s.slice(4);
    return `${PREFIX} ${s}`;
  }).join(', ');
  return `${sel}{${out.join('; ')}}\n`;
}

function walk(css) {
  let out = '';
  for (const b of blocks(css)) {
    if (b.head.startsWith('@keyframes') || b.head.startsWith('@font-face')) continue;
    if (b.head.startsWith('@media') || b.head.startsWith('@supports')) {
      const inner = walk(b.body);
      if (inner) out += `${b.head}{\n${inner}}\n`;
      continue;
    }
    out += convertRule(b.head, b.body);
  }
  return out;
}

// hand-tuned touches the automatic colours can't guess
const EXTRA = `
${PREFIX} .cal-day.out{background:hsl(222 32% 9%)}
${PREFIX} .cal-day.out .cal-num{color:hsl(222 12% 45%)}
`;

const result = `/* Dark mode — made by scripts/make-dark-theme.mjs from globals.css. Don't edit by hand: re-run the script. */\n${walk(src)}${EXTRA}`;
writeFileSync(OUT, result);
console.log(`theme-dark.css: ${result.split('\n').length} lines`);
