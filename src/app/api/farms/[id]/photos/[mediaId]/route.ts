import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { deleteMedia } from '@/lib/media';

const UUID_RE = /^[0-9a-f-]{36}$/;

// Remove a photo. RLS lets only the farm's managers delete the row; the file goes after.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const { id: farmId, mediaId } = await params;
  if (!UUID_RE.test(farmId) || !UUID_RE.test(mediaId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const [removed] = await withUser(
    viewer.id,
    (tx) => tx<{ storage_path: string }[]>`
    delete from public.farm_media where id = ${mediaId} and farm_id = ${farmId} returning storage_path`,
  );
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await deleteMedia(removed.storage_path);
  revalidatePath('/');
  revalidatePath('/my-farm');
  return new NextResponse(null, { status: 204 });
}
