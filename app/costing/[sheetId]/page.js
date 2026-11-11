'use client';

// Costing sheet editor: the same layout as the "Costing _Final_ R" Excel.
//  • Top details (project, client, contractor, consultant, quotation no.
//    and date) came from the project and can be edited here.
//  • One row per item. A new empty row is always waiting at the bottom:
//    type in it and the next Sl No appears.
//  • Make / Model / Code / Make (OEM) / OEM Code: shared dropdowns with
//    a search box; new values are shared with everyone on Save.
//  • Code → its saved Description(s), Mfctr's offer and image fill in
//    by themselves (all still editable). One code can have several
//    descriptions: you pick one.
//  • Image: paste a snip (Ctrl+V) or choose a file; it's remembered for
//    that Code + Description and appears by itself next time.
//  • Every price and total is worked out by lib/costing.js.
// Admin, plus people listed in costing_access (has_costing_access in the database).
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import DateInput from '@/components/DateInput';
import CostingCombo from '@/components/CostingCombo';
import { shrinkToLimit } from '@/lib/shrinkImage';
import {
  num, calcSheet, money, isBlankItem, emptyItem, emptyDiscount,
} from '@/lib/costing';

const BUCKET = 'costing-images';
const MAX_IMAGE_BYTES = 300 * 1024; // costing sheet images are stored at 300 KB at most
const ITEM_KEYS = ['id', 'type', 'qty', 'make', 'model', 'code', 'description', 'image_path', 'make_oem', 'oem_code',
  'offer_price', 'offer_currency', 'exchange_rate', 'customs_freight', 'markup', 'remarks'];
const NUM_KEYS = ['qty', 'offer_price', 'exchange_rate', 'customs_freight', 'markup'];
const OPTION_KINDS = ['make', 'model', 'code', 'make_oem', 'oem_code'];
// column widths (px), in table order: Sl, Type, Qty, Make, Model, Code, Description, Image,
// Make (OEM), OEM Code, Mfctr's Offer, Unit Price, Customs+Freight, Total Unit Price,
// Total Price, Mark up, U.P, T.P, Remarks, row buttons
const COL_WIDTHS = [44, 74, 66, 124, 124, 172, 260, 98, 124, 120, 156, 100, 84, 104, 116, 76, 104, 116, 170, 78];
const key = (s) => String(s || '').trim().toLowerCase();

// Supabase hands back at most 1000 rows at a time: fetch every page
async function fetchAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) return { data: out, error: null };
  }
}

// always an empty row waiting at the bottom (a row emptied while typing
// stays where it is; empty rows are left out when the sheet is saved)
function withBlank(list) {
  const rows = [...list];
  if (!rows.length || !isBlankItem(rows[rows.length - 1])) rows.push(emptyItem());
  return rows;
}

function cleanItem(it) {
  const o = {};
  for (const k of ITEM_KEYS) o[k] = typeof it[k] === 'string' ? it[k].trim() : (it[k] ?? '');
  for (const k of NUM_KEYS) if (o[k] !== '') o[k] = String(num(o[k]) ?? o[k]);
  return o;
}

// a saved row → every field a string, ready for the boxes
function loadItem(saved) {
  const it = emptyItem();
  for (const k of ITEM_KEYS) if (k !== 'id' && saved?.[k] !== null && saved?.[k] !== undefined) it[k] = String(saved[k]);
  if (saved?.id) it.id = String(saved.id);
  if (!it.offer_currency) it.offer_currency = 'AED';
  return it;
}

const badNum = (v) => String(v ?? '').trim() !== '' && num(v) === null;

export default function CostingSheetPage() {
  const router = useRouter();
  const { sheetId } = useParams();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [state, setState] = useState('loading'); // loading | ok | denied | missing | notfound
  const [projectId, setProjectId] = useState(null);
  const [head, setHead] = useState({ revision: 'R0', project_name: '', client: '', contractor: '', consultant: '', quotation_no: '', quotation_date: '' });
  const [items, setItems] = useState([emptyItem()]);
  const [discBuy, setDiscBuy] = useState([emptyDiscount()]);
  const [discSell, setDiscSell] = useState([emptyDiscount()]);
  const [note, setNote] = useState('');
  const [options, setOptions] = useState({}); // kind → [values]
  const [products, setProducts] = useState([]);
  const [rates, setRates] = useState([]); // [{ code, rate }]
  const [urls, setUrls] = useState({}); // image path → signed url
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [savedAt, setSavedAt] = useState(null);
  const [descPick, setDescPick] = useState(null); // { id, rect }
  const [uploading, setUploading] = useState(null); // item id
  const [showRates, setShowRates] = useState(false);

  // ---------- load ----------
  async function loadLists() {
    const [opt, prod, rt] = await Promise.all([
      fetchAll(() => supabase.from('costing_options').select('kind, value').order('value')),
      fetchAll(() => supabase.from('costing_products').select('code, description, offer_price, offer_currency, image_path, updated_at').order('updated_at', { ascending: false })),
      supabase.from('currency_rates').select('code, rate').order('code'),
    ]);
    const o = {};
    for (const k of OPTION_KINDS) o[k] = [];
    for (const r of opt.data || []) (o[r.kind] ||= []).push(r.value);
    setOptions(o);
    setProducts(prod.data || []);
    setRates(rt.data || []);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: ok, error: accErr } = await supabase.rpc('has_costing_access');
      if (accErr) { setState('missing'); return; }
      if (!ok) { setState('denied'); return; }
      const { data: sheet, error } = await supabase.from('costing_sheets').select('*').eq('id', sheetId).maybeSingle();
      if (error || !sheet) { setState(error ? 'missing' : 'notfound'); return; }
      setProjectId(sheet.project_id);
      setHead({
        revision: sheet.revision || 'R0',
        project_name: sheet.project_name || '',
        client: sheet.client || '',
        contractor: sheet.contractor || '',
        consultant: sheet.consultant || '',
        quotation_no: sheet.quotation_no || '',
        quotation_date: sheet.quotation_date || '',
      });
      setItems(withBlank((sheet.items || []).map(loadItem).filter((it) => !isBlankItem(it))));
      setDiscBuy(sheet.discounts_buy?.length ? sheet.discounts_buy : [emptyDiscount()]);
      setDiscSell(sheet.discounts_sell?.length ? sheet.discounts_sell : [emptyDiscount()]);
      setNote(sheet.note || '');
      setSavedAt(sheet.updated_at);
      await loadLists();
      setState('ok');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  // signed links for the images on this sheet (the bucket is private)
  useEffect(() => {
    const need = [...new Set(items.map((it) => it.image_path).filter((p) => p && !urls[p]))];
    if (!need.length) return;
    (async () => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 6);
      const add = {};
      for (const r of data || []) if (r.signedUrl) add[r.path] = r.signedUrl;
      if (Object.keys(add).length) setUrls((u) => ({ ...u, ...add }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ---------- don't lose work ----------
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank' || !a.href.startsWith(window.location.origin)) return;
      if (a.href === window.location.href) return;
      if (!window.confirm('You have unsaved changes on this costing sheet. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onClick, true); };
  }, [dirty]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- lookups ----------
  const byCode = useMemo(() => {
    const m = new Map();
    for (const p of products) {
      const k = key(p.code);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  }, [products]);
  const productsFor = (code) => byCode.get(key(code)) || [];
  const findProduct = (code, desc) => productsFor(code).find((p) => key(p.description) === key(desc));
  const rateOf = (cur) => rates.find((r) => r.code === cur)?.rate;
  const currencies = useMemo(() => {
    const list = rates.map((r) => r.code);
    for (const it of items) if (it.offer_currency && !list.includes(it.offer_currency)) list.push(it.offer_currency);
    return list.length ? list : ['AED'];
  }, [rates, items]);

  // what a remembered product fills in
  function fromProduct(p, { price = true, image = true } = {}) {
    const patch = {};
    if (price && p.offer_price !== null && p.offer_price !== undefined) {
      const cur = p.offer_currency || 'AED';
      patch.offer_price = String(p.offer_price);
      patch.offer_currency = cur;
      patch.exchange_rate = String(rateOf(cur) ?? (cur === 'AED' ? 1 : ''));
    }
    if (image && p.image_path) patch.image_path = p.image_path;
    return patch;
  }

  // ---------- editing ----------
  function change(next) {
    setItems(withBlank(next));
    setDirty(true);
    setMsg(null);
  }
  function setItem(id, patch) {
    change(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function onCode(it, code, rect) {
    const list = productsFor(code);
    let patch = { code };
    if (!code) { setItem(it.id, patch); return; }
    const same = it.description && findProduct(code, it.description);
    if (same) patch = { ...patch, ...fromProduct(same) };
    else if (list.length === 1) patch = { ...patch, description: list[0].description, ...fromProduct(list[0]) };
    else if (list.length > 1) setDescPick({ id: it.id, rect });
    if (!same && list.length !== 1 && key(code) !== key(it.code)) patch.image_path = ''; // the old code's image doesn't belong to the new one
    setItem(it.id, patch);
  }

  function pickDescription(id, p) {
    setDescPick(null);
    setItem(id, { description: p.description, ...fromProduct(p) });
  }

  // typed a description by hand: bring in its remembered image / price if
  // the row doesn't have its own yet
  function onDescriptionBlur(it) {
    const p = findProduct(it.code, it.description);
    if (!p) return;
    const patch = {};
    if (!it.image_path && p.image_path) patch.image_path = p.image_path;
    if (String(it.offer_price).trim() === '') Object.assign(patch, fromProduct(p, { image: false }));
    if (Object.keys(patch).length) setItem(it.id, patch);
  }

  function onCurrency(it, cur) {
    setItem(it.id, { offer_currency: cur, exchange_rate: String(rateOf(cur) ?? (cur === 'AED' ? 1 : it.exchange_rate)) });
  }

  function move(id, dir) {
    const i = items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= items.length - 1) return; // never past the empty last row
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  }
  function remove(id) { change(items.filter((x) => x.id !== id)); }

  async function uploadImage(it, file) {
    if (!file || !/^image\//.test(file.type || '')) { setMsg({ ok: false, text: 'That is not an image. Snip it with the Snipping Tool, then click the image box and press Ctrl+V.' }); return; }
    setUploading(it.id);
    try {
      const blob = await shrinkToLimit(file, MAX_IMAGE_BYTES); // made smaller automatically to fit 300 KB
      const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
      const path = `products/${id}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 6);
      if (data?.signedUrl) setUrls((u) => ({ ...u, [path]: data.signedUrl }));
      setItems((list) => withBlank(list.map((x) => (x.id === it.id ? { ...x, image_path: path } : x))));
      setDirty(true);
    } catch (e) {
      setMsg({ ok: false, text: `The image couldn't be uploaded: ${e.message || 'please try again'}.` });
    }
    setUploading(null);
  }

  // ---------- discounts ----------
  function setDisc(side, i, patch) {
    const [list, set] = side === 'buy' ? [discBuy, setDiscBuy] : [discSell, setDiscSell];
    set(list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setDirty(true);
  }
  function addDisc(side) {
    const [list, set] = side === 'buy' ? [discBuy, setDiscBuy] : [discSell, setDiscSell];
    set([...list, emptyDiscount(list.length + 1)]);
    setDirty(true);
  }
  function removeDisc(side, i) {
    const [list, set] = side === 'buy' ? [discBuy, setDiscBuy] : [discSell, setDiscSell];
    const next = list.filter((_, j) => j !== i);
    set(next.length ? next : [emptyDiscount()]);
    setDirty(true);
  }

  // ---------- save ----------
  async function save() {
    if (saving || state !== 'ok') return;
    setMsg(null);
    const rows = items.filter((it) => !isBlankItem(it)).map(cleanItem);
    const bad = rows.findIndex((it) => NUM_KEYS.some((k) => badNum(it[k])));
    if (bad >= 0) { setMsg({ ok: false, text: `Row ${bad + 1} has a number that isn't valid (red box). Please fix it, then save.` }); return; }
    const badD = [...discBuy, ...discSell].some((d) => badNum(d.value));
    if (badD) { setMsg({ ok: false, text: 'A special discount isn\'t a valid number (red box). Please fix it, then save.' }); return; }
    setSaving(true);
    const payload = {
      revision: head.revision.trim() || 'R0',
      project_name: head.project_name.trim() || null,
      client: head.client.trim() || null,
      contractor: head.contractor.trim() || null,
      consultant: head.consultant.trim() || null,
      quotation_no: head.quotation_no.trim() || null,
      quotation_date: head.quotation_date || null,
      items: rows,
      discounts_buy: discBuy.map((d) => ({ label: String(d.label || '').trim(), mode: d.mode === 'percent' ? 'percent' : 'amount', value: String(d.value ?? '').trim() })),
      discounts_sell: discSell.map((d) => ({ label: String(d.label || '').trim(), mode: d.mode === 'percent' ? 'percent' : 'amount', value: String(d.value ?? '').trim() })),
      note: note.trim() || null,
    };
    const { data, error } = await supabase.from('costing_sheets').update(payload).eq('id', sheetId).select('updated_at').maybeSingle();
    if (error || !data) {
      setSaving(false);
      setMsg({ ok: false, text: error ? `Couldn't save: ${error.message}` : 'Couldn\'t save: this sheet was deleted or you no longer have access.' });
      return;
    }
    // share new dropdown values and remember code + description details
    const { error: learnErr } = await supabase.rpc('costing_learn', { p_items: rows });
    await loadLists();
    setSaving(false);
    setDirty(false);
    setSavedAt(data.updated_at);
    setMsg(learnErr
      ? { ok: false, text: `Saved, but the dropdown lists couldn't be updated: ${learnErr.message}` }
      : { ok: true, text: 'Saved ✓' });
  }

  // ---------- render ----------
  const calc = useMemo(() => calcSheet(items, discBuy, discSell), [items, discBuy, discSell]);
  const discRows = Math.max(discBuy.length, discSell.length);

  if (state !== 'ok') {
    const text = {
      loading: 'Loading…',
      denied: 'Costing sheets are not turned on for your account yet. Please ask your admin.',
      missing: 'Costing sheets need a one-time database update. Please ask your admin to run the "costing sheets" update in Supabase.',
      notfound: 'This costing sheet was not found. It may have been deleted.',
    }[state];
    return (
      <div className="shell">
        <Sidebar active="dashboard" />
        <div className="main"><div className="card"><div className={state === 'loading' ? 'hint' : 'notice err'} style={{ margin: 0 }}>{text}</div></div></div>
      </div>
    );
  }

  const field = (k, label, wide) => (
    <label className={`cs-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <input value={head[k]} onChange={(e) => { setHead({ ...head, [k]: e.target.value }); setDirty(true); }} />
    </label>
  );

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main costing">
        <div className="page-header">
          <div>
            <div className="eyebrow">Costing sheet · {head.revision}</div>
            <h1 style={{ fontSize: 28, marginTop: 4 }}>{head.project_name || 'Costing sheet'}</h1>
          </div>
          <div className="header-actions cs-actions">
            <span className={`cs-status${dirty ? ' dirty' : ''}`}>
              {saving ? 'Saving…' : dirty ? '● Unsaved changes' : savedAt ? `Saved ${new Date(savedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setShowRates(true)}>💱 Currency rates</button>
            {projectId && <Link className="btn btn-ghost" href={`/project/${projectId}/costing`}>← All sheets</Link>}
            <Link className="btn btn-ghost" href={`/quotation/${sheetId}`} title="Make or open the quotation for this costing sheet">📄 Quotation</Link>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save (Ctrl+S)'}</button>
          </div>
        </div>
        {msg && <div className={msg.ok ? 'notice ok' : 'notice err'}>{msg.text}</div>}

        <div className="card cs-card">
          <div className="cs-title">COSTING SHEET</div>
          <div className="cs-head">
            {field('project_name', 'Project', true)}
            {field('client', 'Client')}
            {field('contractor', 'Contractor')}
            {field('consultant', 'Consultant')}
            {field('quotation_no', 'Quotation No')}
            <label className="cs-field">
              <span>Date</span>
              <DateInput value={head.quotation_date} onChange={(e) => { setHead({ ...head, quotation_date: e.target.value }); setDirty(true); }} />
            </label>
            {field('revision', 'Revision')}
          </div>

          <div className="cs-scroll">
            <table className="cs-table" style={{ width: COL_WIDTHS.reduce((x, y) => x + y, 0) }}>
              <colgroup>{COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead>
                <tr>
                  <th rowSpan={2} className="c-sl">Sl No</th>
                  <th rowSpan={2} className="c-type">Type</th>
                  <th rowSpan={2} className="c-qty">Qty</th>
                  <th rowSpan={2} className="c-dd">Make</th>
                  <th rowSpan={2} className="c-dd">Model</th>
                  <th rowSpan={2} className="c-dd">Code</th>
                  <th rowSpan={2} className="c-desc">Description</th>
                  <th rowSpan={2} className="c-img">Image</th>
                  <th rowSpan={2} className="c-dd">Make (OEM)</th>
                  <th rowSpan={2} className="c-dd">OEM Code</th>
                  <th rowSpan={2} className="c-offer">Mfctr&apos;s Offer</th>
                  <th colSpan={4} className="grp buy">Buying Cost</th>
                  <th rowSpan={2} className="c-num">Mark up</th>
                  <th colSpan={2} className="grp sell">Selling Cost</th>
                  <th rowSpan={2} className="c-rem">Remarks</th>
                  <th rowSpan={2} className="c-act"><span className="sr-only">Row actions</span></th>
                </tr>
                <tr>
                  <th className="c-money buy">Unit Price<small>(AED)</small></th>
                  <th className="c-num buy">Customs + Freight</th>
                  <th className="c-money buy">Total Unit Price</th>
                  <th className="c-money buy">Total Price<small>(Unit Rate × Qty)</small></th>
                  <th className="c-money sell">U.P<small>(Mark up × Total Unit Price)</small></th>
                  <th className="c-money sell">T.P<small>(U.P × Qty)</small></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const c = calc.rows[idx];
                  const last = idx === items.length - 1;
                  const descs = productsFor(it.code);
                  const canImage = it.code.trim() && it.description.trim();
                  const url = it.image_path && urls[it.image_path];
                  return (
                    <tr key={it.id} className={last ? 'cs-new' : ''}>
                      <td className="c-sl">{idx + 1}</td>
                      <td><input className="cs-in" value={it.type} onChange={(e) => setItem(it.id, { type: e.target.value })} aria-label={`Row ${idx + 1} type`} placeholder={last ? 'Type…' : ''} /></td>
                      <td><input className={`cs-in num${badNum(it.qty) ? ' bad' : ''}`} inputMode="decimal" value={it.qty} onChange={(e) => setItem(it.id, { qty: e.target.value })} aria-label={`Row ${idx + 1} quantity`} /></td>
                      <td><CostingCombo value={it.make} options={options.make} onChange={(v) => setItem(it.id, { make: v })} ariaLabel={`Row ${idx + 1} make`} /></td>
                      <td><CostingCombo value={it.model} options={options.model} onChange={(v) => setItem(it.id, { model: v })} ariaLabel={`Row ${idx + 1} model`} /></td>
                      <td>
                        <CostingCombo
                          value={it.code}
                          options={options.code}
                          wide
                          onChange={(v) => onCode(it, v, document.getElementById(`desc-${it.id}`)?.getBoundingClientRect())}
                          ariaLabel={`Row ${idx + 1} code`}
                        />
                      </td>
                      <td className="c-desc">
                        <textarea
                          id={`desc-${it.id}`}
                          className="cs-in cs-desc"
                          rows={2}
                          value={it.description}
                          onChange={(e) => setItem(it.id, { description: e.target.value })}
                          onBlur={() => onDescriptionBlur(it)}
                          aria-label={`Row ${idx + 1} description`}
                        />
                        {descs.length > 1 && (
                          <button
                            type="button"
                            className="cs-desc-pick"
                            onClick={(e) => setDescPick({ id: it.id, rect: e.currentTarget.closest('td').getBoundingClientRect() })}
                          >
                            ▾ {descs.length} saved descriptions
                          </button>
                        )}
                      </td>
                      <td className="c-img">
                        {url ? (
                          <div className="cs-img">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={it.description || it.code} /></a>
                            <button type="button" className="cs-img-x" aria-label="Remove image" title="Remove image from this row" onClick={() => setItem(it.id, { image_path: '' })}>×</button>
                          </div>
                        ) : it.image_path ? (
                          <div className="cs-img-wait">…</div>
                        ) : canImage ? (
                          <ImageDrop busy={uploading === it.id} onFile={(f) => uploadImage(it, f)} />
                        ) : (
                          <span className="cs-muted" title="Add the Code and Description first">—</span>
                        )}
                      </td>
                      <td><CostingCombo value={it.make_oem} options={options.make_oem} onChange={(v) => setItem(it.id, { make_oem: v })} ariaLabel={`Row ${idx + 1} make (OEM)`} /></td>
                      <td><CostingCombo value={it.oem_code} options={options.oem_code} onChange={(v) => setItem(it.id, { oem_code: v })} ariaLabel={`Row ${idx + 1} OEM code`} /></td>
                      <td className="c-offer">
                        <div className="cs-offer">
                          <input className={`cs-in num${badNum(it.offer_price) ? ' bad' : ''}`} inputMode="decimal" value={it.offer_price} onChange={(e) => setItem(it.id, { offer_price: e.target.value })} aria-label={`Row ${idx + 1} manufacturer's offer`} />
                          <select className="cs-cur" value={it.offer_currency || 'AED'} onChange={(e) => onCurrency(it, e.target.value)} aria-label={`Row ${idx + 1} currency`}>
                            {currencies.map((cu) => <option key={cu} value={cu}>{cu}</option>)}
                          </select>
                        </div>
                        {(it.offer_currency || 'AED') !== 'AED' && (
                          <label className="cs-rate">
                            1 {it.offer_currency} =
                            <input className={`cs-in num${badNum(it.exchange_rate) ? ' bad' : ''}`} inputMode="decimal" value={it.exchange_rate} onChange={(e) => setItem(it.id, { exchange_rate: e.target.value })} aria-label={`Row ${idx + 1} exchange rate`} />
                            AED
                          </label>
                        )}
                      </td>
                      <td className="c-money calc">{money(c.unitAed)}</td>
                      <td><input className={`cs-in num${badNum(it.customs_freight) ? ' bad' : ''}`} inputMode="decimal" value={it.customs_freight} onChange={(e) => setItem(it.id, { customs_freight: e.target.value })} aria-label={`Row ${idx + 1} customs and freight`} /></td>
                      <td className="c-money calc">{money(c.totalUnit)}</td>
                      <td className="c-money calc strong">{money(c.totalPrice)}</td>
                      <td><input className={`cs-in num${badNum(it.markup) ? ' bad' : ''}`} inputMode="decimal" value={it.markup} onChange={(e) => setItem(it.id, { markup: e.target.value })} aria-label={`Row ${idx + 1} mark up`} /></td>
                      <td className="c-money calc sell">{money(c.sellUnit)}</td>
                      <td className="c-money calc strong sell">{money(c.sellTotal)}</td>
                      <td><textarea className="cs-in cs-rem" rows={2} value={it.remarks} onChange={(e) => setItem(it.id, { remarks: e.target.value })} aria-label={`Row ${idx + 1} remarks`} /></td>
                      <td className="c-act">
                        {!last && (
                          <div className="cs-rowbtns">
                            <button type="button" onClick={() => move(it.id, -1)} disabled={idx === 0} aria-label="Move up" title="Move up">↑</button>
                            <button type="button" onClick={() => move(it.id, 1)} disabled={idx >= items.length - 2} aria-label="Move down" title="Move down">↓</button>
                            <button type="button" className="del" onClick={() => remove(it.id)} aria-label={`Delete row ${idx + 1}`} title="Delete row">×</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="cs-total">
                  <td colSpan={11} rowSpan={discRows + 4} className="cs-note-cell">
                    <label className="cs-note">
                      <span>Note</span>
                      <textarea rows={4} value={note} onChange={(e) => { setNote(e.target.value); setDirty(true); }} placeholder="Availability FOB/CIF, lead time, anything to remember…" />
                    </label>
                  </td>
                  <td colSpan={3} className="lbl">Total Cost :</td>
                  <td className="c-money strong">{money(calc.totalCost)}</td>
                  <td className="c-num cs-muted" title="Overall mark up = Total ÷ Total Cost">{calc.totalCost ? `×${(calc.totalSell / calc.totalCost).toFixed(2)}` : ''}</td>
                  <td className="lbl">Total :</td>
                  <td className="c-money strong">{money(calc.totalSell)}</td>
                  <td colSpan={2} />
                </tr>
                {Array.from({ length: discRows }, (_, i) => (
                  <tr key={`d${i}`} className="cs-disc">
                    <td colSpan={3}>{discBuy[i] && <DiscountEdit d={discBuy[i]} onChange={(p) => setDisc('buy', i, p)} onRemove={() => removeDisc('buy', i)} canRemove={discBuy.length > 1 || String(discBuy[i].value).trim() !== ''} />}</td>
                    <td className="c-money">{discBuy[i] ? `− ${money(calc.buyLines[i])}` : ''}</td>
                    <td colSpan={2}>{discSell[i] && <DiscountEdit d={discSell[i]} onChange={(p) => setDisc('sell', i, p)} onRemove={() => removeDisc('sell', i)} canRemove={discSell.length > 1 || String(discSell[i].value).trim() !== ''} />}</td>
                    <td className="c-money">{discSell[i] ? `− ${money(calc.sellLines[i])}` : ''}</td>
                    <td colSpan={2} />
                  </tr>
                ))}
                <tr className="cs-adddisc">
                  <td colSpan={4}><button type="button" className="td-link" onClick={() => addDisc('buy')}>＋ Add special discount (buying)</button></td>
                  <td colSpan={3}><button type="button" className="td-link" onClick={() => addDisc('sell')}>＋ Add special discount (selling)</button></td>
                  <td colSpan={2} />
                </tr>
                <tr className="cs-gross">
                  <td colSpan={3} className="lbl">Gross :</td>
                  <td className="c-money strong">{money(calc.grossBuy)}</td>
                  <td colSpan={2} className="lbl">Gross :</td>
                  <td className="c-money strong">{money(calc.grossSell)}</td>
                  <td colSpan={2} />
                </tr>
                <tr className="cs-profit">
                  <td colSpan={3} className="lbl">Gross Profit :</td>
                  <td colSpan={4} className={`cs-profit-val${calc.grossProfit < 0 ? ' neg' : ''}`}>
                    AED {money(calc.grossProfit)}
                    {calc.profitPercent !== null && <small> ({calc.profitPercent.toFixed(1)}% of selling gross)</small>}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            Prices are in AED and rounded to fils at each step. A new row appears as soon as you type in the last one.
            Dropdown values, descriptions, offers and images are shared with everyone when you press Save.
          </div>
        </div>
      </div>

      {descPick && (() => {
        const it = items.find((x) => x.id === descPick.id);
        const list = it ? productsFor(it.code) : [];
        if (!it || list.length < 2) return null;
        return <DescriptionPicker rect={descPick.rect} list={list} current={it.description} onPick={(p) => pickDescription(it.id, p)} onClose={() => setDescPick(null)} />;
      })()}

      {showRates && (
        <RatesEditor
          supabase={supabase}
          rates={rates}
          onClose={() => setShowRates(false)}
          onSaved={(next) => { setRates(next); setShowRates(false); }}
        />
      )}
    </div>
  );
}

// ---------- pieces ----------

function DiscountEdit({ d, onChange, onRemove, canRemove }) {
  return (
    <div className="cs-dedit">
      <input className="cs-in" value={d.label} onChange={(e) => onChange({ label: e.target.value })} aria-label="Discount name" placeholder="Special discount" />
      <input className={`cs-in num${badNum(d.value) ? ' bad' : ''}`} inputMode="decimal" value={d.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Discount value" placeholder="0" />
      <select className="cs-cur" value={d.mode} onChange={(e) => onChange({ mode: e.target.value })} aria-label="AED or percent">
        <option value="amount">AED</option>
        <option value="percent">%</option>
      </select>
      {canRemove && <button type="button" className="cs-dx" onClick={onRemove} aria-label="Remove discount" title="Remove">×</button>}
    </div>
  );
}

function ImageDrop({ busy, onFile }) {
  const fileRef = useRef(null);
  return (
    <div
      className={`cs-drop${busy ? ' busy' : ''}`}
      tabIndex={0}
      role="button"
      aria-label="Paste an image with Ctrl+V, or press Enter to choose a file"
      title="Click here, then press Ctrl+V to paste a snip — or double-click to choose a file"
      onPaste={(e) => {
        const f = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'))?.getAsFile();
        if (f) { e.preventDefault(); onFile(f); }
      }}
      onDoubleClick={() => fileRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
    >
      {busy ? <span>Uploading…</span> : <><span>Click, then</span><b>Ctrl+V</b></>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}

function DescriptionPicker({ rect, list, current, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const width = 380;
  const left = Math.max(8, Math.min((rect?.left || 100), window.innerWidth - width - 8));
  const top = Math.min((rect?.bottom || 200) + 4, window.innerHeight - 260);
  return (
    <div ref={ref} className="cc-panel cs-dpanel" style={{ left, top, width }} role="dialog" aria-label="Pick a description">
      <div className="cs-dhead">This code has {list.length} saved descriptions. Pick one (you can still edit it):</div>
      <ul className="cc-list">
        {list.map((p) => (
          <li key={p.description} className={`cc-opt${key(p.description) === key(current) ? ' cur' : ''}`} onMouseDown={(e) => { e.preventDefault(); onPick(p); }}>
            {p.description}
            {p.offer_price !== null && p.offer_price !== undefined && <small> · {p.offer_currency || 'AED'} {p.offer_price}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RatesEditor({ supabase, rates, onClose, onSaved }) {
  const [list, setList] = useState(rates.map((r) => ({ code: r.code, rate: String(r.rate) })));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr('');
    const rows = list.map((r) => ({ code: r.code.trim().toUpperCase(), rate: num(r.rate) })).filter((r) => r.code);
    if (rows.some((r) => !/^[A-Z]{3}$/.test(r.code))) { setErr('Each currency needs a 3-letter code, like USD.'); return; }
    if (rows.some((r) => !(r.rate > 0))) { setErr('Each rate must be a number above 0.'); return; }
    if (new Set(rows.map((r) => r.code)).size !== rows.length) { setErr('A currency is listed twice.'); return; }
    setBusy(true);
    const { error } = await supabase.from('currency_rates').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'code' });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved(rows.sort((a, b) => a.code.localeCompare(b.code)));
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Currency rates" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Currency rates</h2>
          <button className="reminder-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>How many AED for 1 unit of each currency. New rows use these rates; rows already on a sheet keep their own rate (you can change it in the row).</p>
        <div className="cs-rates">
          {list.map((r, i) => (
            <div key={i} className="cs-rate-row">
              <span>1</span>
              <input value={r.code} maxLength={3} disabled={r.code === 'AED' && rates.some((x) => x.code === 'AED')} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} aria-label="Currency code" />
              <span>=</span>
              <input className={badNum(r.rate) ? 'bad' : ''} inputMode="decimal" value={r.rate} disabled={r.code === 'AED'} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} aria-label={`${r.code} rate`} />
              <span>AED</span>
            </div>
          ))}
        </div>
        <button type="button" className="td-link" onClick={() => setList([...list, { code: '', rate: '' }])}>＋ Add a currency</button>
        {err && <div className="error-text">{err}</div>}
        <div className="modal-actions" style={{ marginTop: 14 }}>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rates'}</button>
        </div>
      </div>
    </div>
  );
}
