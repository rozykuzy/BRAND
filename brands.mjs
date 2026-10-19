// The 131 brands of brands.json, and how a listing is read for them.
//
// A search page also returns look-alikes (descriptions that mention a name, "…風",
// "inspired by …"), so on a search page a listing belongs to a brand only when its
// TITLE names that brand:
//   - any Latin alias, case-, width-, accent- and punctuation-insensitive
//     (rickowens · Rick-Owens · RICK  OWENS · ﾘｯｸｵｳｴﾝｽ), beginning where a word begins;
//     a short alias (under five letters) or a `noisy` brand's alias must also end
//     where a word ends — the whole alias as a token, never a substring
//   - or any Japanese / Korean alias (a noisy brand's: not inside a longer word of the same script)
//   - `titleMust` adds a second required term (Tabi · Dr. Martens x Rick Owens)
//   - a name inside a longer name of another brand is that brand's
//     (Comme des Garcons PLAY is not Comme des Garcons)
//   - a brand whose `excludeDesigners` are named in the title is not that brand
//     (UNIQLO +J is not Jil Sander, MM6 is not Maison Margiela)
//   - a name used to describe something else excludes the listing:
//     …風 · 系 · っぽい · 好きな方 · style · like · type · inspired by … · …ではありません · 元…
//   - "…期" (Hermès マルジェラ期) is another house's period: not that brand
//   - a `big` brand keeps only titles that state a year or a season (tier A)
// A title that names several of our brands belongs to each of them.
//
// Grailed and FruitsFamily's brand pages are filed under a brand by the site itself
// (`designated`): those brands need no name in the title, but every other rule holds.

import { readFileSync } from 'node:fs';
import { era, excludeReason } from './classify.mjs';

export const REGISTRY = JSON.parse(readFileSync(new URL('./brands.json', import.meta.url), 'utf8'));
export const BRANDS = REGISTRY.brands;
export const ACTIVE = BRANDS.filter((b) => !b.existing);          // Carol Christian Poell is its own index
export const BY_SLUG = new Map(BRANDS.map((b) => [b.slug, b]));

// the form every comparison is made in: NFKC (full and half width), lower case,
// Latin accents off (Courrèges · Chloé · München), Japanese and Korean untouched
export function fold(s) {
  let t = String(s ?? '');
  try { t = t.normalize('NFKC'); } catch {}
  t = t.toLowerCase();
  try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC'); } catch {}
  return t.replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss').replace(/đ/g, 'd').replace(/ł/g, 'l');
}

// what may stand between the words of a name, or be left out
const SEPC = "\\s._\\-/'’‘`:·・･,*";
const SEP = '[' + SEPC + ']*';
const SEPS = new RegExp('[' + SEPC + ']+', 'gu');
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const scriptOf = (ch) => (/[\p{Script=Katakana}\p{Script=Hiragana}ー]/u.test(ch) ? '[\\p{Script=Katakana}\\p{Script=Hiragana}ー]'
  : /\p{Script=Han}/u.test(ch) ? '\\p{Script=Han}' : /\p{Script=Hangul}/u.test(ch) ? '\\p{Script=Hangul}' : /[a-z0-9]/.test(ch) ? '[a-z0-9]' : null);
const word = (w) => esc(w).replace(/&/g, '\\s*&\\s*');

// one name → a regular expression source, matched against fold(title)
export function termSource(term, { token = false } = {}) {
  const f = fold(term).trim();
  if (CJK.test(f)) {
    const chars = [...f.replace(SEPS, '')];
    let src = chars.map(word).join(SEP);
    if (token) {
      const l = scriptOf(chars[0]), r = scriptOf(chars[chars.length - 1]);
      src = (l ? '(?<!' + l + ')' : '') + src + (r ? '(?!' + r + ')' : '');
    }
    return src;
  }
  const words = f.split(SEPS).filter(Boolean);
  const body = words.map(word).join(SEP);
  const strict = token || f.replace(/[^a-z0-9]/g, '').length < 5;
  // begins where a word begins ('celine' is not in 'marceline', 'y/project' not in 'my project');
  // a short or noisy one ends where a word ends (a short one may take a plural s: tabis)
  return '(?<![a-z0-9])' + body + (strict ? (token ? '' : 's?') + '(?![a-z0-9])' : '');
}
const anyOf = (terms, opts, flags = 'u') => {
  const srcs = [...new Set(terms.map((x) => fold(x).trim()).filter(Boolean))].sort((a, b) => b.length - a.length).map((x) => termSource(x, opts));
  return srcs.length ? new RegExp(srcs.join('|'), flags) : null;
};

// how the designers a brand leaves out (brands.json excludeDesigners) are also written
const EXCLUDED_FORMS = {
  'uniqlo': ['ユニクロ', '유니클로', '+j'],
  'gu': ['ジーユー'],
  'h&m': ['エイチアンドエム', 'エイチ・アンド・エム', 'エイチ&エム'],
  'mm6': ['エムエムシックス'],
  'mcq': ['マックキュー'],
  'mcq alexander mcqueen': ['マックキュー'],
  'see by chloe': ['シーバイクロエ', '씨바이끌로에'],
  'comme des garcons play': ['play comme des garcons', 'cdg play', 'プレイコムデギャルソン', 'コムデギャルソンプレイ', '꼼데가르송 플레이'],
  'noir kei ninomiya': ['ノワールケイニノミヤ', 'ノワール ケイ ニノミヤ'],
};
const PLUSJ = '(?<![a-z0-9])\\+\\s*j(?![a-z0-9])';     // UNIQLO's +J line, written as it is sold
function excludedRe(names) {
  if (!names || !names.length) return null;
  const terms = [], extra = [];
  for (const n of names) { terms.push(n); for (const f of EXCLUDED_FORMS[fold(n)] || []) (f === '+j' ? extra : terms).push(f); }
  const re = anyOf(terms, { token: true });
  return new RegExp([re && re.source, extra.length ? PLUSJ : null].filter(Boolean).join('|'), 'u');
}

const MATCHERS = ACTIVE.map((b) => ({
  slug: b.slug, b,
  alias: anyOf([...b.latin, ...b.ja, ...b.ko], { token: !!b.noisy }, 'gu'),
  must: b.titleMust ? anyOf(b.titleMust, {}) : null,
  ex: excludedRe(b.excludeDesigners),
}));
const M = new Map(MATCHERS.map((m) => [m.slug, m]));

// ── a name used for something other than this brand ──────────────────────
// after the name: …風 · 系 · っぽい · ライク · スタイル · タイプ · 好きな方 · のような · 스타일 · 느낌 · 같은 ·
// style · like · type · inspired · esque ("like new", "type-2", "Style AM/2601L" are not)
const LOOK_AFTER = new RegExp('^\\s*(?:の)?\\s*(?:風|系|っぽい|ぽい|ライク|スタイル|タイプ|ような|みたいな|스타일|느낌|풍(?!성)|타입|같은|처럼|st(?![a-z]))' +
  '|^[\\s\\-]*(?:inspired|esque|like(?![\\s\\-]*new)|type(?![\\s\\-]*(?:\\d|[ivx]{1,3}(?![a-z])|[a-z](?![a-z])))|style(?!\\s*(?:no\\.?|#|number|code|[a-z]{1,2}\\s?[\\/\\-]?\\s?\\d{4})))(?![a-z])' +
  '|^\\s*(?:等|など|とか|や)?\\s*(?:が|の)?\\s*(?:お)?(?:好き|ファン(?:の|に|へ|向け)|愛好)', 'u');
// before the name: style of · inspired by · like
const LOOK_BEFORE = /(?:style|inspired|like)\s+(?:of\s+|by\s+)?$/u;
// "…ではありません" · "元…" (a former designer's own label) · "not …"
const NOT_AFTER = /^\s*(?:では|じゃ)(?:ない|無い|ありません|ございません|なく)|^\s*(?:아님|아닙니다|아니에요)/u;
const NOT_BEFORE = /(?:元\s*|(?<![a-z])not\s+(?:a\s+)?|(?<![a-z])non[\s-]+)$/u;
// "マルジェラ期" — another house in that designer's years (not 本人期, not 期間)
const PERIOD_AFTER = /^\s*期(?!間|限|待)/u;

// where each of our names stands in a title
export function namesIn(title) {
  const t = fold(title), spans = [];
  for (const m of MATCHERS) {
    if (!m.alias) continue;
    m.alias.lastIndex = 0; let x;
    while ((x = m.alias.exec(t))) { if (!x[0].length) { m.alias.lastIndex++; continue; } spans.push({ slug: m.slug, s: x.index, e: x.index + x[0].length }); }
  }
  // a name inside a longer name of another brand belongs to that one
  const kept = spans.filter((a) => !spans.some((o) => o.slug !== a.slug && o.s <= a.s && o.e >= a.e && o.e - o.s > a.e - a.s));
  return { t, spans: kept.sort((a, b) => a.s - b.s || b.e - a.e) };
}

// Grailed: the brands a listing's designers make it (OR over `grailed`, AND over `grailedAll`),
// plus the brands whose search found it — less any brand whose excludeDesigners it carries
export function grailedDesignated(designers = [], foundBy = []) {
  const dz = new Set(designers.map((d) => fold(d).trim()));
  const out = [];
  const excluded = (b) => (b.excludeDesigners || []).some((x) => dz.has(fold(x).trim()));
  for (const b of ACTIVE) {
    let hit = false;
    if (b.grailedAll && b.grailedAll.length) hit = b.grailedAll.every((d) => dz.has(fold(d).trim()));
    else if (b.grailed && b.grailed.length) hit = b.grailed.some((d) => dz.has(fold(d).trim()));
    if (foundBy.includes(b.slug)) hit = true;      // the search's own filter vouches for it
    if (hit && !excluded(b)) out.push(b.slug);
  }
  return out;
}

// the brands a collected listing was filed under by its own site: on Grailed its designers and
// the brand searches that found it (gb), on a brand page that brand (d); a search page files nothing
export function designatedOf(it) {
  if (it.gb || it.dz) return grailedDesignated(it.dz || [], it.gb || []);
  return it.d || [];
}

// title → the brands it is a listing of.
//   designated: brands the site filed it under (Grailed designer, a brand page)
// Returns { b: [slugs], why?: the reason when none, replicaLine, drop: {slug: reason} }
export function brandsOf(title, designated = []) {
  const { t, spans } = namesIn(title);
  const look = new Set(), not = new Set(), period = new Set(), plain = [];
  for (const sp of spans) {
    const after = t.slice(sp.e, sp.e + 40), before = t.slice(Math.max(0, sp.s - 24), sp.s);
    if (NOT_AFTER.test(after) || NOT_BEFORE.test(before)) not.add(sp.slug);
    else if (LOOK_AFTER.test(after) || LOOK_BEFORE.test(before)) look.add(sp.slug);
    else if (PERIOD_AFTER.test(after)) period.add(sp.slug);
    else if (!plain.includes(sp.slug)) plain.push(sp.slug);
  }
  const des = designated.filter((s) => M.has(s));
  const replicaLine = des.includes('maison-margiela') || plain.includes('maison-margiela') || des.includes('tabi-footwear') || plain.includes('tabi-footwear');
  const out = { b: [], replicaLine, drop: {} };
  const why = excludeReason(title, { replicaLine });
  if (why) return { ...out, why };
  // on a search page, a title that says "…風" or "not …" about any of our names is not to be trusted for any
  if ((look.size || not.size) && !des.length) return { ...out, why: not.size ? 'not-brand' : 'style-of' };
  // a filed listing keeps the brand it was filed under, unless the title says it is only like it
  const cand = [...des.filter((s) => !look.has(s) && !not.has(s)), ...(look.size || not.size ? [] : plain)];
  let tierA = null;
  for (const slug of [...new Set(cand)]) {
    const m = M.get(slug), b = m.b, filed = des.includes(slug);
    if (m.ex && m.ex.test(t)) { out.drop[slug] = 'excluded-designer'; continue; }
    // titleMust: on a filed listing only where the filing alone does not say it (Tabi is filed as Maison Margiela)
    if (m.must && !(filed && b.grailedAll) && !m.must.test(t)) { out.drop[slug] = 'title-must'; continue; }
    if (b.big) {
      if (tierA === null) tierA = era(title).tier === 'A';
      if (!tierA) { out.drop[slug] = 'big-undated'; continue; }
    }
    out.b.push(slug);
  }
  for (const s of period) if (!out.b.includes(s) && !out.drop[s]) out.drop[s] = 'period-of';
  for (const s of look) out.drop[s] = 'style-of';
  for (const s of not) out.drop[s] = 'not-brand';
  if (!out.b.length) { const why = Object.values(out.drop); out.why = WHY.find((w) => why.includes(w)) || 'no-brand'; }
  return out;
}
// when no brand is left, the reason said is the one that tells most
const WHY = ['not-brand', 'style-of', 'excluded-designer', 'big-undated', 'period-of', 'title-must'];

// ── what is searched ──────────────────────────────────────────────────────
// A brand's searches: its plain Latin name (latin[0]) and each Japanese alias.
// The same words spaced or not are one search (アン ドゥムルメステール = アンドゥムルメステール),
// and one search serves every brand that has it. A brand whose Latin name is another
// house's (Dr. Martens x Rick Owens: "rick owens") searches with its required term added.
const squash = (q) => fold(q).replace(SEPS, '');
export function queriesOf(b) {
  let en = b.latin[0];
  if (b.titleMust) { const must = anyOf(b.titleMust, {}); if (must && !must.test(fold(en))) en = en + ' ' + b.titleMust[0]; }
  const seen = new Set();
  return [en, ...(b.ja || [])].filter((q) => { const k = squash(q); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}
export function queryPlan(brands = ACTIVE) {
  const by = new Map();
  for (const b of brands) for (const q of queriesOf(b)) {
    const k = squash(q);
    if (!by.has(k)) by.set(k, { q, slugs: [] });
    const cur = by.get(k); if (!cur.slugs.includes(b.slug)) cur.slugs.push(b.slug);
  }
  return [...by.values()];
}

// a card line that is nothing but one of our brand names (a label, not a title)
const LABEL = new RegExp('^(?:' + [...new Set(BRANDS.flatMap((b) => [b.name, ...b.latin, ...b.ja, ...b.ko]).map((x) => fold(x).trim()).filter(Boolean))]
  .sort((a, b) => b.length - a.length).map((x) => termSource(x)).join('|') + ')(?:\\s*[(（][^)）]*[)）])?$', 'u');
export const brandLabel = { test: (s) => LABEL.test(fold(s).trim()) };
