import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { allow } from '@/lib/rate-limit';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_FARM, putMedia, sniffImage } from '@/lib/media';

const UUID_RE = /^[0-9a-f-]{36}$/;

// Upload one farm photo (already shrunk on the phone). Only the farm's
// managers may add photos: the check runs under RLS as the signed-in user.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!allow(`photo:${viewer.id}`, 40, 600_000))
    return NextResponse.json({ error: 'too many uploads, wait a few minutes' }, { status: 429 });
  const { id: farmId } = await params;
  if (!UUID_RE.test(farmId)) return NextResponse.json({ error: 'bad farm' }, { status: 400 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'no file' }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: 'photo larger than 2 MB' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return NextResponse.json({ error: 'not a JPEG, PNG or WebP image' }, { status: 415 });
  const width = Math.min(Math.max(Number(form?.get('width')) || 0, 0), 10000) || null;
  const height = Math.min(Math.max(Number(form?.get('height')) || 0, 0), 10000) || null;

  const allowed = await withUser(viewer.id, async (tx) => {
    const [row] = await tx<{ ok: boolean; n: number }[]>`
      select public.can_manage_farm(${farmId}) as ok,
             (select count(*)::int from public.farm_media where farm_id = ${farmId}) as n`;
    return row;
  });
  if (!allowed.ok) return NextResponse.json({ error: 'not your farm' }, { status: 403 });
  if (allowed.n >= MAX_PHOTOS_PER_FARM) return NextResponse.json({ error: `at most ${MAX_PHOTOS_PER_FARM} photos` }, { status: 409 });

  const path = `farms/${farmId}/${randomUUID()}.${kind.ext}`;
  await putMedia(path, bytes, kind.type);
  const [media] = await withUser(
    viewer.id,
    (tx) => tx<{ id: string }[]>`
    insert into public.farm_media (farm_id, storage_path, kind, position, width, height, bytes)
    values (${farmId}, ${path}, 'photo',
            coalesce((select max(position) + 1 from public.farm_media where farm_id = ${farmId}), 0),
            ${width}, ${height}, ${bytes.length})
    returning id`,
  );
  revalidatePath('/');
  revalidatePath('/my-farm');
  return NextResponse.json({ id: media.id, path }, { status: 201 });
}
