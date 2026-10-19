// Runs every collector and writes one file per source under data/raw/.
//
//   node collect.mjs                                     every source, every brand
//   node collect.mjs --only=yahoo,rakuma                 just these sources
//   node collect.mjs --brands=guidi,uma-wang             just these brands' searches and pages
//   node collect.mjs --max-pages=1                       at most this many pages a search (a trial)
//
// Sources: grailed yahoo yahoo_sold mercari rakuma yfm second fruits fruits_check ebay
// (fruits runs fruits_check after it: the second look at listings already on the ledger).
//
// One queue per host, the hosts side by side; within a host, one search after
// another (lib.mjs keeps 2.5 s between any two requests to it). One source
// failing never stops the others. A source whose host refuses (403 · 429 · a
// bot-check page · robots.txt) is "not observed today" — never "everything gone".
// A source none of whose searches yielded a listing, without the site saying that
// nothing matched, is a failure: that is what a redesign or a block looks like,
// and the shape of the page (never its text) goes to data/raw/_diag.json.
// Exit code is non-zero only when every source failed.

import { writeFileSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BY_FILE, collect } from './sources.mjs';
import { collectEbay } from './ebay.mjs';
import { collectGrailed, planGrailed } from './grailed.mjs';
import { collectMercari } from './mercari.mjs';
import { collectBrandPages, readProduct, dueForRecheck } from './fruitsfamily.mjs';
import { writeRaw, Refused, diagOf, today, requestCounts } from './lib.mjs';
import { ACTIVE, BY_SLUG, queryPlan, brandsOf, designatedOf } from './brands.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const FILES = ['grailed', 'yahoo', 'yahoo_sold', 'mercari', 'rakuma', 'yfm', 'second', 'fruits', 'fruits_check', 'ebay'];
// one queue per host; the sources that share a host take turns
export const QUEUES = [
  ['auctions.yahoo.co.jp', ['yahoo', 'yahoo_sold']],
  ['jp.mercari.com', ['mercari']],
  ['fril.jp', ['rakuma']],
  ['paypayfleamarket.yahoo.co.jp', ['yfm']],
  ['www.2ndstreet.jp', ['second']],
  ['fruitsfamily.com', ['fruits', 'fruits_check']],
  ['mnrwefss2q-dsn.algolia.net', ['grailed']],
  ['api.ebay.com', ['ebay']],
];

export function parseArgs(argv) {
  const out = { only: null, brands: null, maxPages: null };
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  for (const a of argv) {
    let m;
    if ((m = /^--only=(.*)$/.exec(a))) out.only = list(m[1]);
    else if ((m = /^--brands=(.*)$/.exec(a))) out.brands = list(m[1]);
    else if ((m = /^--max-pages=(\d+)$/.exec(a))) out.maxPages = Number(m[1]);
    else if (FILES.includes(a)) (out.only = out.only || []).push(a);
    else throw new Error('unknown argument "' + a + '" — use --only=<source,...> --brands=<slug,...> --max-pages=N');
  }
  for (const f of out.only || []) if (!FILES.includes(f)) throw new Error('unknown source "' + f + '" — one of ' + FILES.join(' '));
  for (const s of out.brands || []) {
    if (!BY_SLUG.has(s)) throw new Error('unknown brand "' + s + '" — slugs are in brands.json');
    if (BY_SLUG.get(s).existing) throw new Error('"' + s + '" has its own index (' + BY_SLUG.get(s).existing + ') and is not collected here');
  }
  if (out.maxPages !== null && !(out.maxPages >= 1)) throw new Error('--max-pages must be 1 or more');
  if (out.only && out.only.includes('fruits') && !out.only.includes('fruits_check')) out.only.push('fruits_check');
  return out;
}

export async function run(opts, { data = process.env.BRAND_DATA || join(ROOT, 'data'), out: OUT = process.env.BRAND_RAW || join(data, 'raw') } = {}) {
  mkdirSync(OUT, { recursive: true });
  const want = (f) => !opts.only || opts.only.includes(f);
  const brands = opts.brands ? ACTIVE.filter((b) => opts.brands.includes(b.slug)) : ACTIVE;
  const plan = queryPlan(brands);
  const log = (s) => console.log(new Date().toISOString().slice(11, 19) + ' ' + s);
  const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
  const summary = { startedAt: new Date().toISOString(), day: today(), args: { only: opts.only, brands: opts.brands, maxPages: opts.maxPages },
                    brands: brands.length, searches: plan.length, sources: {} };
  const diag = {};
  const reqs = (host) => requestCounts()[host] || 0;
  // kept: listings of our brands (on a sale-record page, the sale records of our brands)
  const kept = (items) => items.filter((it) => brandsOf(it.title, designatedOf(it)).b.length).length;
  const sec = (t0) => Math.round((Date.now() - t0) / 1000);
  const failed = (file, e, extra = {}) => {
    summary.sources[file] = { ok: false, refused: e instanceof Refused, error: String((e && e.message) || e).slice(0, 300), ...extra };
    log(file + (e instanceof Refused ? ' REFUSED (not observed today): ' : ' FAILED: ') + summary.sources[file].error);
  };
  const said = (file) => { const s = summary.sources[file];
    if (s.ok) log(file + ': requests ' + s.requests + ' · read ' + s.read + ' · kept ' + s.kept + (s.complete ? '' : ' · reading cut short') + ' · ' + s.sec + ' s'); };
  const doneOf = (done) => { const v = Object.values(done || {}); return { complete: v.length > 0 && v.every(Boolean), searches: v.length, cut: v.filter((x) => !x).length }; };

  // ── search pages ─────────────────────────────────────────────────────────
  async function pages(file) {
    const src = BY_FILE[file], t0 = Date.now(), r0 = reqs(src.host);
    try {
      const r = await collect(src, plan, { maxPages: opts.maxPages || src.maxPages, log });
      if (r.emptyHtml) diag[file] = diagOf(r.emptyHtml, src.spec);
      if (plan.length && !r.items.length && !Object.values(r.done).some(Boolean)) {
        diag[file] = diagOf(r.emptyHtml || r.firstHtml, src.spec);
        throw new Error('no search yielded a listing — markup changed or the pages are blocked (see _diag.json)');
      }
      const n = writeRaw(join(OUT, file + '.json'), src.name, src.market, r.items, { done: r.done, linked: r.linked, pages: r.pages.length, failed: r.failed });
      summary.sources[file] = { ok: true, requests: reqs(src.host) - r0, read: n, kept: kept(r.items), ...doneOf(r.done), failed: r.failed.length,
                                pages: r.pages.length, sec: sec(t0) };
      said(file);
    } catch (e) { failed(file, e, { requests: reqs(src.host) - r0, sec: sec(t0) }); }
  }

  // ── 메루카리: the search page as a browser draws it ────────────────────────
  async function mercari() {
    const src = BY_FILE.mercari, t0 = Date.now();
    try {
      const r = await collectMercari(plan.map((p) => p.q), log, { maxPages: opts.maxPages || src.maxPages });
      if (r.skipped) { summary.sources.mercari = { ok: false, skipped: r.skipped }; log('mercari skipped: ' + r.skipped); return; }
      if (r.refused) { summary.sources.mercari = { ok: false, refused: true, error: r.refused, requests: r.requests, sec: sec(t0) }; log('mercari REFUSED (not observed today): ' + r.refused); return; }
      if (plan.length && !r.items.length && !Object.values(r.done).some(Boolean)) {
        diag.mercari = { browser: true, ...(r.diag || {}), pages: r.pagesRead.length };
        throw new Error('no search yielded a listing — markup changed or the page is blocked (see _diag.json)');
      }
      if (r.diag) diag.mercari = { browser: true, ...r.diag };
      const n = writeRaw(join(OUT, 'mercari.json'), src.name, src.market, r.items, { done: r.done, linked: r.linked, pages: r.pagesRead.length });
      summary.sources.mercari = { ok: true, requests: r.requests, read: n, kept: kept(r.items), ...doneOf(r.done), pages: r.pagesRead.length, sec: sec(t0) };
      said('mercari');
    } catch (e) { failed('mercari', e, { sec: sec(t0) }); }
  }

  // ── 후루츠패밀리: the brands' own pages, then a second look ─────────────────
  async function fruits() {
    const t0 = Date.now(), r0 = reqs('fruitsfamily.com');
    try {
      const r = await collectBrandPages(brands, log);
      const n = writeRaw(join(OUT, 'fruits.json'), '후루츠패밀리', '한국', r.items, { done: r.done, missing: r.missing, pages: r.pages });
      summary.sources.fruits = { ok: true, requests: reqs('fruitsfamily.com') - r0, read: n, kept: kept(r.items), complete: false,
                                 pages: r.pages, missing: r.missing.length, failed: r.failed.length, sec: sec(t0) };
      said('fruits');
    } catch (e) { failed('fruits', e, { requests: reqs('fruitsfamily.com') - r0, sec: sec(t0) }); }
  }
  async function fruitsCheck() {
    const t0 = Date.now(), r0 = reqs('fruitsfamily.com');
    try {
      const ledger = readJson(join(data, 'ledger.json'), { items: {}, state: {} });
      const fr = summary.sources.fruits && summary.sources.fruits.ok ? readJson(join(OUT, 'fruits.json'), { items: [] }) : { items: [] };
      const seenToday = new Set((fr.items || []).map((x) => x.id));
      let due = dueForRecheck(ledger, seenToday, today(), { checked: (ledger.state || {}).ffChecked || {} });
      if (opts.brands) due = due.filter((it) => (it.b || []).some((s) => opts.brands.includes(s)));
      const out = [];
      for (const it of due) {
        const p = await readProduct(it.id.replace(/^ff:/, ''));
        out.push(p ? { id: it.id, forSale: p.forSale, price: p.price, cur: p.cur, title: p.title, img: p.img } : { id: it.id, missing: true });
      }
      writeFileSync(join(OUT, 'fruits_check.json'), JSON.stringify({ src: '후루츠패밀리', fetchedAt: new Date().toISOString(), n: out.length, items: out }, null, 1));
      // nothing due is not a reading: it asked nothing of anyone
      summary.sources.fruits_check = { ok: true, requests: reqs('fruitsfamily.com') - r0, checked: out.length, ...(out.length ? {} : { idle: true }), sec: sec(t0) };
      log('fruits_check: ' + out.length + ' listings looked at again');
    } catch (e) { failed('fruits_check', e, { requests: reqs('fruitsfamily.com') - r0, sec: sec(t0) }); }
  }

  // ── Grailed's search service and eBay's API ──────────────────────────────
  async function grailed() {
    const t0 = Date.now(), host = 'mnrwefss2q-dsn.algolia.net', r0 = reqs(host);
    if (!planGrailed(brands).length) { summary.sources.grailed = { ok: false, skipped: 'no brand of this run is on Grailed' }; return; }
    try {
      const r = await collectGrailed(brands, log, { day: today() });
      if (!r.items.length && !r.calls) throw new Error('the search answered nothing');
      const n = writeRaw(join(OUT, 'grailed.json'), 'Grailed', '해외', r.items, { done: r.done, calls: r.calls, capped: r.capped, unread: r.unread, cut: r.cut });
      summary.sources.grailed = { ok: true, requests: reqs(host) - r0, read: n, kept: kept(r.items), ...doneOf(r.done), calls: r.calls, capped: r.capped,
                                  unread: r.unread.length, sec: sec(t0) };
      said('grailed');
    } catch (e) { failed('grailed', e, { requests: reqs(host) - r0, sec: sec(t0) }); }
  }
  async function ebay() {
    const t0 = Date.now(), r0 = reqs('api.ebay.com');
    try {
      const r = await collectEbay(brands, log, { ...(opts.maxPages ? { maxPages: opts.maxPages } : {}) });
      if (r.skipped) { summary.sources.ebay = { ok: false, skipped: r.skipped }; log('ebay skipped: ' + r.skipped); return; }
      const n = writeRaw(join(OUT, 'ebay.json'), 'eBay', '해외', r.items, { done: r.done, calls: r.calls, failed: r.failed });
      summary.sources.ebay = { ok: true, requests: reqs('api.ebay.com') - r0, read: n, kept: kept(r.items), ...doneOf(r.done), calls: r.calls, sec: sec(t0) };
      said('ebay');
    } catch (e) { failed('ebay', e, { requests: reqs('api.ebay.com') - r0, sec: sec(t0) }); }
  }

  const RUN = { yahoo: () => pages('yahoo'), yahoo_sold: () => pages('yahoo_sold'), rakuma: () => pages('rakuma'), yfm: () => pages('yfm'),
                second: () => pages('second'), mercari, fruits, fruits_check: fruitsCheck, grailed, ebay };
  log('brands ' + brands.length + ' · searches ' + plan.length + ' · sources ' + FILES.filter(want).join(' '));
  await Promise.all(QUEUES.map(async ([, files]) => { for (const f of files) if (want(f)) await RUN[f](); }));

  summary.finishedAt = new Date().toISOString();
  summary.hosts = requestCounts();
  writeFileSync(join(OUT, '_summary.json'), JSON.stringify(summary, null, 1));
  writeFileSync(join(OUT, '_diag.json'), JSON.stringify({ at: summary.finishedAt, pages: diag }, null, 1));
  const oks = Object.values(summary.sources).filter((s) => s.ok && !s.idle).length;
  log('done: ' + oks + '/' + Object.keys(summary.sources).length + ' sources ok · requests ' + JSON.stringify(summary.hosts));
  return { summary, ok: oks > 0 || !Object.keys(summary.sources).length };
}

const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; } })();
if (isMain) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const r = await run(opts);
  process.exit(r.ok ? 0 : 1);
}
