-- i12farm · Reference data: racing pigeons
-- Added for Homa Organica (Lang'ata, Nairobi), the first pigeon breeder on
-- the map. Pigeons sit under Poultry so they show with the poultry chip, and
-- search finds them by "pigeon" or "njiwa".

insert into public.products (slug, category_slug, name_en, name_sw, default_unit) values
  ('racing-pigeon', 'poultry', 'Racing pigeons', 'Njiwa wa mashindano', 'bird')
on conflict (slug) do update set name_en = excluded.name_en, name_sw = excluded.name_sw,
  default_unit = excluded.default_unit, category_slug = excluded.category_slug;
