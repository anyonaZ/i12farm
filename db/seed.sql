-- i12farm · local development seed (never run against production)
-- A field agent, a farmer, a buyer, an admin, and eight sample farms around Homa Bay and
-- Kisumu so every developer sees a populated map. Names are invented.

-- Dev accounts. Password for all of them: i12farm-dev
-- Sign in with the email or the phone number (0700 000 001 etc.).
insert into auth.users (id, email, phone, password_hash, password_changed_at, meta)
values
  ('00000000-0000-4000-8000-0000000000a1', 'agent@dev.i12farm.local',  '254700000001',
   'scrypt$16384$8$1$aTEyZmFybS1kZXYtc2FsdA==$PwrQdfhbuoymqj2cIs3cn6nM4w+t98x3wp5kH9Te1Yd6h5ZXND7rjEgNGj7m29xVU+tdzDuaGP8N3RIcCTrS7A==',
   now(), '{"full_name":"Dev Field Agent"}'),
  ('00000000-0000-4000-8000-0000000000f1', 'farmer@dev.i12farm.local', '254700000002',
   'scrypt$16384$8$1$aTEyZmFybS1kZXYtc2FsdA==$PwrQdfhbuoymqj2cIs3cn6nM4w+t98x3wp5kH9Te1Yd6h5ZXND7rjEgNGj7m29xVU+tdzDuaGP8N3RIcCTrS7A==',
   now(), '{"full_name":"Dev Farmer"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'buyer@dev.i12farm.local',  '254700000003',
   'scrypt$16384$8$1$aTEyZmFybS1kZXYtc2FsdA==$PwrQdfhbuoymqj2cIs3cn6nM4w+t98x3wp5kH9Te1Yd6h5ZXND7rjEgNGj7m29xVU+tdzDuaGP8N3RIcCTrS7A==',
   now(), '{"full_name":"Dev Buyer"}'),
  ('00000000-0000-4000-8000-0000000000ad', 'admin@dev.i12farm.local',  '254700000009',
   'scrypt$16384$8$1$aTEyZmFybS1kZXYtc2FsdA==$PwrQdfhbuoymqj2cIs3cn6nM4w+t98x3wp5kH9Te1Yd6h5ZXND7rjEgNGj7m29xVU+tdzDuaGP8N3RIcCTrS7A==',
   now(), '{"full_name":"Dev Admin"}')
on conflict (id) do nothing;

update public.profiles set roles = array['admin','buyer']::public.user_role[], county_code = 47
  where id = '00000000-0000-4000-8000-0000000000ad';
update public.profiles set county_code = 47
  where id = '00000000-0000-4000-8000-0000000000b1';
update public.profiles set roles = array['agent','buyer']::public.user_role[], county_code = 43, joined_via = 'self'
  where id = '00000000-0000-4000-8000-0000000000a1';
update public.profiles set roles = array['farmer','buyer']::public.user_role[], county_code = 43
  where id = '00000000-0000-4000-8000-0000000000f1';

with sample (id, owner_id, managed_by, name, farmer_name, categories, county, place, visibility, lng, lat, verified) as (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000f1'::uuid, null::uuid,
     'Lakeview Dairy',   'Dev Farmer',  array['dairy','training'], 43::smallint, 'Imbo',       'approximate'::public.location_visibility, 34.493, -0.548, true),
    ('10000000-0000-4000-8000-000000000002', null, '00000000-0000-4000-8000-0000000000a1',
     'Kanyadoto Poultry', 'Akinyi O.',  array['poultry'],          43, 'Kanyadoto',  'approximate', 34.410, -0.512, true),
    ('10000000-0000-4000-8000-000000000003', null, '00000000-0000-4000-8000-0000000000a1',
     'Rangwe Bee Farm',   'Otieno K.',  array['bees'],             43, 'Rangwe',     'exact',       34.590, -0.610, false),
    ('10000000-0000-4000-8000-000000000004', null, '00000000-0000-4000-8000-0000000000a1',
     'Ndhiwa Goat Unit',  'Adhiambo M.',array['goats','sheep'],    43, 'Ndhiwa',     'approximate', 34.367, -0.729, false),
    ('10000000-0000-4000-8000-000000000005', null, '00000000-0000-4000-8000-0000000000a1',
     'Mbita Fish Ponds',  'Ouma J.',    array['fish'],             43, 'Mbita',      'approximate', 34.207, -0.435, false),
    ('10000000-0000-4000-8000-000000000006', null, '00000000-0000-4000-8000-0000000000a1',
     'Kombewa Greens',    'Achieng P.', array['vegetables','seedlings'], 42, 'Kombewa', 'approximate', 34.505, -0.104, true),
    ('10000000-0000-4000-8000-000000000007', null, '00000000-0000-4000-8000-0000000000a1',
     'Ahero Rice and Pigs','Odhiambo T.',array['pigs','grains'],   42, 'Ahero',      'approximate', 34.918, -0.173, false),
    ('10000000-0000-4000-8000-000000000008', null, '00000000-0000-4000-8000-0000000000a1',
     'Maseno Vet Point',  'Dr. Were L.',array['vet-services'],     42, 'Maseno',     'exact',       34.603, -0.004, true)
)
insert into public.farms (id, owner_id, managed_by, name, farmer_name, categories, county_code, place_name,
                          visibility, status, verified_at)
select id, owner_id, managed_by, name, farmer_name, categories, county, place, visibility, 'published',
       case when verified then now() end
from sample
on conflict (id) do nothing;

insert into public.farm_locations (farm_id, location, source)
select f.id, s.pt, 'agent'
from public.farms f
join (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'SRID=4326;POINT(34.493 -0.548)'::extensions.geography),
  ('10000000-0000-4000-8000-000000000002', 'SRID=4326;POINT(34.410 -0.512)'),
  ('10000000-0000-4000-8000-000000000003', 'SRID=4326;POINT(34.590 -0.610)'),
  ('10000000-0000-4000-8000-000000000004', 'SRID=4326;POINT(34.367 -0.729)'),
  ('10000000-0000-4000-8000-000000000005', 'SRID=4326;POINT(34.207 -0.435)'),
  ('10000000-0000-4000-8000-000000000006', 'SRID=4326;POINT(34.505 -0.104)'),
  ('10000000-0000-4000-8000-000000000007', 'SRID=4326;POINT(34.918 -0.173)'),
  ('10000000-0000-4000-8000-000000000008', 'SRID=4326;POINT(34.603 -0.004)')
) as s(farm_id, pt) on s.farm_id = f.id
on conflict (farm_id) do nothing;

insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) values
  ('10000000-0000-4000-8000-000000000001', 'produce',    'fresh-milk',      'Fresh milk, morning collection', 'litre',    60,  80),
  ('10000000-0000-4000-8000-000000000001', 'experience', 'farm-training',   'Half-day dairy training',        'person',  500, null),
  ('10000000-0000-4000-8000-000000000002', 'produce',    'eggs',            'Kienyeji eggs',                  'tray-30', 450,  40),
  ('10000000-0000-4000-8000-000000000002', 'livestock',  'kienyeji-chicken','Mature kienyeji hens',           'bird',    900,  25),
  ('10000000-0000-4000-8000-000000000003', 'produce',    'honey',           'Raw honey',                      'kg',      800,  30),
  ('10000000-0000-4000-8000-000000000004', 'livestock',  'dairy-goat',      'Toggenburg cross does',          'head',  12000,   4),
  ('10000000-0000-4000-8000-000000000005', 'produce',    'tilapia',         'Pond tilapia',                   'kg',      450, 120),
  ('10000000-0000-4000-8000-000000000006', 'produce',    'kale-sukuma',     'Sukuma wiki',                    'kg',       50, 200),
  ('10000000-0000-4000-8000-000000000007', 'livestock',  'piglets',         'Weaned piglets',                 'head',   4500,  10),
  ('10000000-0000-4000-8000-000000000008', 'service',    'vet-visit',       'On-farm vet visit',              'visit',  1500, null);

-- A partner organisation (county office, cooperative, NGO: sees county insights),
-- and a phone for the vet farm so vet-request SMS reach it.
insert into auth.users (id, email, phone, password_hash, password_changed_at, meta)
values
  ('00000000-0000-4000-8000-0000000000c1', 'partner@dev.i12farm.local', '254700000004',
   'scrypt$16384$8$1$aTEyZmFybS1kZXYtc2FsdA==$PwrQdfhbuoymqj2cIs3cn6nM4w+t98x3wp5kH9Te1Yd6h5ZXND7rjEgNGj7m29xVU+tdzDuaGP8N3RIcCTrS7A==',
   now(), '{"full_name":"Dev Partner"}')
on conflict (id) do nothing;
update public.profiles set roles = array['partner','buyer']::public.user_role[], county_code = 43,
                           organisation = 'Homa Bay County Extension'
  where id = '00000000-0000-4000-8000-0000000000c1';
update public.farms set phone_public = '+254722000008'
  where id = '10000000-0000-4000-8000-000000000008' and phone_public is null;
