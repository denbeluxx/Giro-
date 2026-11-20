-- Shotgun — schema del database (Supabase / Postgres).
-- Incolla tutto nell'SQL Editor di Supabase ed esegui una volta.
-- I saldi NON sono salvati: l'app li ricalcola sempre dai viaggi confermati e dai rimborsi.

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 18),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- chi ha creato il gruppo: è l'unico che sceglie i testi delle notifiche
alter table public.groups add column if not exists owner uuid references auth.users(id) on delete set null;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
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
grant update (name) on public.groups to authenticated; -- le impostazioni cambiano solo con set_group_toll
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
  if new.starts_at > now() + interval '2 years' or new.starts_at < now() - interval '20 years' then raise exception 'La data del viaggio non è valida.'; end if;
  -- chi guida, chi paga e chi è presente devono essere membri di questo gruppo
  if exists (
    select 1 from (
      select jsonb_array_elements_text(case when jsonb_typeof(new.data->'presentIds') = 'array' then new.data->'presentIds' else '[]'::jsonb end) as mid
      union all select l->>'driverId' from jsonb_array_elements(case when jsonb_typeof(new.data->'legs') = 'array' then new.data->'legs' else '[]'::jsonb end) l where l->>'driverId' is not null
      union all select l->>'tollPayerId' from jsonb_array_elements(case when jsonb_typeof(new.data->'legs') = 'array' then new.data->'legs' else '[]'::jsonb end) l where l->>'tollPayerId' is not null
    ) ids where not exists (select 1 from public.members m where m.group_id = new.group_id and m.id::text = ids.mid)
  ) then raise exception 'Il viaggio cita persone che non sono nel gruppo.'; end if;
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
  -- l'eliminazione di un account azzera user_id (on delete set null): è ammessa
  if ((new.user_id is distinct from old.user_id and new.user_id is not null) or new.group_id <> old.group_id or new.left_at is distinct from old.left_at)
     and coalesce(current_setting('shotgun.rpc', true), '') <> '1' then
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
  insert into public.groups(name, owner) values (p_name, auth.uid()) returning id into g;
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
  perform set_config('shotgun.rpc', '1', true);
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
  perform set_config('shotgun.rpc', '1', true);
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
  perform set_config('shotgun.rpc', '1', true);
  update public.members set left_at = now() where id = p_member;
end $$;

-- Una tariffa alla volta: due telefoni che salvano tariffe diverse non si sovrascrivono.
create or replace function public.set_group_toll(p_group uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_group) then raise exception 'accesso negato'; end if;
  if p_key !~ '^[a-z-]+\|[a-z-]+$' then raise exception 'Coppia di caselli non valida'; end if;
  if p_value is not null and coalesce((p_value->>'cents')::numeric, -1) not between 1 and 50000 then raise exception 'Importo non valido'; end if;
  -- autore e data li scrive il database: non si possono falsificare
  update public.groups set settings = case
      when p_value is null then jsonb_set(case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end, '{tolls}', coalesce(settings->'tolls', '{}'::jsonb) - p_key)
      else jsonb_set(case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end, '{tolls}', coalesce(settings->'tolls', '{}'::jsonb) || jsonb_build_object(p_key,
        jsonb_build_object('cents', round((p_value->>'cents')::numeric), 'by', public.my_member(p_group), 'on', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
    end
  where id = p_group;
end $$;

-- Nuovo link di invito: il vecchio smette di funzionare.
create or replace function public.regenerate_invite(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 18);
begin
  if not public.is_member(p_group) then raise exception 'accesso negato'; end if;
  update public.groups set invite_code = c where id = p_group;
  return c;
end $$;

revoke all on function public.create_group(text, text), public.invite_preview(text), public.join_group(text, text, uuid), public.leave_group(uuid), public.regenerate_invite(uuid), public.my_member(uuid), public.remove_placeholder(uuid), public.set_group_toll(uuid, text, jsonb) from public, anon;
grant execute on function public.create_group(text, text), public.invite_preview(text), public.join_group(text, text, uuid), public.leave_group(uuid), public.regenerate_invite(uuid), public.is_member(uuid), public.my_member(uuid), public.remove_placeholder(uuid), public.set_group_toll(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifiche e «Shotgun!»
-- ---------------------------------------------------------------------------
-- Telefoni iscritti alle notifiche (una riga per dispositivo).
create table if not exists public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) < 200),
  auth text not null check (char_length(auth) < 100),
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_select on public.push_subscriptions;
drop policy if exists push_delete on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke insert, update, truncate on public.push_subscriptions from authenticated, anon;

-- Un dispositivo appartiene a chi lo ha iscritto per ultimo (stesso telefono, account diverso).
create or replace function public.save_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'accesso richiesto'; end if;
  -- solo i servizi di notifica dei telefoni e dei browser (Google, Apple, Mozilla, Microsoft)
  if p_endpoint !~ '^https://([a-z0-9-]+\.)*(googleapis\.com|google\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)/' then
    raise exception 'Indirizzo di notifica non valido.';
  end if;
  insert into public.push_subscriptions(endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- al massimo 10 dispositivi per persona: i più vecchi escono
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from public.push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
end $$;

-- Il posto davanti: lo prende il primo che chiama «Shotgun!».
create table if not exists public.trip_shotgun (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.trip_shotgun enable row level security;
drop policy if exists shotgun_select on public.trip_shotgun;
create policy shotgun_select on public.trip_shotgun for select to authenticated using (public.is_member(group_id));
revoke insert, update, delete, truncate on public.trip_shotgun from authenticated, anon;

create or replace function public.claim_shotgun(p_trip uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; me uuid;
begin
  select id, group_id, status, starts_at, data into t from public.trips where id = p_trip for update;
  if not found or not public.is_member(t.group_id) then raise exception 'accesso negato'; end if;
  me := public.my_member(t.group_id);
  if t.status <> 'planned' then raise exception 'Shotgun vale solo per le uscite in programma.'; end if;
  if t.starts_at < now() - interval '2 hours' then raise exception 'Troppo tardi: l''uscita è già partita.'; end if;
  if not (t.data->'presentIds') ? me::text then raise exception 'Non sei tra i presenti di questa uscita.'; end if;
  if exists (select 1 from jsonb_array_elements(t.data->'legs') l where l->>'driverId' = me::text) then
    raise exception 'Guidi tu: il posto davanti lo lasci agli altri.';
  end if;
  -- un posto preso da chi nel frattempo non viene più o è diventato il conducente torna libero
  delete from public.trip_shotgun s where s.trip_id = p_trip and (not (t.data->'presentIds') ? s.member_id::text
    or exists (select 1 from jsonb_array_elements(t.data->'legs') l where l->>'driverId' = s.member_id::text)
    or exists (select 1 from public.members m where m.id = s.member_id and m.left_at is not null));
  insert into public.trip_shotgun(trip_id, group_id, member_id) values (p_trip, t.group_id, me) on conflict (trip_id) do nothing;
  return (select jsonb_build_object('member_id', member_id, 'mine', member_id = me) from public.trip_shotgun where trip_id = p_trip);
end $$;

-- Dati riservati al servizio delle notifiche: chiavi e registro degli invii. Nessun accesso dall'app.
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from authenticated, anon;
insert into public.app_secrets(name, value) values ('cron', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text)) on conflict (name) do nothing;
create table if not exists public.notify_log (key text primary key, at timestamptz not null default now());
alter table public.notify_log enable row level security;
revoke all on public.notify_log from authenticated, anon;

-- Gruppi creati prima di questa colonna: il creatore è il primo membro con un account
update public.groups g set owner = (select m.user_id from public.members m where m.group_id = g.id and m.user_id is not null order by m.joined_at limit 1) where g.owner is null;

-- Chi sceglie i testi: il creatore; se ha lasciato il gruppo, il membro con account che è nel gruppo da più tempo.
create or replace function public.texts_editor(p_group uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select g.owner from public.groups g where g.id = p_group and exists (select 1 from public.members m where m.group_id = g.id and m.user_id = g.owner and m.left_at is null)),
    (select m.user_id from public.members m where m.group_id = p_group and m.user_id is not null and m.left_at is null order by m.joined_at, m.id limit 1))
$$;
revoke all on function public.texts_editor(uuid) from public, anon;
grant execute on function public.texts_editor(uuid) to authenticated;

-- Testi delle notifiche, scelti da chi ha creato il gruppo. null o {} = testi predefiniti.
create or replace function public.set_notify_texts(p_group uuid, p_texts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb;
begin
  if not public.is_member(p_group) then raise exception 'accesso negato'; end if;
  if public.texts_editor(p_group) is distinct from auth.uid() then
    raise exception 'I testi delle notifiche li può cambiare solo chi ha creato il gruppo.';
  end if;
  if p_texts is null or p_texts = '{}'::jsonb then
    update public.groups set settings = settings - 'notifyTexts' where id = p_group;
    return;
  end if;
  if jsonb_typeof(p_texts) <> 'object' then raise exception 'Testi non validi.'; end if;
  for k, v in select * from jsonb_each(p_texts) loop
    if k not in ('new_trip', 'shotgun', 'confirm', 'low') or jsonb_typeof(v) <> 'object'
      or jsonb_typeof(v->'title') is distinct from 'string' or jsonb_typeof(v->'body') is distinct from 'string'
      or char_length(v->>'title') > 80 or regexp_replace(v->>'title', '[\s\u00a0\u200b\u200c\u200d\ufeff]', '', 'g') = '' or char_length(v->>'body') > 200
      or (select count(*) from jsonb_object_keys(v)) <> 2 then
      raise exception 'Testi non validi: titolo da 1 a 80 caratteri, messaggio fino a 200.';
    end if;
  end loop;
  update public.groups set settings = jsonb_set(settings, '{notifyTexts}', p_texts) where id = p_group;
end $$;
revoke all on function public.set_notify_texts(uuid, jsonb) from public, anon;
grant execute on function public.set_notify_texts(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Aggiornamenti in tempo reale tra dispositivi
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups', 'members', 'places', 'trips', 'settlements', 'trip_shotgun'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
