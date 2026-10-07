-- i12farm · Phase 0 · Photo storage
-- Public-read bucket for farm photos. The browser compresses to ~200 KB WebP
-- before upload; the bucket rejects anything over 2 MB or not an image.
-- Path convention: farms/<farm_id>/<random>.webp

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('farm-media', 'farm-media', true, 2000000, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_farm_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  parts text[] := string_to_array(object_name, '/');
begin
  if array_length(parts, 1) <> 3 or parts[1] <> 'farms' then
    return null;
  end if;
  return parts[2]::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy "farm managers upload photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'farm-media' and public.can_manage_farm(public.storage_farm_id(name)));

create policy "farm managers replace photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'farm-media' and public.can_manage_farm(public.storage_farm_id(name)));

create policy "farm managers delete photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'farm-media' and public.can_manage_farm(public.storage_farm_id(name)));
