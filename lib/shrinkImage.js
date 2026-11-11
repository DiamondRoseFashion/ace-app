// Turns any photo (any size, phone camera photos included) into a small
// JPEG for a profile picture, so uploads are fast and never too big.
const MAX_SIDE = 800;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unreadable'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// → Blob (image/jpeg). Throws if the browser can't read the picture.
export async function shrinkImage(file, { maxSide = MAX_SIDE, quality = 0.86 } = {}) {
  const src = await decode(file);
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('unreadable');
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('unreadable');
  return blob;
}

// Shrinks a picture until it is at most maxBytes (e.g. 300 KB for costing
// sheet images): first a little smaller / lighter each try, keeping it as
// sharp as the limit allows. Throws if even the smallest try is too big.
export async function shrinkToLimit(file, maxBytes) {
  const tries = [[800, 0.86], [800, 0.75], [700, 0.7], [600, 0.65], [500, 0.6], [400, 0.55], [320, 0.5]];
  for (const [maxSide, quality] of tries) {
    const blob = await shrinkImage(file, { maxSide, quality });
    if (blob.size <= maxBytes) return blob;
  }
  throw new Error(`the picture can't be made smaller than ${Math.round(maxBytes / 1024)} KB`);
}
