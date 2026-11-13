// Shrinks a phone photo in the browser so the upload stays well under the 3.5 MB limit.
import { LIMITS } from '../contract.js';

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export async function downscaleImage(file, { maxSide = 1600, quality = 0.85 } = {}) {
  const source = await decode(file);
  const width = source.width || source.naturalWidth, height = source.height || source.naturalHeight;
  let side = maxSide, q = quality;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, side / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (base64.length < LIMITS.maxImageBytes * 0.8) {
      source.close?.();
      return { dataUrl, base64, mimeType: 'image/jpeg', width: canvas.width, height: canvas.height };
    }
    side = Math.round(side * 0.8);
    q = Math.max(0.6, q - 0.08);
  }
  source.close?.();
  throw Error('That picture is too large. Try a smaller one.');
}
