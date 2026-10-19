// eBay through its official Browse API — the route eBay offers for this, in
// place of the /sch/ search pages its robots.txt closes.
//
// Needs an application key from https://developer.ebay.com (free), as two
// repository secrets: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET. Without them this
// step is skipped and nothing fails. This file never prints them.
// Every call goes through lib.get like any other request: the API host's
// robots.txt, one User-Agent, 2.5 s between calls, a 403/429 ends it for the day.
// One search per brand, its Latin name, newest first, at most MAX_PAGES pages.
// Seller names come back in the response; they are not kept.

import { get, Refused } from './lib.mjs';
import { queriesOf } from './brands.mjs';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const CATEGORY = '11450';   // Clothing, Shoes & Accessories
export const PAGE = 200, MAX_PAGES = 5;

export function itemOf(s) {
  const pr = s.currentBidPrice || s.price || {};
  // asked through the US marketplace, a price set in euros or yen comes back
  // converted to dollars; the seller's own figure is in convertedFrom*. That is
  // the price — the dollar figure moves with the exchange rate every day.
  const value = pr.convertedFromValue != null ? pr.convertedFromValue : pr.value;
  const cur = pr.convertedFromCurrency || pr.currency;
  const it = { id: 'ebay:' + (s.legacyItemId || s.itemId), url: s.itemWebUrl, title: s.title, price: Number(value), cur,
               img: (s.image && s.image.imageUrl) || (s.thumbnailImages && s.thumbnailImages[0] && s.thumbnailImages[0].imageUrl) || null };
  if (Array.isArray(s.buyingOptions) && s.buyingOptions.includes('AUCTION')) {
    if (Number.isFinite(s.bidCount)) it.bids = s.bidCount;
    if (s.itemEndDate) { it.endsAt = s.itemEndDate; it.endsPrec = 'm'; }
  }
  return it.url && it.title && it.price > 0 ? it : null;
}
export const searchUrl = (q, page) => SEARCH_URL + '?q=' + encodeURIComponent(q) + '&category_ids=' + CATEGORY + '&sort=newlyListed&limit=' + PAGE + '&offset=' + page * PAGE;

export async function collectEbay(brands, log = () => {}, { fetchJson = get, env = process.env, maxPages = MAX_PAGES } = {}) {
  const id = env.EBAY_CLIENT_ID, secret = env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return { skipped: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set', items: [] };
  const tj = await fetchJson(TOKEN_URL, { type: 'json', method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope') });
  const tok = tj && tj.access_token;
  if (!tok) throw new Error('eBay token: no access_token — check the two keys');
  const queries = [...new Set(brands.map((b) => queriesOf(b)[0]))];
  const all = new Map(), done = {}, failed = []; let calls = 0;
  for (const q of queries) {
    let ranOut = false;
    try {
      for (let page = 0; page < maxPages; page++) {
        const j = await fetchJson(searchUrl(q, page), { type: 'json', headers: { authorization: 'Bearer ' + tok, 'x-ebay-c-marketplace-id': 'EBAY_US' } });
        calls++;
        const list = (j && j.itemSummaries) || [];
        let fresh = 0;
        for (const s of list) {
          const it = itemOf(s); if (!it) continue;
          const cur = all.get(it.id);
          if (!cur) { all.set(it.id, { ...it, qs: [q] }); fresh++; } else if (!cur.qs.includes(q)) cur.qs.push(q);
        }
        log('ebay "' + q + '" +' + page * PAGE + ': ' + list.length + ' (' + fresh + ' new, total ' + ((j && j.total) || 0) + ')');
        if (list.length < PAGE || (page + 1) * PAGE >= ((j && j.total) || 0)) { ranOut = true; break; }
      }
      done[q] = ranOut;
    } catch (e) {
      if (e instanceof Refused) throw e;
      failed.push(q); log('ebay "' + q + '" FAILED: ' + String(e.message || e).slice(0, 160));
    }
  }
  if (queries.length && failed.length === queries.length) throw new Error('every eBay search failed');
  return { items: [...all.values()], calls, done, failed };
}
