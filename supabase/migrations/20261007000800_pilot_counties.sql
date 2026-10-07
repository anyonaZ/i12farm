-- i12farm · Pilot counties
-- Phase 1 pilots in five counties. The flag drives the Explore hero, agent
-- enrolment pickers and pilot-only reporting, so changing the pilot set is a
-- data change, not a code change.

alter table public.counties add column if not exists is_pilot boolean not null default false;

update public.counties set is_pilot = (code in (22, 42, 43, 44, 47));

-- Sub-counties (constituencies) for the three newly added pilot counties.
insert into public.sub_counties (county_code, name) values
  (44, 'Rongo'), (44, 'Awendo'), (44, 'Suna East'), (44, 'Suna West'),
  (44, 'Uriri'), (44, 'Nyatike'), (44, 'Kuria West'), (44, 'Kuria East'),
  (22, 'Gatundu South'), (22, 'Gatundu North'), (22, 'Juja'), (22, 'Thika Town'),
  (22, 'Ruiru'), (22, 'Githunguri'), (22, 'Kiambu'), (22, 'Kiambaa'),
  (22, 'Kabete'), (22, 'Kikuyu'), (22, 'Limuru'), (22, 'Lari'),
  (47, 'Westlands'), (47, 'Dagoretti North'), (47, 'Dagoretti South'), (47, 'Lang''ata'),
  (47, 'Kibra'), (47, 'Roysambu'), (47, 'Kasarani'), (47, 'Ruaraka'),
  (47, 'Embakasi South'), (47, 'Embakasi North'), (47, 'Embakasi Central'), (47, 'Embakasi East'),
  (47, 'Embakasi West'), (47, 'Makadara'), (47, 'Kamukunji'), (47, 'Starehe'), (47, 'Mathare')
on conflict (county_code, name) do nothing;
