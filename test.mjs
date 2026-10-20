// Every rule the collectors and the build keep, checked without the network.
//   node test.mjs            (V=1 for every group's name)
// Runs in the daily workflow before anything is collected: a failing check
// stops the day's build and yesterday's data stays up.

import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRobots, robotsAllows, listingsFrom, get, diagOf, Refused, unlinked, UA, GAP_MS, botCheck } from './lib.mjs';
import { SOURCES, BY_FILE, collect, readSearch, mdToDate, leftToEnd, secondStreetTitle } from './sources.mjs';
import { productOf, collectBrandPages, dueForRecheck, SPEC as FF_SPEC, brandPageUrl } from './fruitsfamily.mjs';
import { hitOf, catOf, collectGrailed, planGrailed, facetsOf, queryOf, TOKENS, designersOf } from './grailed.mjs';
import { cardOf as mercariCard, searchUrl as mercariUrl, collectMercari } from './mercari.mjs';
import { itemOf, collectEbay } from './ebay.mjs';
import { classify, era, section, size, excludeReason, lastYear, SECTIONS } from './classify.mjs';
import { BRANDS, ACTIVE, BY_SLUG, brandsOf, queryPlan, queriesOf, grailedDesignated, designatedOf, fold, brandLabel } from './brands.mjs';
import { updateLedger, updateSold, buildPayload, toKRW, FILES, markSeen, readAll, newCards, mailOf, photosOf, INDEX_HTML } from './build.mjs';
import { parseArgs, FILES as SOURCE_FILES, QUEUES } from './collect.mjs';
import { readLedger, writeLedger, readSold, writeSold, shardOf, SHARDS } from './store.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
let passed = 0, failed = 0; const failures = [];
// every assertion counts as one check
const A = new Proxy(assert, { get(t, k) {
  const f = t[k]; if (typeof f !== 'function') return f;
  return (...args) => { const r = f(...args); if (r && typeof r.then === 'function') return r.then((v) => { passed++; return v; }); passed++; return r; };
} });
async function group(label, fn) {
  try { await fn(); if (process.env.V) console.log('  ✓ ' + label); }
  catch (e) { failed++; failures.push(label + ': ' + (e && e.message || e)); console.log('  ✗ ' + label + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
}
const S = BY_FILE;
const rates = { USD: 1370, GBP: 1852, EUR: 1587, JPY: 873 };
const okS = (n = 1, extra = {}) => ({ ok: true, complete: true, kept: n, ...extra });

// ── robots.txt, as each host wrote it (read 2026-09-23 / 09-27 / 10-19) ────
await group('robots: routes and query-parameter rules', () => {
  const yahoo = 'User-agent: *\nDisallow: /members/\nDisallow: /closedsearch/\nDisallow: /closedsearch\nDisallow: /search/advanced\n' +
    'Disallow: /search/*?*n=\nDisallow: /search/*?*mode=\nDisallow: /search/*?*s1=\nAllow: /closedsearch/closedsearch\n';
  const ff = 'User-agent: *\nDisallow: /my\nDisallow: /checkout/\nDisallow: /upload\nDisallow: /login\nDisallow: /auth/\n\n' +
    'User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: anthropic-ai\nAllow: /llms.txt\nDisallow: /\n';
  const rakuma = 'User-agent: *\nDisallow: /search/\nDisallow: /*?*sort=\nDisallow: /*?*status=\nAllow: /search/$\n';
  const yfm = 'User-agent: *\nDisallow: /item/*/edit\nDisallow: /search/*?*sort=\nDisallow: /search/*?*sold=\nDisallow: /search/*?*minPrice=\n';
  const grailed = 'User-agent: *\nDisallow: /search\nDisallow: /sold\nDisallow: /users/*\nDisallow: /listings/*/edit\nDisallow: /listings/*/similar\n';
  const ebay = 'User-agent: *\nDisallow: /sch/\nAllow: /sch/ebayadvsearch\nDisallow: /itm/*,\n';
  const cases = [
    [yahoo, '/search/search?p=guidi', true], [yahoo, '/search/search?p=guidi&b=51', true],
    [yahoo, '/search/search?p=x&n=100', false], [yahoo, '/closedsearch/closedsearch?p=guidi', true], [yahoo, '/closedsearch/?p=x', false],
    [ff, '/brand/Guidi', true], [ff, '/product/64x3n/', true], [ff, '/my/orders', false],
    [rakuma, '/s?query=guidi&page=2', true], [rakuma, '/s?query=x&sort=created_at', false],
    [yfm, '/search/%E3%82%B0%E3%82%A4%E3%83%87%E3%82%A3?withSpeller=0&page=2', true], [yfm, '/search/x?sort=openTime', false],
    [grailed, '/designers/guidi', true], [grailed, '/search?q=x', false], [grailed, '/sold', false],
    [ebay, '/sch/i.html?_nkw=guidi', false],
  ];
  for (const [txt, path, want] of cases) A.equal(robotsAllows(parseRobots(txt), path), want, path);
  // the AI-crawler group is someone else's rules, not ours
  A.equal(parseRobots(ff).some((r) => r.path === '/' && !r.allow), false);
  // every route this pipeline asks is one these rules allow
  const own = { yahoo, yahoo_sold: yahoo, rakuma, yfm, mercari: 'User-agent: *\nDisallow: /mypage\nDisallow: /purchase\nDisallow: /v1\nDisallow: /v2\n', second: 'User-agent: *\nDisallow: /share\n' };
  for (const src of SOURCES) for (const i of [0, 1]) { const u = new URL(src.pages('guidi', i)); A.ok(robotsAllows(parseRobots(own[src.file]), u.pathname + u.search), src.file + ' p' + (i + 1)); }
});

// ── the polite fetch, against local servers ───────────────────────────────
function server(handler) {
  return new Promise((r) => { const seen = []; const s = createServer((q, res) => { seen.push({ t: Date.now(), url: q.url, h: q.headers }); handler(q, res); });
    s.listen(0, '127.0.0.1', () => r({ base: 'http://127.0.0.1:' + s.address().port, seen, close: () => s.close() })); });
}
const send = (res, status, body, type = 'text/html') => { res.writeHead(status, { 'content-type': type }); res.end(body); };
await group('lib: robots at every redirect, one UA, 2.5 s a host, stop on 403/429 and bot checks', async () => {
  A.ok(GAP_MS >= 2500);
  // an environment variable cannot make it faster
  const fast = execFileSync(process.execPath, ['--input-type=module', '-e', 'import("' + pathToFileURL(join(HERE, 'lib.mjs')).href + '").then((m) => console.log(m.GAP_MS))'],
    { env: { ...process.env, BRAND_GAP_MS: '100' }, encoding: 'utf8' }).trim();
  A.equal(Number(fast), 2500);
  const s1 = await server((q, res) => {
    if (q.url === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /search/\n', 'text/plain');
    if (q.url.startsWith('/s?')) { res.writeHead(302, { location: '/search/x' }); return res.end(); }
    send(res, 200, '<html>open</html>');
  });
  const s2 = await server((q, res) => {
    if (q.url === '/robots.txt') return send(res, 404, 'no');
    if (q.url === '/c') return send(res, 429, 'slow down');
    send(res, 200, '<html>' + q.url + '</html>');
  });
  const s3 = await server((q, res) => {
    if (q.url === '/robots.txt') return send(res, 200, 'User-agent: *\nAllow: /\n', 'text/plain');
    send(res, 200, '<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>');
  });
  const s4 = await server((q, res) => send(res, 403, 'no'));
  await Promise.all([
    (async () => {
      await A.rejects(get(s1.base + '/search/x'), Refused);                 // robots closes it: never asked
      await A.rejects(get(s1.base + '/s?query=x'), Refused);                // a redirect into it: refused too
      A.equal(await get(s1.base + '/brand/x'), '<html>open</html>');
      A.deepEqual(s1.seen.map((x) => x.url), ['/robots.txt', '/s?query=x', '/brand/x']);
    })(),
    (async () => {
      A.equal(await get(s2.base + '/a', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)', cookie: 'sid=1', referer: 'https://www.google.com/' } }), '<html>/a</html>');
      A.equal(await get(s2.base + '/b'), '<html>/b</html>');
      const a = s2.seen.find((x) => x.url === '/a'), b = s2.seen.find((x) => x.url === '/b');
      A.equal(a.h['user-agent'], UA); A.equal(a.h.cookie, undefined); A.equal(a.h.referer, undefined);
      A.ok(b.t - a.t >= 2400, 'gap ' + (b.t - a.t));
      A.ok(a.t - s2.seen[0].t >= 2400, 'robots.txt waits its turn too');
      await A.rejects(get(s2.base + '/c'), Refused);                        // 429: the site said no
      const n = s2.seen.length;
      await A.rejects(get(s2.base + '/d'), /stopped/);                      // and the host is not asked again today
      A.equal(s2.seen.length, n);
    })(),
    (async () => {
      await A.rejects(get(s3.base + '/x'), /bot-check/);
      const n = s3.seen.length;
      await A.rejects(get(s3.base + '/y'), Refused); A.equal(s3.seen.length, n);
    })(),
    (async () => {
      await A.rejects(get(s4.base + '/x'), Refused);                        // robots.txt refused: the site is not read
      A.deepEqual(s4.seen.map((x) => x.url), ['/robots.txt']);
    })(),
  ]);
  for (const s of [s1, s2, s3, s4]) s.close();
  A.equal(botCheck('<html><head><title>Rick Owens | 検索</title></head><body>' + 'x'.repeat(70000) + '/cdn-cgi/challenge-platform/scripts/jsd/main.js</body></html>'), null);
  A.equal(botCheck('<title>Attention Required! | Cloudflare</title>'), 'bot-check page');
});

// ── reading search pages ─────────────────────────────────────────────────
await group('search pages: yahoo live and closed, mercari label, rakuma sold, fruitsfamily', () => {
  const yahoo = `<ul><li class="Product">
    <a href="https://auctions.yahoo.co.jp/jp/auction/c1243046384"><img src="https://auc-pctr.c.yimg.jp/i/a.jpg" alt="x"></a>
    <h3><a href="https://auctions.yahoo.co.jp/jp/auction/c1243046384">超希少 GUIDI 07SS バックジップブーツ 42</a></h3>
    <span>現在 28,000円</span><span>入札 3</span><span>残り 47分</span></li>
    <li class="Product"><a href="/jp/auction/j1245414100"><img data-src="https://auc-pctr.c.yimg.jp/i/b.jpg"></a>
    <a href="/jp/auction/j1245414100">RICK OWENS リックオウエンス パンツ ブラック 46</a>
    <span>31,500円</span> 16入札 2時間</li></ul>`;
  const g = listingsFrom(yahoo, S.yahoo.spec);
  A.equal(g.length, 2);
  A.deepEqual([g[0].id, g[0].price, g[0].bids, g[0].endsPrec], ['yahoo:c1243046384', 28000, 3, 'm']);
  A.deepEqual([g[1].price, g[1].bids, g[1].endsPrec, g[1].img], [31500, 16, 'h', 'https://auc-pctr.c.yimg.jp/i/b.jpg']);
  const closed = '<li><a href="https://auctions.yahoo.co.jp/jp/auction/k1244417862">新品未使用 GUIDI 988 ブーツ 42</a><span>落札 221,000円</span> 入札 88 <span>9/21 00:31</span></li>';
  const c = listingsFrom(closed, S.yahoo_sold.spec)[0];
  A.deepEqual([c.sold, c.soldKind, c.bids, c.price], [true, '낙찰', 88, 221000]); A.match(c.soldAt, /^\d{4}-09-21$/);
  const ff = '<a href="/product/64x3n/guidi-boots-42"><img src="https://image.production.fruitsfamily.com/public/product/resized%40width620/a.jpg"></a>' +
    '<a href="/product/64x3n/guidi-boots-42">Guidi back zip boots 42</a><span>1,100,000원</span>';
  const f = listingsFrom(ff, FF_SPEC)[0];
  A.deepEqual([f.id, f.url, f.price, f.cur], ['ff:64x3n', 'https://fruitsfamily.com/product/64x3n/', 1100000, 'KRW']);
  // a card's own brand label is not its title
  const m = listingsFrom('<li><a href="/item/m21149925004"><span>RICK OWENS</span><span>コンバットブーツ 42</span><span>¥119,800</span></a></li>', S.mercari.spec)[0];
  A.deepEqual([m.title, m.brandTagged, m.price], ['コンバットブーツ 42', true, 119800]);
  const r = listingsFrom('<li><a href="https://item.fril.jp/ef8eaacc7b78fce2fd7bd9089d3dbd44">Guidi スニーカー サイズ42</a><span>¥70,000</span><span>SOLD OUT</span></li>', S.rakuma.spec)[0];
  A.deepEqual([r.id, r.sold], ['rakuma:ef8eaacc7b78fce2fd7bd9089d3dbd44', true]);
  A.equal(brandLabel.test('Rick Owens(リックオウエンス)'), true); A.equal(brandLabel.test('Rick Owens jacket'), false);
});
await group("search pages: Yahoo!フリマ JSON and sold, 2nd STREET cards under the store's brand line", () => {
  const nd = { props: { initialState: { searchState: { search: { result: { totalResultsAvailable: 3, items: [
    { id: 'x1229425247', title: '2008 リング グイディ GUIDI', price: 94000, itemStatus: 'OPEN', thumbnailImageUrl: 'https://auc-pctr.c.yimg.jp/i/a.jpg',
      brand: { id: 1, name: 'GUIDI' }, seller: { id: 'u77', name: 'tokyo_vintage_shop' } },
    { id: 'z520111612', title: 'テーラードジャケット 黒', price: 112100, itemStatus: 'OPEN', brand: { id: 1, name: 'リックオウエンス' } },
    { id: 'k1245640158', title: 'guidi レザー ブーツ', price: 450000, itemStatus: 'SOLD', brand: null } ] },
    auctionItemsModule: { items: [{ id: 'v1200000001', price: 5000, url: 'https://auctions.yahoo.co.jp/jp/auction/v1200000001', isAuction: true }] } } } } } };
  const html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(nd) + '</script>' +
    '<a href="/item/x1229425247"><img src="https://auc-pctr.c.yimg.jp/i/a.jpg"></a><a href="https://auctions.yahoo.co.jp/jp/auction/v1200000001">x</a>';
  const r = listingsFrom(html, S.yfm.spec);
  A.deepEqual(r.map((x) => x.id).sort(), ['yfm:k1245640158', 'yfm:x1229425247', 'yfm:z520111612']);
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  A.equal(by['yfm:x1229425247'].url, 'https://paypayfleamarket.yahoo.co.jp/item/x1229425247');
  A.equal(by['yfm:z520111612'].brandTagged, true);
  A.equal(by['yfm:k1245640158'].sold, true);
  A.equal(JSON.stringify(r).includes('tokyo_vintage_shop'), false);                 // the seller is not read
  A.equal(S.yfm.pages('guidi', 1), 'https://paypayfleamarket.yahoo.co.jp/search/guidi?withSpeller=0&page=2');
  const card = (id, brand, name, size, price) => '<li class="js-favorite itemCard" goodsid="' + id + '"><a href="/goods/detail/goodsId/' + id + '/shopsId/31108" class="itemCard_inner">' +
    '<div class="itemCard_img"><img src="https://cdn2.2ndstreet.jp/img/pc/goods/' + id + '/1_tn.jpg" loading="lazy" /></div>' +
    '<div class="itemCard_body"><p class="itemCard_brand">' + brand + '</p><p class="itemCard_name">' + name + '</p><p class="itemCard_size">サイズ' + size + '</p>' +
    '<p class="itemCard_status">商品の状態 : 中古B</p><p class="itemCard_price">&yen;' + price + ' </p></div><a class="favorite itemCard_favorite"></a></a></li>';
  const t = listingsFrom('<ul>' + card('2346610082523', 'RICK OWENS', '19SS/イタリア製/レザージャケット/46/レザー/BLK/? NULL ?//', '46', '175,890') +
    card('2347101730237', 'GUIDI', 'ブーツ/PL1/42', 'その他', '65,890') + '</ul>', S.second.spec);
  A.deepEqual(t.map((x) => [x.id, x.price, x.size || null, x.brandLine || null]), [['2nd:2346610082523', 175890, '46', null], ['2nd:2347101730237', 65890, null, null]]);
  A.equal(t[0].title, 'RICK OWENS 19SS · イタリア製 · レザージャケット · 46 · レザー · BLK');
  A.equal(t[1].title, 'GUIDI ブーツ · PL1 · 42');
  A.deepEqual(brandsOf(t[0].title).b, ['rick-owens']); A.deepEqual(brandsOf(t[1].title).b, ['guidi']);
  A.equal(secondStreetTitle('シャツ/CM/1716B', 'X'), 'X シャツ · CM/1716B');
  A.equal(S.second.pages('Guidi', 1), 'https://www.2ndstreet.jp/search?keyword=Guidi&page=2');
});
await group("search pages: Rakuma's cards, Mercari's cards (as drawn)", () => {
  const card = (id, name, label, price, sold) => '<div class="item"><div class="item-box"><div class="item-box__image-wrapper">' +
    '<a href="https://item.fril.jp/' + id + '" class="link_search_image" title="' + name + ' ' + label + '" data-rat-item_name="' + name + '" data-rat-brand="Guidi" data-rat-price="' + price + '">' +
    '<img src="https://asset.fril.jp/assets/new_web/item_square_dummy-e093.png" data-original="https://img.fril.jp/img/' + price + '/m/1.jpg?1" class="img-responsive lazy">' +
    (sold ? '<div class="item-box__soldout_ribbon">SOLD OUT</div>' : '') + '</a></div><div class="item-box__text-wrapper"><div class="item-box__item-sub-name"><a href="/brand/1" class="brand-name">Guidi</a></div>' +
    '<div class="item-box__item-name"><a href="https://item.fril.jp/' + id + '"><span>' + name + '</span></a></div>' +
    '<div class="item-box__item-price"><span>¥</span><span>' + Number(price).toLocaleString('en-US') + '</span></div></div></div></div>';
  const shoes = 'グイディ(Guidi)のメンズの靴/シューズ(ブーツ)の商品詳細ページへのリンク';
  const got = listingsFrom(card('0123456789abcdef0123456789abcdef', 'Guidi バックジップ　サイズ42', shoes, 170000, true) +
    card('fedcba9876543210fedcba9876543210', '参考上代182400円 Guidi 988 42', shoes, 98000, false), S.rakuma.spec);
  A.equal(got.length, 2);
  A.deepEqual([got[0].title, got[0].price, got[0].img, got[0].sold, got[0].cat], ['Guidi バックジップ サイズ42', 170000, 'https://img.fril.jp/img/170000/m/1.jpg?1', true, '靴/シューズ(ブーツ)']);
  A.equal(got[1].price, 98000, 'the retail figure in the title is not the price');
  A.equal(unlinked('Guidi 988 42 ' + shoes), 'Guidi 988 42');
  const m1 = mercariCard({ href: '/item/m45109765100', name: 'guidi ブーツ', price: '¥50,000', img: 'https://static.mercdn.net/thumb/item/webp/m45109765100_1.jpg?1', text: '¥\n50,000' });
  A.deepEqual(m1, { id: 'mercari:m45109765100', url: 'https://jp.mercari.com/item/m45109765100', title: 'guidi ブーツ', price: 50000, cur: 'JPY',
                    img: 'https://static.mercdn.net/thumb/item/webp/m45109765100_1.jpg?1' });
  const m2 = mercariCard({ href: '/shops/product/AbCdEfGhIjKlMnOpQrSt', name: '', price: '', alt: 'Guidi レザージャケット 48のサムネイル', img: '', text: '¥\n128,000' });
  A.deepEqual([m2.url, m2.title, m2.price], ['https://jp.mercari.com/shops/product/AbCdEfGhIjKlMnOpQrSt', 'Guidi レザージャケット 48', 128000]);
  A.equal(mercariCard({ href: '/item/m45109765100', name: 'Guidi', price: '', text: 'no price' }), null);
  A.equal(mercariUrl('グイディ', 2), 'https://jp.mercari.com/search?keyword=%E3%82%B0%E3%82%A4%E3%83%87%E3%82%A3&status=on_sale&page_token=v1%3A2');
});

// ── paging: where a search ends, and what one search's failure does ─────────
await group('paging: per-search end, page limit, nothing matched, a wall, repeats, many searches', async () => {
  const page = (ids, w = 'GUIDI boots') => ids.map((i) => '<a href="/jp/auction/x1' + String(i).padStart(6, '0') + '">' + w + ' ' + i + '</a> 1,000円').join('');
  const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
  const pages = { guidi: [page(range(0, 50)), page(range(50, 73))], グイディ: [page(range(63, 93))] };
  const fetchPage = async (url) => { const u = new URL(url); return pages[u.searchParams.get('p')][Math.floor((Number(u.searchParams.get('b') || 1) - 1) / 50)] || ''; };
  const plan = [{ q: 'guidi' }, { q: 'グイディ' }];
  const res = await collect(S.yahoo, plan, { fetchPage });
  A.equal(res.items.length, 93); A.deepEqual(res.done, { guidi: true, グイディ: true });
  A.deepEqual(res.items.find((x) => x.id === 'yahoo:x1000065').qs, ['guidi', 'グイディ']);     // found by both searches
  A.deepEqual(res.items.find((x) => x.id === 'yahoo:x1000001').qs, ['guidi']);
  // a reading stopped by the page limit is not complete; --max-pages narrows it
  const endless = async (url) => { const b = Number(new URL(url).searchParams.get('b') || 1); return page(range(1000 + b, 1050 + b)); };
  A.deepEqual((await collect(S.yahoo, [{ q: 'x' }], { fetchPage: endless })).done, { x: false });
  let asked = 0;
  await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async (u) => { asked++; return endless(u); }, maxPages: 1 }); A.equal(asked, 1);
  // a first page with nothing on it: the end only if the site says nothing matched
  A.deepEqual((await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async () => '<p>条件に一致する商品は見つかりませんでした</p>' })).done, { x: true });
  const blocked = await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async () => '<p>アクセスが集中しています</p>' });
  A.deepEqual(blocked.done, { x: false }); A.ok(blocked.emptyHtml);
  // a full page followed by a wall, by a short page, by the same page again
  const full = page(range(0, 50)), short = page(range(100, 112));
  A.deepEqual((await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async (u) => (new URL(u).searchParams.get('b') ? '<html>challenge</html>' : full) })).done, { x: false });
  const s2 = await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async (u) => (new URL(u).searchParams.get('b') ? short : full) });
  A.deepEqual([s2.done.x, s2.items.length], [true, 62]);
  A.deepEqual((await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async () => full })).done, { x: false });
  // a full page read badly is still a full page: its links say how long it was
  const bad = Array.from({ length: 50 }, (_, i) => '<a href="/jp/auction/x5' + String(i).padStart(6, '0') + '">GUIDI boots ' + i + '</a>' + (i < 37 ? ' 1,000円' : ' —')).join('');
  const more = await collect(S.yahoo, [{ q: 'x' }], { fetchPage: async (u) => (new URL(u).searchParams.get('b') ? '<a href="/jp/auction/x6000001">GUIDI z</a> 1,000円' : bad) });
  A.deepEqual([more.pages.length, more.done.x, more.linked.length], [2, true, 51]);
  // results that fit on one page are a complete reading
  const one = Array.from({ length: 20 }, (_, i) => '<a href="https://item.fril.jp/' + String(i).padStart(32, 'a') + '">GUIDI boots ' + i + '</a> ¥1,000').join('');
  A.deepEqual((await collect(S.rakuma, [{ q: 'guidi' }], { fetchPage: async () => one })).done, { guidi: true });
  // one search failing leaves it unread and the next goes on; every search failing is the source failing
  const flaky = await collect(S.yahoo, [{ q: 'a' }, { q: 'b' }], { fetchPage: async (u) => { if (/p=a/.test(u)) throw new Error('HTTP 500'); return short; } });
  A.deepEqual([Object.keys(flaky.done), flaky.failed.length, flaky.items.length], [['b'], 1, 12]);
  await A.rejects(collect(S.yahoo, [{ q: 'a' }], { fetchPage: async () => { throw new Error('HTTP 500'); } }), /every search failed/);
  // a refusal ends the source at once
  let calls = 0;
  await A.rejects(collect(S.yahoo, [{ q: 'a' }, { q: 'b' }], { fetchPage: async () => { calls++; throw new Refused('HTTP 429 from x'); } }), Refused);
  A.equal(calls, 1);
  A.match(mdToDate('9/21 00:31', '2026-09-27'), /^2026-09-21$/); A.equal(mdToDate('12/30 10:00', '2026-01-05'), '2025-12-30');
  A.equal(leftToEnd('残り 2日', Date.UTC(2026, 8, 27)).endsPrec, 'd');
});

// ── Mercari through a stand-in browser ──────────────────────────────────
function fakeChromium(script, log = []) {
  const page = { cur: null, at: '' };
  return { log, launch: async () => ({ close: async () => {}, newContext: async (o) => { log.push({ ctx: o }); return { route: async () => {},
    newPage: async () => ({
      goto: async (u) => { page.at = u; page.cur = script(u); log.push({ goto: u }); return { status: () => page.cur.status || 200 }; },
      url: () => page.cur.landed || page.at,
      waitForSelector: async () => null,
      $$eval: async (sel) => (sel.includes('page_token') ? !!page.cur.next : page.cur.cards || []),
      evaluate: async (fn, [what]) => (what === 'atEnd' ? true : what === 'none' ? !!page.cur.none : what === 'wall' ? page.cur.wall || '<title>メルカリ</title>' : { title: 'x', bytes: 1, anchors: 0, text: 0 }),
      mouse: { wheel: async () => {} }, waitForTimeout: async () => {},
    }) }; } }) };
}
await group('mercari: one page a search, our User-Agent, a refusal ends it', async () => {
  const cards = (ids, t) => ids.map((i) => ({ href: '/item/m' + (45100000000 + i), name: t + ' ' + i, price: '¥' + (1000 + i), img: 'https://static.mercdn.net/x' + i + '.jpg', text: '' }));
  const open = parseRobots('User-agent: *\nDisallow: /mypage\n');
  const fc = fakeChromium((u) => (/keyword=guidi&/.test(u) ? { cards: cards([1, 2, 3], 'GUIDI boots'), next: true } : { cards: cards([3, 4], 'グイディ ブーツ'), next: false }));
  const r = await collectMercari(['guidi', 'グイディ'], () => {}, { chromium: fc, rulesFor: async () => open, gapMs: 0, pause: 0 });
  A.deepEqual(r.done, { guidi: false, グイディ: true });               // a next page not read: not to the end
  A.equal(r.items.length, 4); A.deepEqual(r.items.find((x) => x.id === 'mercari:m45100000003').qs, ['guidi', 'グイディ']);
  A.equal(fc.log[0].ctx.userAgent, UA); A.equal(r.requests, 3);
  // pages are spaced, the first one after robots.txt too
  const timed = fakeChromium(() => ({ cards: cards([9], 'GUIDI'), next: false })), t0 = Date.now(), at = [];
  const orig = timed.launch;
  timed.launch = async () => { const b = await orig(); const nc = b.newContext; b.newContext = async (o) => { const c = await nc(o); const np = c.newPage;
    c.newPage = async () => { const p = await np(); const g = p.goto; p.goto = async (u) => { at.push(Date.now()); return g(u); }; return p; }; return c; }; return b; };
  await collectMercari(['a', 'b'], () => {}, { chromium: timed, rulesFor: async () => open, gapMs: 300, pause: 0 });
  A.ok(at[0] - t0 >= 290 && at[1] - at[0] >= 290, 'mercari gaps ' + (at[0] - t0) + ' ' + (at[1] - at[0]));
  const walled = await collectMercari(['guidi', 'x'], () => {}, { chromium: fakeChromium(() => ({ wall: '<title>Just a moment...</title>' })), rulesFor: async () => open, gapMs: 0, pause: 0 });
  A.match(walled.refused, /bot-check/); A.equal(walled.items.length, 0);
  const no = await collectMercari(['guidi'], () => {}, { chromium: fakeChromium(() => ({ status: 403 })), rulesFor: async () => open, gapMs: 0, pause: 0 });
  A.match(no.refused, /HTTP 403/);
  const closed = await collectMercari(['guidi'], () => {}, { chromium: fakeChromium(() => ({})), rulesFor: async () => parseRobots('User-agent: *\nDisallow: /search\n') });
  A.ok(closed.refused);
  const away = await collectMercari(['guidi'], () => {}, { chromium: fakeChromium(() => ({ landed: 'https://login.example.com/x' })), rulesFor: async () => open, gapMs: 0, pause: 0 });
  A.match(away.refused, /redirected/);
});

// ── 후루츠패밀리 brand pages and listing pages ──────────────────────────────
await group('fruitsfamily: brand pages filed under the brand, listing meta, the second look', async () => {
  const html = '<html><head><meta property="og:title" content="Guidi back zip boots 42 | 후루츠패밀리">' +
    '<meta property="og:image" content="https://image.production.fruitsfamily.com/public/product/resized%40width620/a.jpg">' +
    '<meta property="product:price:amount" content="1100000"><meta property="product:price:currency" content="KRW">' +
    '<meta property="product:availability" content="in stock"><meta property="product:brand" content="Guidi"></head><body>사이즈</span><span>42</span></body></html>';
  const p = productOf(html);
  A.deepEqual([p.title, p.price, p.cur, p.forSale, p.brand, p.size], ['Guidi back zip boots 42', 1100000, 'KRW', true, 'Guidi', '42']);
  A.equal(productOf(html.replace('in stock', 'out of stock')).forSale, false);
  const pageOf = { Guidi: '<a href="/product/64x3n/a">백집 부츠 42</a><span>1,100,000원</span><a href="/product/77abc/b">Guidi 988 42</a><span>900,000원</span>' };
  const asked = [];
  const r = await collectBrandPages([BY_SLUG.get('guidi'), BY_SLUG.get('uma-wang')], () => {}, { fetchPage: async (u) => { asked.push(u); return pageOf[decodeURIComponent(u.split('/brand/')[1])] ?? null; } });
  A.deepEqual(asked, [brandPageUrl(BY_SLUG.get('guidi')), 'https://fruitsfamily.com/brand/Uma%20Wang']);
  A.deepEqual([r.items.length, r.missing, r.done], [2, ['uma-wang'], { 'bp:guidi': false, 'bp:uma-wang': false }]);
  const k = r.items.find((x) => x.id === 'ff:64x3n');
  A.deepEqual([k.d, k.qs], [['guidi'], ['bp:guidi']]);
  A.deepEqual(brandsOf(k.title, designatedOf(k)).b, ['guidi']);                   // filed under Guidi: no name needed in the title
  A.deepEqual(brandsOf(k.title).b, []);                                         // the same title on a search page is no one's
  const L = { items: {
    'ff:a': { id: 'ff:a', file: 'fruits', first: '2026-10-01', gone: null }, 'ff:b': { id: 'ff:b', file: 'fruits', first: '2026-10-09', gone: null },
    'ff:c': { id: 'ff:c', file: 'fruits', first: '2026-09-01', gone: '2026-10-02' }, 'ff:d': { id: 'ff:d', file: 'fruits', first: '2026-09-02', gone: null },
    'yahoo:e': { id: 'yahoo:e', file: 'yahoo', first: '2026-09-01', gone: null } } };
  const due = dueForRecheck(L, new Set(['ff:d']), '2026-10-12', { checked: { 'ff:a': '2026-10-11' } });
  A.deepEqual(due.map((x) => x.id), ['ff:b']);                                  // ff:a looked at yesterday, ff:d seen today, ff:c gone
  A.equal(dueForRecheck(L, new Set(), '2026-10-12', { limit: 1 }).map((x) => x.id)[0], 'ff:d');
});

// ── Grailed ───────────────────────────────────────────────────────────────
await group('grailed: hits, designers, categories', () => {
  const g = hitOf({ id: 102614695, title: 'Guidi  988 Back Zip Boots ', price_i: 1850, size: '9', condition: 'is_gently_used', sold: false, deleted: false,
    category_path: 'footwear.boots', cover_photo: { url: 'https://media-assets.grailed.com/prd/listing/a' }, user: { username: 'someone' },
    designers: [{ id: 1, name: 'Guidi', slug: 'guidi' }] });
  A.deepEqual([g.id, g.url, g.title, g.price, g.cur, g.size, g.cat, g.img, g.cond, g.dz],
    ['grailed:102614695', 'https://www.grailed.com/listings/102614695', 'Guidi 988 Back Zip Boots', 1850, 'USD', '9', 'shoes', 'https://media-assets.grailed.com/prd/listing/a', undefined, ['Guidi']]);
  A.equal(JSON.stringify(g).includes('someone'), false);                         // the seller is not kept
  for (const bad of [{ sold: true }, { deleted: true }, { title: '' }, { price_i: 0 }]) A.equal(hitOf({ id: 1, title: 'x', price_i: 100, ...bad }), null);
  A.deepEqual(designersOf({ designer_names: 'Rick Owens × Dr. Martens' }), ['Rick Owens', 'Dr. Martens']);
  const paths = { 'outerwear.leather_jackets': '아우터', 'womens_outerwear.blazers': '테일러링', 'footwear.boots': '신발', 'bottoms.denim': '데님', 'bottoms.casual_pants': '팬츠',
    'womens_bottoms.mini_skirts': '기타', 'tops.button_ups': '셔츠', 'tops.sweaters_knitwear': '상의', 'tailoring.formal_trousers': '팬츠', 'accessories.jewelry_watches': '주얼리',
    'accessories.bags_luggage': '가방·소품', 'accessories.belts': '가방·소품', 'womens_dresses.midi': '기타' };
  for (const [p, sec] of Object.entries(paths)) A.equal(section(catOf(p)), sec, p);
  for (const p of ['accessories.misc', 'bottoms.jumpsuits', '']) A.equal(catOf(p), '', p);
  A.equal(classify({ title: 'Guidi', cat: 'shoes' }).section, '신발');
  A.equal(classify({ title: 'Guidi leather jacket', cat: 'shoes' }).section, '아우터');
});
await group('grailed: the plan — small brands whole, big brands by season words, AND/OR, Tabi, the cap', async () => {
  const plan = planGrailed(ACTIVE, '2026-10-19');
  const small = plan.filter((s) => !s.token), big = plan.filter((s) => s.token);
  A.equal(new Set(big.map((s) => s.slug)).size, 20); A.equal(big.length, 20 * TOKENS.length);
  A.equal(TOKENS.length, 16);
  A.ok(small.every((s) => !BY_SLUG.get(s.slug).big)); A.equal(plan.some((s) => s.slug === 'carol-christian-poell'), false);
  A.equal(plan.findIndex((s) => s.token) , small.length);                       // small brands first
  // OR over grailed, AND over grailedAll
  A.deepEqual(facetsOf(BY_SLUG.get('1017-alyx-9sm')), [['designers.name:1017 ALYX 9SM', 'designers.name:Alyx']]);
  A.deepEqual(facetsOf(BY_SLUG.get('dr-martens-x-rick-owens')), [['designers.name:Rick Owens'], ['designers.name:Dr. Martens']]);
  // Tabi is filed under Maison Margiela: its titleMust word is the search's words
  A.deepEqual([queryOf(BY_SLUG.get('tabi-footwear')), queryOf(BY_SLUG.get('guidi')), queryOf(BY_SLUG.get('dr-martens-x-rick-owens'))], ['', '', '']);
  A.equal(queryOf({ ...BY_SLUG.get('tabi-footwear'), grailedQuery: 'tabi boots' }), 'tabi boots');
  // the order of big brands turns with the day
  const firstBig = (d) => planGrailed(ACTIVE, d).find((s) => s.token).slug;
  A.notEqual(firstBig('2026-10-19'), firstBig('2026-10-20'));
  // the price bands: a search answers 1,000 at most; overfull bands are halved until each fits
  const stockAsk = (stock) => async ({ lo, hi }) => { const m = stock.filter((x) => x.price_i >= lo && (hi == null || x.price_i < hi)); return { nbHits: m.length, hits: m.slice(0, 1000) }; };
  const Lx = (n, price, from, t = 'Guidi boots ') => Array.from({ length: n }, (_, i) => ({ id: from + i, title: t + (from + i), price_i: price(i), designers: [{ name: 'Guidi' }] }));
  const guidi = [{ ...BY_SLUG.get('guidi'), grailedCount: 3000 }];
  const stock = [...Lx(1500, (i) => 250 + (i % 50), 1), ...Lx(1100, (i) => 2500 + i, 5000), ...Lx(3, () => 120, 20000)];
  let r = await collectGrailed(guidi, () => {}, { ask: stockAsk(stock), day: '2026-10-19' });
  A.deepEqual([r.items.length, r.done['g:guidi'], r.capped], [2603, true, false]);
  A.deepEqual(r.items[0].qs, ['g:guidi']); A.deepEqual(r.items[0].gb, ['guidi']);
  // a small brand under 900 is one search
  r = await collectGrailed([BY_SLUG.get('uma-wang')], () => {}, { ask: stockAsk(Lx(40, () => 300, 1, 'Uma Wang coat ')), day: '2026-10-19' });
  A.deepEqual([r.calls, r.items.length, r.done['g:uma-wang']], [1, 40, true]);
  // 1,200 at a single price cannot be split: what came is kept, the reading is not complete
  r = await collectGrailed([BY_SLUG.get('uma-wang')], () => {}, { ask: stockAsk([...Lx(1200, () => 500, 1), ...Lx(10, () => 700, 5000)]), day: '2026-10-19' });
  A.deepEqual([r.items.length, r.done['g:uma-wang']], [1010, false]);
  // the cap: what is not read today is said, and not complete
  const asked = [];
  r = await collectGrailed([BY_SLUG.get('aganovich'), BY_SLUG.get('uma-wang'), BY_SLUG.get('rick-owens')], () => {},
    { ask: async (s) => { asked.push(s); return { nbHits: 1, hits: [{ id: asked.length, title: 'x 2019SS', price_i: 100 }] }; }, cap: 10, day: '2026-10-19' });
  A.deepEqual([r.calls, r.capped, r.done['g:aganovich'], r.done['g:uma-wang'], r.done['g:rick-owens']], [10, true, true, true, false]);
  A.deepEqual(r.cut, ['rick-owens']); A.equal(asked.filter((s) => s.query === 'ss').length, 1);
  r = await collectGrailed([BY_SLUG.get('guidi'), BY_SLUG.get('rick-owens')], () => {}, { ask: async () => ({ nbHits: 0, hits: [] }), cap: 1, day: '2026-10-19' });
  A.deepEqual([r.unread, r.done['g:rick-owens']], [['rick-owens'], undefined]);
  // excludeDesigners and the brands a hit's designers make it
  A.deepEqual(grailedDesignated(['MM6', 'Maison Margiela'], ['maison-margiela']), []);   // MM6 is left out of Maison Margiela; Tabi Footwear is not filed under Margiela
  A.deepEqual(brandsOf('MM6 Maison Margiela SS19 skirt', grailedDesignated(['MM6', 'Maison Margiela'], ['maison-margiela'])).b, []);
  A.deepEqual(grailedDesignated(['Maison Margiela'], []), ['maison-margiela']);
  A.deepEqual(grailedDesignated(['Comme des Garcons PLAY', 'Comme des Garcons'], ['comme-des-garcons']), ['comme-des-garcons-play']);
  A.deepEqual(grailedDesignated(['Rick Owens', 'Dr. Martens'], []), ['dr-martens-x-rick-owens', 'rick-owens']);
  A.deepEqual(grailedDesignated(['Rick Owens'], []), ['rick-owens']);
  // Tabi needs the word, the collaboration does not, a big brand needs a date
  A.deepEqual(brandsOf('Maison Margiela Tabi Boots 39', grailedDesignated(['Maison Margiela'])).b, []);   // filed as Margiela (big, undated); no other brand from the title
  A.deepEqual(brandsOf('Rick Owens 2008AW off-white knit', grailedDesignated(['Rick Owens'])).b, ['rick-owens']);   // a colour on a filed listing is not Off-White
  A.deepEqual(brandsOf('Rick Owens 2010 white tee both sleeves', grailedDesignated(['Rick Owens'])).b, ['rick-owens']);
  A.deepEqual(brandsOf('Maison Margiela GAT 42', grailedDesignated(['Maison Margiela'])).b, []);
  A.deepEqual(brandsOf('Maison Margiela SS19 GAT 42', grailedDesignated(['Maison Margiela'])).b, ['maison-margiela']);
  A.deepEqual(brandsOf('DM 1460 Bex Black', grailedDesignated(['Rick Owens', 'Dr. Martens'])).b, ['dr-martens-x-rick-owens']);
  A.deepEqual(designatedOf({ dz: ['Guidi'], gb: ['guidi'] }), ['guidi']);
});

// ── eBay ─────────────────────────────────────────────────────────────────
await group('ebay: the seller\'s currency, skipped without keys, one search a brand, paging', async () => {
  const e = itemOf({ legacyItemId: '1234', itemWebUrl: 'https://www.ebay.com/itm/1234', title: 'Guidi 988 boots', price: { value: '900.00', currency: 'USD' },
    buyingOptions: ['AUCTION'], bidCount: 4, itemEndDate: '2026-10-25T10:00:00.000Z', seller: { username: 'someone' } });
  A.deepEqual([e.id, e.price, e.cur, e.bids, e.endsPrec], ['ebay:1234', 900, 'USD', 4, 'm']);
  A.equal(JSON.stringify(e).includes('someone'), false);
  const c = itemOf({ legacyItemId: '9', itemWebUrl: 'https://www.ebay.com/itm/9', title: 'Guidi coat',
    price: { value: '580.40', currency: 'USD', convertedFromValue: '500.00', convertedFromCurrency: 'EUR' } });
  A.deepEqual([c.price, c.cur], [500, 'EUR']);
  A.deepEqual(await collectEbay([BY_SLUG.get('guidi')], () => {}, { env: {} }), { skipped: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set', items: [] });
  const calls = [], logs = [];
  const sum = (i) => ({ legacyItemId: String(i), itemWebUrl: 'https://www.ebay.com/itm/' + i, title: 'Guidi boots ' + i, price: { value: '100', currency: 'USD' }, seller: { username: 'seller' + i } });
  const fetchJson = async (url, o) => {
    calls.push({ url, method: o.method || 'GET', auth: o.headers.authorization });
    if (/oauth2/.test(url)) return { access_token: 'T' };
    const q = new URL(url).searchParams.get('q'), off = Number(new URL(url).searchParams.get('offset'));
    if (q === 'guidi') return { total: 250, itemSummaries: Array.from({ length: off ? 50 : 200 }, (_, i) => sum(off + i)) };
    return { total: 5000, itemSummaries: Array.from({ length: 200 }, (_, i) => sum(10000 + off + i)) };
  };
  const r = await collectEbay([BY_SLUG.get('guidi'), BY_SLUG.get('dr-martens-x-rick-owens')], (s) => logs.push(s), { fetchJson, env: { EBAY_CLIENT_ID: 'id-secret-1', EBAY_CLIENT_SECRET: 'sec-secret-2' }, maxPages: 2 });
  A.deepEqual(r.done, { guidi: true, 'rick owens dr. martens': false });
  A.equal(r.items.length, 650); A.equal(r.calls, 4);
  A.equal(calls[0].method, 'POST'); A.ok(calls.slice(1).every((x) => x.auth === 'Bearer T'));
  A.ok(calls[1].url.includes('sort=newlyListed') && calls[1].url.includes('category_ids=11450'));
  A.equal(/secret|seller\d/.test(logs.join(' ') + JSON.stringify(r.items)), false);
});

// ── the registry ─────────────────────────────────────────────────────────
await group('registry: 131 brands, unique slugs, big brands on Grailed, searches', () => {
  A.equal(BRANDS.length, 131); A.equal(new Set(BRANDS.map((b) => b.slug)).size, 131);
  A.equal(ACTIVE.length, 130); A.deepEqual(BRANDS.filter((b) => b.existing).map((b) => [b.slug, b.existing]), [['carol-christian-poell', 'ccp']]);
  A.equal(BRANDS.filter((b) => b.big).length, 20);
  for (const b of BRANDS) {
    A.ok(/^[a-z0-9-]+$/.test(b.slug) && b.name && b.latin && (b.latin[0] || b.pages === false), b.slug);
    if (b.big) A.ok(b.grailed.length > 0, 'big brand without Grailed values: ' + b.slug);
  }
  const plan = queryPlan();
  A.ok(plan.length > 190); A.equal(new Set(plan.map((p) => fold(p.q).replace(/[\s・]/g, ''))).size, plan.length);
  for (const b of ACTIVE) A.ok(b.pages === false ? !plan.some((p) => p.slugs.includes(b.slug)) : plan.some((p) => p.slugs.includes(b.slug)), 'searches for ' + b.slug);
  A.deepEqual(['white', 'warm-me', 'tacet', 'aalto'].map((s) => queriesOf(BY_SLUG.get(s)).length), [0, 0, 0, 0]);
  A.deepEqual(queriesOf(BY_SLUG.get('both')), ['both paris']);
  A.deepEqual(queriesOf(BY_SLUG.get('ann-demeulemeester')), ['ann demeulemeester', 'アンドゥムルメステール']);    // spaced and unspaced: one search
  A.deepEqual(queriesOf(BY_SLUG.get('dr-martens-x-rick-owens')), ['rick owens dr. martens']);
  A.deepEqual(queriesOf(BY_SLUG.get('tabi-footwear')), ['tabi footwear']);
  A.equal(queryPlan([BY_SLUG.get('guidi')]).length, 2);
});

// ── the brand-title check, many brands, look-alikes (EN · JA · KO) ─────────
await group('brands in titles: names, noisy words, look-alikes, several brands, big brands dated', () => {
  const C = [
    // English
    ['Rick Owens 2019SS Geobasket sneakers 42', ['rick-owens']], ['Rick Owens Geobasket sneakers 42', [], 'big-undated'],
    ['RICK OWENS DRKSHDW Ramones low', ['drkshdw']], ['Rick Owens DRKSHDW FW19 Larry Ramones', ['drkshdw']],
    ['rickowens drkshdw 2019ss', ['drkshdw']], ['Rick-Owens leather jacket FW08 Stag', ['rick-owens']],
    ['Guidi 988 back zip boots 42', ['guidi']], ['GUIDI x Rick Owens horse leather boots', ['guidi']],
    ['Boris Bidjan Saberi x Guidi boots', ['boris-bidjan-saberi', 'guidi']], ['Ann Demeulemeester lace up boots 39', ['ann-demeulemeester']],
    ['Comme des Garcons PLAY heart tee', ['comme-des-garcons-play']], ['Play Comme des Garcons cardigan', ['comme-des-garcons-play']],
    ['COMME des GARCONS HOMME PLUS AD2003 jacket', ['comme-des-garcons']], ['Noir Kei Ninomiya Comme des Garcons 2018AW top', ['comme-des-garcons-noir-kei-ninomiya']],
    ['Maison Margiela 2019SS Tabi boots 39', ['maison-margiela']], ['Maison Margiela Tabi ankle boots 39', [], 'big-undated'],
    ['Margiela Tabis 38', [], 'big-undated'], ['white cotton shirt 2004', [], 'no-brand'], ['both sides print tee', [], 'no-brand'], ['MM6 Maison Margiela 2015SS dress', [], 'excluded-designer'],
    ['Maison Martin Margiela H&M 2012 coat', [], 'excluded-designer'], ['Maison Margiela Replica GAT sneakers 2019', ['maison-margiela']],
    ['Balenciaga Triple S replica sneakers 2018', [], 'fake'], ['UNIQLO +J Jil Sander 2020AW down', [], 'excluded-designer'],
    ['Jil Sander 2004SS Raf Simons era coat', ['jil-sander']], ['See by Chloe 2012 bag', [], 'excluded-designer'],
    ['Chloe Paddington bag 2005', ['chloe']], ['McQ Alexander McQueen 2015 jacket', [], 'excluded-designer'],
    ['Alexander McQueen skull scarf 2008', ['alexander-mcqueen']], ['Y/Project 2018 denim', ['y-project']],
    ['my project bag', [], 'no-brand'], ['Celine Phoebe Philo 2014 luggage bag', ['celine']], ['marceline vintage coat 1998', [], 'no-brand'],
    ['Undercover 2003SS Scab jacket', ['undercover']], ['Undercover x Nike Gyakusou running jacket', [], 'big-undated'],
    ['GU x UNDERCOVER 2021 hoodie', [], 'excluded-designer'], ['Issey Miyake Pleats Please 1990s dress', [], 'big-undated'],
    ['Pleats Please Issey Miyake 2008 top', ['issey-miyake']], ["Yohji Yamamoto Y's for men 1990 coat", ['yohji-yamamoto']],
    ['Dr. Martens x Rick Owens 1460 boots', ['dr-martens-x-rick-owens']], ['Rick Owens Dr Martens 2021 boots', ['rick-owens', 'dr-martens-x-rick-owens']],
    ['1017 ALYX 9SM rollercoaster belt', ['1017-alyx-9sm']], ['Alyx chest rig bag', ['1017-alyx-9sm']], ['A-COLD-WALL* nylon jacket', ['a-cold-wall']],
    ['M.A+ leather boots', ['m-a-plus']], ['MA+ backpack', ['m-a-plus']], ['Werkstatt München ring', ['werkstatt-munchen']],
    ['Courrèges 1970s vinyl skirt', ['courreges']], ["Sofie D'hoore wool coat", ['sofie-d-hoore']], ['J.W. Anderson loafers', ['j-w-anderson']],
    ['Juun.J coat 48', ['juun-j']], ['ＧＵＩＤＩ ブーツ', ['guidi']],
    // noisy brands: the whole word, never inside another
    ['BOTH Paris Gao high sneakers 42', ['both']], ['bothersome tee', [], 'no-brand'], ['Herno down jacket', ['herno']], ['hernon jacket', [], 'no-brand'],
    ['sacai 2019AW bomber', ['sacai']], ['Peter Do blazer', ['peter-do']], ['peter dog collar', [], 'no-brand'], ['aalto knit', [], 'no-brand'],
    ['aaltonen chair', [], 'no-brand'], ['07A tee', ['07a']], ['rp07a1 tee', [], 'no-brand'],
    // the first day's reading (2026-10-20): Copernica, Copernicus and a Yu-Gi-Oh! set are not Coperni or Bode;
    // Poiret needs Paul Poiret or Paris written too (Liberty's Poiret print, a Japanese label, other houses' models)
    ['COPERNICA プレストパウダー', [], 'no-brand'], ['コペルニカ ミルク', [], 'no-brand'], ['コペルニクス 天文 本', [], 'no-brand'],
    ['Coperni Swipe bag 2022', ['coperni']], ['COPERNI Paris hoodie', ['coperni']], ['コペルニ ショルダーバッグ', ['coperni']],
    ['遊戯王 白の聖女エクレシア スーパー BODE', [], 'not-garment'], ['Bode quilted shirt', ['bode']],
    ['Merlette マーレットPOIRET ピンタックフレアスリーブ ロングドレス', [], 'title-must'], ['UNITED ARROWS libertyフラワースカート赤茶Poiret', [], 'title-must'],
    ['90s POIRET 前身頃 切り替え 総柄 長袖シャツ', [], 'title-must'], ['ポール ポワレ PAUL POIRET a Paris スパンコールワンピース', ['poiret']], ['Poiret Paris 2019 silk dress', ['poiret']],
    // looking like, not being
    ['Rick Owens style leather jacket 2020', [], 'style-of'], ['Rick Owens inspired boots 2020', [], 'style-of'], ['inspired by Rick Owens 2020 boots', [], 'style-of'],
    ['Guidi like boots', [], 'style-of'], ['Guidi like new boots', ['guidi']], ['Rick Owens type boots 2020', [], 'style-of'],
    ['Rick Owens type-2 boots 2020', ['rick-owens']], ['Not Rick Owens 2019 jacket', [], 'not-brand'], ['Rick Owens Style RO1234 2020', ['rick-owens']],
    // Japanese
    ['リックオウエンス 19SS レザージャケット 48', ['rick-owens']], ['リック オウエンス ブーツ', [], 'big-undated'], ['リックオウエンス風 2019 ブーツ', [], 'style-of'],
    ['マルジェラ好きな方に 2005 ニット', [], 'style-of'], ['ヨウジヤマモト コムデギャルソン 好きな方に 2010 シャツ', [], 'style-of'],
    ['エルメス マルジェラ期 2003 ニット', [], 'other-brand'], ['マルジェラ期 2003 ニット', [], 'period-of'], ['マルタンマルジェラ 本人期 ジャケット', [], 'big-undated'],
    ['メゾンマルジェラ 2019AW 足袋ブーツ', ['maison-margiela']], ['タビ ブーツ マルジェラ', [], 'big-undated'],
    ['グイディ バックジップ ブーツ 42', ['guidi']], ['ボリスビジャンサベリ グイディ ブーツ', ['boris-bidjan-saberi']], ['ボリスビジャンサベリ × グイディ ブーツ', ['boris-bidjan-saberi', 'guidi']],
    ['プレイコムデギャルソン Tシャツ', ['comme-des-garcons-play']], ['ユニクロ ジルサンダー +J 2021AW', [], 'excluded-designer'],
    ['リックオウエンスではありません 2019', [], 'not-brand'], ['元マルジェラ デザイナー 2010 コート', [], 'not-brand'],
    ['サカイ 2019AW ブルゾン', ['sacai']], ['サカイヤ 2019 ブルゾン', [], 'no-brand'], ['アンダーカバー 2003SS ジャケット', ['undercover']],
    ['エンジン アンダーカバー 2015年式', [], 'not-garment'], ['ディーゼル 2016 デニム', ['diesel']], ['セリーヌ 香水 2019', [], 'not-garment'],
    ['コムデギャルソン 雑誌掲載 2004AW ジャケット', ['comme-des-garcons']], ['ジュンヤワタナベ コムデギャルソン 2006AW パッチワーク', ['junya-watanabe']], ['COMME des GARCONS JUNYA WATANABE MAN 2006AW パッチワーク', ['junya-watanabe']],
    ['ﾘｯｸｵｳｴﾝｽ 2019SS ﾌﾞｰﾂ', ['rick-owens']],
    // Korean
    ['릭오웬스 19SS 가죽 자켓', ['rick-owens']], ['릭 오웬스 스타일 자켓 2019', [], 'style-of'], ['꼼데가르송 2005AW 셔츠', ['comme-des-garcons']],
    ['구이디 부츠 42', ['guidi']], ['앤드뮐미스터 부츠 39', ['ann-demeulemeester']], ['알릭스 벨트', ['1017-alyx-9sm']], ['구매) 릭오웬스 2019 자켓', [], 'wanted'],
    ['(렌탈) 사카이 2019 코트', [], 'rental'], ['메종마르지엘라 2019 타비', ['maison-margiela']], ['와이프로젝트 데님', ['y-project']],
    // not for sale, not real, not a garment
    ['グイディ ブーツ 様専用', [], 'reserved'], ['Guidi boots replica', [], 'fake'], ['Guidi boots not fake', ['guidi']],
    ['グイディ ブーツ 専用シューキーパー付き', ['guidi']], ['Guidi レコードバッグ', ['guidi']], ['Guidi ブーツ 空箱', [], 'not-garment'],
    ['Guidi boots CD', [], 'not-garment'], ['Guidi リップストップ ジャケット', ['guidi']], ['Rick Owens 2019 tractor boots', ['rick-owens']],
    ['Rick Owens engineer boots 2019', ['rick-owens']], ['Undercover 2001 engine parts', [], 'not-garment'],
  ];
  A.ok(C.length >= 100, 'cases ' + C.length);
  for (const [t, want, why] of C) {
    const r = brandsOf(t);
    A.deepEqual([...r.b].sort(), [...want].sort(), 'brands of ' + t);
    if (why) A.equal(r.why, why, 'why ' + t);
  }
  // a big brand's listing needs a year or a season, from every source; a small brand's does not
  A.deepEqual(brandsOf('Rick Owens jacket', ['rick-owens']).b, []);
  A.deepEqual(brandsOf('Rick Owens 05AW jacket', ['rick-owens']).b, ['rick-owens']);
  A.deepEqual(brandsOf('Rick Owens jacket 1990s', ['rick-owens']).b, []);
  A.deepEqual(brandsOf('jacket', ['guidi']).b, ['guidi']);
  // a filed listing keeps its brand when another of ours is named "…風"; on a search page the whole title goes
  A.deepEqual(brandsOf('Boris Bidjan Saberi boots rick owens style', ['boris-bidjan-saberi']).b, ['boris-bidjan-saberi']);
  A.deepEqual(brandsOf('Boris Bidjan Saberi boots rick owens style').b, []);
  // …and "style" after a list of names is said of all of them
  A.deepEqual(brandsOf('Boris Bidjan Saberi rick owens style boots', ['boris-bidjan-saberi']).b, []);
  A.deepEqual(brandsOf('Rick Owens style boots 2019', ['rick-owens']).b, []);
});

// ── who made it: the first house named, keywords, collaborations, lines (titles of 2026-10-19) ──
await group('brands in titles: the house named first made it; the rest are keywords unless joined', () => {
  const C = [
    // a name after the maker's is a word added for search
    ['18ss 定価46200円 JULIUS ユリウス チェック シャツ size2 incarnation guidi rick owens yohji yamamoto', [], 'other-brand'],
    ['JULIUS シャークソールレザーシューズ ブーツ 2 ユリウス 黒 Rick Owens リックオウエンス DRKSHDW Yohji Yamamoto GUIDI Viridi-anne', [], 'other-brand'],
    ['新品未使用 定価15万 JUUN.J Washed Denim Wide Pants professor E ziggy chen バレンシアガ guidi ワイドフレア', ['juun-j']],
    ['UMA WANG 18AW ユマワン ドッキングバルーンパンツ 美品 アルチザン BORIS ボリス Paul Harnden ポールハーデン', ['uma-wang']],
    ['UMA WANG 18AW ユマワン ドッキングバルーンパンツ ヨウジヤマモト', ['uma-wang']],
    ['ZIGGY CHEN 22AW ジャケット 50 uma wang paul harnden archivio j.m ribot', [], 'other-brand'],
    ['m.a＋ エムエークロス バッグ guidi a1923 carol christian poell', ['m-a-plus']],
    ['m.a+ snale bag エムエークロス スネイルバッグ Boris Bidjan Saberi', ['m-a-plus']],
    ['GUIDI Hiking Boots ハイキングブーツ 42 1/2 C-Diem CCP m.a+ グイディ', ['guidi']],
    ['guidi PL1V 新品未使用 ブーツ レザー ユリウス エムエークロス', ['guidi']],
    ['Paul Harnden ポールハーデン ショルダーハンドバッグ/bag鞄 カルペディエム guidi エレナドーソン Geoffrey B.Smallmaクロスtoogood', ['paul-harnden']],
    ['¥198000 yohji yamamoto アシンメトリーパッチワークブーツ dior homme/rick owens/damir doma/maison margiela/guidi/drkshdw/santoni', [], 'big-undated'],
    ['90’s Jean Paul Gaultier Homme ゴルチエ Student-Style Collared Wool Sweater JPG アーカイブ rick owens archive Ann demeulemeester', [], 'other-brand'],
    // another house's piece in Guidi leather is that house's
    ['【名作】DEVOA デヴォア GUIDI グイディ レザー サイドジップ アンクル ブーツ 43', [], 'other-brand'],
    ['[Incarnation] GUIDI exclusive BANDNECK OILCALF オイルカーフ グイディレザージャケット ライダース S イタリア製', [], 'other-brand'],
    ['The Viridi-anne / ザ・ヴィリジアン Derby Shoes ダービーシューズ GUIDIレザー メンズ サイズ : 1 ブラック', [], 'other-brand'],
    ['ISAMUKATAYAMA GUIDI オイルカーフ ウォレット ブラック', [], 'other-brand'],
    ['BONUM Cyrillus リメイク 再構築 ショートミリタリーシャツ エムエークロス リックオウエンス', [], 'other-brand'],
    ['新品 カンペール トルメンタ ブラック 黒 42 Camper Tormenta 27 スニーカー/ミハラヤスヒロ/リックオウエンス/バレンシアガ/アミリ', [], 'other-brand'],
    // three houses or more after the description: a seller's keywords, nobody's
    ['ARTEFACT backlash guidi incarnation', [], 'brand-list'],
    ['Attachment レザーブレスレット guidi julius yohji', [], 'brand-list'],
    ['yoshio kubo 足袋 ブーツ 靴 マルジェラ comoli guidi', [], 'brand-list'],
    ['dunhill ダンヒル メガネフレーム べっ甲柄 レッド系 ヴィンテージ dior gucci guidi FENDI', [], 'brand-list'],
    ['スニーカー/ミハラヤスヒロ/リックオウエンス/バレンシアガ', [], 'brand-list'],
    ['【美品】GUIDI グイディ / CCP / m.a+ バックジップ ブーツ 42', ['guidi']],
    ['ierib backlash guidi incarnation strum ma+', [], 'other-brand'],
    // Piero Guidi is another house, in every script; a zebra is not Uma Wang
    ['PIERO GUIDI ハンドバッグ サーカス柄', [], 'other-brand'], ['ピエログイディ 長財布 マジックサーカス ラウンドファスナー型', [], 'other-brand'],
    ['♥♥14362 PIEROGUIDI ピエログイディ マジックサーカス ポーチ 未使用♥♥', [], 'other-brand'], ['美品【ピエログイディ】2wayミニボストンバッグ', [], 'other-brand'],
    ['ピエロ・グイディ トートバッグ', [], 'other-brand'],
    ['ピーエスポールスミス PS Paul Smith ポロシャツ シマウマ ワンポイント 鹿の子 半袖 XL 黒 メンズ', [], 'other-brand'],
    ['シマウマワンピース 6月まで', [], 'no-brand'], ['ユーエスポロアッスン ロゴ 刺繍 半袖 グレー Tシャツ ウマ ワンポイント L', [], 'no-brand'],
    ['UMA WANG / ユマワン | TAB TOP シャツ_長袖 UM1502', ['uma-wang']], ['ユマ・ワン UMA WANG 21SS イージーパンツ', ['uma-wang']],
    ['ユマワン ロングコート', ['uma-wang']], ['ウマワン カシミヤ ワンピース', ['uma-wang']],
    ['グイディサイドゴアブーツ ブラック Vibramソール', ['guidi']], ['GUIDI(グイディ) 988 バックジップ', ['guidi']],
    // joined: a collaboration word, the same house written twice, a line with its house
    ['guidi × alyx フロントジップ ブーツ 42 グイディ レザー コラボ', ['guidi', '1017-alyx-9sm']],
    ['Rick Owens x Dr. Martens コラボレーション ブーツ 28cm 26年製 STEEL TOE QUAD', ['dr-martens-x-rick-owens', 'rick-owens']],
    ['リックオウエンスRick Owens×Dr.Martensドクターマーチン1461BEX3ホール厚底黒', ['dr-martens-x-rick-owens']],
    ['DRKSHDW by Rick Owens ダークシャドウバイリックオウエンス 2007SS コットントラッカージャケット', ['drkshdw']],
    ['正規品 25fw RICK OWENS drkshdw リックオウエンス ダークシャドウ スニーカー sneaks サイズ41', ['drkshdw']],
    ['未使用品 ダークシャドウ DRKSHDW RICK OWENS 25AW JUMBO TABARD BLACK', ['drkshdw']],
    ['Rick Owens Moncler 2020AW down jacket', ['rick-owens']], ['Rick Owens x Moncler 2020AW down jacket', ['rick-owens', 'moncler']],
    ['Converse x DRKSHDW TURBOWPN high', ['drkshdw']], ['DRKSHDW CONVERSE TURBOWPN', ['drkshdw']],
    // Guidi is also a tannery: GUIDIレザー with another house named is that house's piece
    ['FG415 GUIDIコードヴァンレザーシューズ / F.LLI. Giacometti(フラテッリジャコメッティ) D-00595', [], 'material-of'],
    ['最終値下げ GUIDI グイディ ホースレザー 限定 バックパック リュック 馬革 キャロルクリスチャンポエル CAROL CHRISTIAN POELL', ['guidi']],
    ['GUIDIレザー トートバッグ', ['guidi']], ['BACKLASH GUIDIレザーコインケース', [], 'other-brand'],
    ['【CTHY】GUIDI LEATHER ANONYMOUS WALLET', [], 'other-brand'], ['3S5411/wjk center seam backzip boots 8321 GUIDI VITTERO FIORE', [], 'other-brand'],
    ['美品 10sei0otto ディエチセイゼロオット オーバーロック レースアップブーツ 42 DIECISEIZEROOTTO GUIDI メンズ', [], 'other-brand'],
    // two houses that end a title after its description are keywords too
    ['entire studios パンツ guidi devoa', [], 'other-brand'], ['レザー パンツ guidi devoa', [], 'brand-list'], ['レザー パンツ guidi 42', ['guidi']],
    ['2WAY レザーボストンバッグ トートバッグ / GUIDI(グイディ) D-01086', ['guidi']], ['GUIDI × nonnative × UNDERCOVER ビッグダディブーツ 42', ['guidi']],
    ['新品CONVERSE×RICK OWENS ダークシャドウ (DRKSHDW)', ['drkshdw']],
    // a look-alike word covers the list it follows
    ['ブーツ guidi ccp 好きな方に', [], 'style-of'], ['GUIDI 988 バックジップ ccp好きな方に', ['guidi']],
  ];
  A.ok(C.length >= 50, 'cases ' + C.length);
  for (const [t, want, why] of C) {
    const r = brandsOf(t);
    A.deepEqual([...r.b].sort(), [...want].sort(), 'brands of ' + t);
    if (why) A.equal(r.why, why, 'why ' + t);
  }
  // a filed listing: another house named first, or only another house, or a comparison, takes it away
  const F = [
    ['Rick Owens x Moncler SS26 Cyclopic Down Puffer Jacket', ['rick-owens', 'moncler'], ['rick-owens', 'moncler']],
    ['FW20 Thigh High Stocking Socks dust OneSize', ['moncler'], ['moncler']],
    ['1017 Alyx 9SM Guidi Zipper Boots Pink Suede', ['1017-alyx-9sm', 'guidi'], ['1017-alyx-9sm', 'guidi']],
    ['1017 Alyx 9SM Guidi Zipper Boots Pink Suede', ['guidi'], []],
    ['Guidi x StyleZeitgeist ER01V Bison Leather Combat Boots', ['guidi'], ['guidi']],
    ['Leather Mens Boots AS 98 Style Rick Owens Meltal Zip Italy', ['guidi'], []],
    ['Avant garde moto Yohji Yamamoto style leather boots hype', ['guidi'], []],
    ['992.Like Boris Bidjan Saberi or Paul Harnden', ['guidi'], []],
    ['Maxim Sharov waist bag. Like Isaac Reina bags', ['guidi'], []],
    ['Versace Brown Leather Vintage Boots Luxury Streetwear Style', ['guidi'], []],
    ['Punk Avantgarde A.S. 98 Airsteps Style Ankle Boots Y2K Guidi', ['guidi'], []],
    ['Gothic opium platform boots new Rock style avant garde', ['guidi'], []],
    ['Moto studded suede boots guidi suede boots punk style', ['guidi'], ['guidi']],
    ['Leather Suede Boots 42', ['guidi'], ['guidi']],
    ['Rick Owens Drkshdw 23SS Vans Inspired Suede', ['rick-owens'], ['drkshdw']],
    ['Rick Owens 24FW Flame Vans‑Style Low', ['rick-owens'], ['rick-owens']],
    ['Uma Wang 23 Floral Shorts L Cupro Viscose Silk-like', ['uma-wang'], ['uma-wang']],
    ['Mask terry top.Like Paul Harnden or Archivio J.M. Ribot', ['uma-wang'], []],
    ['Piero Guidi Magic Circus tote', ['guidi'], []],
    ['ZIGGY CHEN jacket 50', ['uma-wang'], []],
  ];
  for (const [t, des, want] of F) A.deepEqual([...brandsOf(t, des).b].sort(), [...want].sort(), 'filed ' + des + ': ' + t);
  A.deepEqual(grailedDesignated(['Piero Guidi'], []), []); A.deepEqual(grailedDesignated(['Guidi', 'Piero Guidi'], ['guidi']), []);
});

// ── reading years, seasons, sizes ──────────────────────────────────────────
await group('titles: years from 1950 to this year, seasons, decades, claims, numbers that are not years', () => {
  const R = (t) => { const r = era(t); return r.tier + (r.era ? ' ' + r.era : r.claim ? ' ' + r.claim : ''); };
  const E = [['Courreges 1968 dress', 'A 1968'], ['Issey Miyake AW1985 coat', 'A 1985'], ['ヨウジヤマモト 1985秋冬 コート', 'A 1985'],
    ['Comme des Garcons 80s jacket', 'B 1980년대'], ['コムデギャルソン 80年代 ジャケット', 'B 1980년대'], ['1949 vintage coat', 'C'],
    ['AD1994 COMME des GARCONS', 'A 1994'], ['マルタンマルジェラ 本人期 ジャケット', 'B 본인기'], ['Guidi 20年以上前 ブーツ', 'C'], ['Guidi 10年保管 ブーツ', 'C'],
    ['Guidi 85AW', 'C'], ['Rick Owens AW05 Object leather jacket', 'A AW05'], ['Rick Owens FW04 boots size 9', 'A FW04'],
    ['Jil Sander SS 2003 shirt', 'A SS03'], ['Yohji 2004 AW trousers IT 48', 'A AW04'], ['Vintage 90s Helmut coat', 'B 1990년대'],
    ['Margiela F/W 2006-07 parka', 'A FW06'], ['Margiela AW 99/00 coat 50', 'A AW99'], ['Undercover a/w 2001-2002 jacket', 'A AW01'],
    ['Celine 2010s bag', 'B 2010년대'], ['Guidi 988 boots size 10-11', 'C'], ['Guidi 2008‐9 リング', 'B 2008–09'], ['Margiela 1998-1999 コート48', 'B 1998–1999'],
    ['Guidi 00s アーカイブ ブーツ', 'B 2000년대'], ['Guidi archive boots', 'B 아카이브'], ['Guidi 初期 ブーツ', 'B 초기'], ['Guidi 2003年購入 ブーツ', 'B 2003년 구입'],
    ['Guidi 1999年頃 ブーツ', 'B 1999년 무렵'], ['Guidi Y2K boots', 'B Y2K'], ['Guidi 1998 1999 boots', 'B 1998 · 1999'],
    ['Guidi RRP £1995 coat', 'C'], ['Guidi retail €2000 jacket', 'C'], ['Guidi boots 2000€', 'C'], ['Guidi 2000$ boots', 'C'],
    ['グイディ ブーツ 送料込み 2000', 'C'], ['Guidi No.2003 jacket', 'C'], ['グイディ 品番 2019 ブーツ', 'C'], ['グイディ 平成11年 ブーツ', 'C'],
    ['Guidi 2004 ¥98,000', 'A 2004'], ['Guidi 2003 $1,200', 'A 2003'], ['Guidi 送料無料 2004AW ジャケット', 'A AW04'], ['２００１ＳＳ グイディ シャツ', 'A SS01'],
    ['Guidi P/E 2002 top', 'A SS02'], ['Guidi 96〜97AW jacket', 'A AW96'], ["Guidi A/W '98-'99 coat", 'A AW98'], ['Guidi 99春夏 シャツ', 'A SS99'],
    ['Guidi 2015年式', 'C'], ['Guidi S/S 36 tee', 'C']];
  for (const [t, want] of E) A.equal(R(t), want, t);
  const y = lastYear();
  A.equal(R('Guidi ' + y + ' boots'), 'A ' + y); A.equal(R('Guidi ' + (y + 1) + ' boots'), 'C');   // this year, not next
  A.equal(era('マルタンマルジェラ 本人期').claimKind, 'early');
  A.equal(size('Guidi Prosthetic Zip Boot UK 8', '신발'), 'UK 8'); A.equal(size('Guidi 2004 AW Bias Cut Trousers IT 48', '팬츠'), 'IT 48');
  A.equal(size('グイディ ブーツ 04年製', '신발'), null); A.equal(size('구이디 부츠 5년 사용', '신발'), null); A.equal(size('グイディ ブーツ 9 04年製', '신발'), '9');
  A.equal(size('[50]구이디 레더 자켓'), '50'); A.equal(size('Guidi boots 27cm', '신발'), '27cm'); A.equal(size('Guidi jacket 46/48'), '46/48');
  const sec = (t) => classify({ title: t }).section;
  A.deepEqual(['Guidi PM/2219 Dress Pants ドレスパンツ', '90年代 Guidi ブレーザー', 'S/S2007 Guidi -Button Ups', 'Guidi ハイネックレザー', 'Guidi High Neck knit',
    'Guidi dress', 'Guidi dress shoes', 'Guidi T-Shirt 48', 'Guidi vest bag', 'Guidi shirt jacket'].map(sec),
    ['팬츠', '테일러링', '셔츠', '아우터', '상의', '기타', '신발', '상의', '가방·소품', '아우터']);
  // a sneaker named by its cut (PC trial 10/19: 153 of them filed under tops, one under jewellery)
  A.deepEqual(['Rick Owens DRKSHDW Canvas High Top BFAJKKZG', 'Rick Owens DRKSHDW 23SS Eyelet Ring High Top Sneakers K37', 'Sz 43 Rick Owens Drkshdw Archive Nylon Hi-Top mo.jos',
    'Rick Owens DRKSHDW Milk Low Top Ramones', 'Rick Owens DRKSHDW Black Satin High-Tops', 'リックオウエンス ダークシャドウ ハイカット 42', 'Guidi Mid-Top', '릭오웬스 다크쉐도우 하이탑',
    'Rick Owens tank top', 'Rick Owens crop top', 'Uma Wang knit top', 'Rick Owens DRKSHDW hoodie'].map(sec),
    ['신발', '신발', '신발', '신발', '신발', '신발', '신발', '신발', '상의', '상의', '상의', '상의']);
  A.equal(classify({ title: 'Guidi High Neck', cat: 'ジャケット/アウター(レザージャケット)' }).section, '아우터');
  A.equal(classify({ title: 'Guidi', cat: 'トップス(Tシャツ/カットソー(七分/長袖))' }).section, '상의');
  for (const t of ['Guidi リング 専用ケース付き', 'Guidi ジャケット 保存袋 専用ハンガー付き', 'Guidi 専用袋 箱付き ブーツ', 'Guidi coat with fake fur collar',
    '구이디 부츠 정품 가품시 환불', '구이디 가품 아님', '구이디 부츠 (가품X)', 'Guidi ブーツ 偽物ではありません', 'Guidi boots 雑誌掲載', 'Guidi 紙袋付き ブーツ'])
    A.equal(excludeReason(t), null, t);
  for (const [t, why] of [['【たろう専用】Guidi ブーツ', 'reserved'], ['Guidi ブーツ 専用です', 'reserved'], ['Guidi レプリカ ブーツ 本物ではありません', 'fake'],
    ['Guidi perfume 50ml', 'not-garment'], ['Guidi eau de parfum', 'not-garment'], ['ブランド不明 ブーツ', 'not-brand'], ['WTB guidi boots', 'wanted']])
    A.equal(excludeReason(t), why, t);
  A.equal(excludeReason('Maison Margiela Replica sneakers', { replicaLine: true }), null);
  // printed matter, skin care, trading cards, sheet music (the first day's reading, 2026-10-20) — and what stays
  const ex = (t, cat) => classify({ title: t, cat }).exclude || null;
  for (const t of ['Rick Owens Lookbook - FW15 Mens Sphinx', 'Issey Miyake Men autumn /winter 2016 catalog lookbook', 'Rick Owens Rizzoli Hardcover Book 2011',
    'アンダーカバー 非売品 2018ss ルックブック メンズ', 'ヨウジヤマモト 2023年 秋冬コレクション カタログ', 'FORNASETTI 洋書', 'Paul Poiret and Mariano Fortuny 図録',
    '●ポワレ M´EMOIRE DE LA MODE 光琳社', 'MEMOIRE DE LA MODE POIRET ポワレ', 'コペルニカ 化粧水', '遊戯王 白の聖女エクレシア スーパー BODE', '楽譜 ピアノソロ ショパン ノクターン集 Zimmermann編'])
    A.equal(ex(t), 'not-garment', t);
  for (const [t, cat] of [['Undercover SS13 Lookbook Leopard Panel Shirt'], ['Undercover AW03 Catalogue Wallet'], ['SACAI 2023 book shelf print pleated dress JP1 S'],
    ['Dries Van Noten FW22 Lookbook Leopard Print Merino Wool Card', 'top'], ['コムデギャルソン カタログ掲載 2004AW ジャケット'], ['A Cold Wall Foundation T-Shirt Big Logo Pink'],
    ['Juun.J ファンデーション ベースボールキャップ'], ['Bode Color Book Blanket Stitch Shirt'], ['展覧会限定 Tシャツ Yohji Yamamoto']])
    A.equal(ex(t, cat), null, t);
});
await group('titles: 354 real titles (CCP, 2026-09-27) read the same, and no year out of range', () => {
  const corpus = JSON.parse(readFileSync(new URL('./test_corpus.json', import.meta.url), 'utf8')).items;
  const R = (t) => { const r = era(t); return r.tier + (r.era ? ' ' + r.era : r.claim ? ' ' + r.claim : ''); };
  const got = (t) => { const it = corpus.find((x) => x.title.includes(t)); A.ok(it, 'not in corpus: ' + t); return R(it.title); };
  const X = { '07SS ツイストシャツ': 'A SS07', '2006SS Carol': 'A SS06', 'AW2002 Carol Christian Poell ATTRACTION': 'A AW02', '極美品 2009': 'A 2009',
    '2005SS GM/2027': 'A SS05', '96-97 CAROL': 'B 1996–97', '01AW レザー テーラードジャケット サイズ46': 'A AW01', '希少 90s CAROL': 'B 1990년대',
    'サイズ:44 98AW': 'A AW98', '06AW ラミー セットアップ': 'A AW06', '/2017 IN-BETWEEN': 'A 2017', 'GM/2656OD-IN BETWEEN-PTC2 2018': 'A 2018',
    'SS08 OFF-SCENE AM/2441': 'A SS08', 'S/S97 REF.N 0362': 'A SS97', 'P/E 2002 TM1622SIT': 'A SS02', 'カンガルーレザー 長袖シャツ 00-01 ベージュ アイボリー': 'B 2000–01',
    '2008‐9 釘 スパイラル': 'B 2008–09', '00s アーカイブ Goodyear Derby': 'B 2000년대', '02SS CAROL CHRISTIAN POELL コットン タンクトップ': 'A SS02',
    '２００１ＳＳ リバーシブルワッフルシャツ': 'A SS01', '08SS コードバン ラバーバンド ブーツ 56': 'A SS08', 'CCP 97-98 A/W 트라우저': 'A AW97',
    '参考上代998800円 Carol Christian Poell 25AW': 'A AW25', '【銀週間割引】キャロルクリスチャンポエルJK(96〜97AW': 'A AW96',
    'CAROL CHRISTIAN POELL 1998-1999 レザーコート48': 'B 1998–1999', 'Martin Margiela 本人期': 'B 본인기', 'OVERLOCK DEADEND JACKET 48': 'C' };
  for (const [t, want] of Object.entries(X)) A.equal(got(t), want, t);
  for (const it of corpus) { const r = era(it.title); if (r.era) {
    const y = /^\d{4}$/.test(r.era) ? +r.era : (+r.era.slice(2) >= 90 ? 1900 : 2000) + +r.era.slice(2);
    A.ok(y >= 1950 && y <= lastYear(), 'era out of range: ' + it.title); } }
  // the corpus's neighbours of CCP that are brands of ours are theirs
  A.deepEqual(brandsOf(corpus.find((x) => x.title.includes('GUIDI グイディ ホースレザー 限定 バックパック')).title).b, ['guidi']);
});

// ── the ledger over days ─────────────────────────────────────────────────
await group('ledger: four days — added, price cut, missing once, gone, failed source, sold badge, held reading', () => {
  const mk = (id, t, p, cur = 'JPY', extra = {}) => ({ id, url: 'https://example.invalid/' + id, title: t, price: p, cur, qs: ['guidi'], ...extra });
  const y1 = [mk('yahoo:a1', 'GUIDI 988 BACK ZIP BOOTS 42', 300000), mk('yahoo:a2', 'GUIDI PL2 derby 42', 200000), mk('yahoo:a3', 'Paul Smith シャツ', 50000),
              mk('yahoo:m1', 'Boris Bidjan Saberi x Guidi boots 42', 250000)];
  for (let i = 0; i < 25; i++) y1.push(mk('yahoo:f' + i, 'GUIDI ホースレザー ジャケット 4' + (i % 2 ? '6' : '8') + ' #' + i, 30000 + i));
  const r1 = [mk('rakuma:b1', 'GUIDI 988 BACK ZIP BOOTS 42', 310000)];
  const f1 = [mk('ff:c1', 'Guidi back zip boots 42', 3100000, 'KRW', { d: ['guidi'], qs: ['bp:guidi'] })];
  const closed = [mk('yahoo:s1', 'GUIDI 988 ブーツ 42', 171000, 'JPY', { sold: true, soldAt: '2026-08-20', soldKind: '낙찰' }),
                  mk('yahoo:s2', 'GUIDI 988 BACK ZIP BOOTS 42', 221000, 'JPY', { sold: true, soldAt: '2026-09-21' }), mk('yahoo:s3', 'Paul Smith シャツ', 1000, 'JPY', { sold: true, soldAt: '2026-09-21' })];
  const D = { done: { guidi: true } };
  const L = { v: 1, items: {}, state: {} }, SOLD = { v: 1, items: {} };
  let st = updateLedger(L, { yahoo: { items: y1, ...D }, rakuma: { items: r1, ...D }, fruits: { items: f1, done: { 'bp:guidi': false } }, yahoo_sold: { items: closed } },
    { sources: { yahoo: okS(), rakuma: okS(), fruits: okS(1, { complete: false }), yahoo_sold: okS() } }, rates, '2026-09-28');
  A.equal(updateSold(SOLD, { yahoo_sold: { items: closed } }, { sources: { yahoo_sold: okS() } }, rates, '2026-09-28'), 2);
  A.equal(st.added, 30); A.equal(L.items['yahoo:a3'], undefined); A.equal(SOLD.items['yahoo:s3'], undefined);        // not ours: never enters
  A.deepEqual(L.items['yahoo:m1'].b, ['boris-bidjan-saberi', 'guidi']);                                           // one entry, two brands
  A.deepEqual([L.items['ff:c1'].d, L.items['yahoo:a1'].qs, SOLD.items['yahoo:s2'].b], [['guidi'], ['guidi'], ['guidi']]);
  const first = Object.fromEntries(Object.values(L.items).map((x) => [x.id, x.first]));
  // day 2: yen cut on a1; a2 missing once; rakuma failed; the exchange rate moved (no price move follows from it)
  const y2 = y1.filter((x) => x.id !== 'yahoo:a2' && x.id !== 'yahoo:a3').map((x) => (x.id === 'yahoo:a1' ? { ...x, price: 280000 } : x));
  y2.push(mk('yahoo:a4', 'GUIDI 2004AW レザージャケット 48', 400000));
  const rates2 = { ...rates, JPY: 900 };
  st = updateLedger(L, { yahoo: { items: y2, ...D }, fruits: { items: [], done: {} } },
    { sources: { yahoo: okS(), rakuma: { ok: false, error: 'HTTP 500' }, fruits: okS(0, { complete: false }) } }, rates2, '2026-09-29', { yahoo: '2026-09-28', rakuma: '2026-09-28' });
  A.equal(st.changed, 1); A.equal(st.drops, 1);
  A.deepEqual(L.items['yahoo:a1'].h.map((p) => p[2]), [300000, 280000]);
  A.deepEqual([L.items['yahoo:a2'].gone, L.items['yahoo:a2'].miss], [null, 1]);
  A.deepEqual([L.items['rakuma:b1'].last, L.items['rakuma:b1'].gone], ['2026-09-28', null]);       // failed source: not observed
  A.equal(L.items['ff:c1'].gone, null);                                                             // a brand page never vanishes anything
  // day 3: a2 missing twice → gone; a1 shows a sold badge → gone
  const y3 = y2.map((x) => (x.id === 'yahoo:a1' ? { ...x, sold: true } : x));
  updateLedger(L, { yahoo: { items: y3, ...D } }, { sources: { yahoo: okS() } }, rates2, '2026-09-30', { yahoo: '2026-09-29' });
  A.deepEqual([L.items['yahoo:a2'].gone, L.items['yahoo:a2'].ls, L.items['yahoo:a1'].gone], ['2026-09-30', '2026-09-28', '2026-09-30']);
  for (const [id, f] of Object.entries(first)) A.equal(L.items[id].first, f, 'first-seen moved: ' + id);
  // a reading that brings back far fewer of yesterday's listings says nothing vanished
  st = updateLedger(L, { yahoo: { items: y3.slice(0, 5), ...D } }, { sources: { yahoo: okS() } }, rates2, '2026-10-01', { yahoo: '2026-09-30' });
  A.deepEqual(st.held, ['yahoo']); A.equal(Object.values(L.items).filter((x) => x.gone).length, 2);
  // the payload of the day before
  const P = buildPayload(L, SOLD, rates2, { sources: { yahoo: okS() } }, { day: '2026-09-30', issue: 3, fresh: new Set(['yahoo:a4']), brand: BY_SLUG.get('guidi') });
  const a4 = P.items.find((o) => o.l.endsWith('yahoo:a4'));
  A.deepEqual([a4.n, a4.e, a4.s, a4.z, P.counts.fresh], [1, 'AW04', '아우터', '48', 1]);
  A.equal(P.items.find((o) => o.l.endsWith('yahoo:a1')).x, 1);
  A.equal(P.items.filter((o) => o.so).length, 2);
  A.deepEqual(P.brand, { s: 'guidi', n: 'Guidi', big: false });
  A.ok(P.items.every((o) => !('__id' in o) && !('__ids' in o)));
  // the two-brand listing is in both rooms; a brand with nothing is empty
  A.ok(buildPayload(L, SOLD, rates2, { sources: {} }, { day: '2026-09-30', brand: BY_SLUG.get('boris-bidjan-saberi') }).items.some((o) => o.l.endsWith('yahoo:m1')));
  A.equal(buildPayload(L, SOLD, rates2, { sources: {} }, { day: '2026-09-30', brand: BY_SLUG.get('uma-wang') }).items.length, 0);
  A.equal(toKRW(100, 'JPY', { JPY: 873 }), 873); A.equal(toKRW(10, 'USD', { USD: 1370 }), 13700);
});
await group('ledger: only searches read to the end vanish anything; ended auctions end; links count as seen', () => {
  const it = (id, qs, extra = {}) => ({ id, url: 'https://example.invalid/' + id, title: 'GUIDI boots ' + id, price: 1000, cur: 'JPY', qs, ...extra });
  const L = { items: {}, state: {} }, ok = { sources: { yahoo: okS() } };
  const past = new Date(Date.now() - 3 * 864e5).toISOString(), soon = new Date(Date.now() + 3 * 864e5).toISOString();
  updateLedger(L, { yahoo: { items: [it('yahoo:w', ['guidi']), it('yahoo:p', ['グイディ']), it('yahoo:b', ['guidi', 'グイディ']), it('yahoo:o', ['uma wang']),
    it('yahoo:e', ['グイディ'], { endsAt: past, endsPrec: 'h' }), it('yahoo:s', ['グイディ'], { endsAt: soon, endsPrec: 'h' })], done: { guidi: true, グイディ: false, 'uma wang': true } } },
    ok, rates, '2026-10-01', {});
  // the next day nothing is seen: guidi read to the end, グイディ cut short, uma wang not searched
  updateLedger(L, { yahoo: { items: [], done: { guidi: true, グイディ: false } } }, ok, rates, '2026-10-02', { yahoo: '2026-10-01' });
  A.deepEqual(['yahoo:w', 'yahoo:p', 'yahoo:b', 'yahoo:o'].map((id) => L.items[id].miss), [1, 0, 0, 0]);
  A.deepEqual([L.items['yahoo:e'].gone, L.items['yahoo:s'].gone], ['2026-10-02', null]);       // its stated end has passed
  updateLedger(L, { yahoo: { items: [], done: { guidi: true } } }, ok, rates, '2026-10-03', { yahoo: '2026-10-02' });
  A.deepEqual([L.items['yahoo:w'].gone, L.items['yahoo:o'].gone, L.items['yahoo:b'].gone], ['2026-10-03', null, null]);
  // a listing whose card lost its price stays seen; a listing whose title turns into 専用 is hidden, kept
  const L2 = { items: {}, state: {} };
  const Y = Array.from({ length: 10 }, (_, i) => it('yahoo:u' + i, ['guidi']));
  updateLedger(L2, { yahoo: { items: Y, linked: Y.map((x) => x.id), done: { guidi: true } } }, ok, rates, '2026-10-01', {});
  for (const d of ['2026-10-02', '2026-10-03']) updateLedger(L2, { yahoo: { items: [...Y.slice(0, 7), { ...Y[7], title: 'GUIDI boots ○○様専用' }], linked: Y.map((x) => x.id), done: { guidi: true } } }, ok, rates, d, { yahoo: '2026-10-01' });
  A.deepEqual([L2.items['yahoo:u9'].gone, L2.items['yahoo:u9'].last, L2.items['yahoo:u7'].ex], [null, '2026-10-03', 'reserved']);
  // a small source that sold two of six: a market, not a reading — they go after two misses
  const R = (n) => Array.from({ length: n }, (_, i) => ({ id: 'rakuma:' + i, url: 'https://item.fril.jp/' + i, title: 'GUIDI シャツ ' + i, price: 10000, cur: 'JPY', qs: ['guidi'] }));
  const okR = { sources: { rakuma: okS() } };
  let L3 = { items: {}, state: {} };
  updateLedger(L3, { rakuma: { items: R(6), done: { guidi: true } } }, okR, rates, '2026-10-01', {});
  let st = updateLedger(L3, { rakuma: { items: R(4), done: { guidi: true } } }, okR, rates, '2026-10-02', { rakuma: '2026-10-01' });
  A.deepEqual([st.held, L3.items['rakuma:5'].miss], [[], 1]);
  // half of thirty missing at once: held, with its baseline, for three days — then taken as it is
  L3 = { items: {}, state: {} };
  updateLedger(L3, { rakuma: { items: R(30), done: { guidi: true } } }, okR, rates, '2026-10-01', {});
  for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) {
    st = updateLedger(L3, { rakuma: { items: R(15), done: { guidi: true } } }, okR, rates, d, { rakuma: '2026-10-01' });
    A.deepEqual([st.held, L3.items['rakuma:20'].gone], [['rakuma'], null], d);
  }
  st = updateLedger(L3, { rakuma: { items: R(15), done: { guidi: true } } }, okR, rates, '2026-10-05', { rakuma: '2026-10-01' });
  A.deepEqual([st.held, L3.items['rakuma:20'].miss], [[], 1]);
  // a second reading on the same day corrects that day's price; the day after is compared as usual
  const L4 = { items: {}, state: {} };
  const r = (price) => ({ rakuma: { items: [{ id: 'rakuma:x1', url: 'https://item.fril.jp/x1', title: 'GUIDI 988 BOOTS 42', price, cur: 'JPY', qs: ['guidi'] }], done: { guidi: true } } });
  updateLedger(L4, r(1082400), okR, rates, '2026-09-28');
  st = updateLedger(L4, r(98000), okR, rates, '2026-09-28');
  A.deepEqual([st.drops, L4.items['rakuma:x1'].h.length, L4.items['rakuma:x1'].p], [0, 1, 98000]);
  st = updateLedger(L4, r(90000), okR, rates, '2026-09-29', { rakuma: '2026-09-28' });
  A.deepEqual([st.drops, L4.items['rakuma:x1'].h.length], [1, 2]);
  const P = buildPayload(L4, { items: {} }, rates, okR, { day: '2026-09-29', brand: BY_SLUG.get('guidi') });
  A.equal(P.items[0].w, toKRW(98000, 'JPY', rates), 'the cut is measured from the corrected figure');
  // the second look at 후루츠패밀리 listings
  const L5 = { items: {}, state: {} };
  updateLedger(L5, { fruits: { items: [{ id: 'ff:a', url: 'https://fruitsfamily.com/product/a/', title: '백집 부츠', price: 900000, cur: 'KRW', d: ['guidi'], qs: ['bp:guidi'] },
    { id: 'ff:b', url: 'https://fruitsfamily.com/product/b/', title: '부츠', price: 800000, cur: 'KRW', d: ['guidi'], qs: ['bp:guidi'] }], done: {} } }, { sources: { fruits: okS() } }, rates, '2026-10-01');
  updateLedger(L5, { fruits_check: { items: [{ id: 'ff:a', forSale: false }, { id: 'ff:b', forSale: true, price: 700000, cur: 'KRW', title: '부츠' }] } },
    { sources: { fruits_check: okS() } }, rates, '2026-10-04');
  A.deepEqual([L5.items['ff:a'].gone, L5.items['ff:b'].p, L5.state.ffChecked['ff:b']], ['2026-10-04', 700000, '2026-10-04']);
  // markSeen: which searches have been read, and since when
  const stt = {};
  markSeen(stt, { sources: { yahoo: okS(), rakuma: { ok: false } } }, { held: [] }, '2026-10-02', { yahoo: { done: { guidi: true, x: false } } });
  A.deepEqual([stt.keyFirst.yahoo, stt.seen.yahoo, stt.seen.rakuma], [{ guidi: '2026-10-02', x: '2026-10-02' }, '2026-10-02', undefined]);
});
await group('payload: one listing on two platforms is one card, three on one platform are three', () => {
  const L = { items: {}, state: {} };
  const put = (id, file, src, t, p) => { L.items[id] = { id, file, src, t, u: 'https://example.invalid/' + id, p, cur: 'JPY', k: toKRW(p, 'JPY', rates),
    first: '2026-09-28', last: '2026-09-28', gone: null, miss: 0, h: [['2026-09-28', 0, p]], b: ['guidi'] }; };
  put('m1', 'mercari', '메루카리', 'GUIDI 988 BACK ZIP BOOTS', 330000); put('r1', 'rakuma', '라쿠마', 'GUIDI 988 BACK ZIP BOOTS', 300000);
  put('m2', 'mercari', '메루카리', 'Guidi PL2 Boots', 280000); put('m3', 'mercari', '메루카리', 'Guidi PL2 Boots', 390000); put('r2', 'rakuma', '라쿠마', 'Guidi PL2 Boots', 365000);
  put('m4', 'mercari', '메루카리', 'guidi ジャケット', 219000); put('y4', 'yahoo', '야후옥션', 'guidi ジャケット', 520000);
  const P = buildPayload(L, { items: {} }, rates, { sources: {} }, { day: '2026-09-28', brand: BY_SLUG.get('guidi') });
  const z = P.items.filter((o) => /988/.test(o.t));
  A.deepEqual([z.length, z[0].g, z[0].r], [1, 2, '라쿠마']);
  A.equal(P.items.filter((o) => /PL2/.test(o.t)).length, 3); A.equal(P.items.filter((o) => /ジャケット/.test(o.t)).length, 2);
  A.equal(P.counts.items, 7);
  const ph = photosOf({ items: [{ i: 'a', c: 'C', f: '2026-10-02', k: 1 }, { i: 'b', c: 'A', f: '2026-10-01', k: 1 }, { i: 'c', c: 'C', f: '2026-10-03', k: 1 }, { i: 'd', c: 'A', f: '2026-10-01', k: 1, x: 1 }] });
  A.deepEqual(ph, ['b', 'c']);                                   // a dated card first, then the newest
});

// ── the ledger on disk: in pieces, and a day's commit only what changed ────
await group('store: the ledger in sixteen pieces, last-seen only where it differs, sale records by month', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-'));
  A.equal(readLedger(dir), null); A.equal(readSold(dir), null);                   // a first run
  const mk = (id, file, last, extra = {}) => ({ id, file, src: 'x', t: 't ' + id, u: 'https://x/' + id, p: 100, cur: 'JPY', k: 873, first: '2026-10-01', last, gone: null, miss: 0, h: [['2026-10-01', 873, 100]], b: ['guidi'], ...extra });
  const items = {};
  for (let i = 0; i < 200; i++) { const id = 'yahoo:y' + i; items[id] = mk(id, 'yahoo', '2026-10-05'); }
  items['yahoo:gone'] = mk('yahoo:gone', 'yahoo', '2026-10-03', { gone: '2026-10-05', miss: 2, ls: '2026-10-03' });
  items['grailed:1'] = mk('grailed:1', 'grailed', '2026-10-04');
  const L = { v: 1, start: '2026-10-01', state: { seen: { yahoo: '2026-10-05' } }, items };
  writeLedger(dir, L);
  const files = readdirSync(join(dir, 'ledger')).sort();
  A.equal(files.length, SHARDS + 1); A.ok(files.includes('meta.json'));
  const meta = JSON.parse(readFileSync(join(dir, 'ledger', 'meta.json'), 'utf8'));
  A.deepEqual([meta.count, meta.lastOf, meta.start, meta.state.seen.yahoo], [202, { yahoo: '2026-10-05', grailed: '2026-10-04' }, '2026-10-01', '2026-10-05']);
  const raw = Object.assign({}, ...files.filter((f) => f !== 'meta.json').map((f) => JSON.parse(readFileSync(join(dir, 'ledger', f), 'utf8')).items));
  A.equal(raw['yahoo:y7'].last, undefined); A.equal(raw['yahoo:y7'].miss, undefined); A.equal(raw['yahoo:y7'].gone, undefined);
  A.deepEqual([raw['yahoo:gone'].last, raw['yahoo:gone'].miss, raw['yahoo:gone'].gone], ['2026-10-03', 2, '2026-10-05']);
  A.equal(readFileSync(join(dir, 'ledger', shardOf('yahoo:y7') + '.json'), 'utf8').split('\n').filter((l) => l.includes('"yahoo:y7"')).length, 1);   // one a line
  // read back: exactly what was written
  A.deepEqual(readLedger(dir), L);
  // the next day: every listing seen again, one new — the pieces change only where that one lies
  const before = Object.fromEntries(readdirSync(join(dir, 'ledger')).map((f) => [f, readFileSync(join(dir, 'ledger', f), 'utf8')]));
  const L2 = readLedger(dir);
  for (const x of Object.values(L2.items)) if (x.file === 'yahoo' && !x.gone) x.last = '2026-10-06';
  L2.items['yahoo:new'] = mk('yahoo:new', 'yahoo', '2026-10-06', { first: '2026-10-06' });
  writeLedger(dir, L2);
  const changed = readdirSync(join(dir, 'ledger')).filter((f) => readFileSync(join(dir, 'ledger', f), 'utf8') !== before[f]).sort();
  A.deepEqual(changed, [shardOf('yahoo:new') + '.json', 'meta.json'].sort());
  A.equal(readLedger(dir).items['yahoo:y7'].last, '2026-10-06'); A.equal(readLedger(dir).items['grailed:1'].last, '2026-10-04');
  // a piece that cannot be read, or one with fewer listings than meta.json counts, stops the reading
  const f0 = join(dir, 'ledger', shardOf('yahoo:y7') + '.json'), keep = readFileSync(f0, 'utf8');
  writeFileSync(f0, '{"items":{"yahoo:y7":'); A.throws(() => readLedger(dir), /unreadable/);
  writeFileSync(f0, '{"items":{}}'); A.throws(() => readLedger(dir), /counts/);
  writeFileSync(f0, keep); A.equal(Object.keys(readLedger(dir).items).length, 203);
  // a ledger written whole before is read while there are no pieces
  const old = mkdtempSync(join(tmpdir(), 'store-'));
  writeFileSync(join(old, 'ledger.json'), JSON.stringify({ v: 1, items: { 'yahoo:a': mk('yahoo:a', 'yahoo', '2026-09-30') }, state: {} }));
  writeFileSync(join(old, 'sold.json'), JSON.stringify({ v: 1, items: { 'yahoo:s': { id: 'yahoo:s', soldAt: '2026-09-21' } } }));
  A.equal(readLedger(old).items['yahoo:a'].last, '2026-09-30'); A.equal(Object.keys(readSold(old).items).length, 1);
  writeLedger(old, readLedger(old)); writeSold(old, readSold(old));
  A.ok(existsSync(join(old, 'ledger.json')) && existsSync(join(old, 'sold.json')));      // left in place
  A.equal(readLedger(old).items['yahoo:a'].last, '2026-09-30');
  // sale records by the month of the sale
  writeSold(dir, { v: 1, items: { 'yahoo:s1': { id: 'yahoo:s1', soldAt: '2026-08-20' }, 'yahoo:s2': { id: 'yahoo:s2', soldAt: '2026-09-21' }, 'yahoo:s3': { id: 'yahoo:s3', soldAt: '2026-09-30' } } });
  A.deepEqual(readdirSync(join(dir, 'sold')).sort(), ['2026-08.json', '2026-09.json']);
  A.deepEqual(Object.keys(readSold(dir).items).sort(), ['yahoo:s1', 'yahoo:s2', 'yahoo:s3']);
  A.ok(readdirSync(dir, { recursive: true }).every((f) => !String(f).endsWith('.tmp')));
});

// ── the build as the workflow runs it ─────────────────────────────────────
const PAYLOAD_KEYS = ['issue', 'issueLabel', 'date', 'dateKo', 'built', 'today', 'rates', 'counts', 'sections', 'sellers', 'yearSpan', 'sources', 'brand', 'items'];
const ITEM_KEYS = new Set(['t', 'k', 'r', 'l', 'i', 's', 'f', 'c', 'e', 'q', 'qk', 'z', 'p', 'u', 'im', 'h', 'w', 'wd', 'ab', 'ae', 'aeq', 'x', 'ls', 'n', 'g', 'v', 'sc', 'so', 'sk', 'cn', 'mc']);
const SELLERISH = /tokyo_vintage_shop|kimjisoo|seller_?name|"seller"|"user"|"username"|"shop(?:Name)?"|"store"|"profile"/i;
function buildRunner() {
  const dir = mkdtempSync(join(tmpdir(), 'brand-')), data = join(dir, 'data'), raw = join(data, 'raw'), site = join(dir, 'site');
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(data, 'rates.json'), JSON.stringify({ USD: 1370, GBP: 1852, EUR: 1587, JPY: 873, more: { CAD: 1000 }, date: '2026-09-26' }));
  const run = (day) => JSON.parse(execFileSync(process.execPath, [join(HERE, 'build.mjs')], {
    env: { ...process.env, BRAND_OFFLINE: '1', BRAND_TODAY: day, BRAND_DATA: data, BRAND_SITE: site }, encoding: 'utf8', stdio: 'pipe' }).trim().split('\n').pop());
  const put = (files, sum) => { for (const [f, body] of Object.entries(files)) writeFileSync(join(raw, f + '.json'), JSON.stringify(body));
    writeFileSync(join(raw, '_summary.json'), JSON.stringify({ sources: sum })); };
  const read = (p) => readFileSync(join(dir, p), 'utf8');
  return { dir, data, raw, site, run, put, read, json: (p) => JSON.parse(read(p)) };
}
await group('build: outputs — index.json, b/<slug>.json, new.json, index.html, mail lines — over three days', () => {
  const B = buildRunner();
  // a parser that let seller fields through would still not get them past the ledger
  const Y = (n, extra = []) => [...Array.from({ length: n }, (_, i) => ({ id: 'yahoo:y' + i, url: 'https://auctions.yahoo.co.jp/jp/auction/y' + i,
    title: 'GUIDI ホースレザー ジャケット 48 #' + i, price: 30000 + i, cur: 'JPY', img: 'https://auc-pctr.c.yimg.jp/i/y' + i + '.jpg', qs: ['guidi'],
    seller: 'tokyo_vintage_shop', user: { username: 'kimjisoo' } })), ...extra];
  const G = [{ id: 'grailed:500', url: 'https://www.grailed.com/listings/500', title: 'Rick Owens FW08 Stag leather jacket', price: 900, cur: 'USD', size: '48',
               img: 'https://media-assets.grailed.com/a', dz: ['Rick Owens'], gb: ['rick-owens'], qs: ['g:rick-owens'], user: { username: 'kimjisoo' } },
             { id: 'grailed:501', url: 'https://www.grailed.com/listings/501', title: 'Rick Owens Geobasket', price: 700, cur: 'CAD', dz: ['Rick Owens'], gb: ['rick-owens'], qs: ['g:rick-owens'] }];
  B.put({ yahoo: { items: Y(3), done: { guidi: true }, linked: [] }, grailed: { items: G, done: { 'g:rick-owens': true } } },
        { yahoo: { ok: true, complete: true }, grailed: { ok: true, complete: true } });
  let o = B.run('2026-10-01');
  A.deepEqual([o.issue, o.fresh], [1, 0]);                       // a search's first reading is not 신규
  // day 2: one new Guidi listing, one more Rick Owens
  B.put({ yahoo: { items: Y(3, [{ id: 'yahoo:n1', url: 'https://auctions.yahoo.co.jp/jp/auction/n1', title: 'GUIDI 2004AW ブーツ 42', price: 90000, cur: 'JPY',
                img: 'https://auc-pctr.c.yimg.jp/i/n1.jpg', qs: ['guidi'] }]), done: { guidi: true } },
          grailed: { items: [...G, { id: 'grailed:502', url: 'https://www.grailed.com/listings/502', title: 'Rick Owens SS19 Babel dunks', price: 800, cur: 'USD', dz: ['Rick Owens'], gb: ['rick-owens'], qs: ['g:rick-owens'] }],
                     done: { 'g:rick-owens': true } } },
        { yahoo: { ok: true, complete: true }, grailed: { ok: true, complete: true } });
  o = B.run('2026-10-02'); A.deepEqual([o.issue, o.fresh], [2, 2]);
  o = B.run('2026-10-02'); A.equal(o.issue, 2);                  // a second run the same day is the same issue
  // index.json: all 131, CCP by reference only
  const ix = B.json('site/index.json');
  A.deepEqual(Object.keys(ix).sort(), ['brands', 'built', 'counts', 'date', 'rates', 'sources', 'today'].sort());
  A.deepEqual([ix.today, ix.date, ix.brands.length], ['2026-10-02', '2026.10.02', 131]);
  A.deepEqual(ix.brands.map((e) => e.s), BRANDS.map((b) => b.slug));
  A.deepEqual(ix.brands.find((e) => e.s === 'carol-christian-poell'), { s: 'carol-christian-poell', n: 'Carol Christian Poell', ex: 'ccp' });
  const gd = ix.brands.find((e) => e.s === 'guidi'), ro = ix.brands.find((e) => e.s === 'rick-owens'), um = ix.brands.find((e) => e.s === 'uma-wang');
  A.deepEqual(Object.keys(gd).sort(), ['big', 'c', 'n', 'nw', 'ph', 'q', 's', 'so', 'srcs', 'upd'].sort());
  A.deepEqual([gd.c, gd.nw, gd.big, gd.so, gd.srcs, gd.upd, gd.q], [4, 1, false, 0, { '야후옥션': 4 }, '2026-10-02', { en: 'guidi', ja: 'グイディ', ko: '구이디' }]);
  A.deepEqual(gd.ph, ['https://auc-pctr.c.yimg.jp/i/n1.jpg', 'https://auc-pctr.c.yimg.jp/i/y2.jpg']);    // the dated one first
  A.deepEqual([ro.c, ro.nw, ro.big, ro.srcs], [2, 1, true, { Grailed: 2 }]);                              // the undated Geobasket is not a big brand's
  A.deepEqual([um.c, um.nw, um.ph, um.upd, um.q], [0, 0, [], null, { en: 'uma wang', ja: 'ユマワン', ko: null }]);
  A.deepEqual(ix.counts, { brands: 2, cards: 6, fresh: 2, entries: 6, sold: 0 });
  A.ok(ix.sources.some((s) => s.name === '야후옥션' && s.seen === '2026-10-02'));
  // b/<slug>.json: the CCP page's shape, plus the brand
  const files = readdirSync(join(B.site, 'b')).sort();
  A.equal(files.length, 130); A.equal(files.includes('carol-christian-poell.json'), false);
  const P = B.json('site/b/guidi.json');
  A.deepEqual(Object.keys(P).sort(), [...PAYLOAD_KEYS].sort());
  A.deepEqual(Object.keys(P.counts).sort(), ['changed', 'entries', 'fresh', 'gone', 'grouped', 'items', 'sold'].sort());
  A.deepEqual(P.brand, { s: 'guidi', n: 'Guidi', big: false });
  for (const it of P.items) for (const k of Object.keys(it)) A.ok(ITEM_KEYS.has(k), 'item key ' + k);
  const n1 = P.items.find((x) => x.l.endsWith('/n1'));
  A.deepEqual([n1.n, n1.e, n1.s, n1.c, n1.p, n1.u], [1, 'AW04', '신발', 'A', 90000, 'JPY']);
  const G1 = B.json('site/b/rick-owens.json').items.find((x) => x.l.endsWith('/500'));
  A.deepEqual([G1.e, G1.z, G1.u, G1.p], ['FW08', '48', 'USD', 900]);          // the season as the seller wrote it
  A.equal(B.json('site/b/uma-wang.json').items.length, 0);
  // new.json: today's new cards, each with its brand
  const nj = B.json('site/new.json');
  A.deepEqual([nj.today, nj.items.length, nj.items.map((x) => x.b).sort()], ['2026-10-02', 2, ['guidi', 'rick-owens']]);
  // index.html: no scripts, one link
  const html = B.read('site/index.html');
  A.equal(/<script/i.test(html), false); A.ok(html.includes('href="https://rozykuzy.github.io/?view=brands"')); A.equal(html, INDEX_HTML);
  // the mail: top brands by new cards, plain words
  A.deepEqual(B.json('data/mail_meta.json'), { date: '2026-10-02', fresh: 2, brands: [['Guidi', 1], ['Rick Owens', 1]] });
  A.equal(B.read('data/mail_lines.txt'), 'Guidi 신규 1\nRick Owens 신규 1\n');
  // the ledger keeps the brands, the searches and nothing about sellers
  const L = readLedger(B.data);
  A.deepEqual([L.items['yahoo:y0'].b, L.items['yahoo:y0'].qs, L.items['grailed:500'].d], [['guidi'], ['guidi'], ['rick-owens']]);
  A.deepEqual(Object.keys(B.json('data/status.json')).sort(), ['counts', 'day', 'hosts', 'issue', 'rates', 'soldAdded', 'sources', 'stats'].sort());
  // nothing about any seller, anywhere the build writes
  const pieces = [...readdirSync(join(B.data, 'ledger')).map((f) => 'data/ledger/' + f), ...readdirSync(join(B.data, 'sold')).map((f) => 'data/sold/' + f)];
  for (const p of ['site/index.json', 'site/new.json', 'site/b/guidi.json', 'site/b/rick-owens.json', 'data/status.json', 'data/mail_meta.json', 'data/mail_lines.txt', ...pieces])
    A.equal(SELLERISH.test(B.read(p)), false, 'seller data in ' + p);
  // a ledger that cannot be read stops the build and is left as it was; so does one shorter than the last build's
  const piece = 'data/ledger/' + shardOf('yahoo:y0') + '.json', whole = B.read(piece);
  writeFileSync(join(B.dir, piece), '{"items":{"yahoo:y1":');
  A.throws(() => B.run('2026-10-03'));
  A.equal(B.read(piece), '{"items":{"yahoo:y1":');
  writeFileSync(join(B.dir, piece), '{"items":{}}');                                     // a piece emptied: fewer than meta.json counts
  A.throws(() => B.run('2026-10-03'));
  A.equal(B.read(piece), '{"items":{}}');
  writeFileSync(join(B.dir, piece), whole);
  const meta = B.json('data/ledger/meta.json');
  writeFileSync(join(B.data, 'ledger', 'meta.json'), JSON.stringify({ ...meta, count: 0 }));
  for (const f of readdirSync(join(B.data, 'ledger'))) if (f !== 'meta.json') writeFileSync(join(B.data, 'ledger', f), '{"items":{}}');
  A.throws(() => B.run('2026-10-03'));                                                   // …and fewer than the last build kept
});
await group('build: the day every source failed, quiet days, sale records by brand', () => {
  const B = buildRunner();
  B.put({}, { yahoo: { ok: false, error: 'HTTP 500' } });
  let o = B.run('2026-10-01'); A.equal(o.cards, 0);
  A.deepEqual(B.json('data/mail_meta.json'), { date: '2026-10-01', fresh: 0, brands: [] }); A.equal(B.read('data/mail_lines.txt'), '');
  B.put({ yahoo_sold: { items: [{ id: 'yahoo:s1', url: 'https://auctions.yahoo.co.jp/jp/auction/s1', title: 'GUIDI 988 ブーツ 42', price: 50000, cur: 'JPY', sold: true, soldAt: '2026-09-30', soldKind: '낙찰', bids: 7 },
                                 { id: 'yahoo:s2', url: 'https://auctions.yahoo.co.jp/jp/auction/s2', title: 'Rick Owens ブーツ', price: 50000, cur: 'JPY', sold: true, soldAt: '2026-09-30' }] } },
        { yahoo_sold: { ok: true } });
  o = B.run('2026-10-02'); A.equal(o.soldAdded, 1);                                  // Rick Owens undated: not a big brand's record
  const ix = B.json('site/index.json');
  A.deepEqual([ix.brands.find((e) => e.s === 'guidi').so, ix.brands.find((e) => e.s === 'guidi').c], [1, 0]);
  const rec = B.json('site/b/guidi.json').items[0];
  A.deepEqual([rec.so, rec.sk, rec.ab, rec.p, rec.u], ['2026-09-30', '낙찰', 7, 50000, 'JPY']);
});

// ── the collector as the workflow runs it, against a stand-in Internet ─────
await group('collect.mjs: --only --brands --max-pages, robots first, one UA, 2.5 s a host, requests read kept', () => {
  A.deepEqual(parseArgs(['--only=yahoo,fruits', '--brands=guidi,uma-wang', '--max-pages=1']), { only: ['yahoo', 'fruits', 'fruits_check'], brands: ['guidi', 'uma-wang'], maxPages: 1 });
  A.deepEqual(parseArgs(['rakuma']).only, ['rakuma']);
  A.throws(() => parseArgs(['--only=vinted']), /unknown source/);
  A.throws(() => parseArgs(['--brands=nobody']), /unknown brand/);
  A.throws(() => parseArgs(['--brands=carol-christian-poell']), /own index/);
  A.throws(() => parseArgs(['--max-pages=0']), /max-pages/);
  A.deepEqual(SOURCE_FILES.slice().sort(), ['ebay', 'fruits', 'fruits_check', 'grailed', 'mercari', 'rakuma', 'second', 'yahoo', 'yahoo_sold', 'yfm']);
  A.deepEqual(QUEUES.flatMap(([, f]) => f).sort(), SOURCE_FILES.slice().sort());
  for (const banned of ['depop', 'vestiaire', 'therealreal', 'realreal', 'vinted', 'poshmark', '1stdibs', 'bunjang', 'ragtag', 'mercari.com/us']) {
    for (const f of ['collect.mjs', 'sources.mjs', 'grailed.mjs', 'ebay.mjs', 'mercari.mjs', 'fruitsfamily.mjs'])
      A.equal(new RegExp(banned.replace('.', '\\.'), 'i').test(readFileSync(join(HERE, f), 'utf8').replace(/\/\/.*$/gm, '')), false, banned + ' in ' + f);
  }
  const dir = mkdtempSync(join(tmpdir(), 'brand-collect-')), data = join(dir, 'data'), raw = join(data, 'raw'), log = join(dir, 'requests.log');
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(dir, 'net.mjs'), `
import { appendFileSync } from 'node:fs';
const html = (b) => new Response(b, { status: 200, headers: { 'content-type': 'text/html' } });
const card = (i, t) => '<li class="Product"><a href="https://auctions.yahoo.co.jp/jp/auction/x10000' + i + '"><img src="https://auc-pctr.c.yimg.jp/i/' + i + '.jpg"></a>' +
  '<h3><a href="https://auctions.yahoo.co.jp/jp/auction/x10000' + i + '">' + t + '</a></h3><span>現在 12,000円</span><span>入札 1</span><span>残り 2日</span></li>';
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), h = init.headers || {};
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ t: Date.now(), host: u.host, path: u.pathname + u.search, ua: h['user-agent'], cookie: h.cookie || null, referer: h.referer || null }) + '\\n');
  if (u.pathname === '/robots.txt') return new Response('User-agent: *\\nDisallow: /search/*?*n=\\nDisallow: /my\\n', { status: 200, headers: { 'content-type': 'text/plain' } });
  if (u.host === 'auctions.yahoo.co.jp' && u.pathname === '/search/search')
    return html(u.searchParams.get('p') === 'guidi' ? '<ul>' + card(1, 'GUIDI 988 バックジップ ブーツ 42') + card(2, 'GUIDI PL2 ダービー 42') + card(3, 'グイディ風 ブーツ') + '</ul>'
                                                     : '<p>条件に一致する商品は見つかりませんでした</p>');
  if (u.host === 'fruitsfamily.com' && u.pathname === '/brand/Guidi')
    return html('<a href="/product/64x3n/a">백집 부츠 42</a><span>1,100,000원</span>');
  return new Response('not here', { status: 404 });
};`);
  const out = execFileSync(process.execPath, ['--import', pathToFileURL(join(dir, 'net.mjs')).href, join(HERE, 'collect.mjs'), '--only=yahoo,fruits', '--brands=guidi', '--max-pages=1'],
    { env: { ...process.env, BRAND_DATA: data, BRAND_RAW: raw, FAKE_LOG: log }, encoding: 'utf8' });
  A.match(out, /yahoo: requests 3 · read 3 · kept 2/);
  const sum = JSON.parse(readFileSync(join(raw, '_summary.json'), 'utf8'));
  A.deepEqual([sum.brands, sum.searches, sum.args.maxPages], [1, 2, 1]);
  A.deepEqual(sum.sources.yahoo, { ...sum.sources.yahoo, ok: true, requests: 3, read: 3, kept: 2, complete: true, searches: 2, cut: 0 });
  A.deepEqual([sum.sources.fruits.ok, sum.sources.fruits.read, sum.sources.fruits.kept, sum.sources.fruits_check.idle], [true, 1, 1, true]);
  A.deepEqual(sum.hosts, { 'auctions.yahoo.co.jp': 3, 'fruitsfamily.com': 2 });
  const reqs = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  A.ok(reqs.every((r) => r.ua === UA && !r.cookie && !r.referer));
  for (const host of ['auctions.yahoo.co.jp', 'fruitsfamily.com']) {
    const mine = reqs.filter((r) => r.host === host);
    A.equal(mine[0].path, '/robots.txt', host + ': robots.txt first');
    for (let i = 1; i < mine.length; i++) A.ok(mine[i].t - mine[i - 1].t >= 2400, host + ' gap ' + (mine[i].t - mine[i - 1].t));
  }
  const y = JSON.parse(readFileSync(join(raw, 'yahoo.json'), 'utf8'));
  A.deepEqual([y.items.length, y.done, y.items[0].qs], [3, { guidi: true, グイディ: true }, ['guidi']]);
  // and the build reads what it wrote
  writeFileSync(join(data, 'rates.json'), JSON.stringify({ USD: 1370, GBP: 1852, EUR: 1587, JPY: 873, date: '2026-10-18' }));
  const b = JSON.parse(execFileSync(process.execPath, [join(HERE, 'build.mjs')], { env: { ...process.env, BRAND_OFFLINE: '1', BRAND_DATA: data, BRAND_SITE: join(dir, 'site') }, encoding: 'utf8' }).trim().split('\n').pop());
  A.deepEqual([b.brands, b.cards], [1, 3]);
  const gd = JSON.parse(readFileSync(join(dir, 'site', 'index.json'), 'utf8')).brands.find((e) => e.s === 'guidi');
  A.deepEqual(gd.srcs, { '야후옥션': 2, '후루츠패밀리': 1 });
});

// ── the workflow and the documents ───────────────────────────────────────
await group('workflow: schedule, the branch as it is, Node 22, test → collect → build, data committed, Pages deployed, secrets by name', () => {
  const y = readFileSync(join(HERE, '.github', 'workflows', 'daily.yml'), 'utf8');
  A.match(y, /cron:\s*'7 15 \* \* \*'/); A.match(y, /actions\/checkout@v4\s+with:\s+ref: \$\{\{ github\.ref_name \}\}/); A.match(y, /workflow_dispatch/); A.match(y, /node-version:\s*22/); A.match(y, /timeout-minutes:\s*300/);
  const at = (s) => y.indexOf(s);
  A.ok(at('node test.mjs') > 0 && at('node test.mjs') < at('node collect.mjs') && at('node collect.mjs') < at('node build.mjs'));
  A.ok(at('playwright') > 0 && at('playwright') < at('node collect.mjs'));
  for (const p of ['pages: write', 'id-token: write', 'contents: write', 'actions/upload-pages-artifact', 'actions/deploy-pages', 'path: site',
    'EBAY_CLIENT_ID: ${{ secrets.EBAY_CLIENT_ID }}', 'EBAY_CLIENT_SECRET: ${{ secrets.EBAY_CLIENT_SECRET }}', 'data/mail_lines.txt']) A.ok(y.includes(p), p);
  A.equal(/echo[^\n]*secrets\./.test(y), false);
  A.equal((y.match(/secrets\./g) || []).length, 2);
});
await group('documents: Korean, plain, the local trial command', () => {
  for (const f of ['README.md', 'RUNBOOK.md']) {
    const t = readFileSync(join(HERE, f), 'utf8');
    A.ok(/[가-힣]/.test(t), f);
    for (const w of ['오늘의 발견', '큐레이션', '추천합니다', '주목할 만한']) A.equal(t.includes(w), false, f + ': ' + w);
  }
  A.ok(readFileSync(join(HERE, 'RUNBOOK.md'), 'utf8').includes('node test.mjs && node collect.mjs --only=<source> --brands=<slug,...> && node build.mjs'));
});

console.log('test: ' + passed + ' checks passed, ' + failed + ' group' + (failed === 1 ? '' : 's') + ' failed');
if (failed) { for (const f of failures) console.log('  ' + f); process.exit(1); }
