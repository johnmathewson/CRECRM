-- 0039: on-market listings for the parcel map.
--
-- One row per (source, external listing). Sources: 'crm' (our own listings,
-- synced from properties), 'crexi' / 'loopnet' (captured by the Chrome
-- extension while John browses logged-in, or imported one URL at a time),
-- 'manual'. Matched to a map_parcels row by APN, address or point-in-bbox.
-- Same access model as map_parcels: RLS, no policies, SECURITY DEFINER RPCs
-- keyed by MAP_DATA_KEY. "On market" is public information, so the read
-- RPC returns the overlay fields only; the server decides what to expose.

create table if not exists public.map_listings (
  id              uuid primary key default gen_random_uuid(),
  city            text not null default 'Hobart',
  pid             text references public.map_parcels(pid) on delete set null,
  property_id     uuid,
  source          text not null check (source in ('crm','crexi','loopnet','manual','costar_bulk')),
  external_id     text,
  url             text,
  kind            text not null default 'sale' check (kind in ('sale','lease','both')),
  status          text not null default 'active' check (status in ('active','under_contract','off_market','unverified')),
  title           text,
  address         text,
  price           numeric,
  price_text      text,
  lease_rate_text text,
  sqft            integer,
  acres           numeric,
  asset_type      text,
  broker_name     text,
  broker_company  text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_checked_at timestamptz,
  check_status    text,                 -- ok | blocked | gone | error
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists map_listings_source_ext_idx on public.map_listings (source, external_id) where external_id is not null;
create unique index if not exists map_listings_source_url_idx on public.map_listings (source, url) where url is not null and external_id is null;
create index if not exists map_listings_pid_idx on public.map_listings (pid);
create index if not exists map_listings_status_idx on public.map_listings (city, status);
alter table public.map_listings enable row level security;

-- Upsert listings (sync, import, extension capture). Keyed on (source, external_id)
-- or (source, url). Returns the number of rows written.
create or replace function public.map_listings_upsert(p_key text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0; v_id uuid;
begin
  if not public.map_key_ok(p_key) then raise exception 'map: bad key'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_id from public.map_listings
     where source = r->>'source'
       and ((r->>'external_id' is not null and external_id = r->>'external_id')
         or (r->>'external_id' is null and r->>'url' is not null and url = r->>'url'))
     limit 1;
    if v_id is null then
      insert into public.map_listings (city, pid, property_id, source, external_id, url, kind, status, title, address, price, price_text,
        lease_rate_text, sqft, acres, asset_type, broker_name, broker_company, raw, first_seen_at, last_seen_at)
      values (coalesce(r->>'city','Hobart'), r->>'pid', (r->>'property_id')::uuid, r->>'source', r->>'external_id', r->>'url',
        coalesce(r->>'kind','sale'), coalesce(r->>'status','active'), r->>'title', r->>'address', (r->>'price')::numeric, r->>'price_text',
        r->>'lease_rate_text', (r->>'sqft')::integer, (r->>'acres')::numeric, r->>'asset_type', r->>'broker_name', r->>'broker_company', r->'raw',
        coalesce((r->>'seen_at')::timestamptz, now()), coalesce((r->>'seen_at')::timestamptz, now()));
    else
      update public.map_listings set
        pid = coalesce(r->>'pid', pid), property_id = coalesce((r->>'property_id')::uuid, property_id), url = coalesce(r->>'url', url),
        kind = coalesce(r->>'kind', kind), status = coalesce(r->>'status', status), title = coalesce(r->>'title', title),
        address = coalesce(r->>'address', address), price = coalesce((r->>'price')::numeric, price), price_text = coalesce(r->>'price_text', price_text),
        lease_rate_text = coalesce(r->>'lease_rate_text', lease_rate_text), sqft = coalesce((r->>'sqft')::integer, sqft),
        acres = coalesce((r->>'acres')::numeric, acres), asset_type = coalesce(r->>'asset_type', asset_type),
        broker_name = coalesce(r->>'broker_name', broker_name), broker_company = coalesce(r->>'broker_company', broker_company),
        raw = coalesce(r->'raw', raw), last_seen_at = greatest(last_seen_at, coalesce((r->>'seen_at')::timestamptz, now())), updated_at = now()
      where id = v_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Mark a listing's daily check result.
create or replace function public.map_listing_checked(p_key text, p_id uuid, p_status text, p_check text) returns void
language sql security definer set search_path = public as $$
  update public.map_listings set status = coalesce(p_status, status), check_status = p_check, last_checked_at = now(), updated_at = now()
  where id = p_id and public.map_key_ok(p_key);
$$;

-- Public overlay: everything currently on market in a city.
create or replace function public.map_listings_active(p_key text, p_city text default 'Hobart') returns jsonb
language sql security definer stable set search_path = public as $$
  select case when public.map_key_ok(p_key) then coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) else '[]'::jsonb end
  from (
    select id, pid, source, external_id, url, kind, status, title, address, price, price_text, lease_rate_text, sqft, acres, asset_type,
           broker_company, first_seen_at, last_seen_at
    from public.map_listings
    where city = p_city and status in ('active','under_contract')
    order by last_seen_at desc
  ) s;
$$;

-- Listings needing a re-check (for the daily job).
create or replace function public.map_listings_to_check(p_key text, p_limit integer default 60) returns jsonb
language sql security definer stable set search_path = public as $$
  select case when public.map_key_ok(p_key) then coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) else '[]'::jsonb end
  from (
    select id, source, url, status, last_checked_at from public.map_listings
    where url is not null and source <> 'crm' and status in ('active','under_contract','unverified')
      and (last_checked_at is null or last_checked_at < now() - interval '20 hours')
    order by last_checked_at nulls first limit greatest(1, least(p_limit, 200))
  ) s;
$$;

-- Resolve a parcel for an address / APN / point: returns the pid or null.
create or replace function public.map_parcel_match(p_key text, p_apn text, p_address text, p_lon double precision, p_lat double precision) returns text
language plpgsql security definer stable set search_path = public as $$
declare v text; a text;
begin
  if not public.map_key_ok(p_key) then return null; end if;
  if p_apn is not null then
    select pid into v from public.map_parcels where replace(replace(pid,'-',''),'.','') = replace(replace(p_apn,'-',''),'.','') limit 1;
    if v is not null then return v; end if;
  end if;
  if p_address is not null then
    a := upper(regexp_replace(split_part(p_address, ',', 1), '\s+', ' ', 'g'));
    a := regexp_replace(a, '\b(AVENUE)\b', 'AVE'); a := regexp_replace(a, '\b(STREET)\b', 'ST'); a := regexp_replace(a, '\b(ROAD)\b', 'RD');
    a := regexp_replace(a, '\b(DRIVE)\b', 'DR'); a := regexp_replace(a, '\b(BOULEVARD)\b', 'BLVD'); a := regexp_replace(a, '\b(LANE)\b', 'LN');
    a := regexp_replace(a, '\b(PLACE)\b', 'PL'); a := regexp_replace(a, '\b(COURT)\b', 'CT'); a := regexp_replace(a, '\b(HIGHWAY)\b', 'HWY');
    select pid into v from public.map_parcels where upper(regexp_replace(address, '\s+', ' ', 'g')) = a limit 1;
    if v is not null then return v; end if;
    select pid into v from public.map_parcels where upper(regexp_replace(address, '\s+', ' ', 'g')) like a || '%' limit 1;
    if v is not null then return v; end if;
  end if;
  if p_lon is not null and p_lat is not null then
    select pid into v from public.map_parcels
     where (bbox->>0)::double precision <= p_lon and (bbox->>2)::double precision >= p_lon
       and (bbox->>1)::double precision <= p_lat and (bbox->>3)::double precision >= p_lat
     order by ((bbox->>2)::double precision - (bbox->>0)::double precision) * ((bbox->>3)::double precision - (bbox->>1)::double precision) asc
     limit 1;
    return v;
  end if;
  return null;
end $$;

grant execute on function public.map_listings_upsert(text, jsonb) to anon, authenticated;
grant execute on function public.map_listing_checked(text, uuid, text, text) to anon, authenticated;
grant execute on function public.map_listings_active(text, text) to anon, authenticated;
grant execute on function public.map_listings_to_check(text, integer) to anon, authenticated;
grant execute on function public.map_parcel_match(text, text, text, double precision, double precision) to anon, authenticated;

-- ── v2 matcher (applied as migration map_parcel_match_v2) ───────────────────
-- map_addr_norm / map_addr_norm2 / map_addr_core normalize street addresses
-- (punctuation, suffixes, ordinals, directionals); map_parcel_match tries
-- exact normalized → number + street core → number + core containment → point;
-- map_listings_rematch(p_key) retries unmatched rows. See Supabase migration
-- history for the full bodies; kept out of this file to avoid drift.

-- ── photo_url (applied as migration map_listings_photo) ─────────────────────
-- alter table map_listings add column photo_url text; map_listings_upsert
-- accepts r->>'photo_url' (coalesce on update); map_listings_active returns it.
