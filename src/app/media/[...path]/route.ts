import { NextResponse, type NextRequest } from 'next/server';
import { readLocalMedia } from '@/lib/media';

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

// Serves photos stored on local disk. File names are random and never reused,
// so they can be cached for a year.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  const bytes = await readLocalMedia(path);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
