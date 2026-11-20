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
const DATA = JSON.stringify({ dest: { name: 'X', lat: 45, lng: 9 }, presentIds: [], legs: [{}] })
const ins = `insert into trips(id, group_id, status, starts_at, data, created_by) values ($1, $2, 'planned', now(), '${DATA}', $3) on conflict (id) do nothing returning id`
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
// --- protezioni aggiunte dopo il collaudo ---
const [m2] = await as(U3, `select id from members where user_id = '${U3}'`)
await fails(as(U3, `update members set id = gen_random_uuid() where id = $1`, [m2.id]), 'un membro non può cambiare il proprio id (e azzerare il debito)')
await fails(as(U3, `update members set joined_at = now() - interval '1 year' where id = $1`, [m2.id]), 'data di ingresso non modificabile')
await fails(as(U1, `update groups set invite_code = 'aaaa' where id = $1`, [g]), 'il codice invito non si imposta a mano')
const [{ c }] = await as(U1, `select regenerate_invite($1) c`, [g])
ok(c.length === 18 && c !== code, 'nuovo link di invito generato')
await fails(as(U1, `insert into trips(id, group_id, status, starts_at, data) values (gen_random_uuid(), $1, 'planned', now(), '{}')`, [g]), 'viaggio con dati malformati rifiutato')
const T2 = '99999999-9999-4999-8999-999999999990'
await as(U3, `insert into trips(id, group_id, status, starts_at, data, created_by, updated_by) values ($1, $2, 'planned', now(), '${DATA}', $3, $3)`, [T2, g, ms[0].id])
const [tr] = await as(U3, `select created_by, updated_by from trips where id = $1`, [T2])
ok(tr.created_by === m2.id && tr.updated_by === m2.id, '«creato da» e «modificato da» sono sempre il membro collegato')
const outsider = (await db.query(`insert into groups(name) values ('Altro') returning id`)).rows[0].id
const om = (await db.query(`insert into members(group_id, name) values ($1, 'Estraneo') returning id`, [outsider])).rows[0].id
await fails(as(U3, `insert into settlements(id, group_id, from_member, to_member, cents) values (gen_random_uuid(), $1, $2, $3, 100)`, [g, m2.id, om]), 'rimborso verso un membro di un altro gruppo rifiutato')
await fails(as(U3, `insert into settlements(id, group_id, from_member, to_member, cents) values (gen_random_uuid(), $1, $2, $2, 100)`, [g, m2.id]), 'rimborso a se stessi rifiutato')
const S = (await as(U3, `insert into settlements(id, group_id, from_member, to_member, cents) values (gen_random_uuid(), $1, $2, $3, 100) returning id`, [g, m2.id, ms[0].id]))[0].id
ok((await as(U3, `update settlements set cents = 1 where id = $1 returning id`, [S]).catch(() => [])).length === 0, 'un rimborso non si modifica')
await as(U1, `insert into members(group_id, name) values ($1, 'Paolo')`, [g])
const [{ p: pv }] = await as(U2, `select invite_preview($1) p`, [c])
ok(pv.rejoin_name === 'Luca', 'chi rientra viene riconosciuto: ritrova il suo saldo')
const paolo = pv.unclaimed.find((x) => x.name === 'Paolo').id
const U4 = '44444444-4444-4444-4444-444444444444', U5 = '55555555-5555-5555-5555-555555555555'
await db.exec(`insert into auth.users values ('${U4}'),('${U5}')`)
await as(U4, `select join_group($1, 'Paolo', $2)`, [c, paolo])
await fails(as(U5, `select join_group($1, 'Paolo', $2)`, [c, paolo]), 'due account sullo stesso nome: il secondo riceve un errore chiaro, nessun doppione')
const big = JSON.stringify({ dest: { name: 'X', lat: 45, lng: 9 }, presentIds: [], legs: [{ actualMeters: 5e9, segs: [] }] })
await fails(as(U4, `insert into trips(id, group_id, status, starts_at, data) values (gen_random_uuid(), $1, 'confirmed', now(), '${big}')`, [g]), 'km fuori scala rifiutati dal database')
const bigToll = JSON.stringify({ dest: { name: 'X', lat: 45, lng: 9 }, presentIds: [], legs: [{ segs: [{ meters: 1000, toll: { status: 'ok', cents: 499999 } }] }] })
await fails(as(U4, `insert into trips(id, group_id, status, starts_at, data) values (gen_random_uuid(), $1, 'confirmed', now(), '${bigToll}')`, [g]), 'pedaggi fuori scala rifiutati dal database')
await as(U1, `select set_group_toll($1, 'milano-est|seriate', '{"cents":440,"by":"x","on":"2026-11-17"}')`, [g])
await as(U4, `select set_group_toll($1, 'bergamo|milano-est', '{"cents":380,"by":"y","on":"2026-11-17"}')`, [g])
const [{ settings: st }] = await as(U1, `select settings from groups where id = $1`, [g])
ok(st.tolls['milano-est|seriate'].cents === 440 && st.tolls['bergamo|milano-est'].cents === 380, 'tariffe salvate da due telefoni: nessuna si perde')
await as(U4, `select set_group_toll($1, 'milano-est|seriate', null)`, [g])
const [{ settings: st2 }] = await as(U1, `select settings from groups where id = $1`, [g])
ok(!st2.tolls['milano-est|seriate'] && st2.tolls['bergamo|milano-est'], 'una tariffa rimossa resta rimossa, le altre restano')
await fails(as(U3, `select set_group_toll($1, 'x', '{"cents":1}')`, [outsider]), 'un estraneo non tocca le tariffe di un altro gruppo')

// --- Shotgun e notifiche ---
const members = (await as(U1, `select id, user_id, name from members where group_id = $1 and left_at is null order by joined_at`, [g]))
const mU1 = members.find((m) => m.user_id === U1).id, mU4 = members.find((m) => m.user_id === U4).id
const TS = '88888888-8888-4888-8888-888888888888'
const sdata = JSON.stringify({ dest: { name: 'Bolgia', lat: 45, lng: 9 }, presentIds: [mU1, mU4], legs: [{ driverId: mU1, stops: [], segs: [] }] })
await as(U1, `insert into trips(id, group_id, status, starts_at, data) values ($1, $2, 'planned', now() + interval '1 day', '${sdata}')`, [TS, g])
await fails(as(U1, `select claim_shotgun($1)`, [TS]), 'chi guida non può chiamare Shotgun')
await fails(as(U3, `select claim_shotgun($1)`, [TS]), 'un estraneo non può chiamare Shotgun')
const [{ claim_shotgun: c1s }] = await as(U4, `select claim_shotgun($1)`, [TS])
ok(c1s.mine === true && c1s.member_id === mU4, 'il primo che chiama Shotgun prende il posto davanti')
const [{ claim_shotgun: c2s }] = await as(U4, `select claim_shotgun($1)`, [TS])
ok(c2s.mine === true, 'chiamarlo di nuovo non cambia nulla')
ok((await as(U1, `select * from trip_shotgun where trip_id = $1`, [TS])).length === 1, 'tutti i membri vedono chi ha il posto davanti')
await fails(as(U4, `insert into trip_shotgun(trip_id, group_id, member_id) values ($1, $2, $3)`, ['99999999-9999-4999-8999-999999999999', g, mU4]), 'il posto davanti si prende solo con «Shotgun!»')
const sdata2 = JSON.stringify({ dest: { name: 'Bolgia', lat: 45, lng: 9 }, presentIds: [mU1, mU4], legs: [{ driverId: mU4, stops: [], segs: [] }] })
await as(U1, `update trips set data = '${sdata2}', version = version + 1 where id = $1`, [TS])
const [{ claim_shotgun: c3s }] = await as(U1, `select claim_shotgun($1)`, [TS])
ok(c3s.mine === true, 'se chi aveva il posto davanti diventa il conducente, il posto torna libero')
await as(U4, `select save_push('https://push.example/abc', 'k', 'a')`)
ok((await as(U4, `select * from push_subscriptions`)).length === 1 && (await as(U1, `select * from push_subscriptions`)).length === 0, 'ognuno vede solo i suoi dispositivi iscritti')
await as(U1, `select save_push('https://push.example/abc', 'k2', 'a2')`)
ok((await as(U1, `select * from push_subscriptions`)).length === 1 && (await as(U4, `select * from push_subscriptions`)).length === 0, 'stesso telefono, altro account: il dispositivo passa al nuovo account')
await fails(as(U1, `select * from app_secrets`), 'le chiavi del servizio notifiche non sono leggibili dall\'app')
console.log(`\n${pass} controlli superati`)
