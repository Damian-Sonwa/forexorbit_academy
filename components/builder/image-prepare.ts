/**
 * Shrinks an image in the browser before it is uploaded: at most 1920 px on the longest side,
 * saved as WebP (JPEG where the browser cannot write WebP). A phone photo of several megabytes
 * becomes a few hundred kilobytes, which keeps uploads fast and the built-in image storage
 * (lib/course-image-store.js) small. GIFs are left alone (they may be animated), and so is any
 * image that would not get smaller. If anything fails, the original file is used.
 */

const MAX_SIDE = 1920;
const SMALL_ENOUGH = 300 * 1024;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

export async function prepareImage(file: File): Promise<File> {
  try {
    const type = (file.type || '').toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(type) || typeof createImageBitmap !== 'function') return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SMALL_ENOUGH) { bitmap.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let blob = await canvasBlob(canvas, 'image/webp', 0.85);
    // Browsers that cannot write WebP return PNG instead; use JPEG for photos then.
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}
