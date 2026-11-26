'use client';

// Costing sheet pop-up for a Code.
//  • New code → "Create an item": Model, Type, Wattage, Lumen, Dimension,
//    CCT, Housing, Diffuser, IP and Image. Wattage / Lumen / Dimension /
//    CCT / IP can have several values (variations) – type one, press
//    Enter, type the next.
//  • Saved code → "Select options": Model, Type, Housing, Diffuser and
//    Image are shown; pick one of each variation (a new variation can
//    be added on the spot). "Edit item" changes the saved details.
//  • OK → the item is saved in the product list and the row gets its
//    Model, Image and the Description made from the choices.
import { useEffect, useRef, useState } from 'react';
import { shrinkToLimit } from '@/lib/shrinkImage';
import { VARIANT_FIELDS, addTo, hasValue, buildDescription } from '@/lib/costingItems';

const BUCKET = 'costing-images';
const MAX_IMAGE_BYTES = 300 * 1024;

const blankItem = (code) => ({
  code, model: '', item_type: '', housing: '', diffuser: '', image_path: '',
  wattages: [], lumens: [], dimensions: [], ccts: [], ips: [],
});

function firstPick(item, initial) {
  const p = {};
  for (const f of VARIANT_FIELDS) {
    const list = item?.[f.list] || [];
    p[f.key] = initial?.[f.key] && hasValue(list, initial[f.key])
      ? list.find((x) => x.toLowerCase() === String(initial[f.key]).toLowerCase())
      : (list[0] || '');
  }
  return p;
}

export default function ItemPicker({ supabase, code, item, initialPick, onCancel, onDone }) {
  const isNew = !item;
  const [form, setForm] = useState(() => (item ? { ...blankItem(code), ...item } : blankItem(code)));
  const [pick, setPick] = useState(() => firstPick(item, initialPick));
  const [typing, setTyping] = useState({}); // variation key → text being typed
  const [editing, setEditing] = useState(isNew);
  const [imgUrl, setImgUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const firstRef = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, [editing]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onCancel]);

  // a signed link to show the image (the bucket is private)
  useEffect(() => {
    let alive = true;
    if (!form.image_path) { setImgUrl(''); return undefined; }
    supabase.storage.from(BUCKET).createSignedUrl(form.image_path, 60 * 60).then(({ data }) => {
      if (alive) setImgUrl(data?.signedUrl || '');
    });
    return () => { alive = false; };
  }, [form.image_path, supabase]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setErr(''); };

  function addVariant(f) {
    const v = (typing[f.key] || '').trim();
    if (!v) return;
    setForm((fm) => ({ ...fm, [f.list]: addTo(fm[f.list], v) }));
    setPick((p) => ({ ...p, [f.key]: v }));
    setTyping((t) => ({ ...t, [f.key]: '' }));
    setErr('');
  }
  function removeVariant(f, v) {
    setForm((fm) => ({ ...fm, [f.list]: fm[f.list].filter((x) => x !== v) }));
    setPick((p) => (p[f.key] === v ? { ...p, [f.key]: (form[f.list].find((x) => x !== v) || '') } : p));
  }

  async function uploadImage(file) {
    if (!file || !/^image\//.test(file.type || '')) { setErr('That is not an image. Snip it, click the image box and press Ctrl+V, or choose a file.'); return; }
    setUploading(true); setErr('');
    try {
      const blob = await shrinkToLimit(file, MAX_IMAGE_BYTES); // made smaller automatically to fit 300 KB
      const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
      const path = `products/${id}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      set({ image_path: path });
    } catch (e) {
      setErr(`The image couldn't be uploaded: ${e.message || 'please try again'}.`);
    }
    setUploading(false);
  }

  async function ok() {
    // anything still typed in a variation box counts as added
    let fm = form;
    const pk = { ...pick };
    for (const f of VARIANT_FIELDS) {
      const v = (typing[f.key] || '').trim();
      if (v) { fm = { ...fm, [f.list]: addTo(fm[f.list], v) }; pk[f.key] = v; }
    }
    const clean = (s) => String(s || '').trim();
    if (!clean(fm.model)) { setErr('Please enter the Model.'); setEditing(true); return; }
    if (!clean(fm.item_type)) { setErr('Please enter the Type.'); setEditing(true); return; }
    for (const f of VARIANT_FIELDS) if (fm[f.list].length && !pk[f.key]) pk[f.key] = fm[f.list][0];

    const payload = {
      code: clean(code), model: clean(fm.model), item_type: clean(fm.item_type), housing: clean(fm.housing) || null,
      diffuser: clean(fm.diffuser) || null, image_path: fm.image_path || null,
      wattages: fm.wattages, lumens: fm.lumens, dimensions: fm.dimensions, ccts: fm.ccts, ips: fm.ips,
      updated_at: new Date().toISOString(),
    };
    setSaving(true); setErr('');
    const res = item?.id
      ? await supabase.from('costing_items').update(payload).eq('id', item.id).select('*').maybeSingle()
      : await supabase.from('costing_items').insert(payload).select('*').maybeSingle();
    setSaving(false);
    if (res.error || !res.data) {
      const msg = res.error?.code === '23505'
        ? 'Someone has just created this code. Close this window and pick the code again.'
        : res.error?.code === '42P01' || /costing_items/.test(res.error?.message || '')
          ? 'The product list needs a one-time database update. Please ask your admin to run the "costing items" update in Supabase.'
          : `Couldn't save: ${res.error?.message || 'please try again'}`;
      setErr(msg);
      return;
    }
    onDone(res.data, pk, buildDescription(res.data, pk));
  }

  const preview = buildDescription(form, pick);
  const single = (k, label, placeholder, ref) => (
    <label className="ip-field">
      <span>{label}</span>
      {editing
        ? <input ref={ref} value={form[k] || ''} onChange={(e) => set({ [k]: e.target.value })} placeholder={placeholder} />
        : <div className="ip-fixed">{form[k] || '—'}</div>}
    </label>
  );
  const variant = (f) => (
    <div className="ip-field ip-var" key={f.key}>
      <span>{f.label}</span>
      <div className="ip-chips" role="radiogroup" aria-label={f.label}>
        {form[f.list].map((v) => (
          <span key={v} className={`ip-chip${pick[f.key] === v ? ' on' : ''}`}>
            <button type="button" role="radio" aria-checked={pick[f.key] === v} onClick={() => setPick((p) => ({ ...p, [f.key]: v }))}>
              {pick[f.key] === v && <b aria-hidden="true">✓ </b>}{v}
            </button>
            {editing && <button type="button" className="ip-chip-x" aria-label={`Remove ${v}`} title="Remove this choice" onClick={() => removeVariant(f, v)}>×</button>}
          </span>
        ))}
        <span className="ip-add">
          <input
            value={typing[f.key] || ''}
            onChange={(e) => setTyping((t) => ({ ...t, [f.key]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant(f); } }}
            placeholder={form[f.list].length ? '+ Add another' : f.placeholder}
            aria-label={`Add ${f.label}`}
          />
          {(typing[f.key] || '').trim() && <button type="button" onClick={() => addVariant(f)}>Add</button>}
        </span>
      </div>
    </div>
  );
  const field = (k) => VARIANT_FIELDS.find((f) => f.key === k);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div className="card modal ip-modal" role="dialog" aria-modal="true" aria-label={isNew ? 'Create an item' : 'Select options'}>
        <div className="modal-head">
          <div>
            <h2>{isNew ? 'Create an item' : 'Select options'}</h2>
            <div className="ip-code">Code: <strong>{code}</strong></div>
          </div>
          <button type="button" className="reminder-x" aria-label="Close" onClick={onCancel} disabled={saving}>✕</button>
        </div>

        {!isNew && !editing && (
          <div className="ip-note">
            Pick one of each, then press OK.
            <button type="button" className="td-link" onClick={() => setEditing(true)}>Edit item</button>
          </div>
        )}
        {isNew && <div className="ip-note">For Wattage, Lumen, Dimension, CCT and IP you can add several choices: type one, press Enter, type the next.</div>}

        <div className="ip-grid">
          {single('model', 'Model', 'e.g. Caliber', firstRef)}
          {single('item_type', 'Type', 'e.g. LED Weather Proof')}
          {variant(field('wattage'))}
          {variant(field('lumen'))}
          {variant(field('dimension'))}
          {variant(field('cct'))}
          {single('housing', 'Housing', 'e.g. Polycarbonate')}
          {single('diffuser', 'Diffuser', 'e.g. PC Opal')}
          {variant(field('ip'))}
          <div className="ip-field">
            <span>Image</span>
            <div className="ip-img-row">
              {imgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ip-img" src={imgUrl} alt={form.model || code} />
              ) : form.image_path ? <div className="ip-img ip-img-wait">…</div> : null}
              {editing && (
                <>
                  <div
                    className={`cs-drop ip-drop${uploading ? ' busy' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label="Paste an image with Ctrl+V, or press Enter to choose a file"
                    onPaste={(e) => {
                      const f = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'))?.getAsFile();
                      if (f) { e.preventDefault(); uploadImage(f); }
                    }}
                    onDoubleClick={() => fileRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadImage(f); }}
                  >
                    {uploading ? <span>Uploading…</span> : <><span>{form.image_path ? 'Change: click, then' : 'Click, then'}</span><b>Ctrl+V</b></>}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImage(f); }} />
                  </div>
                  {form.image_path && <button type="button" className="td-link" onClick={() => set({ image_path: '' })}>Remove image</button>}
                </>
              )}
              {!editing && !form.image_path && <div className="ip-fixed">—</div>}
            </div>
          </div>
        </div>

        <div className="ip-preview">
          <span>Description</span>
          <div>{preview || <em>Fill in the details to see the description.</em>}</div>
        </div>

        {err && <div className="error-text" style={{ marginBottom: 10 }}>{err}</div>}
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={ok} disabled={saving || uploading}>{saving ? 'Saving…' : isNew ? 'Save & OK' : 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
