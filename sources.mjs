// Every search-page source, and the exact routes each one uses — the routes the
// Carol Christian Poell index reads every day, now asked once per search of the
// query plan (brands.mjs queryPlan: each brand's Latin name and Japanese aliases).
// lib.get() checks robots.txt again on every run, so a site that closes a path
// later is obeyed without anyone editing this file.
//
// What a search page returns is not yet anybody's listing: brands.mjs decides,
// from the title, which of our brands (if any) each one belongs to.

import { get, listingsFrom, decode, Refused } from './lib.mjs';
import { brandLabel } from './brands.mjs';

// "9/22 18:17" → 2026-09-22 (the closed search covers 180 days, so a month
// later than this one belongs to last year)
export function mdToDate(s, now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) {
  const m = /(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s || ''); if (!m) return null;
  const [y0, m0] = now.split('-').map(Number);
  const y = Number(m[1]) > m0 ? y0 - 1 : y0;
  return y + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
}
// "残り 10時間" / "4日" / "35分" → an end time, and how precisely it is known
export function leftToEnd(s, now = Date.now()) {
  const m = /(\d+)\s*(日|時間|分)/.exec(s || ''); if (!m) return null;
  const n = Number(m[1]), unit = m[2];
  const ms = unit === '日' ? n * 864e5 : unit === '時間' ? n * 36e5 : n * 6e4;
  return { endsAt: new Date(now + ms).toISOString(), endsPrec: unit === '日' ? 'd' : unit === '時間' ? 'h' : 'm' };
}
function fromJsonAuction(o) {
  const out = {};
  const end = o.endTime || o.endDate || o.end_time || o.endAt;
  if (typeof end === 'string' && !isNaN(Date.parse(end))) { out.endsAt = new Date(end).toISOString(); out.endsPrec = 'm'; }
  const bids = o.bids ?? o.bidCount ?? o.bid_count ?? o.numberOfBids;
  if (Number.isFinite(Number(bids))) out.bids = Number(bids);
  return out;
}
// the number and the word come in either order on a card: 入札 16 · 16入札 · 16件
const bidsOf = (t) => { const b = /入札\s*[:：]?\s*(\d+)|(\d+)\s*(?:件\s*)?入札/.exec(t); return b ? Number(b[1] ?? b[2]) : null; };

// 2nd STREET's card: the brand on its own line, the piece in slash fields
export function secondStreetCard(seg) {
  const field = (cls) => { const m = new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>([^<]*)<').exec(seg || ''); return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : ''; };
  const out = {}, name = field('itemCard_name'), size = /^サイズ\s*(.+)$/.exec(field('itemCard_size')), brand = field('itemCard_brand');
  if (name) out.title = name;
  if (brand) out.brandLine = brand;
  if (size && !/^(?:その他|--|-|F)$/.test(size[1])) out.size = size[1];
  return out;
}
// "I/99AW/イタリア製/ジャケット/46/ウール/BEG/? NULL ?//" under "RICK OWENS" →
// "RICK OWENS I · 99AW · イタリア製 · ジャケット · 46 · ウール · BEG". A model number keeps its own slash (CM/1716B).
export function secondStreetTitle(t, brand) {
  const kept = String(t || '').replace(/\?\s*NULL\s*\?/gi, '/').replace(/\b([A-Z]{2})\/(\d{3,4}[A-Z0-9]*)\b/g, '$1∕$2');
  const parts = kept.split('/').map((x) => x.trim().replace(/∕/g, '/')).filter((x) => x && x !== '--');
  return ((brand || '') + ' ' + parts.join(' · ')).trim();
}

const NONE_JP = /一致する(?:商品|オークション)はありません|見つかりませんでした/;
export const SOURCES = [
  // ── Japan ───────────────────────────────────────────────────────────────
  {
    file: 'yahoo', name: '야후옥션', market: '일본', host: 'auctions.yahoo.co.jp',
    // /search/search is open; only its sort and page-size parameters are not.
    // 50 per page is the default, so we page with b= and never set n=.
    pages: (q, i) => 'https://auctions.yahoo.co.jp/search/search?p=' + encodeURIComponent(q) + (i ? '&b=' + (i * 50 + 1) : ''),
    maxPages: 2, pageSize: 50, noneRe: NONE_JP,
    spec: {
      cur: 'JPY', hrefRe: /\/jp\/auction\/([a-z]?\d{6,})/i,
      key: (id) => 'yahoo:' + id, urlOf: (id) => 'https://auctions.yahoo.co.jp/jp/auction/' + id,
      idOf: (id) => (/^[a-z]?\d{6,}$/i.test(id) ? id : null),
      fromJson: fromJsonAuction,
      fromCard: (t) => {
        const out = {};
        const b = bidsOf(t); if (b != null) out.bids = b;
        const l = /残り\s*([\d]+\s*(?:日|時間|分))/.exec(t) || /(\d+\s*(?:日|時間|分))\s*$/.exec(t.slice(0, 200));
        if (l) Object.assign(out, leftToEnd(l[1]));
        return out;
      },
    },
  },
  {
    file: 'yahoo_sold', name: '야후옥션', market: '일본', host: 'auctions.yahoo.co.jp', sold: true,
    // robots.txt: Disallow /closedsearch/  Allow /closedsearch/closedsearch
    pages: (q, i) => 'https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=' + encodeURIComponent(q) + (i ? '&b=' + (i * 50 + 1) : ''),
    maxPages: 1, pageSize: 50, noneRe: NONE_JP,
    spec: {
      cur: 'JPY', hrefRe: /\/jp\/auction\/([a-z]?\d{6,})/i,
      key: (id) => 'yahoo:' + id, urlOf: (id) => 'https://auctions.yahoo.co.jp/jp/auction/' + id,
      idOf: (id) => (/^[a-z]?\d{6,}$/i.test(id) ? id : null),
      fromJson: fromJsonAuction,
      fromCard: (t) => {
        const out = { sold: true, soldKind: '낙찰' };
        const b = bidsOf(t); if (b != null) out.bids = b;
        const d = /(\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/.exec(t); if (d) out.soldAt = mdToDate(d[1]);
        return out;
      },
    },
  },
  {
    file: 'mercari', name: '메루카리', market: '일본', host: 'jp.mercari.com', browser: true,
    // robots.txt closes /mypage /purchase /sell /transaction /v1 /v2 — not /search.
    // The search page draws its listings in the browser, so collect.mjs reads it
    // through mercari.mjs; the routes and the listing format below stay the same.
    pages: (q, i) => 'https://jp.mercari.com/search?keyword=' + encodeURIComponent(q) + '&status=on_sale' + (i ? '&page_token=v1%3A' + i : ''),
    maxPages: 1, pageSize: 120, noneRe: /出品された商品がありません|見つかりませんでした|該当する商品はありません/,
    spec: {
      // its own listings (/item/m…) and Mercari Shops listings (/shops/product/…)
      cur: 'JPY', hrefRe: /\/(?:item\/(m\d{6,})|shops\/product\/([A-Za-z0-9]{16,32}))(?:[\/?#"]|$)/,
      key: (id) => 'mercari:' + id,
      urlOf: (id) => (/^m\d+$/.test(id) ? 'https://jp.mercari.com/item/' + id : 'https://jp.mercari.com/shops/product/' + id),
      idOf: (id) => (/^m\d{6,}$/.test(id) || /^[A-Za-z0-9]{16,32}$/.test(id) ? id : null), soldRe: /SOLD/,
      brandChunkRe: brandLabel,
    },
  },
  {
    file: 'rakuma', name: '라쿠마', market: '일본', host: 'fril.jp',
    // robots.txt closes /search/ and the sort=/status= parameters; /s?query= is open.
    // The search also matches descriptions: the title reading drops what is not ours.
    pages: (q, i) => 'https://fril.jp/s?query=' + encodeURIComponent(q) + (i ? '&page=' + (i + 1) : ''),
    maxPages: 2, pageSize: 40, noneRe: /見つかりませんでした|該当する商品はありません/,
    spec: {
      cur: 'JPY', hrefRe: /item\.fril\.jp\/([0-9a-f]{32})/i,
      key: (id) => 'rakuma:' + id, urlOf: (id) => 'https://item.fril.jp/' + id,
      idOf: (id) => (/^[0-9a-f]{32}$/i.test(id) ? id : null), soldRe: /SOLD|売り切れ/,
      brandChunkRe: brandLabel,
    },
  },
  {
    file: 'yfm', name: '야후 플리마', market: '일본', host: 'paypayfleamarket.yahoo.co.jp',
    // Yahoo!フリマ (formerly PayPayフリマ), same LY terms as 야후옥션. robots.txt closes
    // /search/ only with sort= order= sold= open= price and filter parameters;
    // the page and page= are open. Results come as the page's own JSON, 100 a page,
    // with what has sold marked SOLD (read as gone, never as a listing).
    pages: (q, i) => 'https://paypayfleamarket.yahoo.co.jp/search/' + encodeURIComponent(q) + (i ? '?withSpeller=0&page=' + (i + 1) : ''),
    maxPages: 2, pageSize: 100, noneRe: /該当する商品(?:は|が)ありません|見つかりませんでした|商品が見つかりません/,
    spec: {
      cur: 'JPY', hrefRe: /(?:paypayfleamarket\.yahoo\.co\.jp)?\/item\/([a-z]\d{6,})(?:[\/?#"]|$)/i,
      key: (id) => 'yfm:' + id, urlOf: (id) => 'https://paypayfleamarket.yahoo.co.jp/item/' + id,
      idOf: (id) => (/^[a-z]\d{6,}$/i.test(id) ? id : null), soldRe: /^SOLD$|売り切れ/,
      brandChunkRe: brandLabel,
      fromJson: (o) => ({ ...(o.itemStatus === 'SOLD' ? { sold: true } : {}),
                          ...(o.brand && brandLabel.test(String(o.brand.name || '').trim()) ? { brandTagged: true } : {}) }),
    },
  },
  {
    file: 'second', name: '세컨드스트리트', market: '일본', host: 'www.2ndstreet.jp',
    // 2nd STREET online store. robots.txt closes only its share links; /search is open.
    // 60 a page. The card names the brand on its own line and describes the piece in
    // slash-separated fields (season, 本人期, category, size, material, colour); the
    // title is the store's brand line followed by those fields.
    pages: (q, i) => 'https://www.2ndstreet.jp/search?keyword=' + encodeURIComponent(q) + (i ? '&page=' + (i + 1) : ''),
    maxPages: 2, pageSize: 60, noneRe: /該当する商品(?:は|が)ありません|見つかりませんでした|検索結果はありません/,
    spec: {
      cur: 'JPY', hrefRe: /\/goods\/detail\/goodsId\/(\d{8,})\/shopsId\/\d+/,
      key: (id) => '2nd:' + id, urlOf: (id) => 'https://www.2ndstreet.jp/goods/detail/goodsId/' + id,
      idOf: (id) => (/^\d{8,}$/.test(id) ? id : null), soldRe: /^SOLD\s*OUT$|売り切れ/,
      brandChunkRe: brandLabel,
      // the card's own fields, not the longest text on it ("商品の状態 : 中古B" can be longer than a short name)
      fromCard: (t, seg) => secondStreetCard(seg),
      title: (t, x) => secondStreetTitle(t, x.brandLine),
    },
  },
];
export const BY_FILE = Object.fromEntries(SOURCES.map((s) => [s.file, s]));

// ── one search, page after page ───────────────────────────────────────────
// Pages until the results run out. A search has run out only when its last page
// was short — fewer than the site's page size (a first page included) — or when
// the site says in its own words that nothing matched. A full page followed by an
// empty one, or by a repeat of what was already read (a site ignoring the page
// parameter, a challenge page), is not an end we can vouch for; neither is a
// reading stopped by maxPages. An incomplete reading never makes an unread listing
// look vanished.
function linkIds(html, re) {
  const ids = new Set(); const a = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi; let m;
  while ((m = a.exec(String(html || '')))) { const h = m[2] ?? m[3] ?? ''; const x = re.exec(h); if (x) { const v = x.slice(1).find((y) => y); if (v) ids.add(v); } }
  return ids;
}
export async function readSearch(src, q, { fetchPage = get, maxPages = src.maxPages, log = () => {}, all = new Map(), linked = new Set() } = {}) {
  const mine = new Set(), pagesRead = []; let ranOut = false, size = src.pageSize || 0, firstHtml = null;
  for (let i = 0; i < maxPages; i++) {
    const url = src.pages(q, i); if (!url) { ranOut = true; break; }
    let html;
    try { html = await fetchPage(url); }
    catch (e) {
      // past the last full page some sites answer 404: an end only after a short page, which we would not have followed
      if (i > 0 && !(e instanceof Refused) && /HTTP 404/.test(String(e && e.message))) break;
      throw e;
    }
    if (firstHtml == null) firstHtml = html;
    const got = listingsFrom(html, src.spec);
    let fresh = 0, added = 0;
    for (const it of got) {
      if (!mine.has(it.id)) { mine.add(it.id); fresh++; }
      const cur = all.get(it.id);
      if (!cur) { all.set(it.id, { ...(src.sold ? { sold: true } : {}), ...it, qs: [q] }); added++; }
      else if (!cur.qs.includes(q)) cur.qs.push(q);
    }
    // how long the page was is told by its listing links, not by how many of
    // them we could read a price from: a full page read badly is still full.
    // Every listing linked from the page is on the market today, read or not.
    const links = linkIds(html, src.spec.hrefRe);
    for (const id of links) linked.add(src.spec.key(id));
    const cards = Math.max(got.length, links.size);
    pagesRead.push({ page: i + 1, cards, found: got.length, fresh, added });
    log(src.file + ' "' + q + '" p' + (i + 1) + ': ' + cards + ' cards, ' + got.length + ' read, ' + added + ' new overall');
    if (!size && i === 0) size = cards;                      // no stated page size: the first page's
    if (!cards) { ranOut = !!(src.noneRe && src.noneRe.test(html)); break; }
    if (!fresh) break;                                       // the same page again: not an end
    if (cards < 0.8 * size) { ranOut = true; break; }       // a short page is the last one
  }
  return { ranOut, pagesRead, firstHtml };
}

// ── every search of the plan, one after another ──────────────────────────
// A refusal (403 · 429 · a bot-check page · robots.txt) ends the source for the
// day: it is thrown, and the source is "not observed today". Any other failure
// of one search leaves that search unread (and its listings unjudged) and the
// next search goes on.
export async function collect(src, plan, { fetchPage = get, maxPages = src.maxPages, log = () => {} } = {}) {
  const all = new Map(), linked = new Set(), done = {}, pages = [], failed = [];
  let firstHtml = null, emptyHtml = null;
  for (const { q } of plan) {
    try {
      const r = await readSearch(src, q, { fetchPage, maxPages, log, all, linked });
      done[q] = r.ranOut;
      pages.push(...r.pagesRead.map((p) => ({ q, ...p })));
      if (firstHtml == null) firstHtml = r.firstHtml;
      // a first page with no listing on it that does not say "nothing matched": its shape is kept
      if (emptyHtml == null && r.pagesRead[0] && !r.pagesRead[0].cards && !r.ranOut) emptyHtml = r.firstHtml;
    } catch (e) {
      if (e instanceof Refused) throw e;
      failed.push({ q, error: String((e && e.message) || e).slice(0, 160) });
      log(src.file + ' "' + q + '" FAILED: ' + failed[failed.length - 1].error);
    }
  }
  if (plan.length && failed.length === plan.length) throw new Error('every search failed: ' + failed[0].error);
  return { items: [...all.values()], pages, done, linked: [...linked], failed, firstHtml, emptyHtml };
}
