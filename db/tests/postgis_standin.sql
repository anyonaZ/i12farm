-- LOCAL ONLY. A tiny text-based stand-in for the handful of PostGIS functions
-- our schema uses, for machines where PostGIS can't be installed. Points are
-- stored as EWKT text ('SRID=4326;POINT(lng lat)'). CI runs the same tests
-- against real PostGIS; this file is never used there or in production.

create domain extensions.geography as text;
create domain extensions.geometry  as text;

create or replace function extensions._xy(g text) returns double precision[]
language sql immutable as $$
  select array[split_part(m[1], ' ', 1)::double precision, split_part(m[1], ' ', 2)::double precision]
  from regexp_match(g, 'POINT\(([^)]+)\)') as m;
$$;

create or replace function extensions.st_x(g extensions.geometry) returns double precision
language sql immutable as $$ select (extensions._xy(g))[1]; $$;

create or replace function extensions.st_y(g extensions.geometry) returns double precision
language sql immutable as $$ select (extensions._xy(g))[2]; $$;

create or replace function extensions.st_snaptogrid(g extensions.geometry, ox double precision, oy double precision,
                                                    sx double precision, sy double precision)
returns extensions.geometry
language sql immutable as $$
  select format('SRID=4326;POINT(%s %s)',
    round(((ox + round(((extensions._xy(g))[1] - ox) / sx) * sx))::numeric, 6)::double precision,
    round(((oy + round(((extensions._xy(g))[2] - oy) / sy) * sy))::numeric, 6)::double precision)::extensions.geometry;
$$;

create or replace function extensions.st_makeenvelope(a double precision, b double precision,
                                                      c double precision, d double precision, srid integer)
returns extensions.geometry
language sql immutable as $$ select format('ENVELOPE(%s %s %s %s)', a, b, c, d)::extensions.geometry; $$;

create or replace function extensions._overlaps(p text, e text) returns boolean
language sql immutable as $$
  select (extensions._xy(p))[1] between split_part(m[1], ' ', 1)::float8 and split_part(m[1], ' ', 3)::float8
     and (extensions._xy(p))[2] between split_part(m[1], ' ', 2)::float8 and split_part(m[1], ' ', 4)::float8
  from regexp_match(e, 'ENVELOPE\(([^)]+)\)') as m;
$$;

create operator extensions.&& (leftarg = text, rightarg = text, function = extensions._overlaps);

create or replace function extensions.st_makepoint(x double precision, y double precision) returns extensions.geometry
language sql immutable as $$ select format('POINT(%s %s)', x, y)::extensions.geometry; $$;

create or replace function extensions.st_setsrid(g extensions.geometry, srid integer) returns extensions.geometry
language sql immutable as $$ select ('SRID=' || srid || ';' || regexp_replace(g, '^SRID=\d+;', ''))::extensions.geometry; $$;

grant usage on schema extensions to anon, authenticated, service_role;
