// Mercari through its search page, drawn the way a reader's browser draws it.
// The page ships no listings in its HTML: they arrive from Mercari's own service
// as the page runs (2026-09-28: 395 KB of markup, no listing links, no JSON).
// robots.txt closes /mypage /purchase /sell /transaction /language /v1 /v2 —
// not /search. We read what the page shows, one page per search of the plan.
// The browser announces the same User-Agent as every other request
// (lib.UA); nothing about it is hidden and no automation flag is changed.
// Photos are answered inside the browser with a blank 1×1 image, so the page
// still writes each photo's address into its card but nothing is fetched from
// Mercari's image host; fonts and video are not fetched either. A fresh browser
// context each run: no cookies are carried from one run to the next.
// A 403, a 429, a bot-check page or a redirect somewhere robots.txt closes ends
// the reading for the day.
//
// Needs `playwright` (the workflow installs it).

import { rulesFor, robotsAllows, botCheck, UA, GAP_MS } from './lib.mjs';

export const BASE = 'https://jp.mercari.com';
const LINKS = 'a[href*="/item/m"], a[href*="/shops/product/"]';
const NONE = /出品された商品がありません|見つかりませんでした|該当する商品(?:は|が)ありません|検索結果がありません/;
const ID = /\/item\/(m\d{6,})|\/shops\/product\/([A-Za-z0-9]{16,32})/;
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const searchUrl = (q, i) => BASE + '/search?keyword=' + encodeURIComponent(q) + '&status=on_sale' + (i ? '&page_token=v1%3A' + i : '');
export const idOfHref = (href) => { const m = ID.exec(href || ''); return m ? m[1] || m[2] : null; };

// one card as the page showed it → a listing (exported for the tests)
export function cardOf(c) {
  const id = idOfHref(c.href); if (!id) return null;
  const title = String(c.name || '').replace(/\s+/g, ' ').trim() ||
                String(c.alt || '').replace(/のサムネイル$/, '').replace(/\s+/g, ' ').trim();
  const pm = /(\d[\d,]*)/.exec(String(c.price || '').replace(/[¥￥\s]/g, '')) || /[¥￥]\s*(\d[\d,]*)/.exec(c.text || '');
  const price = pm ? Number(pm[1].replace(/,/g, '')) : null;
  if (!title || !(price > 0)) return null;
  const url = /^m\d+$/.test(id) ? BASE + '/item/' + id : BASE + '/shops/product/' + id;
  const sold = /\bSOLD\b|売り切れ/.test(c.text || '');
  return { id: 'mercari:' + id, url, title, price, cur: 'JPY',
           ...(c.img && /^https:\/\//.test(c.img) ? { img: c.img } : {}), ...(sold ? { sold: true } : {}) };
}

// in the page: each probe is named by its first argument, so the tests can answer it
const PROBE = ([what, src]) => {
  if (what === 'atEnd') return window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  if (what === 'none') return new RegExp(src).test(document.body.innerText || '');
  if (what === 'wall') return document.documentElement.outerHTML.slice(0, 60000);
  return { title: document.title, bytes: document.documentElement.outerHTML.length,
           anchors: document.querySelectorAll('a').length, text: (document.body.innerText || '').length };
};
const CARDS = (as) => as.map((a) => {
  const name = a.querySelector('[data-testid="thumbnail-item-name"]');
  const price = a.querySelector('[data-testid="item-tile-price"]');
  const img = a.querySelector('img');
  return { href: a.getAttribute('href') || '', name: name ? name.textContent : '', price: price ? price.textContent : '',
           alt: img ? img.getAttribute('alt') || '' : '', img: img ? img.getAttribute('src') || '' : '',
           text: (a.innerText || '').slice(0, 400) };
});
const NEXT = (as) => as.some((a) => /次へ|next/i.test((a.innerText || '') + ' ' + (a.getAttribute('aria-label') || '')));

// queries: [search words]. Options for the tests: chromium (a stand-in browser), rulesFor, gapMs, scroll pause.
export async function collectMercari(queries, log = () => {}, { maxPages = 1, gapMs = 4000, pause = 800, chromium = null, rulesFor: rf = rulesFor } = {}) {
  const rules = await rf(BASE);
  if (!robotsAllows(rules, '/search?keyword=x&status=on_sale'))
    return { refused: rules[0] && rules[0].why ? 'jp.mercari.com: ' + rules[0].why : 'robots.txt no longer allows /search', items: [], requests: 1 };
  // with the real browser the pause between pages is never shorter than lib's 2.5 s; a stand-in browser (the tests) sets its own
  const gap = chromium ? gapMs : Math.max(GAP_MS, gapMs);
  if (!chromium) {
    try { ({ chromium } = await import('playwright')); }
    catch { return { skipped: 'playwright is not installed', items: [], requests: 1 }; }
  }
  // BRAND_BROWSER_CHANNEL=chrome runs an installed Chrome instead of Playwright's own (a check on a PC)
  const browser = await chromium.launch(process.env.BRAND_BROWSER_CHANNEL ? { channel: process.env.BRAND_BROWSER_CHANNEL } : {});
  const all = new Map(), linked = new Set(), pagesRead = [], done = {};
  // robots.txt was the first request to the host: the first page waits its turn after it
  let diag = null, requests = 1, last = Date.now();
  const refuse = (why) => ({ refused: why, items: [], pagesRead, requests });
  try {
    // our own User-Agent; a tall window, so a photo's card is on screen long enough to get its address
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 }, userAgent: UA,
                                           extraHTTPHeaders: { 'accept-language': 'ja,ko;q=0.9,en;q=0.8' } });
    await ctx.route('**/*', (r) => {
      const t = r.request().resourceType();
      if (t === 'image') return r.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
      return t === 'media' || t === 'font' ? r.abort() : r.continue();
    });
    const page = await ctx.newPage();
    for (const q of queries) {
      let ranOut = false; const mine = new Set(), full = [];
      for (let i = 0; i < maxPages; i++) {
        const url = searchUrl(q, i), u = new URL(url);
        if (!robotsAllows(rules, u.pathname + u.search)) break;
        const wait = last + gap - Date.now(); if (wait > 0) await sleep(wait);
        last = Date.now(); requests++;
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const status = res ? res.status() : 0;
        if (status === 403 || status === 429) return refuse('HTTP ' + status + ' from jp.mercari.com');
        // wherever the page ended up has to be open to us as well
        const landed = new URL(page.url());
        if (landed.host !== u.host || !robotsAllows(await rf(landed.origin), landed.pathname + landed.search))
          return refuse('redirected to ' + landed.host + landed.pathname);
        await page.waitForSelector(LINKS, { timeout: 30000 }).catch(() => null);
        const wall = botCheck(await page.evaluate(PROBE, ['wall']));
        if (wall) return refuse(wall + ' from jp.mercari.com');
        // the grid is drawn as it scrolls: read it at every step, a screen at a time,
        // until the end of the page has shown nothing new four times running
        const seen = new Map(); let still = 0;
        for (let s = 0; s < 80 && still < 4; s++) {
          const batch = await page.$$eval(LINKS, CARDS);
          const before = seen.size;
          for (const c of batch) { const had = seen.get(c.href); if (!had) seen.set(c.href, c); else if (!had.img && c.img) had.img = c.img; }
          const atEnd = await page.evaluate(PROBE, ['atEnd']);
          still = seen.size === before && atEnd ? still + 1 : 0;
          await page.mouse.wheel(0, 1200);
          await page.waitForTimeout(pause);
        }
        const next = await page.$$eval('a[href*="page_token"]', NEXT);
        const none = await page.evaluate(PROBE, ['none', NONE.source]);
        let found = 0, fresh = 0, added = 0;
        for (const c of seen.values()) {
          const id = idOfHref(c.href); if (id) { linked.add('mercari:' + id); if (!mine.has(id)) { mine.add(id); fresh++; } }
          const it = cardOf(c); if (!it) continue;
          found++;
          const cur = all.get(it.id);
          if (!cur) { all.set(it.id, { ...it, qs: [q] }); added++; } else if (!cur.qs.includes(q)) cur.qs.push(q);
        }
        pagesRead.push({ q, page: i + 1, cards: seen.size, found, fresh, added, next });
        log('mercari "' + q + '" p' + (i + 1) + ': ' + seen.size + ' cards, ' + found + ' read, ' + added + ' new overall' + (next ? '' : ', last page'));
        if (!seen.size) {
          ranOut = none;
          // the page's shape, never its words
          if (!diag && !none) diag = await page.evaluate(PROBE, ['diag']);
          break;
        }
        if (!fresh) break;                                      // the same page again: not an end
        if (next) full.push(seen.size);
        if (!next) { ranOut = true; break; }                    // no 次へ: the last page
      }
      // every page before the last holds the same number of cards; one that came up
      // short was not read to its end, and its missing cards must not count as gone
      if (ranOut && full.length && Math.min(...full) < 0.85 * Math.max(...full)) ranOut = false;
      done[q] = ranOut;
    }
  } finally { await browser.close(); }
  return { items: [...all.values()], pagesRead, done, linked: [...linked], requests, ...(diag ? { diag } : {}) };
}
