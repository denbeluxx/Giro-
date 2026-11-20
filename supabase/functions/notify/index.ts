// GENERATO da main.ts con «npm run build:notify»: non modificare a mano. Da incollare in Supabase → Edge Functions → notify → Code.

// supabase/functions/notify/main.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// src/lib/calc.ts
var THRESHOLD_M = 5e3;
var BONUS_CAP_M = 3e4;
var MAX_M = 1e7;
var MAX_CENTS = 1e6;
var safe = (v, max) => typeof v === "number" && isFinite(v) && v >= 0 && v <= max ? v : 0;
function occupantsBySeg(leg2) {
  const out = [];
  const aboard = /* @__PURE__ */ new Set();
  for (let i = 0; i < leg2.stops.length - 1; i++) {
    const s = leg2.stops[i];
    for (const id of s.off) aboard.delete(id);
    for (const id of s.on) aboard.add(id);
    const set = new Set(aboard);
    if (leg2.driverId) set.add(leg2.driverId);
    out.push([...set]);
  }
  return out;
}
var hasSegs = (leg2) => !!leg2.segs?.length && leg2.stops.length === leg2.segs.length + 1;
function segMeters(leg2) {
  if (!hasSegs(leg2)) return leg2.actualMeters != null ? [safe(leg2.actualMeters, MAX_M)] : [];
  const raw = leg2.segs.map((s) => safe(s.meters, MAX_M));
  if (leg2.actualMeters == null) return raw;
  const actual = safe(leg2.actualMeters, MAX_M);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return raw.map(() => actual / Math.max(1, raw.length));
  return raw.map((m) => m / sum * actual);
}
function legMeters(leg2) {
  if (leg2.actualMeters != null) return safe(leg2.actualMeters, MAX_M);
  return leg2.segs ? leg2.segs.reduce((a, s) => a + safe(s.meters, MAX_M), 0) : 0;
}
var RANK = { none: 0, ok: 1, verify: 2, out: 3 };
function legToll(leg2) {
  const segs = leg2.segs ?? [];
  if (leg2.tollOverride != null) {
    const base = segs.map((s) => s.toll).find((t) => t.status !== "none");
    const cents = safe(leg2.tollOverride, MAX_CENTS);
    const gates = leg2.tollGates ?? (base?.from ? { from: base.from, to: base.to } : null);
    return { ...base ?? {}, from: gates?.from, to: gates?.to, status: cents > 0 ? "ok" : "none", cents, known: cents, manual: true, note: void 0 };
  }
  if (leg2.tollGates) return { status: "verify", cents: null, known: 0, manual: true, road: "A4", from: leg2.tollGates.from, to: leg2.tollGates.to, note: "Importo da inserire per i caselli scelti" };
  let status = "none";
  let ref;
  let known = 0;
  let unknown = false;
  for (const s of segs) {
    if (s.toll.status === "none") continue;
    if (RANK[s.toll.status] > RANK[status]) {
      status = s.toll.status;
      ref = s.toll;
    }
    if (s.toll.status !== "out" && s.toll.cents != null) known += safe(s.toll.cents, MAX_CENTS);
    else unknown = true;
  }
  if (status === "none") return { status, cents: 0, known: 0, manual: false };
  return { ...ref, status, cents: unknown ? null : known, known, manual: false };
}
function segTollCents(leg2) {
  const segs = hasSegs(leg2) ? leg2.segs : [];
  if (!segs.length) return leg2.tollOverride != null && leg2.actualMeters != null ? [safe(leg2.tollOverride, MAX_CENTS)] : [];
  if (leg2.tollOverride == null && leg2.tollGates) return segs.map(() => 0);
  if (leg2.tollOverride != null) {
    const total = safe(leg2.tollOverride, MAX_CENTS);
    const out = segs.map(() => 0);
    if (!total) return out;
    let idx = segs.map((s, i) => s.toll.status !== "none" ? i : -1).filter((i) => i >= 0);
    if (!idx.length) idx = segs.map((_, i) => i);
    const auto = idx.map((i) => segs[i].toll.status !== "out" ? safe(segs[i].toll.cents, MAX_CENTS) : 0);
    const w = auto.every((c) => c > 0) ? auto : idx.map((i) => Math.max(1, safe(segs[i].meters, MAX_M)));
    const wsum = w.reduce((a, b) => a + b, 0);
    let given = 0;
    idx.forEach((i, k) => {
      const c = k === idx.length - 1 ? total - given : Math.round(total * w[k] / wsum);
      out[i] = c;
      given += c;
    });
    return out;
  }
  return segs.map((s) => s.toll.status === "none" || s.toll.status === "out" ? 0 : safe(s.toll.cents, MAX_CENTS));
}
function zeroSumRound(vals, seed = "") {
  const rank = (id) => {
    let h = 2166136261;
    for (const c of seed + "|" + id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  const ids2 = [...vals.keys()].sort();
  const clean = new Map(ids2.map((id) => [id, isFinite(vals.get(id)) ? vals.get(id) : 0]));
  const out = /* @__PURE__ */ new Map();
  let sum = 0;
  for (const id of ids2) {
    const r = Math.round(clean.get(id));
    out.set(id, r);
    sum += r;
  }
  if (sum !== 0 && ids2.length) {
    const dir = sum > 0 ? -1 : 1;
    const order = ids2.map((id) => ({ id, err: (out.get(id) - clean.get(id)) * (sum > 0 ? 1 : -1) })).sort((a, b) => b.err - a.err || (seed ? rank(a.id) - rank(b.id) : 0) || (a.id < b.id ? -1 : 1));
    const n = Math.min(Math.abs(sum), ids2.length * 4);
    for (let i = 0; i < n; i++) {
      const id = order[i % order.length].id;
      out.set(id, out.get(id) + dir);
    }
  }
  return out;
}
function displayRound(vals, step = 100) {
  const scaled = new Map(Object.entries(vals).map(([id, v]) => [id, v / step]));
  return Object.fromEntries([...zeroSumRound(scaled)].map(([id, v]) => [id, v * step || 0]));
}
function tripEffect(trip) {
  const legsIn = Array.isArray(trip.legs) ? trip.legs : [];
  const flaggedTrip = legsIn.some((l) => l.designated);
  const totalShown = Math.round(legsIn.reduce((a, l) => a + (l.driverId ? legMeters(l) : 0), 0) / 100) * 100;
  const total = legsIn.reduce((a, l) => a + (l.driverId ? legMeters(l) : 0), 0);
  const tripMult = !flaggedTrip || total <= 0 ? 1 : totalShown < THRESHOLD_M ? 3 : (total + Math.min(total, BONUS_CAP_M)) / total;
  const km = /* @__PURE__ */ new Map();
  const eur = /* @__PURE__ */ new Map();
  const add = (m, id, v) => m.set(id, (m.get(id) ?? 0) + v);
  const legs = [];
  for (const leg2 of legsIn) {
    const real = legMeters(leg2);
    const mult = leg2.driverId ? tripMult : 1;
    const toll2 = legToll(leg2);
    const payerId = leg2.tollPayerId ?? leg2.driverId;
    legs.push({ kind: leg2.kind, driverId: leg2.driverId, realMeters: real, mult, weightedMeters: real * mult, toll: toll2, payerId });
    if (!leg2.driverId) continue;
    const occ = hasSegs(leg2) ? occupantsBySeg(leg2) : [[.../* @__PURE__ */ new Set([leg2.driverId, ...trip.presentIds ?? []])]];
    const meters = segMeters(leg2);
    const tolls = segTollCents(leg2);
    meters.forEach((m, i) => {
      const who = occ[i];
      if (!who?.length) return;
      const w = m * mult;
      add(km, leg2.driverId, w);
      for (const id of who) add(km, id, -w / who.length);
      const c = tolls[i] ?? 0;
      if (c > 0 && payerId) {
        add(eur, payerId, c);
        for (const id of who) add(eur, id, -c / who.length);
      }
    });
  }
  return {
    km: zeroSumRound(km, trip.id),
    eur: zeroSumRound(eur, trip.id),
    legs,
    realMeters: legs.reduce((a, l) => a + l.realMeters, 0),
    weightedMeters: legs.reduce((a, l) => a + l.weightedMeters, 0)
  };
}
function balances(members, trips, settlements) {
  const km = {};
  const eur = {};
  const lastDrove = {};
  const known = new Set(members.map((m) => m.id));
  for (const m of members) {
    km[m.id] = 0;
    eur[m.id] = 0;
  }
  for (const t of trips) {
    if (t.status !== "confirmed") continue;
    const ids2 = [...t.presentIds ?? [], ...(t.legs ?? []).flatMap((l) => [l.driverId, l.tollPayerId, ...l.stops.flatMap((s) => [...s.on, ...s.off])])].filter((x) => !!x);
    if (ids2.some((x) => !known.has(x))) {
      console.warn("Viaggio con persone estranee al gruppo ignorato", t.id);
      continue;
    }
    const e = tripEffect(t);
    for (const [id, v] of e.km) km[id] = (km[id] ?? 0) + v;
    for (const [id, v] of e.eur) eur[id] = (eur[id] ?? 0) + v;
    for (const l of t.legs ?? []) {
      if (l.driverId && (!lastDrove[l.driverId] || lastDrove[l.driverId] < t.startsAt)) lastDrove[l.driverId] = t.startsAt;
    }
  }
  for (const s of Array.isArray(settlements) ? settlements : []) {
    if (!s) continue;
    if (!known.has(s.from) || !known.has(s.to) || s.from === s.to) continue;
    const c = safe(s.cents, MAX_CENTS);
    eur[s.from] = (eur[s.from] ?? 0) + c;
    eur[s.to] = (eur[s.to] ?? 0) - c;
  }
  return { km, eur, lastDrove };
}

// src/lib/notifyTexts.ts
var NOTIFY_DEFAULTS = {
  new_trip: { title: "Nuova uscita: {dove}", body: "{quando} · guida {guida}. Il posto davanti va a chi chiama Shotgun per primo." },
  shotgun: { title: "{chi} ha chiamato Shotgun!", body: "Il posto davanti per {dove} è suo." },
  confirm: { title: "Conferma il viaggio: {dove}", body: "Era {quando}. Controllate km e pedaggi e confermate." },
  low: { title: "Saldo {km} km", body: "Sei sotto i −70 km: alla prossima uscita il volante è tuo." }
};
function fillText(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
}
var textFor = (texts2, kind) => {
  const t = texts2 && typeof texts2 === "object" ? texts2[kind] : void 0;
  return t && typeof t.title === "string" && t.title.trim() && typeof t.body === "string" ? t : NOTIFY_DEFAULTS[kind];
};

// src/lib/validate.ts
var num = (v, min = -Infinity, max = Infinity) => typeof v === "number" && isFinite(v) && v >= min && v <= max ? v : null;
var str = (v) => typeof v === "string" ? v : null;
var ids = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
var TOLL_STATES = ["none", "ok", "verify", "out"];
function toll(v) {
  const status = TOLL_STATES.includes(v?.status) ? v.status : "none";
  return { status, cents: num(v?.cents, 0, 1e6), road: str(v?.road) ?? void 0, from: str(v?.from) ?? void 0, to: str(v?.to) ?? void 0, note: str(v?.note) ?? void 0, estimate: v?.estimate === true || void 0 };
}
function stop(v) {
  const lat = num(v?.lat, -90, 90), lng = num(v?.lng, -180, 180);
  if (lat == null || lng == null) return null;
  return { id: str(v?.id) ?? `${lat},${lng}`, name: str(v?.name) ?? "Tappa", lat, lng, on: ids(v?.on), off: ids(v?.off), homeOf: str(v?.homeOf) ?? void 0 };
}
function seg(v) {
  const meters = num(v?.meters, 0, 1e7);
  return meters == null ? null : { meters, seconds: num(v?.seconds, 0, 1e6) ?? 0, toll: toll(v?.toll) };
}
function leg(v) {
  if (!v || typeof v !== "object") return null;
  const stops = (Array.isArray(v.stops) ? v.stops : []).map(stop).filter(Boolean);
  let segs = Array.isArray(v.segs) ? v.segs.map(seg).filter(Boolean) : null;
  if (segs && segs.length !== Math.max(0, stops.length - 1)) segs = null;
  if (segs && (segs.reduce((a, x) => a + x.meters, 0) > 2e6 || segs.reduce((a, x) => a + (x.toll.cents ?? 0), 0) > 5e4)) return null;
  const geometry = Array.isArray(v.geometry) ? v.geometry.filter((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null).slice(0, 2e4) : null;
  const tg = v.tollGates && str(v.tollGates.from) && str(v.tollGates.to) ? { from: v.tollGates.from, to: v.tollGates.to } : null;
  return {
    kind: v.kind === "ritorno" ? "ritorno" : "andata",
    driverId: str(v.driverId),
    designated: v.designated === true,
    time: str(v.time) ?? void 0,
    stops,
    segs,
    geometry,
    routeState: ["ok", "stimato", "missing"].includes(v.routeState) ? v.routeState : segs ? "stimato" : "missing",
    actualMeters: num(v.actualMeters, 0, 2e6),
    tollPayerId: str(v.tollPayerId),
    tollOverride: num(v.tollOverride, 0, 5e4),
    tollGates: tg
  };
}
function sanitizeTrip(t) {
  try {
    if (!t || typeof t !== "object" || !str(t.id)) return null;
    const raw = Array.isArray(t.legs) ? t.legs : [];
    const legs = raw.map(leg).filter(Boolean).slice(0, 2);
    if (legs.length !== Math.min(2, raw.length)) return null;
    const lat = num(t.dest?.lat, -90, 90), lng = num(t.dest?.lng, -180, 180);
    if (!legs.length || lat == null || lng == null || !str(t.startsAt) || isNaN(Date.parse(t.startsAt))) return null;
    return {
      ...t,
      legs,
      presentIds: ids(t.presentIds),
      unavailableIds: ids(t.unavailableIds),
      dest: { name: str(t.dest?.name) ?? "Destinazione", lat, lng, address: str(t.dest?.address) ?? void 0 },
      status: ["planned", "confirmed", "cancelled"].includes(t.status) ? t.status : "planned",
      version: num(t.version, 1) ?? 1
    };
  } catch {
    return null;
  }
}
function sanitizeTrips(list) {
  const out = [];
  for (const t of list) {
    const s = sanitizeTrip(t);
    if (s) out.push(s);
    else console.warn("Viaggio con dati non validi ignorato", t);
  }
  return out;
}

// supabase/functions/notify/main.ts
var serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => {
  try {
    return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))[0];
  } catch {
    return "";
  }
})();
var db = createClient(Deno.env.get("SUPABASE_URL"), serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
var cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
var json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });
var LOW_M = -7e4;
var cut = (s, n) => {
  const c = Array.from(s);
  return c.length > n ? c.slice(0, n - 1).join("") + "…" : s;
};
async function texts(groupId, kind, vars) {
  const { data } = await db.from("groups").select("settings").eq("id", groupId).maybeSingle();
  const t = textFor(data?.settings?.notifyTexts, kind);
  return { title: cut(fillText(t.title, vars), 120), body: cut(fillText(t.body, vars), 300) };
}
async function secret(name) {
  const { data } = await db.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value ?? null;
}
var pair = (s) => {
  try {
    const v = JSON.parse(s ?? "");
    return v?.pub && v?.priv ? v : null;
  } catch {
    return null;
  }
};
async function vapid() {
  let v = pair(await secret("vapid"));
  if (!v) {
    const pub = await secret("vapid_public"), priv = await secret("vapid_private");
    const k = pub && priv ? { pub, priv } : (() => {
      const g = webpush.generateVAPIDKeys();
      return { pub: g.publicKey, priv: g.privateKey };
    })();
    await db.from("app_secrets").upsert({ name: "vapid", value: JSON.stringify(k) }, { onConflict: "name", ignoreDuplicates: true });
    v = pair(await secret("vapid"));
    if (!v) throw new Error("chiavi delle notifiche non disponibili");
  }
  webpush.setVapidDetails("mailto:denbeluxx@gmail.com", v.pub, v.priv);
  return v.pub;
}
async function once(key) {
  const { error } = await db.from("notify_log").insert({ key });
  return !error;
}
async function send(userIds, p) {
  const ids2 = [...new Set(userIds.filter((x) => !!x))];
  if (!ids2.length) return 0;
  await vapid();
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", ids2);
  let n = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 12 * 3600, urgency: "high" });
      n++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push", e?.statusCode, e?.body);
    }
  }));
  return n;
}
async function callerUser(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data.user?.id ?? null;
}
async function groupMembers(groupId) {
  const { data } = await db.from("members").select("id, user_id, name, left_at, joined_at, color").eq("group_id", groupId);
  const all = data ?? [];
  return { all, active: all.filter((m) => !m.left_at), name: (id) => nameOf(all.find((m) => m.id === id)?.name) };
}
async function loadTrip(id) {
  const { data } = await db.from("trips").select("id, group_id, status, starts_at, data").eq("id", id).maybeSingle();
  return data;
}
async function shownKm(groupId, all) {
  const [{ data: t }, { data: s }] = await Promise.all([
    db.from("trips").select("*").eq("group_id", groupId).eq("status", "confirmed"),
    db.from("settlements").select("*").eq("group_id", groupId)
  ]);
  const members = all.map((m) => ({ id: m.id, groupId, userId: m.user_id, name: m.name, color: m.color ?? 0, home: null, homeShared: false, joinedAt: m.joined_at, leftAt: m.left_at }));
  const trips = sanitizeTrips((t ?? []).map((r) => ({ ...r.data, id: r.id, groupId: r.group_id, status: r.status, version: r.version, startsAt: r.starts_at, createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at, confirmedAt: r.confirmed_at })));
  const settlements = (s ?? []).map((r) => ({ id: r.id, groupId: r.group_id, from: r.from_member, to: r.to_member, cents: r.cents, createdAt: r.created_at, createdBy: r.created_by }));
  return displayRound(balances(members, trips, settlements).km);
}
var when = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
var legsOf = (t) => Array.isArray(t.data?.legs) ? t.data.legs : [];
var driverOf = (t) => legsOf(t).find((l) => l?.driverId)?.driverId ?? null;
var driversOf = (t) => new Set(legsOf(t).map((l) => l?.driverId).filter((x) => typeof x === "string"));
var nameOf = (name) => (name ?? "").trim().replace(/\s+/g, " ") || "Qualcuno";
var fmtKm = (m) => (m / 1e3).toFixed(1).replace(".", ",").replace("-", "−");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") return json({ publicKey: await vapid() });
    const raw = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (body.type === "daily") {
      if (!req.headers.get("x-cron") || req.headers.get("x-cron") !== await secret("cron")) return json({ error: "non autorizzato" }, 401);
      const from = new Date(Date.now() - 40 * 36e5).toISOString(), to = new Date(Date.now() - 4 * 36e5).toISOString();
      const { data: trips } = await db.from("trips").select("id, group_id, status, starts_at, data").eq("status", "planned").gte("starts_at", from).lte("starts_at", to);
      let sent = 0;
      for (const t of trips ?? []) {
        if (!await once(`confirm:${t.id}`)) continue;
        const g = await groupMembers(t.group_id);
        const present = new Set(t.data?.presentIds ?? []);
        const d = driverOf(t);
        const txt = await texts(t.group_id, "confirm", { dove: t.data?.dest?.name ?? "uscita", quando: when(t.starts_at), guida: d ? g.name(d) : "da decidere" });
        sent += await send(g.active.filter((m) => present.has(m.id)).map((m) => m.user_id), { ...txt, url: `?t=${t.id}`, tag: `confirm-${t.id}` });
      }
      return json({ sent });
    }
    const uid = await callerUser(req);
    if (!uid) return json({ error: "accesso richiesto" }, 401);
    if (body.type === "test") {
      if (!await once(`test:${uid}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16)}`)) return json({ sent: 0, reason: "attendi" });
      return json({ sent: await send([uid], { title: "Notifiche attive", body: "Da ora ti avvisiamo di nuove uscite, Shotgun e viaggi da confermare.", url: "./", tag: "test" }) });
    }
    if (body.type === "new_trip" || body.type === "shotgun") {
      const t = await loadTrip(String(body.tripId ?? ""));
      if (!t) return json({ error: "uscita non trovata" }, 404);
      const g = await groupMembers(t.group_id);
      const me = g.active.find((m) => m.user_id === uid);
      if (!me) return json({ error: "accesso negato" }, 403);
      if (t.status !== "planned") return json({ sent: 0 });
      const dest = t.data?.dest?.name ?? "uscita";
      const present = new Set(t.data?.presentIds ?? []);
      const drivers = driversOf(t), driver = driverOf(t);
      if (body.type === "new_trip") {
        if (!await once(`new:${t.id}`)) return json({ sent: 0 });
        const others = g.active.filter((m) => m.user_id !== uid);
        const riders = others.filter((m) => present.has(m.id) && !drivers.has(m.id));
        const rest = others.filter((m) => !riders.includes(m));
        const txt2 = await texts(t.group_id, "new_trip", { dove: dest, quando: when(t.starts_at), guida: driver ? g.name(driver) : "da decidere", chi: nameOf(me.name) });
        const base = { ...txt2, url: `?t=${t.id}`, tag: `trip-${t.id}` };
        const sent = await send(riders.map((m) => m.user_id), { ...base, actions: [{ action: "shotgun", title: "Shotgun!" }] }) + await send(rest.map((m) => m.user_id), base);
        return json({ sent });
      }
      const { data: claim } = await db.from("trip_shotgun").select("member_id").eq("trip_id", t.id).maybeSingle();
      if (!claim || claim.member_id !== me.id || !await once(`shotgun:${t.id}:${me.id}`)) return json({ sent: 0 });
      const to = g.active.filter((m) => m.id !== me.id && (present.has(m.id) || drivers.has(m.id)));
      const txt = await texts(t.group_id, "shotgun", { chi: nameOf(me.name), dove: dest, quando: when(t.starts_at) });
      return json({ sent: await send(to.map((m) => m.user_id), { ...txt, url: `?t=${t.id}`, tag: `shotgun-${t.id}` }) });
    }
    if (body.type === "low") {
      const groupId = String(body.groupId ?? "");
      const g = await groupMembers(groupId);
      if (!g.active.some((m) => m.user_id === uid)) return json({ error: "accesso negato" }, 403);
      const target = g.active.find((m) => m.id === body.memberId);
      if (!target?.user_id) return json({ sent: 0 });
      const km = (await shownKm(groupId, g.all))[target.id] ?? 0;
      if (km > LOW_M) return json({ sent: 0 });
      if (!await once(`low:${target.id}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`)) return json({ sent: 0 });
      const txt = await texts(groupId, "low", { chi: nameOf(target.name), km: fmtKm(km) });
      return json({ sent: await send([target.user_id], { ...txt, url: "./", tag: `low-${target.id}` }) });
    }
    return json({ error: "richiesta sconosciuta" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "errore interno" }, 500);
  }
});
