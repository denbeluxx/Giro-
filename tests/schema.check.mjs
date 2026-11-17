// Collaudo dello schema su Postgres (PGlite): RLS, inviti, concorrenza, doppio invio.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync } from 'node:fs'

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated; create role anon;
  grant usage on schema public, auth to authenticated;
  alter default privileges in schema public grant all on tables to authenticated;
`)
await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'))
await db.exec(`grant all on all tables in schema public to authenticated;`)

const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333'
await db.exec(`insert into auth.users values ('${U1}'),('${U2}'),('${U3}')`)
const as = async (u, sql, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`)
  try { return (await db.query(sql, params)).rows } finally { await db.exec('reset role') }
}
let pass = 0
const ok = (c, msg) => { if (!c) { console.error('✗', msg); process.exit(1) } pass++; console.log('✓', msg) }
const fails = async (p, msg) => { try { await p; ok(false, msg) } catch { ok(true, msg) } }

const [{ g }] = await as(U1, `select create_group('Sabato sera', 'Andrea') g`)
const [{ invite_code: code }] = await as(U1, `select invite_code from groups where id = $1`, [g])
ok(code.length === 18, 'gruppo creato con codice invito')
ok((await as(U2, `select * from groups`)).length === 0, 'chi non è membro non vede il gruppo')
ok((await as(U2, `select * from members`)).length === 0, 'chi non è membro non vede i membri')
await as(U1, `insert into members(group_id, name) values ($1, 'Luca')`, [g])
const [{ p }] = await as(U2, `select invite_preview($1) p`, [code])
ok(p.name === 'Sabato sera' && p.unclaimed.length === 1, 'anteprima invito con membri da collegare')
await as(U2, `select join_group($1, 'Luca', $2)`, [code, p.unclaimed[0].id])
const ms = await as(U2, `select * from members order by joined_at`)
ok(ms.length === 2 && ms[1].user_id === U2, 'ingresso con invito: collega il membro esistente, nessun doppione')
await as(U2, `select join_group($1, 'Luca', null)`, [code])
ok((await as(U2, `select * from members`)).length === 2, 'invito riaperto: resta un solo membro')
await fails(as(U2, `update members set user_id = '${U3}' where user_id = '${U2}'`), 'non si può cambiare l\'utente di un membro')
ok((await as(U2, `update members set name = 'X' where user_id = '${U1}' returning id`)).length === 0, 'non si modifica il profilo di un altro')

const T = '99999999-9999-4999-8999-999999999999'
const ins = `insert into trips(id, group_id, status, starts_at, data, created_by) values ($1, $2, 'planned', now(), '{}', $3) on conflict (id) do nothing returning id`
ok((await as(U1, ins, [T, g, ms[0].id])).length === 1, 'viaggio salvato')
ok((await as(U1, ins, [T, g, ms[0].id])).length === 0, 'secondo invio dello stesso viaggio: nessun doppione')
ok((await as(U2, `select * from trips`)).length === 1, 'l\'altro membro vede lo stesso viaggio')
ok((await as(U3, `select * from trips`)).length === 0, 'un estraneo non vede i viaggi')
await fails(as(U3, ins, ['99999999-9999-4999-8999-999999999998', g, ms[0].id]), 'un estraneo non può inserire viaggi')
const conf = `update trips set status = 'confirmed', version = $2 + 1 where id = $1 and version = $2 returning version, confirmed_at`
const c1 = await as(U1, conf, [T, 1])
ok(c1.length === 1 && c1[0].version === 2 && c1[0].confirmed_at, 'conferma registrata')
ok((await as(U2, conf, [T, 1])).length === 0, 'conferma ripetuta da un altro dispositivo: ignorata (versione superata)')
await fails(as(U2, `update trips set version = 7 where id = $1`, [T]), 'salto di versione rifiutato dal database')
ok((await as(U1, `delete from trips where id = $1 returning id`, [T])).length === 0, 'i viaggi non si cancellano')

await as(U2, `insert into private_homes(group_id, user_id, home) values ($1, '${U2}', '{"lat":1}')`, [g])
ok((await as(U1, `select * from private_homes`)).length === 0, 'la casa non condivisa è visibile solo al proprietario')
await as(U2, `select leave_group($1)`, [g])
ok((await as(U2, `select * from trips`)).length === 0, 'chi lascia il gruppo non vede più i dati')
const after = await as(U1, `select * from members order by joined_at`)
ok(after.length === 2 && after[1].left_at, 'chi lascia resta nello storico')
await as(U3, `select join_group($1, 'Sara', null)`, [code])
ok((await as(U3, `select * from members`)).length === 3, 'nuovo membro aggiunto')
console.log(`\n${pass} controlli superati`)
