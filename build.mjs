// The day's build: raw listings → ledger → the brand rooms' data and the mail lines.
//
//   node build.mjs              reads data/raw/, writes data/ and site/
//
// data/ledger.json is the record of every listing this index has ever shown:
// which of our brands it is (b), when it was first and last seen, and every price
// the seller asked (h). It is only ever added to. A listing that leaves the market
// is marked, not deleted. data/sold.json keeps the sale records.
//
// Rules this file keeps (Carol Christian Poell's, for many brands):
//   · a source that failed today was not observed: none of its listings is
//     seen again, and none of them vanishes
//   · a listing vanishes only when every search that found it was read to the end
//     twice without it, when its own page or card says it is sold or gone, or when
//     it is an auction whose stated end has passed — never because a reading was cut short
//   · a price has moved only when the seller's own number moved; the won
//     figure moves with the exchange rate every day and says nothing
//   · a sale record is not a listing: it has no ledger entry, is never new
//     and never vanishes
//   · 신규 (new) only from a search that had been read before today
//
// Writes:
//   site/index.json      every brand of brands.json: counts, two photos, the search words
//   site/b/<slug>.json   one brand's room, in the Carol Christian Poell page's data shape
//   site/new.json        today's new cards across brands (at most 400)
//   site/index.html      a page that links to the brands on the Archive Index site
//   data/ledger.json · data/sold.json · data/status.json · data/rates.json · data/edition.json
//   data/mail_meta.json · data/mail_lines.txt (the brands with the most new cards, one line each)

import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './classify.mjs';
import { BRANDS, ACTIVE, brandsOf, designatedOf } from './brands.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.BRAND_DATA || join(ROOT, 'data');
const RAW = process.env.BRAND_RAW || join(DATA, 'raw');
const SITE = process.env.BRAND_SITE || join(ROOT, 'site');
export const SITE_URL = 'https://rozykuzy.github.io/BRAND/';
export const BRANDS_URL = 'https://rozykuzy.github.io/?view=brands';
const kst = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const TODAY = process.env.BRAND_TODAY || kst();
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
// the ledger and the sale records: absent is a first run; present but unreadable
// is a stop — rewriting it from nothing would lose every first-seen date
function readRecord(f, empty) {
  if (!existsSync(f)) return empty;
  const txt = readFileSync(f, 'utf8');
  try { return JSON.parse(txt); } catch (e) { throw new Error(f + ' is unreadable (' + e.message + ') — not overwriting it'); }
}
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// how each collector's file is read
export const FILES = {
  // hold: the share of yesterday's listings a complete reading must find again
  // before anything it did not find is counted as missing (auctions end every day)
  grailed:      { kind: 'live', name: 'Grailed', m: '해외', how: '검색' },
  yahoo:        { kind: 'live', name: '야후옥션', m: '일본', how: '진행 중 경매', hold: 0.6 },
  yahoo_sold:   { kind: 'sold', name: '야후옥션', m: '일본', how: '180일 낙찰' },
  mercari:      { kind: 'live', name: '메루카리', m: '일본' },
  rakuma:       { kind: 'live', name: '라쿠마', m: '일본' },
  yfm:          { kind: 'live', name: '야후 플리마', m: '일본' },
  second:       { kind: 'live', name: '세컨드스트리트', m: '일본', how: '온라인 스토어' },
  fruits:       { kind: 'live', name: '후루츠패밀리', m: '한국', how: '브랜드 페이지', partial: true },
  fruits_check: { kind: 'check', name: '후루츠패밀리', m: '한국' },
  ebay:         { kind: 'live', name: 'eBay', m: '해외', how: '공식 API' },
};

// ── exchange rates ───────────────────────────────────────────────────────
// ECB reference rates (frankfurter), carried as the site carries them: won per
// dollar, pound, euro, and per 100 yen. Yesterday's rates when today's cannot
// be had — never made-up ones.
export async function fetchRates(prev) {
  if (process.env.BRAND_OFFLINE && prev && prev.USD > 0) return { ...prev, stale: true };
  const tries = ['https://api.frankfurter.dev/v1/latest?base=EUR', 'https://api.frankfurter.app/latest?from=EUR'];
  for (const u of tries) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) continue;
      const j = await r.json(), x = j.rates || {};
      if (!(x.KRW > 0 && x.USD > 0 && x.GBP > 0 && x.JPY > 0)) continue;
      const more = {};
      for (const [c, v] of Object.entries(x)) if (v > 0 && !['KRW', 'USD', 'GBP', 'JPY'].includes(c)) more[c] = Math.round(x.KRW / v * 100) / 100;
      return { USD: Math.round(x.KRW / x.USD), GBP: Math.round(x.KRW / x.GBP), EUR: Math.round(x.KRW), JPY: Math.round(x.KRW / x.JPY * 100),
               more, date: j.date || TODAY, from: 'ECB' };
    } catch {}
  }
  if (prev && prev.USD > 0) return { ...prev, stale: true };
  throw new Error('no exchange rate today and none on record — not building with invented rates');
}
export function toKRW(price, cur, rates) {
  if (!(price > 0)) return null;
  if (!cur || cur === 'KRW') return Math.round(price);
  const r = rates[cur] || (rates.more && rates.more[cur]); if (!(r > 0)) return null;
  return Math.round(cur === 'JPY' ? price * r / 100 : price * r);
}

// ── the ledger ───────────────────────────────────────────────────────────
// asg: { b: our brands, d: brands the site filed it under, qs: the searches that found it today }
function observe(L, it, file, day, rates, stats, asg) {
  const cfg = FILES[file];
  const k = toKRW(it.price, it.cur, rates);
  const cur = L.items[it.id];
  if (!cur && !k) return false;               // a price we cannot state in won is not shown
  if (!cur) {
    L.items[it.id] = {
      id: it.id, file, src: cfg.name, m: cfg.m, t: it.title, u: it.url, img: it.img || null, p: it.price, cur: it.cur || 'KRW', k,
      first: day, last: day, gone: null, miss: 0, h: [[day, k, it.price]], b: asg.b,
      ...(asg.d && asg.d.length ? { d: asg.d } : {}), ...(asg.qs && asg.qs.length ? { qs: asg.qs } : {}),
      ...(it.size ? { z: it.size } : {}), ...(it.brandTagged ? { tagged: 1 } : {}), ...(it.cond === 'new' ? { cn: 'new' } : {}),
      ...(it.cat ? { cat: it.cat } : {}),
      ...(Number.isFinite(it.bids) ? { bids: it.bids } : {}), ...(it.endsAt ? { ends: it.endsAt, endsPrec: it.endsPrec || 'd' } : {}),
      ...(Array.isArray(it.im) && it.im.length ? { im: it.im.slice(0, 12) } : {}),
    };
    stats.added++; return true;
  }
  // seen again. The seller's own number decides whether the price moved.
  if (cur.gone) { cur.gone = null; delete cur.ls; stats.back++; }
  cur.last = day; cur.miss = 0; cur.t = it.title || cur.t; cur.u = it.url || cur.u; if (k) cur.k = k;
  cur.b = asg.b;
  if (asg.d && asg.d.length) cur.d = asg.d; else delete cur.d;
  if (asg.qs && asg.qs.length) cur.qs = asg.qs;
  if (!(it.price > 0)) return true;
  if (it.img) cur.img = it.img;
  if (it.size) cur.z = it.size;
  if (it.brandTagged) cur.tagged = 1;
  if (it.cat) cur.cat = it.cat;
  if (Number.isFinite(it.bids)) cur.bids = it.bids;
  if (it.endsAt) { cur.ends = it.endsAt; cur.endsPrec = it.endsPrec || 'd'; }
  const sameCur = (cur.cur || 'KRW') === (it.cur || 'KRW');
  if (!sameCur) { cur.cur = it.cur || 'KRW'; cur.p = it.price; cur.h = [[day, k || cur.k, it.price]]; stats.recur++; }
  else if (it.price !== cur.p) {
    const lastH = cur.h[cur.h.length - 1];
    // a day has one price: a second reading on the same day corrects that day's
    // figure (a re-run after a parser fix) and is compared with the day before
    if (lastH && lastH[0] === day) {
      lastH[1] = k || lastH[1]; lastH[2] = it.price; cur.p = it.price;
      if (cur.h.length === 1) cur.k = k || cur.k;
    } else { cur.h.push([day, k || cur.k, it.price]); if (it.price < cur.p) stats.drops++; else stats.rises++; cur.p = it.price; stats.changed++; }
  }
  return true;
}

const PREC = { m: 6e4, h: 36e5, d: 864e5 };
// prevComplete: the day of each file's last reading with a search read to the end, before today
export function updateLedger(L, raw, summary, rates, day = TODAY, prevComplete = {}, now = Date.now()) {
  L.state = L.state || {};
  const stats = { added: 0, back: 0, changed: 0, drops: 0, rises: 0, recur: 0, vanished: 0, ended: 0, held: [], notOurs: 0, hidden: 0 };
  const seenBy = {};
  for (const [file, cfg] of Object.entries(FILES)) {
    if (cfg.kind !== 'live') continue;
    const s = summary.sources[file]; if (!s || !s.ok || !raw[file]) continue;
    const seen = seenBy[file] = new Set();
    for (const it of raw[file].items || []) {
      // a search page also shows what has just sold: it is not for sale, and a
      // listing we had shown that now carries the badge has left the market
      if (it.sold) {
        const x = L.items[it.id];
        if (x && !x.gone) { x.gone = day; x.ls = x.last; stats.vanished++; }
        if (x) seen.add(it.id);
        continue;
      }
      const d = designatedOf(it);
      const a = brandsOf(it.title, d);
      if (!a.b.length) {
        // a listing already shown whose title now says it is not ours or not for sale (専用 …): hidden, kept
        const x = L.items[it.id];
        if (x) { x.ex = a.why; x.last = day; seen.add(it.id); stats.hidden++; } else stats.notOurs++;
        continue;
      }
      if (L.items[it.id] && L.items[it.id].ex) delete L.items[it.id].ex;
      if (observe(L, it, file, day, rates, stats, { b: a.b, d, qs: it.qs || [] })) seen.add(it.id);
    }
    // linked from today's pages but not readable today (no price on the card): still
    // listed. Kept as seen, its last price unchanged — never brought back from gone.
    for (const id of raw[file].linked || []) {
      const x = L.items[id]; if (!x || x.gone || seen.has(id)) continue;
      x.last = day; x.miss = 0; seen.add(id); stats.unread = (stats.unread || 0) + 1;
    }
  }
  // who was not seen, where the reading went to the end
  for (const [file, seen] of Object.entries(seenBy)) {
    const cfg = FILES[file];
    if (cfg.partial) continue;
    const done = raw[file].done || {};
    const read = new Set(Object.keys(done)), whole = new Set(Object.keys(done).filter((k) => done[k]));
    const mine = Object.values(L.items).filter((x) => x.file === file && !x.gone && !x.ex && !seen.has(x.id));
    // an auction whose own stated end has passed is over (with that much margin as the
    // end was known to), once a search that found it has been read today — however far
    for (const x of mine) {
      if (!x.ends || !(x.qs || []).some((k) => read.has(k))) continue;
      if (Date.parse(x.ends) + (PREC[x.endsPrec] || PREC.d) < now) { x.gone = day; x.ls = x.last; stats.vanished++; stats.ended++; }
    }
    // the rest: only where every search that found it was read to the end today
    const all = Object.values(L.items).filter((x) => x.file === file && !x.gone && !x.ex && (x.qs || []).length && x.qs.every((k) => whole.has(k)));
    if (!all.length) continue;
    // a reading that found far fewer of yesterday's listings than were there is
    // held back from saying anything vanished: a half-loaded page looks like this.
    // A few gone is a market; a large share gone at once is a reading. It is held
    // back — its baseline kept — for up to three days, and after that taken as it is
    const base = prevComplete[file];
    const old = base ? all.filter((x) => x.first < day && x.last >= base) : [], seenOld = old.filter((x) => x.last === day).length;
    const held = (L.state.held || {})[file];
    const heldDays = held ? dayDiff(held, day) : 0;
    if (old.length - seenOld >= 5 && seenOld < (cfg.hold || 0.8) * old.length && heldDays < 3) {
      L.state.held = L.state.held || {}; if (!held) L.state.held[file] = day;
      stats.held.push(file); continue; }
    if (held) delete L.state.held[file];
    for (const x of all) {
      if (x.last === day || x.missDay === day) continue;     // one miss a day, however many runs
      x.miss = (x.miss || 0) + 1; x.missDay = day;
      if (x.miss >= 2) { x.gone = day; x.ls = x.last; stats.vanished++; }
    }
  }
  // 후루츠패밀리 listings looked at again on their own page
  const chk = summary.sources.fruits_check && summary.sources.fruits_check.ok ? raw.fruits_check : null;
  if (chk) for (const r of chk.items || []) {
    const x = L.items[r.id]; if (!x) continue;
    L.state.ffChecked = L.state.ffChecked || {}; L.state.ffChecked[r.id] = day;
    if (r.missing || !r.forSale) { if (!x.gone) { x.gone = day; x.ls = x.last; stats.vanished++; } continue; }
    const a = brandsOf(r.title || x.t, x.d || []);
    if (!a.b.length) { x.ex = a.why; x.last = day; stats.hidden++; continue; }
    observe(L, { id: r.id, title: r.title || x.t, url: x.u, price: r.price || x.p, cur: r.cur || x.cur, img: r.img }, x.file, day, rates, stats,
            { b: a.b, d: x.d || [], qs: x.qs || [] });
  }
  return stats;
}

// which sources answered today, which searches have been read, since when
export function markSeen(st, summary, stats, day = TODAY, raw = {}) {
  st.srcFirst = st.srcFirst || {}; st.seen = st.seen || {}; st.complete = st.complete || {}; st.keyFirst = st.keyFirst || {};
  for (const [f, s] of Object.entries(summary.sources)) {
    if (!s.ok || s.idle || !FILES[f]) continue;
    st.seen[f] = day;
    const kf = st.keyFirst[f] = st.keyFirst[f] || {};
    for (const k of Object.keys((raw[f] && raw[f].done) || {})) if (!kf[k]) kf[k] = day;
    // a held reading is not a baseline: the next day still compares with the one before it
    const someWhole = Object.values((raw[f] && raw[f].done) || {}).some(Boolean);
    if ((FILES[f].partial || someWhole || s.complete) && !(stats.held || []).includes(f)) { if (!st.srcFirst[f]) st.srcFirst[f] = day; st.complete[f] = day; }
  }
}

// ── sale records ─────────────────────────────────────────────────────────
export function updateSold(S, raw, summary, rates, day = TODAY) {
  let added = 0;
  for (const [file, cfg] of Object.entries(FILES)) {
    if (cfg.kind !== 'sold') continue;
    const s = summary.sources[file]; if (!s || !s.ok || !raw[file]) continue;
    for (const it of raw[file].items || []) {
      if (!it.soldAt || S.items[it.id]) continue;
      const a = brandsOf(it.title); if (!a.b.length) continue;
      const k = toKRW(it.price, it.cur, rates); if (!k) continue;
      S.items[it.id] = { id: it.id, file, src: cfg.name, t: it.title, u: it.url, img: it.img || null, p: it.price, cur: it.cur || 'JPY', k,
                         soldAt: it.soldAt, sk: it.soldKind || '낙찰', ...(Number.isFinite(it.bids) ? { bids: it.bids } : {}), first: day, b: a.b };
      added++;
    }
  }
  return added;
}

// ── each listing read once, for every brand it belongs to ────────────────
export function readEntry(x) {
  const a = brandsOf(x.t, x.d || []);
  if (!a.b.length) return null;
  const c = classify({ title: x.t, size: x.z, cat: x.cat, replicaLine: a.replicaLine });
  return c.exclude ? null : { b: a.b, c };
}
export function readAll(L, S) {
  const live = new Map(), sold = new Map();
  for (const x of Object.values(L.items)) {
    if (x.ex) continue;
    const r = readEntry(x); if (!r) continue;
    for (const s of r.b) (live.get(s) || live.set(s, []).get(s)).push([x, r.c]);
  }
  for (const x of Object.values(S.items)) {
    const r = readEntry(x); if (!r) continue;
    for (const s of r.b) (sold.get(s) || sold.set(s, []).get(s)).push([x, r.c]);
  }
  return { live, sold };
}

// ── the payload one brand's room reads (the CCP page's data shape) ────────
const norm = (t) => { let s = String(t || ''); try { s = s.normalize('NFKC'); } catch {} return s.toLowerCase()
  .replace(/【[^】]*(?:中古|used|美品|送料)[^】]*】|\((?:中古|used)\)/g, ' ').replace(/[【】\[\]()（）|｜\/・,，.。!！?？★☆◆■♪「」"“”'’]/g, ' ')
  .replace(/\s+/g, ' ').trim(); };
export const yearOfEra = (e) => { let m = /^(?:SS|AW|FW)(\d{2})$/.exec(e || ''); if (m) return (+m[1] >= 90 ? 1900 : 2000) + +m[1];
  m = /^(\d{4})$/.exec(e || ''); return m ? +m[1] : null; };

function payloadItem(x, c, rates, day) {
  // today's rate for today's figure: the struck-through price is at today's rate too
  const o = { t: x.t, k: toKRW(x.p, x.cur, rates) || x.k, r: x.src, l: x.u, i: x.img || null, s: c.section, f: x.first, c: c.tier };
  if (c.era) o.e = c.era;
  if (c.tier === 'B' && c.claim) { o.q = c.claim; o.qk = c.claimKind || 'arch'; }
  if (c.size) o.z = c.size;
  if (x.cur && x.cur !== 'KRW') { o.p = x.p; o.u = x.cur; }
  if (x.cn === 'new') o.cn = 'new';
  if (Array.isArray(x.im) && x.im.length) o.im = x.im;
  if (x.h && x.h.length >= 2) {
    o.h = x.h.map((pt) => [pt[0], pt[1], pt[2]]);
    // the last move, if it was down and recent, is shown struck through at today's rate
    const last = x.h[x.h.length - 1], prev = x.h[x.h.length - 2];
    if (last[2] < prev[2] && dayDiff(last[0], day) <= 14) { o.w = toKRW(prev[2], x.cur, rates); o.wd = last[0]; }
  }
  if (Number.isFinite(x.bids)) o.ab = x.bids;
  if (x.ends) { o.ae = x.ends; o.aeq = x.endsPrec || 'd'; }
  if (x.gone) { o.x = 1; o.ls = x.ls || x.last; }
  return o;
}

export function sourcesOf(L, summary) {
  const seenOf = (f) => (L.state.seen || {})[f];
  const srcs = new Map();
  for (const [f, cfg] of Object.entries(FILES)) {
    if (cfg.kind === 'check') continue;
    const s = summary.sources[f]; const seen = seenOf(f);
    if (!seen) continue;                                   // never answered: not claimed
    const cur = srcs.get(cfg.name) || { m: cfg.m, name: cfg.name, how: [], seen: null };
    if (s && s.ok && cfg.how) cur.how.push(cfg.how);
    // the day the listings were last read, not the day the sale records were
    if (cfg.kind === 'live' && (!cur.seen || seen > cur.seen)) cur.seen = seen;
    srcs.set(cfg.name, cur);
  }
  return [...srcs.values()].map((x) => ({ m: x.m, name: x.name, ...(x.how.length ? { how: [...new Set(x.how)].join(' + ') } : {}), ...(x.seen ? { seen: x.seen } : {}) }));
}

// brand: a brands.json entry. pre: readAll()'s result (read once for every brand); without it, read here
export function buildPayload(L, S, rates, summary, { day = TODAY, issue = 1, fresh = new Set(), brand, pre = null } = {}) {
  const slug = brand.slug;
  const mineLive = pre ? pre.live.get(slug) || [] : readAll(L, S).live.get(slug) || [];
  const mineSold = pre ? pre.sold.get(slug) || [] : readAll(L, S).sold.get(slug) || [];
  const live = [], goneRecent = [];
  for (const [x, c] of mineLive) {
    const o = payloadItem(x, c, rates, day);
    if (fresh.has(x.id)) o.n = 1;
    o.__id = x.id;
    (x.gone ? (dayDiff(x.gone, day) <= 60 ? goneRecent : null) : live)?.push(o);
  }
  // one listing on several platforms under one title: one card, every offer in it
  const byTitle = new Map(), out = [];
  for (const o of live) {
    const key = norm(o.t) + '|' + (o.z || '');
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(o);
  }
  let grouped = 0;
  for (const g of byTitle.values()) {
    // the shape of one listing cross-posted: one copy on each platform, asking
    // about the same. Two on one platform under one title are two garments,
    // and so is a price twice another's.
    const srcs = new Set(g.map((o) => o.r)), ks = g.map((o) => o.k);
    if (g.length < 2 || srcs.size !== g.length || Math.max(...ks) > 1.25 * Math.min(...ks)) { out.push(...g); continue; }
    g.sort((a, b) => a.k - b.k);
    const head = { ...g[0], g: g.length, __ids: g.map((o) => o.__id),
      v: g.map((o) => ({ k: o.k, r: o.r, l: o.l, i: o.i, ...(o.z ? { z: o.z } : {}), ...(o.p ? { p: o.p, u: o.u } : {}) })) };
    if (g.some((o) => o.n)) head.n = 1;
    head.f = g.map((o) => o.f).sort()[0];
    out.push(head); grouped++;
  }
  // sale records
  const sold = [];
  for (const [r, c] of mineSold) {
    if (dayDiff(r.soldAt, day) > 365) continue;
    const o = { t: r.t, k: r.k, r: r.src, l: r.u, i: r.img || null, s: c.section, f: r.first, c: c.tier, so: r.soldAt, sk: r.sk || '낙찰' };
    if (c.era) o.e = c.era;
    if (c.tier === 'B' && c.claim) { o.q = c.claim; o.qk = c.claimKind || 'arch'; }
    if (c.size) o.z = c.size;
    if (r.cur && r.cur !== 'KRW') { o.p = r.p; o.u = r.cur; }
    if (Number.isFinite(r.bids)) o.ab = r.bids;
    sold.push(o);
  }
  const freshN = out.reduce((n, o) => n + (o.__ids || [o.__id]).filter((id) => fresh.has(id)).length, 0);
  const changed = mineLive.filter(([x]) => !x.gone && x.h && x.h.length >= 2 && x.h[x.h.length - 1][0] === day).length;
  const items = [...out, ...goneRecent, ...sold].map((o) => { delete o.__id; delete o.__ids; return o; });

  const liveN = out.reduce((n, o) => n + (o.v ? o.v.length : 1), 0);
  const sections = {}, sellers = {}, years = [];
  for (const o of out) { sections[o.s] = (sections[o.s] || 0) + 1; for (const v of o.v || [o]) sellers[v.r] = (sellers[v.r] || 0) + 1;
    const y = yearOfEra(o.e); if (y) years.push(y); }
  years.sort((a, b) => a - b);
  const entries = Object.values(L.items).filter((x) => (x.b || []).includes(slug)).length;
  const d = new Date(Date.parse(day + 'T00:00:00Z'));
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  return {
    issue, issueLabel: 'Issue ' + String(issue).padStart(3, '0'), date: day.replace(/-/g, '.'),
    dateKo: d.getUTCFullYear() + '년 ' + (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + dow + '요일',
    built: new Date().toISOString(), today: day,
    rates: { USD: rates.USD, GBP: rates.GBP, EUR: rates.EUR, JPY: rates.JPY, ...(rates.date ? { date: rates.date } : {}), ...(rates.stale ? { stale: true } : {}) },
    counts: { entries, items: liveN, grouped, fresh: freshN, changed, sold: sold.length, gone: goneRecent.length },
    sections, sellers, yearSpan: years.length ? years[0] + '–' + years[years.length - 1] : '',
    sources: sourcesOf(L, summary),
    brand: { s: slug, n: brand.name, big: !!brand.big },
    items,
  };
}

// ── across brands ────────────────────────────────────────────────────────
// up to two photos for a brand's entry: dated (tier A) cards first, newest first, then any newest
export function photosOf(P) {
  const cards = P.items.filter((o) => !o.x && !o.so && o.i);
  const newest = (a, b) => String(b.f).localeCompare(String(a.f)) || b.k - a.k;
  const ph = [];
  for (const o of [...cards.filter((o) => o.c === 'A').sort(newest), ...cards.sort(newest)]) { if (!ph.includes(o.i)) ph.push(o.i); if (ph.length === 2) break; }
  return ph;
}
export function brandEntry(b, P, L) {
  const q = { en: b.latin[0], ja: (b.ja && b.ja[0]) || null, ko: (b.ko && b.ko[0]) || null };
  if (b.existing) return { s: b.slug, n: b.name, ex: b.existing };
  const cards = P.items.filter((o) => !o.x && !o.so);
  let upd = null;
  for (const x of Object.values(L.items)) if ((x.b || []).includes(b.slug) && (!upd || x.last > upd)) upd = x.last;
  return { s: b.slug, n: b.name, c: cards.length, nw: cards.filter((o) => o.n).length, big: !!b.big, so: P.items.filter((o) => o.so).length,
           srcs: P.sellers, ph: photosOf(P), upd, q };
}
// today's new cards across brands, newest first, each once (with its first brand; bs when it is several brands')
export function newCards(payloads, max = 400) {
  const seen = new Map();
  for (const [b, P] of payloads) for (const o of P.items) {
    if (!o.n || o.x || o.so) continue;
    const cur = seen.get(o.l);
    if (cur) { if (!cur.bs) cur.bs = [cur.b]; if (!cur.bs.includes(b.slug)) cur.bs.push(b.slug); continue; }
    seen.set(o.l, { ...o, b: b.slug });
  }
  return [...seen.values()].sort((a, b) => String(b.f).localeCompare(String(a.f)) || b.k - a.k).slice(0, max);
}
// the mail's lines: the brands with the most new cards, plain words
export function mailOf(index, day, top = 8) {
  const list = index.brands.filter((e) => e.nw > 0).sort((a, b) => b.nw - a.nw || a.n.localeCompare(b.n)).slice(0, top);
  const meta = { date: day, fresh: index.counts.fresh, brands: list.map((e) => [e.n, e.nw]) };
  const lines = list.map((e) => e.n + ' 신규 ' + e.nw.toLocaleString('ko-KR')).join('\n') + (list.length ? '\n' : '');
  return { meta, lines };
}
export const INDEX_HTML = '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Archive Index — Brands</title></head>\n<body><p><a href="' + BRANDS_URL + '">Archive Index — Brands</a></p></body></html>\n';

// ── run ──────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(DATA, { recursive: true }); mkdirSync(join(SITE, 'b'), { recursive: true });
  const summary = readJson(join(RAW, '_summary.json'), null);
  if (!summary) throw new Error('no data/raw/_summary.json — run collect.mjs first');
  summary.sources = summary.sources || {};
  const raw = {};
  for (const f of Object.keys(FILES)) { const r = readJson(join(RAW, f + '.json'), null); if (r) raw[f] = r; }

  const status = readJson(join(DATA, 'status.json'), null);
  const L = readRecord(join(DATA, 'ledger.json'), null) || { v: 1, start: TODAY, items: {}, state: {} };
  // the last build said how many it kept; a ledger with fewer has lost some, however it parses
  if (status && status.counts && status.counts.entries > Object.keys(L.items || {}).length)
    throw new Error('data/ledger.json has ' + Object.keys(L.items || {}).length + ' entries, the last build kept ' + status.counts.entries + ' — not overwriting it');
  L.state = L.state || {}; L.start = L.start || TODAY;
  const before = { n: Object.keys(L.items).length, first: Object.fromEntries(Object.values(L.items).map((x) => [x.id, x.first])) };
  const S = readRecord(join(DATA, 'sold.json'), null) || { v: 1, items: {} };
  const soldBefore = Object.keys(S.items).length;
  const prevRates = readJson(join(DATA, 'rates.json'), null);
  const rates = await fetchRates(prevRates);
  if (!rates.stale) writeFileSync(join(DATA, 'rates.json'), JSON.stringify(rates, null, 1));

  const st = L.state;
  st.srcFirst = st.srcFirst || {}; st.seen = st.seen || {}; st.complete = st.complete || {}; st.keyFirst = st.keyFirst || {};
  // a re-run on the same day compares with the reading before today's, not with its own
  const prevComplete = {};
  for (const [f, d] of Object.entries(st.complete)) prevComplete[f] = d < TODAY ? d : (st.completeBefore || {})[f];
  const prevKeyFirst = JSON.parse(JSON.stringify(st.keyFirst));
  const stats = updateLedger(L, raw, summary, rates, TODAY, prevComplete);
  st.completeBefore = {};
  for (const [f, d] of Object.entries(prevComplete)) if (d) st.completeBefore[f] = d;
  markSeen(st, summary, stats, TODAY, raw);
  const soldAdded = updateSold(S, raw, summary, rates);

  // the ledger never shrinks and no first-seen date ever moves
  const now = Object.values(L.items);
  if (now.length < before.n) throw new Error('ledger shrank: ' + before.n + ' → ' + now.length);
  if (Object.keys(S.items).length < soldBefore) throw new Error('sale records shrank');
  for (const x of now) if (before.first[x.id] && before.first[x.id] !== x.first) throw new Error('first-seen date moved for ' + x.id);

  // 신규: first seen today, through a search that had been read on an earlier day. A source's or
  // a search's first reading brings its whole stock — new to the index, not new on the market.
  // When a code change widens what a source reads, set state.quiet[file] to that day by hand.
  const fresh = new Set(); stats.flood = [];
  for (const x of now) {
    if (x.first !== TODAY || x.gone || x.ex) continue;
    if ((st.quiet || {})[x.file] === TODAY) { if (!stats.flood.includes(x.file + ' quiet')) stats.flood.push(x.file + ' quiet'); continue; }
    const kf = prevKeyFirst[x.file] || {};
    if ((x.qs || []).some((k) => kf[k] && kf[k] < TODAY)) fresh.add(x.id);
  }
  const ed = readJson(join(DATA, 'edition.json'), { issue: 0 });
  const issue = ed.date === TODAY ? ed.issue : Number(ed.issue || 0) + 1;    // a second run the same day is the same issue

  const pre = readAll(L, S);
  const payloads = [];
  for (const b of ACTIVE) payloads.push([b, buildPayload(L, S, rates, summary, { issue, fresh, brand: b, pre })]);
  const byBrand = new Map(payloads.map(([b, P]) => [b.slug, P]));
  const news = newCards(payloads);
  const entries = BRANDS.map((b) => brandEntry(b, byBrand.get(b.slug) || { items: [], sellers: {} }, L));
  const freshCards = newCards(payloads, Infinity).length;
  const index = {
    built: new Date().toISOString(), today: TODAY, date: TODAY.replace(/-/g, '.'),
    rates: payloads[0][1].rates,
    counts: { brands: entries.filter((e) => e.c > 0).length, cards: entries.reduce((n, e) => n + (e.c || 0), 0), fresh: freshCards,
              entries: now.length, sold: Object.keys(S.items).length },
    sources: sourcesOf(L, summary),
    brands: entries,
  };
  const m = mailOf(index, TODAY);

  writeFileSync(join(DATA, 'ledger.json'), ledgerJson(L));
  writeFileSync(join(DATA, 'sold.json'), ledgerJson(S));
  writeFileSync(join(DATA, 'edition.json'), JSON.stringify({ issue, date: TODAY }));
  writeFileSync(join(DATA, 'mail_meta.json'), JSON.stringify(m.meta, null, 1));
  writeFileSync(join(DATA, 'mail_lines.txt'), m.lines);
  writeFileSync(join(DATA, 'status.json'), JSON.stringify({ day: TODAY, issue, rates, stats, soldAdded, sources: summary.sources, hosts: summary.hosts || {},
    counts: { entries: now.length, sold: Object.keys(S.items).length, brands: index.counts.brands, cards: index.counts.cards, fresh: freshCards } }, null, 1));
  for (const [b, P] of payloads) writeFileSync(join(SITE, 'b', b.slug + '.json'), JSON.stringify(P));
  writeFileSync(join(SITE, 'index.json'), JSON.stringify(index));
  writeFileSync(join(SITE, 'new.json'), JSON.stringify({ today: TODAY, items: news }));
  writeFileSync(join(SITE, 'index.html'), INDEX_HTML);
  writeFileSync(join(SITE, '.nojekyll'), '');
  console.log(JSON.stringify({ issue, brands: index.counts.brands, cards: index.counts.cards, fresh: freshCards, stats, soldAdded, rates: rates.stale ? 'stale' : rates.date }));
}
// one listing a line: a day's change is a few lines of diff, not the whole file
function ledgerJson(o) {
  const { items, ...rest } = o;
  const keys = Object.keys(items).sort();
  return '{' + Object.entries(rest).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',') + (Object.keys(rest).length ? ',' : '') +
    '"items":{\n' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(items[k])).join(',\n') + '\n}}\n';
}

const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; } })();
if (isMain) main().catch((e) => { console.error('BUILD FAILED: ' + (e && e.stack || e)); process.exit(1); });
