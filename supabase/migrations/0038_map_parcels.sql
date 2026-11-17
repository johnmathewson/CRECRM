-- 0038: parcel map data store (Hobart first, any city later).
--
-- The public parcel map ships only a "lite" GeoJSON (geometry + zoning / land
-- use / lot facts). Everything behind the registration gate — owner, mailing
-- address, assessed values, sales, permits — lives here and is reachable ONLY
-- through SECURITY DEFINER functions that require the server-side data key.
-- RLS is enabled with no policies, so the public anon key (which is in the
-- browser bundle) cannot read the table directly; the gate is real.

create table if not exists public.map_parcels (
  pid            text primary key,
  city           text not null default 'Hobart',
  address        text,
  zoning         text,
  flu            text,
  acres          numeric,
  class_code     text,
  class          text,
  tif            text,
  flood          text,
  historic       text,
  legal          text,
  transfer_date  timestamptz,
  owner          text,
  mail           text,
  mail_city      text,
  mail_state     text,
  mail_zip       text,
  deduction      text,
  av_total       integer,
  av_land        integer,
  av_impr        integer,
  conveyance     text,
  sales          jsonb not null default '[]'::jsonb,
  permits        jsonb not null default '[]'::jsonb,
  lon            double precision,
  lat            double precision,
  bbox           jsonb,
  source         text not null default 'hobart_gis+lake_county_gis',
  updated_at     timestamptz not null default now()
);
create index if not exists map_parcels_owner_idx   on public.map_parcels (lower(owner));
create index if not exists map_parcels_address_idx on public.map_parcels (lower(address));
create index if not exists map_parcels_city_idx    on public.map_parcels (city);
alter table public.map_parcels enable row level security;
-- no policies: direct access denied for anon/authenticated; functions below only.

-- Server-side secret the API passes to the functions. Not readable by anon.
create table if not exists public.map_config (
  key   text primary key,
  value text not null
);
alter table public.map_config enable row level security;

create or replace function public.map_key_ok(p_key text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.map_config where key = 'data_key' and value = p_key and length(p_key) >= 16);
$$;
revoke all on function public.map_key_ok(text) from public;

-- Bulk upsert from the sync script. Rows are jsonb objects matching columns.
create or replace function public.map_parcels_upsert(p_key text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.map_key_ok(p_key) then raise exception 'map: bad key'; end if;
  insert into public.map_parcels as m (
    pid, city, address, zoning, flu, acres, class_code, class, tif, flood, historic, legal, transfer_date,
    owner, mail, mail_city, mail_state, mail_zip, deduction, av_total, av_land, av_impr, conveyance,
    sales, permits, lon, lat, bbox, updated_at)
  select
    r->>'pid', coalesce(r->>'city','Hobart'), r->>'address', r->>'zoning', r->>'flu', (r->>'acres')::numeric,
    r->>'class_code', r->>'class', r->>'tif', r->>'flood', r->>'historic', r->>'legal',
    case when (r->>'transfer_date') ~ '^\d+$' then to_timestamp((r->>'transfer_date')::bigint / 1000.0) else null end,
    r->>'owner', r->>'mail', r->>'mail_city', r->>'mail_state', r->>'mail_zip', r->>'deduction',
    (r->>'av_total')::integer, (r->>'av_land')::integer, (r->>'av_impr')::integer, r->>'conveyance',
    coalesce(r->'sales','[]'::jsonb), coalesce(r->'permits','[]'::jsonb),
    (r->>'lon')::double precision, (r->>'lat')::double precision, r->'bbox', now()
  from jsonb_array_elements(p_rows) r
  where r->>'pid' is not null
  on conflict (pid) do update set
    city = excluded.city, address = excluded.address, zoning = excluded.zoning, flu = excluded.flu,
    acres = excluded.acres, class_code = excluded.class_code, class = excluded.class, tif = excluded.tif,
    flood = excluded.flood, historic = excluded.historic, legal = excluded.legal, transfer_date = excluded.transfer_date,
    owner = excluded.owner, mail = excluded.mail, mail_city = excluded.mail_city, mail_state = excluded.mail_state,
    mail_zip = excluded.mail_zip, deduction = excluded.deduction, av_total = excluded.av_total,
    av_land = excluded.av_land, av_impr = excluded.av_impr, conveyance = excluded.conveyance,
    sales = excluded.sales, permits = excluded.permits, lon = excluded.lon, lat = excluded.lat,
    bbox = excluded.bbox, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- One parcel, full record. The API decides which fields the caller may see.
create or replace function public.map_parcel_get(p_key text, p_pid text) returns jsonb
language sql security definer stable set search_path = public as $$
  select case when public.map_key_ok(p_key) then to_jsonb(m) else null end
  from public.map_parcels m where m.pid = p_pid;
$$;

-- Search by address / parcel number / owner (owner only when p_owner = true).
create or replace function public.map_parcel_search(p_key text, p_q text, p_owner boolean default false, p_limit integer default 8)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when public.map_key_ok(p_key) then coalesce(jsonb_agg(row), '[]'::jsonb) else '[]'::jsonb end
  from (
    select jsonb_build_object('pid', pid, 'address', address, 'zoning', zoning, 'lon', lon, 'lat', lat,
                              'owner', case when p_owner then owner else null end) as row
    from public.map_parcels
    where address ilike '%' || p_q || '%'
       or replace(replace(pid, '-', ''), '.', '') like replace(replace(p_q, '-', ''), '.', '') || '%'
       or (p_owner and owner ilike '%' || p_q || '%')
    order by (address ilike p_q || '%') desc, address
    limit greatest(1, least(p_limit, 25))
  ) s;
$$;

-- Every parcel held by one deeded owner (exact, case-insensitive).
create or replace function public.map_parcels_by_owner(p_key text, p_owner text) returns jsonb
language sql security definer stable set search_path = public as $$
  select case when public.map_key_ok(p_key)
    then coalesce((select jsonb_agg(jsonb_build_object('pid', pid, 'address', address, 'acres', acres, 'av_total', av_total, 'lon', lon, 'lat', lat))
                   from public.map_parcels where lower(owner) = lower(p_owner)), '[]'::jsonb)
    else '[]'::jsonb end;
$$;

grant execute on function public.map_parcels_upsert(text, jsonb) to anon, authenticated;
grant execute on function public.map_parcel_get(text, text) to anon, authenticated;
grant execute on function public.map_parcel_search(text, text, boolean, integer) to anon, authenticated;
grant execute on function public.map_parcels_by_owner(text, text) to anon, authenticated;
