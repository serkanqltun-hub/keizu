// Reading pictures the user adds to topics. Big photos are scaled down so
// maps stay small enough to save, sync and keep in version history.

const MAX_SIDE = 1600;
const KEEP_AS_IS_BYTES = 400 * 1024;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Görsel okunamadı.'));
    r.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bu görsel açılamadı.'));
    img.src = url;
  });
}

export async function loadImageFile(file: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Desteklenen görseller: PNG, JPEG, GIF, WebP.');
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) throw new Error('Bu görsel açılamadı.');
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (k === 1 && (file.size <= KEEP_AS_IS_BYTES || file.type === 'image/gif')) return { dataUrl: original, width: w, height: h };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Keep transparency for PNGs; photos compress far better as JPEG.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return { dataUrl: canvas.toDataURL(type, 0.88), width: canvas.width, height: canvas.height };
}
