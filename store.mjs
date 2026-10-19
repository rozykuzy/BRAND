// The ledger and the sale records on disk.
//
// 130 brands are some 200,000 listings: one file would pass what GitHub takes (100 MB a
// file), and a ledger that rewrites every listing's last-seen day each morning would grow
// the repository by megabytes a day. So the records are kept in pieces, one listing a line,
// and a day's commit carries what changed that day — not the date on every line:
//
//   data/ledger/meta.json      everything but the listings (start, state), how many there
//                              are, and the day each source was last read (`lastOf`)
//   data/ledger/<0–f>.json     the listings, by a hash of their id. A listing seen on its
//                              source's last reading carries no `last`: it is `lastOf` there.
//                              `miss: 0` and `gone: null` are left out the same way
//   data/sold/<YYYY-MM>.json   the sale records, by the month of the sale: a past month's
//                              file does not change again
//
// Read back, every listing has its `last`, `miss` and `gone` as before; nothing else in
// the build sees the pieces. A record written whole before (data/ledger.json,
// data/sold.json) is read when there are no pieces yet, and left in place.
// Absent is a first run; present but unreadable, or fewer listings than meta.json counts,
// is a stop: rewriting it from what could be read would lose first-seen dates.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const SHARDS = 16;
export function shardOf(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % SHARDS).toString(16);
}

function parse(f) {
  const txt = readFileSync(f, 'utf8');
  try { return JSON.parse(txt); } catch (e) { throw new Error(f + ' is unreadable (' + e.message + ') — not overwriting it'); }
}
// one record a line, in the order of their ids
const lines = (items) => {
  const keys = Object.keys(items).sort();
  return '{"items":{\n' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(items[k])).join(',\n') + '\n}}\n';
};
// written beside, then put in place: a run that stops half-way leaves the old file whole
function put(f, text) { writeFileSync(f + '.tmp', text); renameSync(f + '.tmp', f); }

export function readLedger(data) {
  const dir = join(data, 'ledger'), metaF = join(dir, 'meta.json');
  if (!existsSync(metaF)) {
    const whole = join(data, 'ledger.json');
    return existsSync(whole) ? parse(whole) : null;
  }
  const { lastOf = {}, count = 0, ...rest } = parse(metaF);
  const items = {};
  for (let s = 0; s < SHARDS; s++) {
    const f = join(dir, s.toString(16) + '.json');
    if (existsSync(f)) Object.assign(items, parse(f).items || {});
  }
  const n = Object.keys(items).length;
  if (n < count) throw new Error('data/ledger/ has ' + n + ' listings, meta.json counts ' + count + ' — not overwriting it');
  for (const x of Object.values(items)) {
    if (x.last === undefined) {
      if (!lastOf[x.file]) throw new Error('data/ledger/: no last reading day for ' + x.file + ' (' + x.id + ') — not overwriting it');
      x.last = lastOf[x.file];
    }
    if (x.miss === undefined) x.miss = 0;
    if (x.gone === undefined) x.gone = null;
  }
  return { ...rest, items };
}

export function writeLedger(data, L) {
  const dir = join(data, 'ledger');
  mkdirSync(dir, { recursive: true });
  const { items, ...rest } = L;
  const lastOf = {};
  for (const x of Object.values(items)) if (x.last && (!lastOf[x.file] || x.last > lastOf[x.file])) lastOf[x.file] = x.last;
  const parts = Array.from({ length: SHARDS }, () => ({}));
  for (const [id, x] of Object.entries(items)) {
    const o = { ...x };
    if (o.last === lastOf[o.file]) delete o.last;
    if (o.miss === 0) delete o.miss;
    if (o.gone === null) delete o.gone;
    parts[parseInt(shardOf(id), 16)][id] = o;
  }
  for (let s = 0; s < SHARDS; s++) put(join(dir, s.toString(16) + '.json'), lines(parts[s]));
  // last: the note that says how to read the pieces
  put(join(dir, 'meta.json'), JSON.stringify({ ...rest, lastOf, count: Object.keys(items).length }) + '\n');
}

const MONTH = /^\d{4}-\d{2}\.json$/;
export function readSold(data) {
  const dir = join(data, 'sold');
  if (!existsSync(dir) || !readdirSync(dir).some((f) => MONTH.test(f))) {
    const whole = join(data, 'sold.json');
    return existsSync(whole) ? parse(whole) : null;
  }
  const items = {};
  for (const f of readdirSync(dir).filter((f) => MONTH.test(f)).sort()) Object.assign(items, parse(join(dir, f)).items || {});
  return { v: 1, items };
}

export function writeSold(data, S) {
  const dir = join(data, 'sold');
  mkdirSync(dir, { recursive: true });
  const by = {};
  for (const [id, x] of Object.entries(S.items)) {
    const m = /^\d{4}-\d{2}/.exec(String(x.soldAt || x.first || ''));
    (by[m ? m[0] : '0000-00'] ||= {})[id] = x;
  }
  for (const [m, items] of Object.entries(by)) put(join(dir, m + '.json'), lines(items));
}
