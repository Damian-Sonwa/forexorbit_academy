/**
 * Turns the chosen file into a small square photo in the browser: cropped to the centre, 400 px,
 * WebP (JPEG where the browser cannot write WebP). A phone photo of several megabytes becomes about
 * 30 KB, so it uploads quickly and fits the account record. Throws a message to show when the file
 * cannot be used.
 */

const SIDE = 400;
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

const toBlob = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close?.() };
    } catch { /* some browsers decode more through <img> */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(/heic|heif/i.test(`${file.type} ${file.name}`)
      ? 'This browser cannot read HEIC photos (the iPhone default). Choose a JPEG or PNG, or a screenshot of the photo.'
      : 'This file could not be read as an image. Choose a JPEG, PNG or WebP photo.');
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

export async function preparePhoto(file: File): Promise<File> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Choose a photo of 5 MB or less.');
  const { source, width, height, done } = await decode(file);
  try {
    const side = Math.min(width, height);
    if (!side) throw new Error('This file could not be read as an image. Choose a JPEG, PNG or WebP photo.');
    const size = Math.min(SIDE, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare the photo. Try another browser.');
    // JPEG has no transparency: a clear background becomes white rather than black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    let blob = await toBlob(canvas, 'image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg');
    if (!blob) throw new Error('This browser cannot prepare the photo. Try another browser.');
    return new File([blob], blob.type === 'image/webp' ? 'photo.webp' : 'photo.jpg', { type: blob.type });
  } finally {
    done();
  }
}
