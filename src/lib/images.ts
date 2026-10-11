'use client';

// Shrinks a photo on the phone before upload: longest side 1280 px, WebP at
// 0.72 quality (JPEG where WebP encoding isn't supported). A 4 MB camera photo
// usually lands around 150–250 KB, which matters on a 100 MB data bundle.

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  previewUrl: string;
}

export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  const source: CanvasImageSource & { width: number; height: number } = bitmap ?? (await loadImage(file));
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  bitmap?.close();

  let blob = await toBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
  if (!blob) throw new Error('could not encode image');

  return { blob, width, height, originalBytes: file.size, previewUrl: URL.createObjectURL(blob) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function formatBytes(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
