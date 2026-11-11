// E-signatures: each person can upload one (My Profile → E-signature).
// Quotations print the signature of the profile whose name matches the
// quotation's "Salesman name". Images live in the private "signatures"
// bucket at <user id>/<file>; profiles.signature_path points to it.

export const SIGNATURE_BUCKET = 'signatures';
const MAX_W = 900;
const MAX_H = 360;

// Any PNG / JPEG → a reasonably small image of the same kind. A PNG keeps
// its see-through background, so the signature sits cleanly on the letterhead.
export async function prepareSignature(file) {
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  let src;
  try {
    src = await createImageBitmap(file);
  } catch {
    throw new Error('This file could not be read as a picture. Please use a PNG or JPEG.');
  }
  const scale = Math.min(1, MAX_W / src.width, MAX_H / src.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * scale));
  canvas.height = Math.max(1, Math.round(src.height * scale));
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error('The picture could not be prepared. Please try another file.');
  return { blob, type, ext: type === 'image/png' ? 'png' : 'jpg' };
}

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// The signature for a salesman name: { name, path } of the matching
// profile (exact name, ignoring capitals and extra spaces), or null.
export async function signatureFor(supabase, salesman) {
  const want = norm(salesman);
  if (!want) return null;
  const { data, error } = await supabase.from('profiles').select('full_name, signature_path').not('signature_path', 'is', null);
  if (error) return null; // not set up yet
  const hit = (data || []).find((p) => norm(p.full_name) === want);
  return hit ? { name: hit.full_name, path: hit.signature_path } : null;
}
