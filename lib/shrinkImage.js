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
export async function shrinkImage(file) {
  const src = await decode(file);
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('unreadable');
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('unreadable');
  return blob;
}
