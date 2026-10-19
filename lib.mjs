// Shared plumbing for every collector (the same rules as the Helmut Lang and CCP indexes).
//
// Enforced here, in code, so no collector can forget them:
//   - robots.txt is fetched and obeyed before any page on a host is requested,
//     query parameters included; a robots.txt we cannot read closes the host
//   - one honest User-Agent that names the site; no browser disguise, no
//     cookies, no referrer — a caller cannot set them
//   - at least 2.5 s between two requests to the same host, however many
//     collectors run at once (one queue per host)
//   - a 403, a 429 or a bot-check page stops that host for the rest of the run;
//     nothing is retried around a refusal
//   - nothing about the seller is kept (no ids, names, ratings)
//
// Node 18+ (global fetch). No dependencies.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const UA = 'ArchiveIndex/1.0 (+https://rozykuzy.github.io/BRAND/; personal archive search, one request every few seconds)';
// never less than 2.5 s; an environment variable can only make it slower
export const GAP_MS = Math.max(2500, Number(process.env.BRAND_GAP_MS) || 0);
const lastHit = new Map();
const turns = new Map();
const robotsCache = new Map();
const stopped = new Map();
const counts = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── one queue per host ────────────────────────────────────────────────────
// Every request to a host — robots.txt included — waits for its turn: the
// previous request to that host started at least GAP_MS ago.
function turn(host) {
  const prev = turns.get(host) || Promise.resolve();
  const mine = prev.then(async () => {
    const wait = (lastHit.get(host) || 0) + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    counts.set(host, (counts.get(host) || 0) + 1);
  });
  turns.set(host, mine.catch(() => {}));
  return mine;
}
// how many requests each host has had in this run (robots.txt included)
export const requestCounts = () => Object.fromEntries(counts);
export const hostStopped = (host) => stopped.get(host) || null;
function stop(host, why) { if (!stopped.has(host)) stopped.set(host, why); }

// ── robots.txt ────────────────────────────────────────────────────────────
// Google's reading of the spec: the most specific (longest) matching rule
// wins, Allow beats Disallow on a tie, `*` is any run of characters and a
// trailing `$` anchors the end. Only the `User-agent: *` group applies to us
// — we are not any of the named crawlers, and do not claim to be.
export function parseRobots(txt) {
  const groups = []; let cur = null, lastWasUA = false;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasUA = true; continue;
    }
    lastWasUA = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
  }
  const star = groups.filter((g) => g.agents.includes('*'));
  // an empty Disallow means "nothing is disallowed"; it adds no rule
  return star.flatMap((g) => g.rules).filter((r) => r.path !== '');
}
// RFC 9309 §2.2.2: compare paths in one encoding. Non-ASCII is percent-encoded,
// hex is upper-cased, and escaped unreserved characters are decoded — on the
// rule and on the URL alike, so /ブランド/ and /%E3%83%96… are the same path.
export function normPath(p) {
  return String(p)
    .replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase())
    .replace(/[^\x00-\x7F]/gu, (c) => encodeURIComponent(c))
    .replace(/%([0-9A-F]{2})/g, (m, h) => { const ch = String.fromCharCode(parseInt(h, 16)); return /[A-Za-z0-9\-._~]/.test(ch) ? ch : m; });
}
function ruleRe(path) {
  const anchored = path.endsWith('$');
  const body = normPath(anchored ? path.slice(0, -1) : path)
    .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}
export function robotsAllows(rules, pathAndQuery) {
  let best = null; const target = normPath(pathAndQuery);
  for (const r of rules) {
    if (!ruleRe(r.path).test(target)) continue;
    const len = normPath(r.path.replace(/\$$/, '')).length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}
async function readRobots(origin) {
  const host = new URL(origin).host;
  try {
    await turn(host);
    const res = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = res.ok ? await res.text() : '';
    // a 200 that is an HTML page (a challenge, a soft 404) is not a robots.txt;
    // reading it as "no rules" would turn a wall into permission
    if (res.ok && (/text\/html/i.test(res.headers.get('content-type') || '') || /^\s*</.test(body)))
      return [{ allow: false, path: '/', why: 'robots.txt answered with an HTML page' }];
    if (res.ok) return parseRobots(body);
    // 404/410: the site has no robots.txt, so nothing is closed. Anything else
    // — refused, rate-limited, down — is read as closed: when we cannot learn
    // the rules, we do not guess them in our favour.
    if (res.status === 404 || res.status === 410) return [];
    if (res.status === 403 || res.status === 429) stop(host, 'robots.txt answered HTTP ' + res.status);
    return [{ allow: false, path: '/', why: 'robots.txt answered HTTP ' + res.status }];
  } catch (e) { return [{ allow: false, path: '/', why: 'robots.txt unreachable (' + (e.cause && e.cause.code || e.message) + ')' }]; }
}
export function rulesFor(origin) {
  if (!robotsCache.has(origin)) robotsCache.set(origin, readRobots(origin));
  return robotsCache.get(origin);
}

// ── a page that is a wall, not an answer ───────────────────────────────────
// Challenge pages say so in their title, or carry the challenge's own markers.
// Only pages that are small or titled that way are read as one: a normal page
// may load a challenge vendor's script and still be the page.
const BOT_TITLE = /<title[^>]*>\s*(?:just a moment|attention required|access denied|pardon our interruption|are you a (?:robot|human)|security check|robot check|verify (?:that )?you are (?:a )?human|captcha|request blocked|forbidden)/i;
const BOT_MARK = /cf-chl-|cf_chl_opt|captcha-delivery\.com|_incapsula_resource|px-captcha|\/_sec\/cp_challenge\//i;
export function botCheck(body) {
  const s = String(body || '');
  if (BOT_TITLE.test(s.slice(0, 6000))) return 'bot-check page';
  if (s.length < 60000 && BOT_MARK.test(s)) return 'bot-check page';
  return null;
}

// ── polite fetch ─────────────────────────────────────────────────────────
export class Refused extends Error {}
async function allowed(u) {
  const why = stopped.get(u.host);
  if (why) throw new Refused(u.host + ' stopped for this run (' + why + ')');
  const rules = await rulesFor(u.origin);
  if (!robotsAllows(rules, u.pathname + u.search))
    throw new Refused(rules[0] && rules[0].why ? u.host + ': ' + rules[0].why + ' — not reading the site' : 'robots.txt disallows ' + u.host + u.pathname + u.search);
}
// what a caller may not set: who we are, what we carried, where we came from
const OWN = /^(?:user-agent|cookie|referer|referrer)$/i;
export async function get(url, { type = 'text', headers = {}, allow404 = false, method = 'GET', body } = {}) {
  let u = new URL(url);
  await allowed(u);
  const head = { 'accept-language': 'ja,ko;q=0.9,en;q=0.8',
    ...Object.fromEntries(Object.entries(headers).filter(([k]) => !OWN.test(k))), 'user-agent': UA };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // redirects are followed by hand: every address we are sent to is checked
      // against its own host's robots.txt before it is requested
      let res, at = u, m = method, b = body;
      for (let hop = 0; ; hop++) {
        await turn(at.host);
        res = await fetch(at.href, { method: m, body: b, headers: head, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        const loc = res.headers.get('location');
        if (!loc || hop >= 5) throw new Error('HTTP ' + res.status + ' without a usable redirect from ' + at.host);
        if (res.status === 303) { m = 'GET'; b = undefined; }
        at = new URL(loc, at);
        await allowed(at);
      }
      // a 403/429 is the site saying no. We stop, we do not try harder.
      if (res.status === 403 || res.status === 429) { stop(at.host, 'HTTP ' + res.status); throw new Refused('HTTP ' + res.status + ' from ' + at.host); }
      // a listing page that is gone answers 404 or 410: that is an answer, not a failure
      if (allow404 && (res.status === 404 || res.status === 410)) return null;
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status + ' ' + at.href); await sleep(GAP_MS * (attempt + 2)); continue; }
      const txt = await res.text();
      if (type === 'json') {
        try { return JSON.parse(txt); }
        catch { const why = botCheck(txt); if (why) { stop(at.host, why); throw new Refused(why + ' from ' + at.host); }
                throw new Error('not JSON from ' + at.host); }
      }
      const why = botCheck(txt);
      if (why) { stop(at.host, why); throw new Refused(why + ' from ' + at.host); }
      return txt;
    } catch (e) {
      if (e instanceof Refused) throw e;
      lastErr = e; await sleep(GAP_MS * (attempt + 2));
    }
  }
  throw lastErr;
}

// ── HTML ─────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥', times: '×' };
export function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
export const text = (html) => decode(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export function attr(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
export const num = (s) => { const m = /(\d[\d,]*)/.exec(String(s ?? '').replace(/[，]/g, ',')); return m ? Number(m[1].replace(/,/g, '')) : null; };

// Every JSON blob a server-rendered page ships: Next.js, Nuxt, Apollo, JSON-LD.
export function embeddedJson(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) {
    const a = m[1], body = m[2].trim(); if (!body) continue;
    if (/application\/(ld\+)?json/i.test(a) || /id=["']__NEXT_DATA__["']/i.test(a)) { try { out.push(JSON.parse(body)); } catch {} continue; }
    const w = /^(?:window\.)?(__NUXT__|__APOLLO_STATE__|__INITIAL_STATE__|__PRELOADED_STATE__)\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(body);
    if (w) { try { out.push(JSON.parse(w[2])); } catch {} }
  }
  return out;
}
// Walk any JSON and yield the objects that look like one listing.
export function* walk(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 40) return;
  yield o;
  for (const v of Array.isArray(o) ? o : Object.values(o)) if (v && typeof v === 'object') yield* walk(v, depth + 1);
}

// ── output ───────────────────────────────────────────────────────────────
// One neutral shape for every source. Classification (era, category, brand)
// is not a collector's job; it happens once, downstream, for all.
//   { src, market, id, url, title, price, cur, img, size?, sold?, soldAt?, bids?, endsAt?,
//     qs: [the searches that found it], d?: [brands the site filed it under], dz?: [Grailed designers] }
export function writeRaw(file, src, market, items, extra = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const seen = new Set(), clean = [];
  for (const it of items) {
    if (!it || !it.url || !it.title || seen.has(it.id || it.url)) continue;
    seen.add(it.id || it.url);
    clean.push({ src, market, ...it, title: String(it.title).replace(/\s+/g, ' ').trim() });
  }
  writeFileSync(file, JSON.stringify({ src, market, fetchedAt: new Date().toISOString(), n: clean.length, ...extra, items: clean }, null, 1));
  return clean.length;
}
export const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST

// ── listings out of a page whose markup we have not been promised ─────────
// Two independent readings, merged by listing id:
//   1. any JSON the server embedded (Next.js, Nuxt, JSON-LD …) — an object with
//      an id, a title and a price is taken to be one listing
//   2. every link whose address is a listing address; the nearest title,
//      price and photo around it
// A site that redesigns breaks one reading, rarely both. collect.mjs writes
// the page's shape to _diag.json when a page that should hold listings yields none.
const PRICE = {
  JPY: /(?:[¥￥]\s*([\d,]{3,}))|(?:([\d,]{3,})\s*円)/,
  KRW: /(?:([\d,]{3,})\s*원)|(?:₩\s*([\d,]{3,}))/,
  USD: /\$\s*([\d,]+(?:\.\d{2})?)/,
};
const TITLEKEYS = ['title', 'name', 'itemName', 'auctionTitle', 'productName'];
const PRICEKEYS = ['price', 'currentPrice', 'itemPrice', 'bidPrice', 'buyNowPrice', 'salePrice', 'priceValue', 'winPrice', 'endPrice'];
const IDKEYS = ['auctionId', 'itemId', 'productId', 'id', 'item_id', 'pid'];
const IMGKEYS = ['imageUrl', 'image', 'img', 'thumbnail', 'thumbnailUrl', 'thumbnailImageUrl', 'thumbnails', 'photos', 'imageUrls', 'images', 'mainImage'];
const pick = (o, ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return null; };
const firstUrl = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? v : null;
  if (Array.isArray(v)) { for (const x of v) { const u = firstUrl(x); if (u) return u; } return null; }
  if (typeof v === 'object') return firstUrl(v.url || v.src || v.imageUrl || v.large || v.original || v.medium);
  return null;
};
// Text chunks between tags, with their position in the page.
function chunks(seg, base = 0) {
  const out = []; const re = />([^<]+)</g; let m;
  const src = '>' + seg + '<';
  while ((m = re.exec(src))) { const t = decode(m[1]).replace(/\s+/g, ' ').trim(); if (t) out.push({ t, at: base + m.index - 1 }); }
  return out;
}
const PRICE_ONLY = {
  JPY: /^(?:現在|即決|落札|価格|販売価格|price)?\s*[:：]?\s*(?:[¥￥]\s*([\d,]{3,})|([\d,]{3,})\s*円)\s*(?:\(税込\)|税込)?$/i,
  KRW: /^(?:판매가|가격)?\s*[:：]?\s*(?:([\d,]{3,})\s*원|₩\s*([\d,]{3,}))$/,
  USD: /^\$\s*([\d,]+(?:\.\d{2})?)$/,
};
const BADGE = /^(?:sold(?:\s*out)?|売り切れ|売切れ|판매완료|품절|予約済み|reserved)$/i;
const PLACEHOLDER_IMG = /dummy|placeholder|no[-_]?image|spacer|blank\.(?:gif|png)|loading\.(?:gif|svg)/i;
// words a link carries for screen readers, after the title: "{brand}({en})の{…}の商品詳細ページへのリンク"
// (the brand word carries no brackets, so a size or model number just before it stays)
export const unlinked = (x) => (x == null ? x : String(x)
  .replace(/\s*[^\s()（）]*(?:[(（][^()（）]*[)）])?の\S*?の商品詳細ページへのリンク\s*$/, '').trim());
// the same label names the category the seller filed the listing under
const CAT_IN_LABEL = /[)）]の(?:(?:メンズ|レディース|キッズ|ユニセックス|ベビー)の)?(\S+?)の商品詳細ページへのリンク\s*$/;
const STRONG_ID = ['auctionId', 'itemId', 'productId', 'item_id', 'pid'];

export function listingsFrom(html, spec) {
  const byId = new Map();
  const put = (id, f) => { const cur = byId.get(id) || { id: spec.key(id), url: spec.urlOf(id) };
    for (const k of Object.keys(f)) if (f[k] != null && f[k] !== '' && cur[k] == null) cur[k] = f[k];
    byId.set(id, cur); };

  // 1 — embedded JSON. An object counts as a listing only when it carries a
  // listing's own id key, or a listing address, or an id in the listing's
  // own format — not every {id, name, price} a page ships (menus, adverts).
  for (const blob of embeddedJson(html)) for (const o of walk(blob)) {
    const title = pick(o, TITLEKEYS), rawId = pick(o, IDKEYS), price = pick(o, PRICEKEYS);
    if (typeof title !== 'string' || rawId == null || price == null) continue;
    const strong = STRONG_ID.some((k) => o[k] != null);
    const hasUrl = Object.values(o).some((v) => typeof v === 'string' && spec.hrefRe.test(v));
    const distinctive = o.id != null && !/^\d+$/.test(String(o.id));
    if (!strong && !hasUrl && !distinctive) continue;
    const id = spec.idOf(String(rawId), o); if (!id) continue;
    const p = typeof price === 'number' ? price : typeof price === 'object' ? num(price.value ?? price.amount) : num(price);
    if (!(p > 0)) continue;
    const extra = spec.fromJson ? spec.fromJson(o) || {} : {};
    put(id, { title, price: p, img: firstUrl(pick(o, IMGKEYS)), ...extra });
  }

  // 2 — links to listings, read card by card
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let m; const hits = [];
  while ((m = aRe.exec(html))) {
    const href = attr(m[1], 'href'); if (!href) continue;
    const idm = spec.hrefRe.exec(href); if (!idm) continue;
    // a pattern may offer alternatives (Mercari's own items and its Shops items)
    const hid = idm.slice(1).find((x) => x);
    if (!hid) continue;
    hits.push({ id: hid, at: m.index, end: aRe.lastIndex, open: m[1], inner: m[2] });
  }
  let prevEnd = 0;
  for (let i = 0; i < hits.length;) {
    // one card is often several links to one listing (photo, title …)
    let j = i + 1; while (j < hits.length && hits[j].id === hits[i].id) j++;
    const group = hits.slice(i, j), h = group[0], lastEnd = group[group.length - 1].end;
    const nextStart = j < hits.length ? hits[j].at : html.length;
    // Where this card begins and ends, from the page's own structure: the
    // outermost block that opens after the previous listing's links is this
    // card, and the outermost block that opens after this listing's links is
    // the next one. The photo or the price may sit before the first link;
    // nothing from a neighbour is read either way.
    const from = Math.max(prevEnd, h.at - 4000);
    const firstOpen = (a, b) => {
      const st = []; const re = /<(\/?)(div|li|article|section)\b[^>]*>/gi; re.lastIndex = a; let t;
      while ((t = re.exec(html)) && t.index < b) { if (t[1]) { if (st.length) st.pop(); } else st.push(t.index); }
      return st.length ? st[0] : -1;
    };
    const o1 = firstOpen(from, h.at), o2 = firstOpen(lastEnd, nextStart);
    const start = o1 >= 0 ? o1 : h.at;
    const end = o2 >= 0 ? o2 : Math.min(nextStart, lastEnd + 2500);
    const boxed = o1 >= 0;
    const seg = html.slice(start, end);
    const cs = chunks(seg, start);
    const dist = (c) => (c.at < h.at ? h.at - c.at : c.at > lastEnd ? c.at - lastEnd : 0);

    // title: the fullest text any of this listing's own links carries
    const okTitle = (x) => x && x.length > 4 && !PRICE_ONLY[spec.cur].test(x) && !BADGE.test(x) &&
      !(spec.brandChunkRe && spec.brandChunkRe.test(x));
    const own = [];
    for (const g of group) own.push(...chunks(g.inner).map((c) => c.t), attr(g.open, 'title'), attr(g.open, 'aria-label'),
      ...[...g.open.matchAll(/\sdata-[\w-]*title[\w-]*\s*=\s*"([^"]*)"/gi)].map((x) => decode(x[1])));
    const alts = [...seg.matchAll(/<img\b[^>]*\balt\s*=\s*"([^"]+)"/gi)].map((x) => decode(x[1]));
    const byLen = (a, b) => b.length - a.length;
    // the name a site attaches to the link as data (Rakuma: data-rat-item_name) is the
    // title as the seller typed it, without the words its title attribute adds for
    // screen readers ("…のメンズの靴/シューズ(ブーツ)の商品詳細ページへのリンク")
    const named = group.map((g) => attr(g.open, 'data-rat-item_name') || attr(g.open, 'data-item-name'))
      .map((x) => (x || '').replace(/\s+/g, ' ').trim()).find((x) => x.length > 2);
    const title = named || own.map(unlinked).filter(okTitle).sort(byLen)[0] || alts.map(unlinked).filter(okTitle).sort(byLen)[0];
    // everything else is read from the card with the title taken out of it:
    // a title that says 定価198,000円 or 入札2件で終了 is not the price or the bids
    const flat = (x) => String(x || '').replace(/\s+/g, ' ').trim();
    const rest = cs.filter((c) => c.t !== title && flat(c.t) !== flat(title));
    const priceChunk = rest.filter((c) => PRICE_ONLY[spec.cur].test(c.t)).sort((a, b) => (boxed ? a.at - b.at : dist(a) - dist(b)))[0];
    // likewise a price attached as data (Rakuma: data-rat-price) is the listing's own
    let price = group.map((g) => num(attr(g.open, 'data-rat-price'))).find((p) => p > 0) || null;
    if (price) { /* the site's own figure */ }
    else if (priceChunk) { const pm = PRICE_ONLY[spec.cur].exec(priceChunk.t); price = num(pm[1] || pm[2]); }
    else {
      const pm = PRICE[spec.cur].exec(rest.map((c) => c.t).join(' '));
      price = pm ? num(pm[1] || pm[2]) : num(attr(h.open, 'data-auction-price') || attr(h.open, 'data-price'));
    }
    // a lazily loaded photo keeps its address in data-original / data-src while src
    // holds a placeholder
    const imgs = [...seg.matchAll(/<img\b([^>]*)>/gi)].map((x) => {
      const lazy = /\s(?:data-original|data-lazy-src|data-lazy|data-src)\s*=\s*"(https?:\/\/[^"]+)"/i.exec(x[1]);
      const src = /\ssrc\s*=\s*"(https?:\/\/[^"]+)"/i.exec(x[1]);
      return { u: decode((lazy && lazy[1]) || (src && src[1]) || ''), at: start + x.index };
    }).filter((x) => x.u && !PLACEHOLDER_IMG.test(x.u));
    const img = (imgs.find((x) => group.some((g) => x.at > g.at && x.at < g.end)) ||
                 imgs.sort((a, b) => dist(a) - dist(b))[0] || {}).u || attr(h.open, 'data-auction-img');
    const sold = rest.some((c) => BADGE.test(c.t)) || (spec.soldRe && rest.some((c) => c.t.length < 20 && spec.soldRe.test(c.t)));
    // a card that shows one of our brand names as its own label: the site or the
    // seller filed it under that brand (kept as a note; the title still decides)
    const brandTagged = !!(spec.brandChunkRe && rest.some((c) => spec.brandChunkRe.test(c.t)));
    const restText = rest.map((c) => c.t).join(' ');
    const extra = spec.fromCard ? spec.fromCard(restText, seg) || {} : {};
    const catm = group.map((g) => CAT_IN_LABEL.exec(attr(g.open, 'title') || '') || CAT_IN_LABEL.exec(attr(g.open, 'aria-label') || '')).find(Boolean);
    if (title || price) {
      const prev = byId.get(h.id);
      if (prev && title && (!prev.title || title.length > prev.title.length)) prev.title = title;
      put(h.id, { title, price, img, ...(sold ? { sold: true } : {}), ...(brandTagged ? { brandTagged: true } : {}),
                  ...(catm ? { cat: catm[1] } : {}), ...extra });
    }
    prevEnd = lastEnd; i = j;
  }
  // a source may tidy its own titles (2nd STREET: brand + slash-separated fields)
  return [...byId.values()].filter((x) => x.title && x.price > 0)
    .map((x) => { const o = { ...x, cur: x.cur || spec.cur, ...(spec.title ? { title: spec.title(x.title, x) } : {}) };
                  if (spec.title) delete o.brandLine;
                  return o; });
}

// ── what a page looked like, without what it said ─────────────────────────
// When a page that should hold listings yields none, this is what gets kept in
// the repository: its size, its <title>, how many links look like listings,
// which embedded JSON it carried and the shapes of its links with every digit
// run replaced. Nothing a seller wrote, and no ids, go into it.
const ROUTE = /^(?:jp|kr|en|ja|ko|item|items|product|products|listing|listings|auction|auctions|search|closedsearch|s|shop|shops|brand|brands|category|categories|designers?|collections?|user|users|seller|sellers|store|stores|mypage|sitemap|help|guide|about|login|signup|cart|sell|feed|sale|sold|new|ranking|tag|tags|goods|detail)$/i;
export function diagOf(html, spec = {}) {
  html = String(html || '');
  const title = ((/<title[^>]*>([^<]*)/i.exec(html) || [])[1] || '').trim().slice(0, 120);
  const shapes = new Map(); let anchors = 0, hits = 0; const re = /<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi; let m;
  while ((m = re.exec(html))) {
    anchors++;
    const href = m[1];
    if (spec.hrefRe && spec.hrefRe.test(href)) hits++;
    let host = '', segs = [];
    try { const u = new URL(href, 'https://x.invalid/'); host = u.host === 'x.invalid' ? '' : u.host; segs = u.pathname.split('/').filter(Boolean); } catch {}
    const shape = host + '/' + segs.slice(0, 4).map((g) => (ROUTE.test(g) ? g.toLowerCase() : /^[\d]+$/.test(g) ? '#' : '{seg}')).join('/') + (segs.length > 4 ? '/…' : '');
    shapes.set(shape, (shapes.get(shape) || 0) + 1);
  }
  const blobs = embeddedJson(html);
  return { bytes: html.length, title, anchors, listingLinks: hits,
    jsonBlobs: blobs.length, jsonKeys: [...new Set(blobs.flatMap((b) => (b && typeof b === 'object' ? Object.keys(b) : [])))].slice(0, 20),
    linkShapes: [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    scripts: (html.match(/<script\b/gi) || []).length, noscript: /<noscript/i.test(html) };
}
