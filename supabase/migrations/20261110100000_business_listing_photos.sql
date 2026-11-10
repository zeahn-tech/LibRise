-- Business listing photos: actually persist every attached image.
--
-- Why:
--  The "List your business" form let sellers attach any number of photos, but business_listings had no
--  column for them and the insert/read mapping dropped them, so none were saved and listings only ever
--  showed the single fallback image.
--
-- What:
--  1. business_listings.photos jsonb: ordered array of public image URLs (max 12).
--  2. PUBLIC Storage bucket 'business-photos' (5 MB cap, image types only). Listing photos are shown to
--     every marketplace visitor, so the bucket is public-read.
--     Object path: <owner_user_id>/<uuid>-<file_name>
--  3. Storage RLS: authenticated users may upload/delete only inside their own <uid>/ folder.
--
-- Idempotent. Additive only. list_business_listings_public / get_business_listing_public return
-- to_jsonb(row), so the new column flows through them with no function change.

alter table public.business_listings
  add column if not exists photos jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_listings_photos_valid'
  ) then
    alter table public.business_listings
      add constraint business_listings_photos_valid
      check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 12);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-photos', 'business-photos', true, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view business photos" on storage.objects;
create policy "Anyone can view business photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'business-photos');

drop policy if exists "Sellers can upload business photos" on storage.objects;
create policy "Sellers can upload business photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'business-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Sellers can remove their business photos" on storage.objects;
create policy "Sellers can remove their business photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'business-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
