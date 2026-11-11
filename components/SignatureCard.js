'use client';

// My Profile → E-signature: upload a PNG or JPEG of your signature (a PNG
// with a see-through background looks best). Quotations where you are the
// salesman print it above your name.
import { useEffect, useRef, useState } from 'react';
import { SIGNATURE_BUCKET, prepareSignature } from '@/lib/signature';

export default function SignatureCard({ supabase, userId }) {
  const [path, setPath] = useState(null);
  const [url, setUrl] = useState('');
  const [ready, setReady] = useState(null); // null = checking, false = needs the database update
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileRef = useRef(null);

  async function showPreview(p) {
    if (!p) { setUrl(''); return; }
    const { data } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(p, 60 * 60);
    setUrl(data?.signedUrl || '');
  }

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data, error } = await supabase.from('profiles').select('signature_path').eq('id', userId).maybeSingle();
      if (error) { setReady(false); return; }
      setReady(true);
      setPath(data?.signature_path || null);
      showPreview(data?.signature_path || null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null);
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) { setMsg({ ok: false, text: 'Please choose a PNG or JPEG picture of your signature.' }); return; }
    setBusy(true);
    try {
      const { blob, type, ext } = await prepareSignature(file);
      const next = `${userId}/signature-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(SIGNATURE_BUCKET).upload(next, blob, { contentType: type, upsert: false });
      if (upErr) throw upErr;
      const { error: saveErr } = await supabase.from('profiles').update({ signature_path: next }).eq('id', userId);
      if (saveErr) { await supabase.storage.from(SIGNATURE_BUCKET).remove([next]); throw saveErr; }
      if (path) await supabase.storage.from(SIGNATURE_BUCKET).remove([path]); // the old one isn't needed
      setPath(next);
      await showPreview(next);
      setMsg({ ok: true, text: 'Signature saved ✓ It will appear on your quotations.' });
    } catch (err) {
      setMsg({ ok: false, text: `The signature couldn't be saved: ${err.message || 'please try again'}.` });
    }
    setBusy(false);
  }

  async function remove() {
    setConfirmRemove(false);
    setBusy(true); setMsg(null);
    const { error } = await supabase.from('profiles').update({ signature_path: null }).eq('id', userId);
    if (error) { setBusy(false); setMsg({ ok: false, text: error.message }); return; }
    if (path) await supabase.storage.from(SIGNATURE_BUCKET).remove([path]);
    setPath(null); setUrl('');
    setBusy(false);
    setMsg({ ok: true, text: 'Signature removed.' });
  }

  return (
    <div className="card sig-card">
      <h2 className="sig-title">E-signature</h2>
      <p className="hint" style={{ marginTop: 4 }}>
        Printed above your name on quotations where you are the salesman. Use a PNG or JPEG. A PNG with a
        see-through (transparent) background looks best on the letterhead.
      </p>
      {ready === false ? (
        <div className="notice err" style={{ marginTop: 12, marginBottom: 0 }}>E-signatures need a one-time database update. Please ask your admin to run the &quot;e-signatures&quot; update in Supabase.</div>
      ) : (
        <>
          <div className="sig-box">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {url ? <img src={url} alt="Your signature" /> : <span className="cs-muted">{ready === null ? 'Loading…' : 'No signature yet'}</span>}
          </div>
          <div className="sig-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={() => fileRef.current?.click()}>
              {busy ? 'Please wait…' : path ? 'Replace signature' : 'Upload signature'}
            </button>
            {path && !confirmRemove && <button type="button" className="btn btn-ghost danger-text" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>}
            {confirmRemove && (
              <>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>Yes, remove it</button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>Cancel</button>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={onFile} />
          </div>
          {msg && <div className={msg.ok ? 'notice ok' : 'notice err'} style={{ marginTop: 12, marginBottom: 0 }}>{msg.text}</div>}
        </>
      )}
    </div>
  );
}
