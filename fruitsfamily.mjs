// 후루츠패밀리 — the Korean market, through the doors the site itself opens
// (robots.txt: `*` may read everything but /my /checkout /upload /login /auth;
// llms.txt: "the public web catalog is server-rendered").
//
//   1. a brand's own page, /brand/<Name>: the 40 listings it shows in its default
//      order (트렌드순); the rest loads by script. The site files these under the
//      brand, so the title need not repeat the name. `partial`: absence here says
//      nothing about a listing.
//   2. a listing's own page, which states in plain meta tags its price and whether
//      it is still for sale (product:availability). Listings already on the ledger
//      that today's brand pages did not show are looked at again a few at a time
//      (RECHECK a day, each at most every RECHECK_EVERY days): without a second look
//      a sold listing would stay on the index for ever.

import { get, decode, listingsFrom, Refused } from './lib.mjs';

export const BASE = 'https://fruitsfamily.com';
export const RECHECK = 200;          // listing pages re-read per day, oldest look first
export const RECHECK_EVERY = 3;      // days between two looks at one listing

export const brandPageUrl = (b) => BASE + '/brand/' + encodeURIComponent(b.name);
export const SPEC = {
  cur: 'KRW', hrefRe: /(?:fruitsfamily\.com)?\/product\/([0-9a-z]{4,8})(?:[\/?#]|$)/i,
  key: (id) => 'ff:' + id, urlOf: (id) => BASE + '/product/' + id + '/',
  idOf: (id) => (/^[0-9a-z]{4,8}$/i.test(id) ? id : null), soldRe: /판매완료|SOLD/,
};

// every brand's page; a page that is not there (404) is skipped, a refusal ends the reading
export async function collectBrandPages(brands, log = () => {}, { fetchPage = get } = {}) {
  const all = new Map(), done = {}, missing = [], failed = []; let firstHtml = null, pages = 0;
  for (const b of brands) {
    const key = 'bp:' + b.slug;
    let html;
    try { html = await fetchPage(brandPageUrl(b), { allow404: true }); }
    catch (e) { if (e instanceof Refused) throw e; failed.push(b.slug); log('fruits ' + b.slug + ' FAILED: ' + String(e.message || e).slice(0, 160)); continue; }
    pages++;
    if (html == null) { missing.push(b.slug); done[key] = false; continue; }
    if (firstHtml == null) firstHtml = html;
    const got = listingsFrom(html, SPEC);
    let added = 0;
    for (const it of got) {
      const cur = all.get(it.id);
      if (!cur) { all.set(it.id, { ...it, d: [b.slug], qs: [key] }); added++; }
      else { if (!cur.d.includes(b.slug)) cur.d.push(b.slug); if (!cur.qs.includes(key)) cur.qs.push(key); }
    }
    done[key] = false;                // a brand page is never the whole stock
    log('fruits ' + b.slug + ': ' + got.length + ' read, ' + added + ' new');
  }
  if (brands.length && failed.length === brands.length) throw new Error('every brand page failed');
  return { items: [...all.values()], done, missing, failed, pages, firstHtml };
}

function meta(html, prop) {
  const a = new RegExp('<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["\']' + prop.replace(/[.:]/g, '\\$&') + '["\'][^>]*>', 'i').exec(html);
  if (!a) return null;
  const c = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(a[0]);
  return c ? decode(c[2] ?? c[3] ?? '').trim() : null;
}
// what a listing's own page says about it — nothing about who is selling it
export function productOf(html) {
  html = String(html || '');
  let title = meta(html, 'og:title') || ((/<title[^>]*>([^<]*)/i.exec(html) || [])[1] || '');
  title = decode(title).replace(/\s*[|｜\-–—]\s*(?:후루츠\s*패밀리|후루츠패밀리|fruits\s*family|fruitsfamily)\s*$/i, '').trim();
  const price = Number(String(meta(html, 'product:price:amount') || '').replace(/[^\d.]/g, ''));
  const avail = (meta(html, 'product:availability') || '').toLowerCase();
  const out = {
    title, price: price > 0 ? price : null, cur: meta(html, 'product:price:currency') || 'KRW',
    brand: meta(html, 'product:brand') || null, img: meta(html, 'og:image') || null,
    cond: (meta(html, 'product:condition') || '').toLowerCase() || null,
    // "in stock" is for sale; anything else the page says (out of stock, sold) is not
    forSale: avail ? /in\s*stock|instock|available/.test(avail) && !/out/.test(avail) : !/판매\s*완료/.test(html),
  };
  const sz = /사이즈\s*<\/[^>]+>\s*<[^>]+>\s*([^<]{1,16})</.exec(html) || /사이즈\s*[:：]\s*([^<\s]{1,12})/.exec(html);
  if (sz) out.size = decode(sz[1]).trim();
  return out;
}

// a listing's own page; null when it is gone (404)
export async function readProduct(id, { fetchPage = get } = {}) {
  const html = await fetchPage(BASE + '/product/' + id + '/', { allow404: true });
  if (html == null) return null;
  return { id: 'ff:' + id, url: BASE + '/product/' + id + '/', ...productOf(html) };
}

// which ledger listings are due a second look today
export function dueForRecheck(ledger, seenToday, day, { checked = {}, limit = RECHECK, every = RECHECK_EVERY } = {}) {
  return Object.values(ledger.items || {})
    .filter((it) => it.file === 'fruits' && !it.gone && !it.ex && !seenToday.has(it.id))
    .filter((it) => { const c = checked[it.id] || it.first; return !c || (Date.parse(day) - Date.parse(c)) / 864e5 >= every; })
    .sort((a, b) => String(checked[a.id] || a.first).localeCompare(String(checked[b.id] || b.first)))
    .slice(0, limit);
}
