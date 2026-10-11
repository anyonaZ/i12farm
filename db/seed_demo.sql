-- i12farm · demo seed for local development (never run against production)
-- 28 sample farms across the five pilot counties, matching the clickable prototype.
-- Managed by the dev field agent from seed.sql. Names and numbers are made up.

do $$
declare fid uuid; agent uuid := '00000000-0000-4000-8000-0000000000a1';
begin
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Kendu Bay Layers', 'Rose Anyango', 'Improved kienyeji layers on free range. Eggs collected daily.', array['poultry']::text[], 43, (select id from public.sub_counties where county_code = 43 and name = 'Karachuonyo'), 'Kendu Bay', 'approximate', '2', 2019, '+254700103437', '+254700103437', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.645 -0.362)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 450, '40' from public.products where slug = 'eggs';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 900, '25' from public.products where slug = 'kienyeji-chicken';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Oyugis Greens', 'Beatrice Akinyi', 'Drip-irrigated sukuma, spinach and seedlings for home gardens.', array['vegetables','seedlings']::text[], 43, (select id from public.sub_counties where county_code = 43 and name = 'Kasipul'), 'Oyugis', 'approximate', '1', 2020, '+254700106474', '+254700106474', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.735 -0.508)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 50, '200' from public.products where slug = 'kale-sukuma';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 300, '40' from public.products where slug = 'vegetable-seedlings';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Kabondo Pig Farm', 'Samuel Okoth', 'Large White and Landrace crosses. Weaned piglets every two months.', array['pigs']::text[], 43, (select id from public.sub_counties where county_code = 43 and name = 'Kabondo Kasipul'), 'Kadel', 'approximate', '2', 2015, '+254700109511', '+254700109511', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.8 -0.45)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 4500, '10' from public.products where slug = 'piglets';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Rodi Mango Orchard', 'Peter Nyangweso', 'Apple and Ngowe mangoes. Season runs November to February.', array['fruits']::text[], 43, (select id from public.sub_counties where county_code = 43 and name = 'Rangwe'), 'Rodi Kopany', 'approximate', '8', 2009, '+254700112548', '+254700112548', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.52 -0.63)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 15, '3000' from public.products where slug = 'mangoes';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Rongo Dairy Farm', 'Lilian Odero', 'Ayrshire herd. Milk chilled on the farm and collected at 7 am.', array['dairy']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Rongo'), 'Rongo', 'approximate', '10', 2012, '+254700115585', '+254700115585', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.6 -0.765)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 55, '150' from public.products where slug = 'fresh-milk';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Awendo Beans and Maize', 'Tom Owino', 'Rosecoco beans and dried maize, stored in hermetic bags.', array['grains']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Awendo'), 'Awendo', 'approximate', '12', 2011, '+254700118622', '+254700118622', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.53 -0.9)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 120, '500' from public.products where slug = 'beans';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 3800, '40' from public.products where slug = 'maize';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Uriri Kienyeji Hub', 'Faith Atieno', 'Hatchery with vaccinated day-old chicks every week.', array['poultry']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Uriri'), 'Uriri', 'approximate', '1', 2021, '+254700121659', '+254700121659', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.5 -0.985)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 850, '40' from public.products where slug = 'kienyeji-chicken';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 110, '300' from public.products where slug = 'day-old-chicks';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Migori Vet Point', 'Dr. Daniel Chacha', 'Licensed vet. Farm visits within 30 km, AI for dairy cattle.', array['vet-services']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Suna East'), 'Migori Town', 'exact', null, 2013, '+254700124696', '+254700124696', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.47 -1.065)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 1500, null from public.products where slug = 'vet-visit';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 2500, null from public.products where slug = 'artificial-insemination';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Isebania Hay Supply', 'Joseph Mwita', 'Rhodes grass hay, baled after the long rains.', array['inputs']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Kuria West'), 'Isebania', 'approximate', '15', 2010, '+254700127733', '+254700127733', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.48 -1.24)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 350, '400' from public.products where slug = 'hay';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Nyatike Fish Farm', 'Paul Onyango', 'Tilapia ponds fed by the Kuja river.', array['fish']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Nyatike'), 'Macalder', 'approximate', '2', 2019, '+254700130770', '+254700130770', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.27 -1.1)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 420, '300' from public.products where slug = 'tilapia';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Suna Avocado Gardens', 'Esther Auma', 'Hass avocados and grafted seedlings.', array['fruits','seedlings']::text[], 44, (select id from public.sub_counties where county_code = 44 and name = 'Suna West'), 'Masara', 'approximate', '4', 2016, '+254700133807', '+254700133807', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.4 -1.03)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 15, '2000' from public.products where slug = 'avocados';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 50, '500' from public.products where slug = 'tree-seedlings';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Kibos Dairy Goats', 'Martin Ochieng', 'Saanen and Alpine dairy goats, does and young bucks.', array['goats']::text[], 42, (select id from public.sub_counties where county_code = 42 and name = 'Kisumu East'), 'Kibos', 'approximate', '2', 2017, '+254700136844', '+254700136844', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.82 -0.065)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 14000, '3' from public.products where slug = 'dairy-goat';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Muhoroni Honey Collective', 'Alice Kiprono', 'Twenty beekeepers pooling honey for bulk buyers.', array['bees']::text[], 42, (select id from public.sub_counties where county_code = 42 and name = 'Muhoroni'), 'Muhoroni', 'approximate', null, 2016, '+254700139881', '+254700139881', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(35.195 -0.155)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 750, '60' from public.products where slug = 'honey';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Katito Fish Farm', 'Vincent Opiyo', 'Catfish and tilapia fingerlings for new pond owners.', array['fish']::text[], 42, (select id from public.sub_counties where county_code = 42 and name = 'Nyakach'), 'Katito', 'approximate', '1', 2020, '+254700142918', '+254700142918', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.97 -0.27)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 500, '80' from public.products where slug = 'catfish';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 12, '1500' from public.products where slug = 'fingerlings';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Awasi Training Farm', 'Jane Omondi', 'Demonstration farm. School visits and weekend courses.', array['training','vegetables']::text[], 42, (select id from public.sub_counties where county_code = 42 and name = 'Nyando'), 'Awasi', 'exact', '5', 2010, '+254700145955', '+254700145955', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(35.07 -0.17)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 300, null from public.products where slug = 'farm-tour';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 800, null from public.products where slug = 'farm-training';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Githunguri Highland Dairy', 'Mary Wanjiku', 'Friesian herd, in-calf heifers available.', array['dairy']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Githunguri'), 'Githunguri', 'approximate', '8', 2008, '+254700148992', '+254700148992', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.78 -1.06)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 50, '400' from public.products where slug = 'fresh-milk';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 85000, '2' from public.products where slug = 'dairy-heifer';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Limuru Greens', 'Peter Kamau', 'Highland cabbage and kale for Nairobi markets.', array['vegetables']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Limuru'), 'Limuru', 'approximate', '3', 2015, '+254700151429', '+254700151429', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.64 -1.105)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 40, '500' from public.products where slug = 'cabbage';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 40, '300' from public.products where slug = 'kale-sukuma';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Kikuyu Rabbitry', 'James Njoroge', 'New Zealand White and California rabbits.', array['rabbits']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Kikuyu'), 'Kikuyu', 'approximate', '0.5', 2021, '+254700154466', '+254700154466', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.665 -1.245)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 1200, '30' from public.products where slug = 'rabbits';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Ruiru Broilers', 'Esther Mwangi', 'Broilers ready every five weeks.', array['poultry']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Ruiru'), 'Ruiru', 'approximate', '1', 2019, '+254700157503', '+254700157503', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.96 -1.15)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 550, '200' from public.products where slug = 'broiler-chicken';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 420, '100' from public.products where slug = 'eggs';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Juja Fish and Greens', 'Daniel Kariuki', 'Aquaponics: tilapia with lettuce and herbs.', array['fish','vegetables']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Juja'), 'Juja Farm', 'approximate', '2', 2020, '+254700160540', '+254700160540', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(37.01 -1.1)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 500, '80' from public.products where slug = 'tilapia';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Gatundu Avocado Farm', 'Ann Njeri', 'Hass and Fuerte avocados, export grade.', array['fruits']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Gatundu North'), 'Kamwangi', 'approximate', '6', 2012, '+254700163577', '+254700163577', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.91 -0.985)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 20, '5000' from public.products where slug = 'avocados';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Lari Seedlings Nursery', 'Lucy Wambui', 'Grevillea, fruit trees and vegetable seedlings.', array['seedlings']::text[], 22, (select id from public.sub_counties where county_code = 22 and name = 'Lari'), 'Kimende', 'exact', '1', 2014, '+254700166614', '+254700166614', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.62 -0.985)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 40, '3000' from public.products where slug = 'tree-seedlings';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 250, '100' from public.products where slug = 'vegetable-seedlings';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Karen Urban Bees', 'Brian Otieno', 'Rooftop and garden hives. Beginner beekeeping classes.', array['bees','training']::text[], 47, (select id from public.sub_counties where county_code = 47 and name = 'Lang''ata'), 'Karen', 'approximate', null, 2018, '+254700169651', '+254700169651', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.71 -1.32)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 1000, '40' from public.products where slug = 'honey';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 1500, null from public.products where slug = 'farm-training';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Kasarani Leafy Greens', 'Faith Mutua', 'Managu, terere and kunde from sack gardens.', array['vegetables']::text[], 47, (select id from public.sub_counties where county_code = 47 and name = 'Kasarani'), 'Mwiki', 'approximate', '0.5', 2021, '+254700172688', '+254700172688', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.92 -1.22)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 50, '150' from public.products where slug = 'african-leafy-veg';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Ruai Poultry Farm', 'Daniel Kiptoo', 'Layers and our own feed mix.', array['poultry','inputs']::text[], 47, (select id from public.sub_counties where county_code = 47 and name = 'Embakasi East'), 'Ruai', 'approximate', '2', 2017, '+254700175725', '+254700175725', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(37.0 -1.27)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 430, '200' from public.products where slug = 'eggs';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 3400, '50' from public.products where slug = 'layers-mash';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Riruta Dairy Unit', 'John Waweru', 'Zero-grazing unit in the city. Morning milk by 8 am.', array['dairy']::text[], 47, (select id from public.sub_counties where county_code = 47 and name = 'Dagoretti South'), 'Riruta', 'approximate', '0.5', 2016, '+254700178762', '+254700178762', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.73 -1.29)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 70, '60' from public.products where slug = 'fresh-milk';
  end if;
  insert into public.farms (owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values (null, agent, agent, 'Nairobi Mobile Vet', 'Dr. Susan Kamau', 'Mobile vet for Nairobi and Kiambu farms.', array['vet-services']::text[], 47, (select id from public.sub_counties where county_code = 47 and name = 'Westlands'), 'Kangemi', 'exact', null, 2011, '+254700181799', '+254700181799', 'published', now())
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.75 -1.265)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 2000, null from public.products where slug = 'vet-visit';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 3000, null from public.products where slug = 'artificial-insemination';
  end if;
  -- Homa Organica: pig farming and racing pigeons in Lang'ata (requested by Zacc).
  -- Fixed slug so the page is always /f/homa-organica. Phone, prices and
  -- quantities are placeholders until Benedict confirms them.
  insert into public.farms (slug, owner_id, managed_by, created_by, name, farmer_name, description, categories, county_code, sub_county_id, place_name, visibility, size_acres, year_started, phone_public, whatsapp, status, verified_at)
  values ('homa-organica', null, agent, agent, 'Homa Organica', 'Benedict Kotonya', 'Pig farm and racing pigeon loft in Lang''ata. Weaned piglets, finished pigs for pork, and trained racing pigeons from proven lines.', array['pigs','poultry']::text[], 47, (select id from public.sub_counties where county_code = 47 and name = 'Lang''ata'), 'Lang''ata', 'approximate', null, null, '+254700190836', '+254700190836', 'published', null)
  on conflict (slug) do nothing returning id into fid;
  if fid is not null then
    insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(36.748 -1.343)', 'agent');
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 5000, '12' from public.products where slug = 'piglets';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 25000, '4' from public.products where slug = 'pork-pig';
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity) select fid, case when category_slug = 'vet-services' then 'service' when category_slug = 'training' then 'experience' when default_unit in ('head','bird','chick') then 'livestock' when category_slug = 'inputs' then 'input' else 'produce' end::public.listing_type, slug, name_en, default_unit, 2500, '30' from public.products where slug = 'racing-pigeon';
  end if;
end;
$$;
