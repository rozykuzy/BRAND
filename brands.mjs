// The brands of brands.json (130 — 07A left out at ROK's word, 2026-10-20), and how a listing is read for them.
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
// The house named first made the piece: a name written after it is a word added for
// search (JULIUS … incarnation guidi rick owens), unless it is joined to it as a
// collaboration (Guidi × Alyx · Rick Owens x Moncler) or is its line (Rick Owens DRKSHDW).
// A title that opens on another house (Piero Guidi, Carol Christian Poell, JULIUS) is not ours.
//
// Grailed and FruitsFamily's brand pages are filed under a brand by the site itself
// (`designated`): those brands need no name in the title, but a title that names
// another house first, or only another house, or compares the piece to one, takes it away.

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
// A Japanese or Korean name of six characters or more may be spaced anywhere (リック・オウエンス);
// a shorter one only where its own words part (ユマ・ワン for ユマ ワン), and a short katakana
// name never as the end of a longer katakana word: シマウマ ワンポイント is a zebra, not Uma Wang,
// ピエログイディ is Piero Guidi (グイディサイドゴアブーツ, written on, is still Guidi).
const KATA = '[\\p{Script=Katakana}ー]';
export function termSource(term, { token = false } = {}) {
  const f = fold(term).trim();
  if (CJK.test(f)) {
    const chars = [...f.replace(SEPS, '')];
    const short = chars.length <= 5;
    let src = short ? f.split(SEPS).filter(Boolean).map((w) => [...w].map(word).join('')).join(SEP) : chars.map(word).join(SEP);
    if (token) {
      const l = scriptOf(chars[0]), r = scriptOf(chars[chars.length - 1]);
      src = (l ? '(?<!' + l + ')' : '') + src + (r ? '(?!' + r + ')' : '');
    } else if (short && new RegExp(KATA, 'u').test(chars[0])) src = '(?<!' + KATA + ')' + src;
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
  'piero guidi': ['ピエログイディ', 'ピエロ グイディ'],
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
  alias: anyOf([...b.latin, ...b.ja, ...b.ko, ...(b.also || [])], { token: !!b.noisy }, 'gu'),   // `also`: read in titles, never searched
  must: b.titleMust ? anyOf(b.titleMust, {}) : null,
  ex: excludedRe(b.excludeDesigners),
}));
const M = new Map(MATCHERS.map((m) => [m.slug, m]));

// ── houses that are not ours ─────────────────────────────────────────────
// Sellers add other names to a title so that more searches find it
// (JULIUS … incarnation guidi rick owens yohji yamamoto). These are the houses
// that turn up that way: the two archives the Archive Index already keeps, the
// neighbours Carol Christian Poell's index learnt (2026-09), and what the first
// reading for these brands found (2026-10-19). A name of ours inside one of
// these is that house's (Piero Guidi). Houses our brands make collaborations
// with (Converse, Champion, adidas, Nike, Dr. Martens, Vans, Birkenstock) are
// left out on purpose: "Converse DRKSHDW" is a DRKSHDW piece.
const OTHER_TERMS = [
  // Carol Christian Poell and Helmut Lang: their own indexes, not this one
  'carol[\\s._\\-]*ch[a-z]{2,9}[\\s._\\-]*poel{1,2}(?![a-z])', 'キャロル\\s*[・･]?\\s*(?:クリスチャン\\s*[・･]?\\s*)?ポエル', '캐롤\\s*(?:크리스[찬챤]\\s*)?(?:포엘|포웰)',
  '(?<![a-z0-9])c\\.?c\\.?p(?![a-z0-9])', 'caroll(?![\\s._\\-]*ch)', 'helmut\\s*lang', 'ヘルムート\\s*ラング', '헬무트\\s*랭',
  // Carol Christian Poell's neighbours (its classify.mjs), less the houses that are ours
  'john\\s*alexander\\s*skelton', 'geoffrey\\s*b\\.?\\s*small', 'ziggy\\s*chen', 'ma[\\s_]*julius', 'carpe\\s*diem', '(?<![a-z])c[\\s-]?diem',
  'カルペディエム', 'label\\s*under\\s*construction', 'レーベルアンダー', 'devoa', 'デヴォア', 'incarnation', 'インカネーション',
  'a\\s*diciannoveventitre', '(?<![a-z0-9])a1923', 'premiata', 'プレミアータ', 'werkschwarz', 'ヴェルクシュヴァルツ', 'poeme\\s*bohemien',
  'ポエムボヘミアン', 'ematyte', 'エマタイト', 'gaultier', 'ゴルチエ', 'renato\\s*angi', 'deepti', 'ディプティ', 'oppose\\s*duality',
  'julius', 'ユリウス', 'christian\\s*peau', 'casey\\s*casey', 'archivio\\s*j', 'm[_\\s]?moriabc', 'nostrasantissima', 'yohji(?!\\s*yamamoto)', 'ヨウジ(?!\\s*ヤマモト)',
  'individual\\s*sentiments', 'インディビジュアル', 'isabel\\s*benenato', 'manamis', 'branquinho', 'yohan\\s*serfaty', 'nicolas\\s*&\\s*mark',
  'd\\s*&\\s*g(?![a-z])', 'dolce\\s*&?\\s*gabbana', 'atelier\\s*suppan', 'damir\\s*doma', 'van\\s*essche', 'officine\\s*creative', 'hadjab',
  'hi\\s*tek\\s*designs', 'greg\\s*lauren', 'sandrine\\s*philippe', 'rogosky', 'viridi[\\s-]*anne', 'ヴァリジアン', 'cinzia\\s*araia', 'gomme',
  'shellac', 'somar', 'ute\\s*ploier', 'morgan\\s*homme', 'ripvanwinkle', 'bajra', 'gabriela\\s*coll', 'morizane', 'nousan', 'christian\\s*roth',
  'クリスチャンロス', 'at(?:e)?lier\\s*inscrire', 'taichi\\s*murakami', 'leon\\s*emanuel\\s*blanck', 'jacquemyn', 'forme\\s*d.?expression',
  'portaille', 'giorgio\\s*brato', 'preamita', 'hed\\s*mayner', 'ヘドメイナー', 'ishinn', 'イシン', 'lumen\\s*et\\s*umbra',
  'ルーメン\\s*エト\\s*ウンブラ', 'valentino', 'ヴァレンティノ', 'raf\\s*simons', 'ラフ\\s*シモンズ', 'luciano\\s*soprani', 'yoshiyuki\\s*konishi', 'louboutin',
  // found in the first reading for these brands (2026-10-19)
  'piero\\s*guidi', 'ピエロ\\s*[・･]?\\s*グイディ', 'ierib', 'backlash', 'バックラッシュ', 'isamu\\s*katayama', '(?<![a-z])strum(?![a-z])',
  'professor\\s*e(?![a-z])', 'kazuyuki\\s*kumagai', 'comoli', 'コモリ', 'nonnative', 'ノンネイティブ', 'giacometti', 'tagliovivo',
  '(?<![a-z])detaj(?![a-z])', 'gianveer', '(?<![a-z])bonum(?![a-z])', 'elena\\s*dawson', 'エレナ\\s*ドーソン', 'camper', 'カンペール',
  'amiri', 'アミリ', '(?<![a-z])dior(?![a-z])', 'ディオール', 'santoni', 'trippen', 'トリッペン', 'versace', 'ヴェルサーチ',
  'fly\\s*london', 'h(?:e|ei)di\\s*slimane', '(?<![a-z0-9])a\\.?\\s?s\\.?\\s?98(?![0-9])', 'airstep', 'isaac\\s*reina', 'gareth\\s*pugh',
  '(?<![a-z])wjk(?![a-z])', '10sei0otto', 'dieci\\s*sei\\s*zero\\s*otto', 'ディエチセイゼロオット', '(?<![a-z])cthy(?![a-z])', 'entire\\s*studios',
  'wolf\\s*&\\s*dog', '14th\\s*addiction', 'new\\s*rock(?![a-z])', 'kmrii', 'if\\s*six\\s*was\\s*nine', 'ifsixwasnine', 'paul\\s*smith', 'ポール\\s*スミス', 'hermes', 'エルメス',
  // the large houses that are not among ours
  'prada', 'プラダ', 'gucci', 'グッチ', 'louis\\s*vuitton', 'ルイ\\s*ヴィトン', 'chanel', 'シャネル', 'bottega\\s*veneta', 'loewe', 'ロエベ',
  'acne\\s*studios', 'number\\s*\\(?n\\)?ine', 'ナンバーナイン', 'kapital', 'キャピタル', 'visvim', 'ビズビム', '(?<![a-z])zara(?![a-z])',
];
const OTHER = new RegExp(OTHER_TERMS.join('|'), 'gu');

// a line of another of our houses (DRKSHDW is Rick Owens's): named with its house, the piece is the line's
const LINE = new Map(ACTIVE.filter((b) => b.line).map((b) => [b.slug, b.line]));
const related = (a, b) => a === b || LINE.get(a) === b || LINE.get(b) === a;
// a house that is also a tannery: the words that, written onto its name, make it a material
// (GUIDIレザー · グイディカーフ · GUIDI社 — not "GUIDI グイディ ホースレザー", Guidi's own wording for its pieces)
const MATERIAL = new Map(ACTIVE.filter((b) => b.material).map((b) => [b.slug,
  new RegExp('^(?:' + b.material.map((w) => esc(fold(w))).join('|') + ')', 'u')]));

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
// between two names: a list (a / b, a b, a・b, a or b) or a collaboration (a x b, a × b, a + b, a for b, b by a)
const LIST_GAP = /^[\s\/,，、・･|｜;:()（）\[\]【】]*(?:(?:or|and|&|＆|や|と)[\s\/,，、・･|｜;:()（）\[\]【】]*)?$/u;
const COLLAB_GAP = /^[\s()（）]*(?:[x×✕╳]|\+|＋|コラボ|collab(?:oration)?|for|with|by|バイ)[\s()（）]*$/u;
const gapOf = (t, a, b) => t.slice(a.e, b.s);

// where each of our names, and each other house's, stands in a title
export function namesIn(title) {
  const t = fold(title), spans = [];
  for (const m of MATCHERS) {
    if (!m.alias) continue;
    m.alias.lastIndex = 0; let x;
    while ((x = m.alias.exec(t))) { if (!x[0].length) { m.alias.lastIndex++; continue; } spans.push({ slug: m.slug, s: x.index, e: x.index + x[0].length }); }
  }
  const others = []; OTHER.lastIndex = 0; let x;
  while ((x = OTHER.exec(t))) { if (!x[0].length) { OTHER.lastIndex++; continue; } others.push({ slug: null, s: x.index, e: x.index + x[0].length, o: x[0].replace(/[\s._\-・･]/g, '') }); }
  const inside = (a, o) => o.s <= a.s && o.e >= a.e;
  const longer = (a, o) => inside(a, o) && o.e - o.s > a.e - a.s;
  // a name inside a longer name of another brand belongs to that one; of ours or another house's,
  // the longer name wins, and where they are the same name it is ours
  const ours = spans.filter((a) => !spans.some((o) => o.slug !== a.slug && longer(a, o)) && !others.some((o) => longer(a, o)));
  const theirs = others.filter((a) => !spans.some((o) => inside(a, o)) && !others.some((o) => o !== a && longer(a, o)));
  return { t, spans: ours.sort((a, b) => a.s - b.s || b.e - a.e), others: theirs };
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

// the text before a list of names that may come first in a title: brackets, condition, season, price
const LEAD_NOISE = new RegExp(['【[^】]*】', '［[^］]*］', '\\[[^\\]]*\\]', '〔[^〕]*〕', '《[^》]*》', '＜[^＞]*＞', '<[^>]*>',
  '(?:極|超)?美品', '新品', '未使用', '未着用', '中古', '正規品', '本物', '国内正規', '送料(?:無料|込み?)', '即決', '即購入可?', '希少', '激レア', 'レア',
  '限定', 'タグ付き?', '最終(?:値下げ|価格)?', '(?:お)?値下げ', 'アーカイブ', 'ヴィンテージ', 'ビンテージ',
  '(?<![a-z])(?:nwt|bnwt|new|rare|vintage|used|authentic|archive|sale|grail)(?![a-z])',
  '定価[\\d,.]+万?円?', '[\\d,.]+万?円', '[¥￥$][\\d,.]+', '\\d+(?:ss|aw|fw|s\\/s|a\\/w)', '(?:ss|aw|fw)\\d+', '[^\\p{L}]+'].join('|'), 'gu');
const leadIsNoise = (s) => !/\p{L}/u.test(s.replace(LEAD_NOISE, ' '));

// title → the brands it is a listing of.
//   designated: brands the site filed it under (Grailed designer, a brand page)
// Returns { b: [slugs], why?: the reason when none, replicaLine, drop: {slug: reason} }
//
// On a search page the house named first made the piece. A name written after it is a word
// added for search, unless it is joined to it as a collaboration (Guidi × Alyx) or is that
// house's line (Rick Owens DRKSHDW). A title that opens on another house is not ours; a list of
// three or more houses after the description is a seller's keywords, and nobody's.
// On a filed listing (Grailed, a brand page) the site's filing holds, as Carol Christian Poell's
// index holds it: unless another house is named before the filed one, or named while the filed
// one is not, or the title compares the piece to a house without naming the filed one.
export function brandsOf(title, designated = []) {
  const { t, spans, others } = namesIn(title);
  const all = [...spans, ...others].map((sp) => ({ ...sp })).sort((a, b) => a.s - b.s || b.e - a.e);
  for (const sp of all) {
    const after = t.slice(sp.e, sp.e + 40), before = t.slice(Math.max(0, sp.s - 24), sp.s);
    sp.how = NOT_AFTER.test(after) || NOT_BEFORE.test(before) ? 'not'
      : LOOK_AFTER.test(after) ? 'look-after' : LOOK_BEFORE.test(before) ? 'look-before'
      : PERIOD_AFTER.test(after) ? 'period' : 'plain';
  }
  // a look-alike word covers the whole list it follows ("guidi ccp 好きな方に") or leads ("like BBS or Paul Harnden")
  for (let i = 0; i < all.length; i++) {
    if (all[i].how === 'look-after') for (let j = i - 1; j >= 0 && LIST_GAP.test(gapOf(t, all[j], all[j + 1])); j--) if (all[j].how === 'plain') all[j].how = 'look-after';
    if (all[i].how === 'look-before') for (let j = i + 1; j < all.length && LIST_GAP.test(gapOf(t, all[j - 1], all[j])); j++) if (all[j].how === 'plain') all[j].how = 'look-before';
  }
  const look = new Set(), not = new Set(), period = new Set();
  for (const sp of all) if (sp.slug) {
    if (sp.how === 'not') not.add(sp.slug);
    else if (sp.how.startsWith('look')) look.add(sp.slug);
    else if (sp.how === 'period') period.add(sp.slug);
  }
  const plain = all.filter((sp) => sp.how === 'plain');
  const des = designated.filter((s) => M.has(s));
  const named = new Set(plain.filter((sp) => sp.slug).map((sp) => sp.slug));
  const replicaLine = des.includes('maison-margiela') || named.has('maison-margiela') || des.includes('tabi-footwear') || named.has('tabi-footwear');
  const out = { b: [], replicaLine, drop: {} };
  const why = excludeReason(title, { replicaLine });
  if (why) return { ...out, why };
  // the names joined to one: the same house written again (リックオウエンス Rick Owens), its line,
  // or a house joined by a collaboration word, forwards and back
  const joined = (i) => {
    const set = new Set([i]);
    // a name at this place (two of ours can share one: Rick Owens, and Dr. Martens x Rick Owens) of a house already in
    const same = (sp) => plain.some((o) => o.s === sp.s && o.slug && [...set].some((k) => plain[k].slug && related(plain[k].slug, o.slug)));
    const tie = (a, b) => b.s === a.s || COLLAB_GAP.test(gapOf(t, a, b)) || (LIST_GAP.test(gapOf(t, a, b)) && same(b));
    for (let j = i + 1; j < plain.length && tie(plain[j - 1], plain[j]); j++) set.add(j);
    for (let j = i - 1; j >= 0 && (plain[j].s === plain[j + 1].s || COLLAB_GAP.test(gapOf(t, plain[j], plain[j + 1])) || (LIST_GAP.test(gapOf(t, plain[j], plain[j + 1])) && same(plain[j]))); j--) set.add(j);
    return set;
  };
  let cand;
  if (!des.length) {
    // on a search page, a title that says "…風" or "not …" about any of our names is not to be trusted for any
    if (look.size || not.size) return { ...out, why: not.size ? 'not-brand' : 'style-of' };
    if (!plain.length) return { ...out, why: period.size ? 'period-of' : 'no-brand' };
    // the run of names the first one stands in: three houses or more after a description are keywords
    let k = 0; while (k + 1 < plain.length && LIST_GAP.test(gapOf(t, plain[k], plain[k + 1]))) k++;
    // one house a place (Rick Owens and Dr. Martens x Rick Owens share a name), a line with its house
    const houses = new Set(plain.slice(0, k + 1).filter((sp, i, a) => !i || sp.s !== a[i - 1].s).map((sp) => sp.slug ? (LINE.get(sp.slug) || sp.slug) : 'o:' + sp.o));
    // …and two or more that end the title after a description (entire studios パンツ guidi devoa)
    // (a partner joined to the first name, CONVERSE×RICK OWENS, is not a description)
    const described = !leadIsNoise(t.slice(0, plain[0].s)) && !/(?:[x×✕╳+＋]|コラボ)\s*$/u.test(t.slice(0, plain[0].s));
    const endsTitle = leadIsNoise(t.slice(Math.max(...plain.slice(0, k + 1).map((sp) => sp.e))));
    if (described && (houses.size >= 3 || (houses.size >= 2 && endsTitle))) return { ...out, why: 'brand-list' };
    const maker = [...joined(0)].map((i) => plain[i]);
    cand = [...new Set(maker.filter((sp) => sp.slug).map((sp) => sp.slug))];
    if (!cand.length) return { ...out, why: 'other-brand' };
  } else {
    // a filed listing is the brands it was filed under and no others, unless the title gives it
    // to another house: a Grailed title that says "off-white" about a Rick Owens sweater is a colour
    cand = [];
    for (const d of des) {
      if (look.has(d)) { out.drop[d] = 'style-of'; continue; }
      if (not.has(d)) { out.drop[d] = 'not-brand'; continue; }
      const mine = plain.findIndex((sp) => sp.slug && related(sp.slug, d));
      const near = mine >= 0 ? joined(mine) : new Set();
      const foreign = plain.filter((sp, i) => !(sp.slug && (related(sp.slug, d) || des.includes(sp.slug))) && !near.has(i));
      if (mine >= 0 ? foreign.some((sp) => sp.s < plain[mine].s) : foreign.length) { out.drop[d] = 'other-brand'; continue; }
      if (mine < 0 && all.some((sp) => sp.how.startsWith('look'))) { out.drop[d] = 'style-of'; continue; }
      cand.push(d);
    }
  }
  // a house's line named with it: the line's piece
  for (const [line, house] of LINE) {
    if (cand.includes(house) && (cand.includes(line) || named.has(line))) cand = cand.filter((s) => s !== house).concat(cand.includes(line) ? [] : [line]);
  }
  // a house that is also a tannery (Guidi): its name written as a material (GUIDIコードヴァン), with
  // another house named in the title that is not its partner, is that house's piece in its leather
  cand = cand.filter((slug) => {
    const re = MATERIAL.get(slug); if (!re) return true;
    const mine = plain.map((sp, i) => (sp.slug === slug ? i : -1)).filter((i) => i >= 0);
    if (!mine.some((i) => re.test(t.slice(plain[i].e, plain[i].e + 16)))) return true;
    const near = new Set(mine.flatMap((i) => [...joined(i)]));
    if (plain.some((sp, i) => !near.has(i) && !(sp.slug && (related(sp.slug, slug) || cand.includes(sp.slug))))) { out.drop[slug] = 'material-of'; return false; }
    return true;
  });
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
  for (const s of look) if (!out.drop[s]) out.drop[s] = 'style-of';
  for (const s of not) if (!out.drop[s]) out.drop[s] = 'not-brand';
  if (!out.b.length) { const why = Object.values(out.drop); out.why = WHY.find((w) => why.includes(w)) || 'no-brand'; }
  return out;
}
// when no brand is left, the reason said is the one that tells most
const WHY = ['not-brand', 'style-of', 'other-brand', 'material-of', 'excluded-designer', 'big-undated', 'period-of', 'title-must'];

// ── what is searched ──────────────────────────────────────────────────────
// A brand's searches: its plain Latin name (latin[0]) and each Japanese alias.
// The same words spaced or not are one search (アン ドゥムルメステール = アンドゥムルメステール),
// and one search serves every brand that has it. A brand whose Latin name is another
// house's (Dr. Martens x Rick Owens: "rick owens") searches with its required term added.
const squash = (q) => fold(q).replace(SEPS, '');
export function queriesOf(b) {
  if (b.pages === false) return [];                // a common word: no searches (brands.json says why)
  let en = b.latin[0];
  if (!en) return [...new Set(b.ja || [])];
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
const LABEL = new RegExp('^(?:' + [...new Set(BRANDS.flatMap((b) => [b.name, ...b.latin, ...b.ja, ...b.ko, ...(b.also || [])]).map((x) => fold(x).trim()).filter(Boolean))]
  .sort((a, b) => b.length - a.length).map((x) => termSource(x)).join('|') + ')(?:\\s*[(（][^)）]*[)）])?$', 'u');
export const brandLabel = { test: (s) => LABEL.test(fold(s).trim()) };
