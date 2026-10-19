// Grailed through its own search service (ROK 2026-09-29: "Grailed는 HL처럼 검색 백엔드로 읽어줘").
//
// Grailed's pages turn a headless browser away (HTTP 403, 2026-09-28), and the listings
// on a designer page are not in its HTML: the reader's browser asks Grailed's search
// service (Algolia, application MNRWEFSS2Q) for them with the public search-only key
// that grailed.com hands every visitor. This asks the same service the same question —
// the listings whose designer is one of ours — the way the Helmut Lang and CCP indexes do.
//
// Through lib.get, like every other source: the search host's robots.txt is read first
// (it answers 404: no rules), one honest User-Agent, 2.5 s between requests, and a 403
// or 429 stops it for the day. Nothing about the seller is kept.
//
// What is asked, per brand (brands.json):
//   designers  OR over `grailed` (facetFilters [["designers.name:A","designers.name:B"]]);
//              `grailedAll` is AND (each its own group: the collaboration's listings)
//   words      `grailedQuery` (Algolia query text) with the designer filter; a brand
//              filed under another house's name (Tabi under Maison Margiela) uses its
//              titleMust word when brands.json gives no grailedQuery
//   small brands (big: false)  everything, read in price bands: one search answers at
//              most 1,000 hits, so an overfull band is split in two until it fits
//   big brands (big: true)     only listings whose title can state a year or season:
//              a search for each prefix word below, each split by price bands when
//              over 1,000. The build keeps tier A only.
// A cap on searches a day (default 1,500): small brands first, then big brands in an
// order that turns each day, so a cut falls on different brands. A brand not read to the
// end today is "incomplete": none of its Grailed listings is marked delisted today.

import { get, today } from './lib.mjs';

export const APP = 'MNRWEFSS2Q';
export const KEY = 'c89dbaddf15fe70e1941a109bf7c2a3d';     // the public search-only key grailed.com serves to every reader
export const INDEX = 'Listing_by_date_added_production';
const HOST = 'https://' + APP.toLowerCase() + '-dsn.algolia.net';
const EDGES = [0, 100, 200, 300, 400, 500, 650, 800, 1000, 1250, 1500, 2000, 3000, 5000, 10000];
export const TOKENS = ['ss', 'fw', 'aw', 's/s', 'f/w', 'a/w', 'spring', 'fall', 'autumn', 'winter', 'resort', '198', '199', '200', '201', '202'];
export const CAP = 1500;

// what Grailed filed it under (category_path, e.g. footwear.boots · womens_tops.blouses), as a
// word classify.mjs reads. The title comes first there: this decides only when the title does
// not say what the thing is. accessories.misc says nothing, so it gives nothing.
const CAT = [
  [/^(?:womens_)?footwear\./, 'shoes'],
  [/^(?:womens_)?outerwear\.blazers$/, 'blazer'],
  [/^(?:womens_)?outerwear\./, 'jacket'],
  [/^tailoring\.formal_trousers$/, 'trousers'],
  [/^tailoring\.formal_shirting$/, 'shirt'],
  [/^tailoring\.suits$/, 'suit'],
  [/^tailoring\./, 'blazer'],
  [/^(?:womens_)?bottoms\.(?:denim|jeans)$/, 'jeans'],
  [/^(?:womens_)?bottoms\.\w*skirts$/, 'skirt'],
  [/^(?:womens_)?bottoms\.shorts$/, 'shorts'],
  [/^(?:womens_)?bottoms\.jumpsuits$/, ''],
  [/^(?:womens_)?bottoms\./, 'pants'],
  [/^(?:womens_)?tops\.(?:button_ups|blouses)$/, 'shirt'],
  [/^(?:womens_)?tops\./, 'top'],
  [/^womens_dresses\./, 'dress'],
  [/jewel/, 'ring'],
  [/bags_luggage/, 'bag'],
  [/wallets/, 'wallet'],
  [/belts/, 'belt'],
  [/gloves|scarves/, 'gloves'],
  [/ties_pocketsquares/, 'tie'],
  [/hats/, 'hat'],
];
export function catOf(path) {
  const p = String(path || '').toLowerCase();
  for (const [re, w] of CAT) if (re.test(p)) return w;
  return '';
}
const COND_NEW = new Set(['is_new']);

// the designers a hit names (designer names are brands, not people)
export function designersOf(h) {
  if (Array.isArray(h.designers) && h.designers.length) return h.designers.map((d) => (d && typeof d === 'object' ? d.name : d)).filter((x) => typeof x === 'string' && x);
  if (typeof h.designer_names === 'string' && h.designer_names.trim()) return h.designer_names.split(/\s+×\s+|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  return [];
}
// one search hit → a listing (exported for the tests)
export function hitOf(h) {
  if (!h || h.sold || h.deleted || !h.id || !h.title || !(h.price_i > 0)) return null;
  const img = h.cover_photo && (h.cover_photo.url || h.cover_photo.image_url);
  const cat = catOf(h.category_path);
  const size = h.size != null && String(h.size).trim() && !/^one\s*size$/i.test(String(h.size).trim()) ? String(h.size).trim().toUpperCase() : '';
  const dz = designersOf(h);
  return { id: 'grailed:' + h.id, url: 'https://www.grailed.com/listings/' + h.id, title: String(h.title).replace(/\s+/g, ' ').trim(),
           price: h.price_i, cur: 'USD', img: /^https?:\/\//.test(img || '') ? img : null, brandTagged: true,
           ...(cat ? { cat } : {}), ...(size ? { size } : {}), ...(COND_NEW.has(h.condition) ? { cond: 'new' } : {}), ...(dz.length ? { dz } : {}) };
}

// ── the plan ──────────────────────────────────────────────────────────────
export const facetsOf = (b) => (b.grailedAll && b.grailedAll.length ? b.grailedAll.map((d) => ['designers.name:' + d]) : [b.grailed.map((d) => 'designers.name:' + d)]);
export const queryOf = (b) => b.grailedQuery || (b.titleMust && !b.grailedAll ? b.titleMust[0] : '');
const dayNo = (day) => Math.floor(Date.parse(day + 'T00:00:00Z') / 864e5) || 0;
export function planGrailed(brands, day = today()) {
  const has = (b) => (b.grailed && b.grailed.length) || (b.grailedAll && b.grailedAll.length);
  const small = brands.filter((b) => !b.existing && !b.big && has(b));
  const big = brands.filter((b) => !b.existing && b.big && has(b));
  const off = big.length ? dayNo(day) % big.length : 0;
  const turned = big.slice(off).concat(big.slice(0, off));
  const out = [];
  for (const b of small) out.push({ slug: b.slug, query: queryOf(b), facetFilters: facetsOf(b), est: b.grailedCount || 0 });
  for (const b of turned) for (const t of TOKENS) out.push({ slug: b.slug, query: t, facetFilters: facetsOf(b), token: true });
  return out;
}

async function search({ query = '', facetFilters, lo, hi }) {
  const q = new URLSearchParams({ query, hitsPerPage: '1000', page: '0',
    facetFilters: JSON.stringify(facetFilters),
    numericFilters: JSON.stringify(['price_i>=' + lo].concat(hi != null ? ['price_i<' + hi] : [])) });
  return get(HOST + '/1/indexes/' + INDEX + '?' + q, { type: 'json', headers: { 'x-algolia-application-id': APP, 'x-algolia-api-key': KEY } });
}

// one planned search, to the end or to the cap
async function readOne(s, ask, budget, seen) {
  let complete = true;
  const take = async (lo, hi) => {
    if (budget.left <= 0) { budget.hit = true; complete = false; return null; }
    budget.left--; budget.calls++;
    const r = await ask({ query: s.query, facetFilters: s.facetFilters, lo, hi });
    for (const h of r.hits || []) seen(h);
    return r;
  };
  async function band(lo, hi, depth) {
    const r = await take(lo, hi); if (!r) return;
    if ((r.nbHits || 0) > (r.hits || []).length) {
      // more than one answer holds: halve the band (an open top band doubles first)
      if (depth < 10) {
        const mid = hi == null ? lo * 2 + 1 : Math.floor((lo + hi) / 2);
        if (mid > lo) { await band(lo, mid, depth + 1); await band(mid, hi, depth + 1); return; }
      }
      complete = false;                           // a single price holding more than 1,000: read what came
    }
  }
  const bands = async () => { for (let i = 0; i < EDGES.length - 1; i++) await band(EDGES[i], EDGES[i + 1], 0); await band(EDGES[EDGES.length - 1], null, 0); };
  if (s.est > 900) await bands();                 // known to be big: straight to the bands
  else {
    const r = await take(0, null);
    if (r && (r.nbHits || 0) > (r.hits || []).length) await bands();
  }
  return complete;
}

// ask({query, facetFilters, lo, hi}) is the search itself; the tests hand in a stock of their own
export async function collectGrailed(brands, log = () => {}, { ask = search, cap = CAP, day = today() } = {}) {
  const plan = planGrailed(brands, day);
  const budget = { left: cap, calls: 0, hit: false };
  const hits = new Map();            // id → { h, gb: Set(brand slugs whose search found it) }
  const state = new Map();           // slug → 'complete' | 'cut' | 'unread'
  for (const s of plan) {
    if (budget.left <= 0) {
      budget.hit = true;
      // a brand none of whose searches ran is unread; one cut between its searches is cut short
      state.set(s.slug, !state.has(s.slug) || state.get(s.slug) === 'unread' ? 'unread' : 'cut');
      continue;
    }
    const ok = await readOne(s, ask, budget, (h) => {
      const k = String(h.id); const cur = hits.get(k) || hits.set(k, { h, gb: new Set() }).get(k); cur.gb.add(s.slug); });
    const prev = state.get(s.slug);
    state.set(s.slug, !ok ? 'cut' : prev === 'cut' || prev === 'unread' ? prev : 'complete');
  }
  const items = [];
  for (const { h, gb } of hits.values()) {
    const it = hitOf(h); if (!it) continue;
    items.push({ ...it, gb: [...gb], qs: [...gb].map((s) => 'g:' + s) });
  }
  const done = {}; for (const [slug, st] of state) if (st !== 'unread') done['g:' + slug] = st === 'complete';
  const unread = [...state].filter(([, st]) => st === 'unread').map(([s]) => s);
  const cut = [...state].filter(([, st]) => st === 'cut').map(([s]) => s);
  log('grailed: ' + items.length + ' listings from ' + hits.size + ' hits (' + budget.calls + ' searches)' +
      (budget.hit ? ' — cap of ' + cap + ' reached; not read today: ' + (unread.join(', ') || '—') + '; cut short: ' + (cut.join(', ') || '—') : ''));
  return { items, cards: hits.size, calls: budget.calls, capped: budget.hit, done, unread, cut, planned: plan.length };
}
