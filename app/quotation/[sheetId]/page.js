'use client';

// Quotation for one costing sheet revision (costing sheet → "📄 Quotation").
//  • First time: made from the costing sheet (Ref, Date, Project, items
//    with selling prices) and the project's Contractor contact (To / Tel /
//    Attn.; Main Contractor if there's no Contractor), plus the standard
//    terms. Everything is editable.
//  • Items only change when you press "Update from costing sheet"; a note
//    shows when the costing sheet was saved after the last update.
//  • Download PDF: drawn on the company letterhead by lib/quotationPdf.js.
// Same access as costing sheets (has_costing_access).
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import DateInput from '@/components/DateInput';
import { money } from '@/lib/costing';
import { SIGNATURE_BUCKET, signatureFor } from '@/lib/signature';
import {
  DEFAULT_INTRO, DEFAULT_TERMS, DEFAULT_CLOSING, itemsFromCosting, discountsFromCosting, quotationTotals, modelOf, qtyText,
} from '@/lib/quotation';

const BUCKET = 'costing-images';
// the contact the quotation is addressed to: the Contractor (or the Main Contractor)
function addressee(contacts = []) {
  const has = (c) => (c.company_name || '').trim() || (c.name || '').trim();
  return contacts.find((c) => c.contact_role === 'contractor' && has(c))
    || contacts.find((c) => c.contact_role === 'main_contractor' && has(c))
    || null;
}

const FIELDS = ['to_company', 'po_box', 'city', 'tel', 'attn', 'ref_no', 'quote_date', 'project_name', 'salutation', 'intro', 'delivery', 'payment', 'validity', 'closing', 'salesman'];

export default function QuotationPage() {
  const router = useRouter();
  const { sheetId } = useParams();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [state, setState] = useState('loading'); // loading | ok | denied | missing | notfound
  const [sheet, setSheet] = useState(null);
  const [doc, setDoc] = useState(null); // the saved quotation row
  const [form, setForm] = useState({});
  const [items, setItems] = useState([]);
  const [discounts, setDiscounts] = useState([]); // selling special discounts, from the costing sheet
  const [terms, setTerms] = useState([]);
  const [vat, setVat] = useState('5');
  const [urls, setUrls] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [sig, setSig] = useState(null); // { name, path, url } of the salesman's e-signature

  function fillFrom(row) {
    const f = {};
    for (const k of FIELDS) f[k] = row[k] ?? '';
    setForm(f);
    setItems(row.items || []);
    setDiscounts(row.discounts || []);
    setTerms(row.terms || []);
    setVat(String(row.vat_percent ?? 5));
    setDoc(row);
    setDirty(false);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: ok, error: accErr } = await supabase.rpc('has_costing_access');
      if (accErr) { setState('missing'); return; }
      if (!ok) { setState('denied'); return; }
      const { data: sh, error: shErr } = await supabase.from('costing_sheets').select('*').eq('id', sheetId).maybeSingle();
      if (shErr || !sh) { setState(shErr ? 'missing' : 'notfound'); return; }
      setSheet(sh);
      const { data: existing, error: qErr } = await supabase.from('quotation_docs').select('*').eq('costing_sheet_id', sheetId).maybeSingle();
      if (qErr) { setState('missing'); return; }
      if (existing) { fillFrom(existing); setState('ok'); return; }

      // first time: start from the costing sheet and the project's contractor contact
      const [{ data: me }, { data: contacts }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
        supabase.from('contacts').select('contact_role, company_name, name, tel, mobile, created_at').eq('project_id', sh.project_id).order('created_at'),
      ]);
      const to = addressee(contacts || []);
      const row = {
        costing_sheet_id: sh.id,
        project_id: sh.project_id,
        to_company: (to?.company_name || '').trim() || sh.contractor || null,
        po_box: null,
        city: 'UAE',
        tel: (to?.tel || to?.mobile || '').trim() || null,
        attn: (to?.name || '').trim() || null,
        ref_no: sh.quotation_no,
        quote_date: sh.quotation_date,
        project_name: sh.project_name,
        salutation: 'Dear Sir,',
        intro: DEFAULT_INTRO,
        items: itemsFromCosting(sh.items || []),
        discounts: discountsFromCosting(sh.discounts_sell || []),
        vat_percent: 5,
        terms: DEFAULT_TERMS,
        delivery: null,
        payment: null,
        validity: '30 Days.',
        closing: DEFAULT_CLOSING,
        salesman: (me?.full_name || '').trim() || null,
        synced_at: sh.updated_at, // the costing sheet as saved at that moment
      };
      const { data: created, error: cErr } = await supabase.from('quotation_docs').insert(row).select('*').single();
      if (cErr) {
        // made at the same moment in another tab: use that one
        const { data: again } = await supabase.from('quotation_docs').select('*').eq('costing_sheet_id', sheetId).maybeSingle();
        if (!again) { setMsg({ ok: false, text: cErr.message }); setState('missing'); return; }
        fillFrom(again);
      } else fillFrom(created);
      setState('ok');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  // signed links for the item images (the bucket is private)
  useEffect(() => {
    const need = [...new Set(items.map((it) => it.image_path).filter((p) => p && !urls[p]))];
    if (!need.length) return;
    supabase.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 6).then(({ data }) => {
      const add = {};
      for (const r of data || []) if (r.signedUrl) add[r.path] = r.signedUrl;
      if (Object.keys(add).length) setUrls((u) => ({ ...u, ...add }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // the salesman's e-signature (from the profile with that name)
  useEffect(() => {
    if (state !== 'ok') return undefined;
    let stop = false;
    const t = setTimeout(async () => {
      const hit = await signatureFor(supabase, form.salesman);
      if (stop) return;
      if (!hit) { setSig(null); return; }
      const { data } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(hit.path, 60 * 60);
      if (!stop) setSig({ ...hit, url: data?.signedUrl || '' });
    }, 400);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.salesman, state]);

  const totals = useMemo(() => quotationTotals(items, vat, discounts), [items, vat, discounts]);
  // the costing sheet has been saved since its items were last taken
  const costingNewer = sheet && doc?.synced_at && new Date(sheet.updated_at).getTime() > new Date(doc.synced_at).getTime();

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setMsg(null); };

  function payload() {
    const p = {};
    for (const k of FIELDS) p[k] = String(form[k] ?? '').trim() || null;
    p.items = items;
    p.discounts = discounts;
    p.terms = terms.map((t) => String(t || '').trim()).filter(Boolean);
    const v = Number(String(vat).trim());
    p.vat_percent = Number.isFinite(v) && v >= 0 && v <= 100 ? v : 5;
    return p;
  }

  async function save(extra = {}) {
    setBusy('save'); setMsg(null);
    const { data, error } = await supabase.from('quotation_docs').update({ ...payload(), ...extra }).eq('id', doc.id).select('*').maybeSingle();
    setBusy('');
    if (error || !data) { setMsg({ ok: false, text: error ? `Couldn't save: ${error.message}` : 'Couldn\'t save: this quotation was deleted or you no longer have access.' }); return null; }
    fillFrom(data);
    return data;
  }

  // To / Tel / Attn. again from the project's contractor contact
  async function fillFromContractor() {
    setMsg(null);
    const { data: contacts } = await supabase.from('contacts')
      .select('contact_role, company_name, name, tel, mobile, created_at').eq('project_id', sheet.project_id).order('created_at');
    const to = addressee(contacts || []);
    const company = (to?.company_name || '').trim() || sheet.contractor || '';
    if (!company && !to) { setMsg({ ok: false, text: 'This project has no Contractor contact yet. Add one on the project page, or type the details here.' }); return; }
    setForm((f) => ({ ...f, to_company: company, tel: (to?.tel || to?.mobile || '').trim(), attn: (to?.name || '').trim() }));
    setDirty(true);
    setMsg({ ok: true, text: 'Filled in from the project\'s contractor. Press Save to keep it.' });
  }

  async function updateFromCosting() {
    setBusy('sync'); setMsg(null);
    const { data: sh, error } = await supabase.from('costing_sheets').select('*').eq('id', sheetId).maybeSingle();
    if (error || !sh) { setBusy(''); setMsg({ ok: false, text: 'The costing sheet could not be read.' }); return; }
    setSheet(sh);
    const nextItems = itemsFromCosting(sh.items || []);
    const nextDiscounts = discountsFromCosting(sh.discounts_sell || []);
    const nextForm = { ...form, ref_no: sh.quotation_no || '', quote_date: sh.quotation_date || '', project_name: sh.project_name || '' };
    setForm(nextForm);
    setItems(nextItems);
    setDiscounts(nextDiscounts);
    const p = payload();
    const { data, error: uErr } = await supabase.from('quotation_docs').update({
      ...p, ...Object.fromEntries(['ref_no', 'quote_date', 'project_name'].map((k) => [k, String(nextForm[k] || '').trim() || null])),
      items: nextItems, discounts: nextDiscounts, synced_at: sh.updated_at,
    }).eq('id', doc.id).select('*').maybeSingle();
    setBusy('');
    if (uErr || !data) { setMsg({ ok: false, text: uErr ? uErr.message : 'Couldn\'t update.' }); return; }
    fillFrom(data);
    setMsg({ ok: true, text: `Updated from costing sheet ${sh.revision}: ${nextItems.length} item${nextItems.length === 1 ? '' : 's'}, special discounts, Ref, Date and Project.` });
  }

  async function downloadPdf() {
    setMsg(null);
    if (dirty && !(await save())) return;
    setBusy('pdf');
    try {
      const [{ buildQuotationPdf }, letterhead, regular, bold, italic, boldItalic] = await Promise.all([
        import('@/lib/quotationPdf'),
        ...['/quotation/letterhead.pdf', '/fonts/Carlito-Regular.ttf', '/fonts/Carlito-Bold.ttf', '/fonts/Carlito-Italic.ttf', '/fonts/Carlito-BoldItalic.ttf']
          .map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u} not found`); return r.arrayBuffer(); })),
      ]);
      // item images, freshly signed
      const paths = [...new Set(items.map((it) => it.image_path).filter(Boolean))];
      const images = new Map();
      if (paths.length) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
        await Promise.all((data || []).filter((r) => r.signedUrl).map(async (r) => {
          try { const res = await fetch(r.signedUrl); if (res.ok) images.set(r.path, await res.arrayBuffer()); } catch { /* skip */ }
        }));
      }
      // the salesman's e-signature, if their profile has one
      let signature = null;
      const hit = await signatureFor(supabase, form.salesman);
      if (hit) {
        const { data } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(hit.path, 600);
        if (data?.signedUrl) { try { const r = await fetch(data.signedUrl); if (r.ok) signature = await r.arrayBuffer(); } catch { /* print without it */ } }
      }
      const bytes = await buildQuotationPdf({ q: payload(), letterhead, fonts: { regular, bold, italic, boldItalic }, images, signature });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = `Quotation ${form.ref_no || ''} ${form.project_name || ''} ${sheet?.revision || ''}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
      a.href = url;
      a.download = `${name || 'Quotation'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setMsg({ ok: false, text: `The PDF couldn't be made: ${e.message || 'please try again'}.` });
    }
    setBusy('');
  }

  if (state !== 'ok') {
    const text = {
      loading: 'Loading…',
      denied: 'Quotations are not turned on for your account yet. Please ask your admin.',
      missing: msg?.text || 'Quotations need a one-time database update. Please ask your admin to run the "quotations" update in Supabase.',
      notfound: 'This costing sheet was not found. It may have been deleted.',
    }[state];
    return (
      <div className="shell">
        <Sidebar active="dashboard" />
        <div className="main"><div className="card"><div className={state === 'loading' ? 'hint' : 'notice err'} style={{ margin: 0 }}>{text}</div></div></div>
      </div>
    );
  }

  const inp = (k, label, props = {}) => (
    <label className="qt-field">
      <span>{label}</span>
      <input value={form[k] || ''} onChange={(e) => set(k, e.target.value)} {...props} />
    </label>
  );

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main quotation">
        <div className="page-header">
          <div>
            <div className="eyebrow">Quotation · costing sheet {sheet.revision}</div>
            <h1 style={{ fontSize: 28, marginTop: 4 }}>{form.project_name || 'Quotation'}</h1>
          </div>
          <div className="header-actions cs-actions">
            <span className={`cs-status${dirty ? ' dirty' : ''}`}>{dirty ? '● Unsaved changes' : 'Saved'}</span>
            <Link className="btn btn-ghost" href={`/costing/${sheetId}`}>← Costing sheet</Link>
            <button type="button" className="btn btn-ghost" onClick={() => save()} disabled={!!busy || !dirty}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-primary" onClick={downloadPdf} disabled={!!busy}>{busy === 'pdf' ? 'Making PDF…' : '⬇ Download PDF'}</button>
          </div>
        </div>
        {msg && <div className={msg.ok ? 'notice ok' : 'notice err'}>{msg.text}</div>}
        {costingNewer && (
          <div className="notice qt-stale">
            The costing sheet was saved after this quotation was last updated. Press <strong>Update from costing sheet</strong> to bring in the latest items and prices.
          </div>
        )}

        <div className="card qt-paper">
          <div className="qt-top">
            <div className="qt-to">
              {inp('to_company', 'To: M/s.')}
              <button type="button" className="td-link qt-fill" onClick={fillFromContractor} disabled={!!busy}>↻ Fill To, Tel and Attn. from the project&apos;s contractor</button>
              {inp('po_box', 'P.O. Box')}
              {inp('city', 'City / Country')}
              {inp('tel', 'Tel')}
              {inp('attn', 'Attn.')}
            </div>
            <div className="qt-ref">
              {inp('ref_no', 'Ref.')}
              <label className="qt-field">
                <span>Date</span>
                <DateInput value={form.quote_date || ''} onChange={(e) => set('quote_date', e.target.value)} />
              </label>
            </div>
          </div>

          {inp('project_name', 'Project')}
          {inp('salutation', 'Greeting')}
          <label className="qt-field">
            <span>Opening line</span>
            <textarea rows={2} value={form.intro || ''} onChange={(e) => set('intro', e.target.value)} />
          </label>

          <div className="qt-items-head">
            <div className="qt-sec">Items</div>
            <button type="button" className="btn btn-ghost" onClick={updateFromCosting} disabled={!!busy}>{busy === 'sync' ? 'Updating…' : '↻ Update from costing sheet'}</button>
          </div>
          <div className="cs-scroll">
            <table className="qt-table">
              <thead>
                <tr>
                  <th>Sl.No</th><th>Type</th><th>Model</th><th>Make</th><th>Description</th><th>Image</th><th>Qty.</th>
                  <th>Unit Price<small>(AED)</small></th><th>Total<small>(AED)</small></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={9} className="cs-muted" style={{ textAlign: 'center', padding: 18 }}>No items yet. Add them on the costing sheet, save it, then press “Update from costing sheet”.</td></tr>
                )}
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="c">{i + 1}</td>
                    <td className="c">{it.type}</td>
                    <td className="c">{modelOf(it)}</td>
                    <td className="c">{it.make}</td>
                    <td>{it.description}</td>
                    <td className="c">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {it.image_path && urls[it.image_path] && <img src={urls[it.image_path]} alt="" className="qt-img" />}
                    </td>
                    <td className="c">{qtyText(it.qty)}</td>
                    <td className="r">{money(it.unit_price)}</td>
                    <td className="r">{money(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={8} className="r lbl">Total in AED :</td><td className="r strong">{money(totals.total)}</td></tr>
                {totals.discountLines.map((l, i) => (
                  <tr key={`d${i}`}><td colSpan={8} className="r lbl">{l.label} :</td><td className="r strong">− {money(l.amount)}</td></tr>
                ))}
                {totals.discountLines.length > 0 && (
                  <tr><td colSpan={8} className="r lbl">Total after Discount :</td><td className="r strong">{money(totals.afterDiscount)}</td></tr>
                )}
                <tr>
                  <td colSpan={8} className="r lbl">
                    VAT (<input className="qt-vat" inputMode="decimal" value={vat} onChange={(e) => { setVat(e.target.value); setDirty(true); }} aria-label="VAT percent" />%) :
                  </td>
                  <td className="r strong">{money(totals.vat)}</td>
                </tr>
                <tr className="net"><td colSpan={8} className="r lbl">Net Total in AED :</td><td className="r strong">{money(totals.net)}</td></tr>
              </tfoot>
            </table>
          </div>
          <div className="hint">Items, prices and special discounts come from the costing sheet (selling side only). Change them there, save, then press “Update from costing sheet”.</div>

          <div className="qt-sec" style={{ marginTop: 22 }}>Terms &amp; Conditions</div>
          <ol className="qt-terms">
            {terms.map((t, i) => (
              <li key={i}>
                <span aria-hidden="true">*</span>
                <input value={t} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? e.target.value : x))); setDirty(true); }} aria-label={`Term ${i + 1}`} />
                <button type="button" className="cs-dx" onClick={() => { setTerms(terms.filter((_, j) => j !== i)); setDirty(true); }} aria-label={`Remove term ${i + 1}`} title="Remove">×</button>
              </li>
            ))}
          </ol>
          <button type="button" className="td-link" onClick={() => { setTerms([...terms, '']); setDirty(true); }}>＋ Add a term</button>

          <div className="qt-dpv">
            {inp('delivery', 'Delivery')}
            {inp('payment', 'Payment')}
            {inp('validity', 'Validity')}
          </div>

          <label className="qt-field">
            <span>Closing line</span>
            <input value={form.closing || ''} onChange={(e) => set('closing', e.target.value)} />
          </label>
          <div className="qt-sign">Best Regards. <strong>For GEMS Systems LLC</strong></div>
          {inp('salesman', 'Salesman name (signs the quotation)')}
          <div className="qt-sig">
            {sig?.url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sig.url} alt={`Signature of ${sig.name}`} />
                <span>{sig.name}&apos;s e-signature will be printed above the name.</span>
              </>
            ) : (
              <span className="cs-muted">
                {form.salesman ? `No e-signature found for “${form.salesman}”. ${form.salesman} can add one in My Profile → E-signature (the name here must match their profile name).` : 'Type the salesman name to print their e-signature.'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
