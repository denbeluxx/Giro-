-- Giro — schema del database (Supabase / Postgres).
-- Incolla tutto nell'SQL Editor di Supabase ed esegui una volta.
-- I saldi NON sono salvati: l'app li ricalcola sempre dai viaggi confermati e dai rimborsi.

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default encode(gen_random_bytes(9), 'hex'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 40),
  color int not null default 0,
  home jsonb,                       -- valorizzata solo se la casa è condivisa col gruppo
  home_shared boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz               -- chi lascia il gruppo resta nello storico
);
create unique index if not exists members_group_user on public.members(group_id, user_id) where user_id is not null;

create table if not exists public.private_homes (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  home jsonb,
  primary key (group_id, user_id)
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  kind text not null default 'locale',
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key,              -- generato dal dispositivo: reinviare lo stesso viaggio non lo duplica
  group_id uuid not null references public.groups(id) on delete cascade,
  status text not null check (status in ('planned', 'confirmed', 'cancelled')),
  starts_at timestamptz not null,
  data jsonb not null,              -- destinazione, presenti, tratte, tappe, km, pedaggi
  constraint trips_data_shape check (coalesce(
    jsonb_typeof(data) = 'object' and jsonb_typeof(data->'legs') = 'array'
    and jsonb_typeof(data->'presentIds') = 'array' and jsonb_typeof(data->'dest') = 'object'
    and jsonb_array_length(case when jsonb_typeof(data->'legs') = 'array' then data->'legs' else '[]' end) between 1 and 2
    and octet_length(data::text) < 600000, false)),
  version int not null default 1,
  created_by uuid references public.members(id),
  updated_by uuid references public.members(id),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists trips_group on public.trips(group_id, starts_at desc);

create table if not exists public.settlements (
  id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  from_member uuid not null references public.members(id),
  to_member uuid not null references public.members(id),
  cents int not null check (cents > 0),
  created_by uuid references public.members(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Accesso: solo i membri attivi del gruppo
-- ---------------------------------------------------------------------------
create or replace function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where group_id = g and user_id = auth.uid() and left_at is null)
$$;

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.private_homes enable row level security;
alter table public.places enable row level security;
alter table public.trips enable row level security;
alter table public.settlements enable row level security;

drop policy if exists groups_select on public.groups;
drop policy if exists groups_update on public.groups;
create policy groups_select on public.groups for select to authenticated using (public.is_member(id));
create policy groups_update on public.groups for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_select on public.members;
drop policy if exists members_insert on public.members;
drop policy if exists members_update on public.members;
create policy members_select on public.members for select to authenticated using (public.is_member(group_id));
-- a mano si possono aggiungere solo membri senza account; gli account entrano con join_group
create policy members_insert on public.members for insert to authenticated with check (public.is_member(group_id) and user_id is null);
create policy members_update on public.members for update to authenticated using (public.is_member(group_id) and user_id = auth.uid()) with check (public.is_member(group_id) and user_id = auth.uid());
-- i membri aggiunti a mano (senza account) si possono rinominare da chiunque nel gruppo
drop policy if exists members_update_placeholder on public.members;
create policy members_update_placeholder on public.members for update to authenticated using (public.is_member(group_id) and user_id is null) with check (public.is_member(group_id) and user_id is null);

drop policy if exists homes_all on public.private_homes;
create policy homes_all on public.private_homes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(group_id));

drop policy if exists places_all on public.places;
create policy places_all on public.places for all to authenticated using (public.is_member(group_id)) with check (public.is_member(group_id));

drop policy if exists trips_select on public.trips;
drop policy if exists trips_insert on public.trips;
drop policy if exists trips_update on public.trips;
create policy trips_select on public.trips for select to authenticated using (public.is_member(group_id));
create policy trips_insert on public.trips for insert to authenticated with check (public.is_member(group_id));
create policy trips_update on public.trips for update to authenticated using (public.is_member(group_id)) with check (public.is_member(group_id));
-- nessuna policy di delete: i viaggi si annullano, non si cancellano

drop policy if exists settlements_all on public.settlements;
drop policy if exists settlements_select on public.settlements;
drop policy if exists settlements_insert on public.settlements;
drop policy if exists settlements_delete on public.settlements;
create policy settlements_select on public.settlements for select to authenticated using (public.is_member(group_id));
create policy settlements_insert on public.settlements for insert to authenticated with check (public.is_member(group_id));
create policy settlements_delete on public.settlements for delete to authenticated using (public.is_member(group_id));
-- nessuna modifica: un rimborso sbagliato si elimina e si registra di nuovo

-- Colonne modificabili dai client: tutto il resto passa solo dalle funzioni qui sotto o dai trigger.
revoke insert, update on public.members from authenticated, anon;
grant insert (group_id, name, color) on public.members to authenticated;
grant update (name, color, home, home_shared) on public.members to authenticated;
revoke update on public.groups from authenticated, anon;
grant update (name, settings) on public.groups to authenticated;
revoke update on public.trips from authenticated, anon;
grant update (status, starts_at, data, version, confirmed_at, updated_by) on public.trips to authenticated;
revoke update on public.settlements from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Coerenza: una modifica alla volta per viaggio
-- ---------------------------------------------------------------------------
-- Chi scrive è sempre il membro collegato: «creato da» e «ultima modifica di» non sono falsificabili.
create or replace function public.my_member(g uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where group_id = g and user_id = auth.uid() and left_at is null
$$;

-- Limiti realistici per i numeri del viaggio: niente km o pedaggi fuori scala inseriti a mano via API.
create or replace function public.trip_values_ok(d jsonb) returns boolean language plpgsql immutable as $$
declare l jsonb; m numeric; n int; c numeric;
begin
  for l in select * from jsonb_array_elements(d->'legs') loop
    if coalesce(nullif(l->>'actualMeters', '')::numeric, 0) not between 0 and 2000000 then return false; end if;
    if coalesce(nullif(l->>'tollOverride', '')::numeric, 0) not between 0 and 50000 then return false; end if;
    select coalesce(sum(nullif(x->>'meters', '')::numeric), 0), count(*), coalesce(sum(nullif(x->'toll'->>'cents', '')::numeric), 0)
      into m, n, c
      from jsonb_array_elements(case when jsonb_typeof(l->'segs') = 'array' then l->'segs' else '[]'::jsonb end) x;
    if m > 2000000 or n > 40 or c > 50000 then return false; end if;
    if jsonb_typeof(l->'stops') = 'array' and jsonb_array_length(l->'stops') > 41 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public.trips_guard() returns trigger language plpgsql as $$
declare me uuid := public.my_member(new.group_id);
begin
  if not public.trip_values_ok(new.data) then raise exception 'Il viaggio contiene valori fuori scala (km o pedaggi).'; end if;
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := now();
    if me is not null then new.created_by := me; new.updated_by := me; end if;
    new.confirmed_at := case when new.status = 'confirmed' then now() else null end;
    return new;
  end if;
  if new.version <> old.version + 1 then
    raise exception 'conflict: il viaggio è stato modificato da un altro dispositivo' using errcode = '40001';
  end if;
  if new.group_id <> old.group_id or new.id <> old.id or new.created_by is distinct from old.created_by then
    raise exception 'campo non modificabile';
  end if;
  if me is not null then new.updated_by := me; end if;
  new.updated_at := now();
  if new.status = 'confirmed' and old.status <> 'confirmed' then new.confirmed_at := now(); end if;
  if new.status <> 'confirmed' and old.status = 'confirmed' and new.status <> 'cancelled' then new.confirmed_at := old.confirmed_at; end if;
  return new;
end $$;
drop trigger if exists trips_guard on public.trips;
create trigger trips_guard before insert or update on public.trips for each row execute function public.trips_guard();

-- Rimborsi solo tra membri dello stesso gruppo, mai a se stessi; autore = chi lo registra.
create or replace function public.settlements_guard() returns trigger language plpgsql as $$
begin
  if new.from_member = new.to_member then raise exception 'Un rimborso non può essere verso se stessi'; end if;
  if not exists (select 1 from public.members where id = new.from_member and group_id = new.group_id)
     or not exists (select 1 from public.members where id = new.to_member and group_id = new.group_id) then
    raise exception 'Il rimborso deve essere tra membri del gruppo';
  end if;
  new.created_by := coalesce(public.my_member(new.group_id), new.created_by);
  new.created_at := now();
  return new;
end $$;
drop trigger if exists settlements_guard on public.settlements;
create trigger settlements_guard before insert on public.settlements for each row execute function public.settlements_guard();

create or replace function public.members_guard() returns trigger language plpgsql as $$
begin
  if (new.user_id is distinct from old.user_id or new.group_id <> old.group_id or new.left_at is distinct from old.left_at)
     and coalesce(current_setting('giro.rpc', true), '') <> '1' then
    raise exception 'campo non modificabile direttamente';
  end if;
  return new;
end $$;
drop trigger if exists members_guard on public.members;
create trigger members_guard before update on public.members for each row execute function public.members_guard();

-- ---------------------------------------------------------------------------
-- Gruppi e inviti
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'accesso richiesto'; end if;
  insert into public.groups(name) values (p_name) returning id into g;
  insert into public.members(group_id, user_id, name) values (g, auth.uid(), p_member_name);
  return g;
end $$;

create or replace function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'group_id', g.id, 'name', g.name,
    'already_member', exists (select 1 from public.members m where m.group_id = g.id and m.user_id = auth.uid() and m.left_at is null),
    'rejoin_name', (select m.name from public.members m where m.group_id = g.id and m.user_id = auth.uid() and m.left_at is not null limit 1),
    'unclaimed', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.joined_at)
                           from public.members m where m.group_id = g.id and m.user_id is null and m.left_at is null), '[]'::jsonb))
  from public.groups g where g.invite_code = p_code and auth.uid() is not null
$$;

-- Chi entra parte da zero: i viaggi precedenti non gli attribuiscono quote.
create or replace function public.join_group(p_code text, p_name text, p_claim uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid; n int;
begin
  if auth.uid() is null then raise exception 'accesso richiesto'; end if;
  select id into g from public.groups where invite_code = p_code;
  if g is null then raise exception 'Invito non valido o scaduto'; end if;
  perform set_config('giro.rpc', '1', true);
  update public.members set left_at = null where group_id = g and user_id = auth.uid();
  get diagnostics n = row_count;
  if n > 0 then return g; end if;
  if p_claim is not null then
    update public.members set user_id = auth.uid() where id = p_claim and group_id = g and user_id is null and left_at is null;
    get diagnostics n = row_count;
    if n > 0 then return g; end if;
    raise exception 'Questo nome è appena stato scelto da un altro account. Scegli di nuovo.';
  end if;
  if exists (select 1 from public.members where group_id = g and left_at is null and lower(trim(name)) = lower(trim(p_name))) then
    raise exception 'Nel gruppo c''è già qualcuno con questo nome: aggiungi l''iniziale del cognome.';
  end if;
  select count(*) into n from public.members where group_id = g;
  insert into public.members(group_id, user_id, name, color) values (g, auth.uid(), p_name, n % 8);
  return g;
end $$;

create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('giro.rpc', '1', true);
  update public.members set left_at = now(), home = null, home_shared = false where group_id = p_group and user_id = auth.uid();
  delete from public.private_homes where group_id = p_group and user_id = auth.uid();
end $$;

-- Toglie dal gruppo un membro aggiunto a mano (senza account). Resta nello storico dei viaggi.
create or replace function public.remove_placeholder(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select group_id into g from public.members where id = p_member and user_id is null;
  if g is null or not public.is_member(g) then raise exception 'Si possono togliere solo i membri senza account'; end if;
  perform set_config('giro.rpc', '1', true);
  update public.members set left_at = now() where id = p_member;
end $$;

-- Una tariffa alla volta: due telefoni che salvano tariffe diverse non si sovrascrivono.
create or replace function public.set_group_toll(p_group uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_group) then raise exception 'accesso negato'; end if;
  if p_key !~ '^[a-z-]+\|[a-z-]+$' then raise exception 'Coppia di caselli non valida'; end if;
  if p_value is not null and coalesce((p_value->>'cents')::numeric, -1) not between 1 and 50000 then raise exception 'Importo non valido'; end if;
  update public.groups set settings = case
      when p_value is null then jsonb_set(settings, '{tolls}', coalesce(settings->'tolls', '{}'::jsonb) - p_key)
      else jsonb_set(settings, '{tolls}', coalesce(settings->'tolls', '{}'::jsonb) || jsonb_build_object(p_key, p_value))
    end
  where id = p_group;
end $$;

-- Nuovo link di invito: il vecchio smette di funzionare.
create or replace function public.regenerate_invite(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := encode(gen_random_bytes(9), 'hex');
begin
  if not public.is_member(p_group) then raise exception 'accesso negato'; end if;
  update public.groups set invite_code = c where id = p_group;
  return c;
end $$;

revoke all on function public.create_group(text, text), public.invite_preview(text), public.join_group(text, text, uuid), public.leave_group(uuid), public.regenerate_invite(uuid), public.my_member(uuid), public.remove_placeholder(uuid), public.set_group_toll(uuid, text, jsonb) from public, anon;
grant execute on function public.create_group(text, text), public.invite_preview(text), public.join_group(text, text, uuid), public.leave_group(uuid), public.regenerate_invite(uuid), public.is_member(uuid), public.my_member(uuid), public.remove_placeholder(uuid), public.set_group_toll(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Aggiornamenti in tempo reale tra dispositivi
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups', 'members', 'places', 'trips', 'settlements'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
