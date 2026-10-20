// Reading a listing title — Japanese, Korean or English — for any of the brands.
// Every decision rests on words that are in the title. Nothing is guessed.
// (Carol Christian Poell's classify.mjs, with what was CCP's own taken out:
// its name, its model numbers, its vocabulary. Which brand a title names is
// brands.mjs's job.)
//
//   tier A  one year or season is written        2009 · SS97 · 07SS · AW2002 · 02fw · P/E 2002 · 96〜97AW · 1985
//   tier B  the seller names a period, not one year
//           1990s · 90s · 00s · 1980年代 · 96-97 · 00-01 · 2008-9 · 初期 · 本人期 · archive · アーカイブ
//   tier C  nothing to go on
//
// Excluded — not a listing of a thing you can buy:
//   not-brand    ブランド不明 · ノーブランド · 元ネタ
//   reserved     専用 · 様へ — held for one named buyer
//   wanted       구매) · 구해요 · WTB — someone asking to buy
//   rental       렌탈 · レンタル
//   fake         レプリカ · replica · 가품 (Maison Margiela's own Replica line is not one)
//   not-garment  perfume, cosmetics, records and books, car parts, an empty box,
//                trading cards, sheet music; printed matter (a lookbook, a catalogue)
//                that names nothing to wear or carry
//
// Before any number is read as a year, the title is cleared of the numbers
// that are not years: prices (定価612.700円 · 参考上代998800円 · ¥19,800),
// reference and shop numbers (REF.N 0362 · (16394M)), labelled sizes
// (size 10-11), durations (10年保管 · 20年以上前), imperial dates, a car's 年式.

const nk = (s) => { try { return String(s ?? '').normalize('NFKC'); } catch { return String(s ?? ''); } };
export const FIRST_YEAR = 1950;
export const lastYear = () => new Date(Date.now() + 9 * 3600e3).getUTCFullYear();   // the current year (KST)
const inEra = (y) => y >= FIRST_YEAR && y <= lastYear();
// a two-digit year as CCP reads it: 90..99 → 19xx, 00..89 → 20xx
const yy = (n) => (n >= 90 ? 1900 + n : 2000 + n);
const full = (s) => (String(s).length === 4 ? Number(s) : yy(Number(s)));

// ── not a listing of a thing you can buy ──────────────────────────────────
const NOT_BRAND = /ブランド不明|ノーブランド|no\s*brand|元ネタ/i;
// held for a named buyer — not 専用ケース付き (comes with its own case)
const RESERVED = /(?:様|さま|さん|くん|ちゃん)\s*へ|専用(?!\s*(?:袋|紙袋|箱|ケース|ハンガー|バッグ|ダストバッグ|ポーチ|カバー|保存|シュー|ボックス|box|タグ|ソール|ツリー|ガーメント|キーパー|クリーナー|ケア|布|ショッパー))|取り置き/i;
const WANTED = /^\s*[\[(【]?\s*(?:구매|구함|구해요|삽니다|wtb)\s*[\])】:]|구해요|구합니다|삽니다|\bwtb\b|want\s*to\s*buy|求む|探しています/i;
const RENTAL = /렌탈|렌트(?![가-힣])|レンタル|\brental\b/i;
const FAKE = /レプリカ|replica|偽物|コピー品|(?<![a-z])fake(?![a-z])|가품|레플리카|이미테이션|짝퉁/i;
// "not fake", "가품 시 환불", "fake fur": a seller vouching, or a material
// removed from the title before FAKE is asked, so each negation covers only its own word
const NOT_FAKE = /not\s*(?:a\s*)?fake|no\s*fake|fake\s*(?:fur|leather|suede|pocket|layer|collar)|가품\s*(?:시|x|아님|일\s*(?:경우|시)|이면|판정|보장|절대)|\(\s*가품\s*x\s*\)|偽物\s*(?:では|じゃ)(?:ない|ありません)/gi;
// Maison Margiela names a line Replica (sneakers, scent): with that house named, it is a name
const REPLICA_LINE = /replica|レプリカ|레플리카/gi;
// not a garment, a bag, shoes or jewellery: what a brand's name also sells or is also the word for
// (the Helmut Lang index's JUNK rule, in three languages). Each word is one that a clothing title
// does not use otherwise: 雑誌掲載 (featured in a magazine), レコードバッグ, 紙袋付き stay.
const NOT_GARMENT = new RegExp([
  '香水', 'パルファ[ムン]', 'オードトワレ', 'オードパルファム', 'オーデコロン', 'フレグランス', '(?<![a-z])(?:perfume|parfum|fragrance|cologne)', '(?<![a-z])eau\\s*d(?:e|[\'’])',
  '향수', '퍼퓸', '口紅', 'コスメ', '化粧品', '(?<![a-z])(?:cosmetics?|lipstick|mascara)(?![a-z])', '립스틱', '화장품', 'ネイル\\s*(?:カラー|ポリッシュ)', 'nail\\s*polish',
  '(?<![a-z0-9])(?:cd|dvd|lp|blu-?ray|vhs)(?![a-z0-9])', 'レコード(?!\\s*バッグ)', '(?<![a-z])(?:vinyl\\s*record|magazine|poster)(?![a-z])', '雑誌(?!\\s*(?:掲載|着用|で))', '写真集', '書籍', '作品集', 'ポスター(?!\\s*バッグ)',
  '年式', '車検', '走行距離', 'エンジン(?!ニア)', 'ディーゼル\\s*(?:車|エンジン|発電機|ポンプ)', '(?:フロント|リア)\\s*アンダー\\s*カバー', 'ホイール', 'タイヤ', 'バンパー', 'ラジエーター',
  '(?<![a-z])(?:engine|forklift)(?![a-z])',          // not "tractor": a tractor sole is a boot's
  // the first day's reading (2026-10-20): skin care (Copernica's toner, a Korean POIRET's), Yu-Gi-Oh! cards
  // (the BODE-JP038 set), sheet music (Zimmermann the publisher). Not "foundation": A-Cold-Wall*'s line
  '化粧水', '美容液', '乳液', '化粧下地', 'メイク\\s*アップ\\s*ベース', 'スキンケア', '(?<![a-z])skin\\s*care(?![a-z])', '스킨케어',
  '遊戯王', '(?<![ァ-ヶー])トレカ(?![ァ-ヶー])', 'トレーディング\\s*カード', 'ポケモン\\s*カード', '(?<![a-z])(?:yu-?gi-?oh|trading\\s*cards?)(?![a-z])', '楽譜',
  '空箱', '箱のみ', '袋のみ', '紙袋のみ', 'ショッパーのみ', 'ハンガーのみ', 'タグのみ', '(?<![a-z])(?:empty\\s*box|box\\s*only|dust\\s*bag\\s*only)(?![a-z])',
].join('|'), 'i');

export function excludeReason(title, { replicaLine = false } = {}) {
  const t = nk(title);
  if (NOT_BRAND.test(t)) return 'not-brand';
  if (RESERVED.test(t)) return 'reserved';
  if (WANTED.test(t)) return 'wanted';
  if (RENTAL.test(t)) return 'rental';
  let f = t.replace(NOT_FAKE, ' ');
  if (replicaLine) f = f.replace(REPLICA_LINE, ' ');
  if (FAKE.test(f)) return 'fake';
  if (NOT_GARMENT.test(t)) return 'not-garment';
  return null;
}

// ── what the seller said instead of a year ────────────────────────────────
//  kind  label           rank (lower wins)
//  bought 2003년 구입      1   a purchase year dates the purchase, not the garment
//  about  1999년 무렵      1   頃 · ごろ · 前後 · 쯤 · circa · c. · early/late 2000
//  rng    1996–97         1   a span of years
//  multi  1998 · 1999     1   two different years in one title
//  dec    1990년대 (후반)   2   1990s · 90's · 00s · 80年代(後半) · 2010s
//  y2k    Y2K             2
//  early  본인기 · 초기     3   本人期 (the designer's own years) · 初期 · 極初期 · 초기
//  arch   아카이브          4   archive · archival · アーカイブ · 아카이브
const ARCH = /アーカイブ|archiv(?:e|al)|아카이브/i;
const EARLY = /初期|초기|\bearly\s+(?:piece|period|era|collection|work)/i;
const SELF = /本人期|본인기|본인\s*시기/;
const QUAL = { early: '초반', mid: '중반', late: '후반', '前半': '초반', '初頭': '초반', '中頃': '중반', '後半': '후반', '末': '후반' };
const AP = "['’‘]?";
// a decade, written as two digits (50s–90s, 00s) or four (1950s–2020s)
const DEC = '((?:19)?[5-9]0|(?:20)?00|20[12]0)';
const decLabel = (d) => (d.length === 4 ? d : d === '00' ? '2000' : '19' + d) + '년대';

// the numbers in a title that are not years, cut before anything is read
function clean(t) {
  return t
    .replace(/(?:定価|정가|retail|rrp|msrp|参考上代|上代|원가|送料込み?|送料無料)\s*[:：]?\s*[¥￥$₩£€]?\s*\d[\d,.]*(?![\d,.])(?!\s*(?:ss|aw|fw|a\/w|s\/s|年|년|'))\s*(?:円|원|엔)?/gi, ' ')
    .replace(/[¥￥$₩£€]\s*[\d,]+(?:\.\d+)?|[\d,.]+\s*(?:円|원|엔|yen|usd|krw|eur(?:os?)?|gbp|jpy|dollars?|pounds?|ドル|달러|유로)(?![a-z])|[\d,.]+[€$£¥￥₩]/gi, ' ')
    .replace(/(?:\bno\.?|品番|管理番号|商品番号)\s*\d+/gi, ' ')
    .replace(/\bref\.?\s*n?[o°]?\.?\s*\d+/gi, ' ')
    .replace(/\(\s*\d{4,6}[A-Z]\s*\)|(?<![A-Za-z0-9])\d{5,}[A-Z]?(?![A-Za-z0-9])/g, ' ')
    .replace(/(?:size|サイズ|사이즈|sz)\s*[:：.]?\s*\d{1,3}(?:\.\d)?(?:\s*[-~〜\/]\s*\d{1,3}(?:\.\d)?)?/gi, ' ')
    .replace(/\d+\s*(?:年|년)\s*(?:以上|以前|ほど|程|くらい|ぐらい|間|近く|ぶり|前|物|保管|使用|着用|愛用|式|전|이상|정도|넘게|간|된|동안|착용|사용|보관)/g, ' ')
    .replace(/(?:平成|昭和|令和)\s*\d+\s*年/g, ' ')
    .replace(/(?<![a-z0-9])s\/s\s*[-.]?\s*(?:3\d|4\d|5\d)(?!\d)|(?<!\d)(?:3\d|4\d|5\d)\s*[-.]?\s*s\/s(?![a-z])/gi, ' ');
}

export function era(title) {
  let t = clean(nk(title));
  const claims = [];
  const say = (k, v, rank) => claims.push({ k, v, rank });
  if (SELF.test(t)) say('early', '본인기', 3);
  if (EARLY.test(t)) say('early', '초기', 3);
  if (ARCH.test(t)) say('arch', '아카이브', 4);
  const cut = (re, fn) => { t = t.replace(re, (...m) => { if (fn) fn(...m); return ' '; }); };

  cut(/(?<!\d)((?:19|20)?\d{2})\s*(?:年|년)?\s*(?:[^\s\d]{0,6})?\s*(?:購入|구입)/g, (m, y) => { if (inEra(full(y))) say('bought', full(y) + '년 구입', 1); });
  cut(/\b(?:bought|purchased|acquired)\b[^0-9]{0,12}((?:19|20)\d{2})(?!\d)/gi, (m, y) => { if (inEra(+y)) say('bought', y + '년 구입', 1); });

  // seasons as [kind as written, year]
  const years = new Set(), seasons = [];
  // a fall/winter season runs across two years: 05-06AW · AW 2000/2001 · 97-98 A/W · A/W '98-'99 · 96〜97AW
  const SAW = '(a\\/?w|f\\/?w|a\\/i|秋冬|fall|winter)';
  const Y2 = "'?((?:19|20)?\\d{2})";
  t = t.replace(new RegExp('(?<!\\d)' + Y2 + '\\s*[-‐‑〜~～–/]\\s*' + Y2 + '\\s*' + SAW + '|' + SAW + '\\s*' + Y2 + '\\s*[-‐‑〜~～–/]\\s*' + Y2 + '(?!\\d)', 'gi'),
    (m, a1, b1, s1, s2, a2, b2) => { const a = a1 || a2, b = b1 || b2, w = (s1 || s2).toLowerCase();
      if (full(b) !== full(a) + 1 || !inEra(full(a))) return m;
      seasons.push([/^f\/?w$/.test(w) ? 'FW' : 'AW', full(a)]);
      return ' '; });
  // any other span: the seller does not say which year
  const span = (m, a, b) => {
    const y1 = full(a);
    let y2;
    if (b.length === 1) { y2 = Math.floor(y1 / 10) * 10 + Number(b); if (y2 <= y1) y2 += 10; }
    else y2 = full(b);
    if (inEra(y1) && inEra(y2) && y2 > y1 && y2 - y1 <= 12) {
      const tail = b.length === 4 ? b : String(y2).slice(-2);
      say('rng', y1 + '–' + tail, 1); return ' '; }
    return m; };
  t = t.replace(/(?<!\d)((?:19|20)?\d{2})\s*[〜~～\-‐‑–—]\s*((?:19|20)?\d{2})(?!\d)/g, span);
  t = t.replace(/(?<!\d)((?:19|20)\d{2})\s*[\-‐‑–—〜~～]\s*(\d)(?!\d)/g, span);            // 2008‐9
  t = t.replace(/(?<!\d)((?:19|20)\d{2})\s*\/\s*((?:19|20)?\d{2})(?!\d)/g, span);          // 1998/99

  // decades: an era, not a year. 1980s · 90's · 00s · 2000s · 2010s · 70年代後半
  cut(new RegExp('\\b(?:(early|mid|late)[\\s-]*)?(?<!\\d)' + DEC + '\\s*' + AP + '\\s*s\\b(?!\\s*\\/\\s*s)', 'gi'),
      (m, q, d) => say('dec', decLabel(d) + (q ? ' ' + QUAL[q.toLowerCase()] : ''), 2));
  cut(new RegExp('(?<!\\d)' + DEC + '\\s*(?:年代|년대)\\s*(前半|初頭|中頃|後半|末)?', 'g'),
      (m, d, q) => say('dec', decLabel(d) + (q ? ' ' + QUAL[q] : ''), 2));
  cut(/\by2k\b/gi, () => say('y2k', 'Y2K', 2));
  cut(/(?<!\d)((?:19|20)?\d{2})\s*(?:年|년)?\s*(?:頃|ごろ|前後|쯤|경)(?![가-힣])/g, (m, y) => { if (inEra(full(y))) say('about', full(y) + '년 무렵', 1); });
  cut(/(?:\bcirca|\bca\.?|\bc\.)\s*((?:19|20)\d{2})(?!\d)/gi, (m, y) => { if (inEra(+y)) say('about', y + '년 무렵', 1); });
  cut(/\b(?:early|mid|late)[\s-]*((?:19|20)\d{2})(?!\d)/gi, (m, y) => { if (inEra(+y)) say('about', y + '년 무렵', 1); });

  // seasons, Latin: SS97 · S/S97 · FW 02 · AW'99 · P/E 2002 · 2006SS · 07SS · 02fw · 25AW · AW1985
  const S = '(a\\/?w|f\\/?w|s\\/?s|p\\/e|a\\/i|sp|ss|aw|fw)';
  for (const m of t.matchAll(new RegExp('(?<![a-z0-9])' + S + "\\s*[-./]?\\s*'?(\\d{2})(?!\\d)", 'gi'))) seasons.push([m[1], yy(Number(m[2]))]);
  for (const m of t.matchAll(new RegExp('(?<![a-z0-9])' + S + '\\s*[-./]?\\s*((?:19|20)\\d{2})(?!\\d)', 'gi'))) seasons.push([m[1], Number(m[2])]);
  for (const m of t.matchAll(new RegExp('(?<!\\d)((?:19|20)\\d{2})\\s*[-./]?\\s*' + S + '(?![a-z])', 'gi'))) seasons.push([m[2], Number(m[1])]);
  for (const m of t.matchAll(new RegExp("(?<![\\d])'?(\\d{2})\\s*[-.]?\\s*" + S + '(?![a-z])', 'gi'))) seasons.push([m[2], yy(Number(m[1]))]);
  // seasons, Japanese: 99春夏 · 03秋冬 · 1999秋冬 · 1985秋冬
  for (const m of t.matchAll(/(?<!\d)((?:19|20)\d{2}|\d{2})\s*(春夏|秋冬)/g)) seasons.push([m[2] === '春夏' ? 'SS' : 'AW', full(m[1])]);
  // four-digit years, '99, 99年
  for (const m of t.matchAll(/(?<!\d)(19[5-9]\d|20[0-3]\d)(?!\d)/g)) { const y = Number(m[1]); if (inEra(y)) years.add(y); }
  for (const m of t.matchAll(/(?<![\w'])'(\d{2})(?!\d)/g)) { const y = yy(Number(m[1])); if (inEra(y)) years.add(y); }
  for (const m of t.matchAll(/(?<!\d)(\d{2})\s*(?:年(?!代)|년(?!대))/g)) { const y = yy(Number(m[1])); if (inEra(y)) years.add(y); }

  const tags = new Map();   // year -> the seasons written for it, first-written form kept
  for (const [s, y] of seasons) {
    if (!inEra(y)) continue;
    years.add(y);
    // the site reads a two-digit season tag as 19xx only from 90 on: before 1990 the year stands alone
    if (y < 1990) continue;
    const w = s.replace('/', '').toUpperCase();
    const tag = (w === 'PE' ? 'SS' : w === 'AI' ? 'AW' : w === 'SP' ? 'SS' : w === '秋冬' ? 'AW' : w === '春夏' ? 'SS' : w) + String(y).slice(-2);
    const same = tag.replace(/^FW/, 'AW');          // FW00 and AW00 are one season
    const m = tags.get(y) || tags.set(y, new Map()).get(y); if (!m.has(same)) m.set(same, tag);
  }
  if (years.size === 1) {
    const y = [...years][0], ts = tags.get(y);
    // one season named: say it the way the seller did. Two seasons of one year: the year.
    return { tier: 'A', era: ts && ts.size === 1 ? [...ts.values()][0] : String(y) };
  }
  if (years.size > 1 || claims.length) {
    if (years.size > 1) say('multi', [...years].sort().join(' · '), 1);
    const best = claims.sort((x, y) => x.rank - y.rank)[0];
    return { tier: 'B', era: null, ...(best ? { claim: best.v, claimKind: best.k } : {}) };
  }
  return { tier: 'C', era: null };
}

// ── what kind of thing it is ──────────────────────────────────────────────
// First match wins, so the order matters: a vest bag is a bag, boots are boots
// before anything else in the title, a shirt jacket is a jacket, a T-shirt is
// not a shirt, a knit vest is a knit.
export const SECTIONS = ['아우터', '테일러링', '셔츠', '상의', '팬츠', '데님', '신발', '가방·소품', '주얼리', '기타'];
const SECTION = [
  ['기타', /\bdress(?!\s*(?:shirt|pants?|trousers?|slacks|shoes?|boots?))(?:es)?\b|\bskirts?\b|ワンピース|スカート|ドレス(?!\s*(?:シャツ|パンツ|シューズ|ブーツ))|원피스|스커트|드레스(?!\s*(?:셔츠|팬츠|슈즈))/i],
  // a sneaker named by its cut (High Top · Low-Top · Hi-Top · ハイカット) is a shoe, whatever else the title says
  // (Eyelet Ring High Top is not a ring, Canvas High Top is not a top)
  ['신발', /(?<![a-z])(?:low|high|hi|mid)[\s-]?tops?(?![a-z])|ハイカット|ローカット|ミッドカット|하이탑|로우탑|미드탑/i],
  ['주얼리', /\brings?\b|necklace|pendant|bracelet|bangle|earrings?|dog\s*tag|リング|ネックレス|ペンダント|ブレスレット|(?<!ー)ブレス(?!ト|ス|レ)|バングル|指輪|ピアス|イヤリング|ドッグタグ|반지|목걸이|팔찌|펜던트|귀걸이|이어링/i],
  ['가방·소품', /\bbags?\b|backpack|rucksack|\btote\b|pouch|wallet|\bpurse\b|バッグ|バックパック|リュック|ポーチ|財布|ウォレット|パース|鞄|가방|백팩|지갑|파우치|(?:베스트|토트|숄더)\s*백/i],
  ['신발', /boot(?!\s*-?cut)|sneakers?|\bshoes?\b|derbys?|derbies|loafers?|sandals?|slippers?|creepers?|\bbrogues?\b|ブーツ(?!カット)|スニーカー|シューズ|短靴|革靴|靴(?!下)|ダービー|ローファー|サンダル|スリッポン|부츠(?!컷)|스니커즈|신발|구두|더비|로퍼|샌들|워커/i],
  ['상의', /knit\s*(?:vest|top)|sleeveless\s*knit|ニット\s*ベスト|スリーブレス\s*ニット|니트\s*(?:베스트|조끼)/i],
  ['테일러링', /blazer|tailored|\bsuit\b|set[\s-]?up|\b[12]\s*b\b|\b1\s*button\b|sport\s*coat|テーラード|(?<!ジャンプ)スーツ|ブレ[ー]?ザー|セットアップ|블레이저|(?<!점프)수트|정장|셋업|테일러드/i],
  ['아우터', /high[\s-]?neck(?=[\s\S]*(?:leather|レザー|레더))|ハイネック\s*レザー|하이넥\s*레더|jacket|(?<![a-z])jkt(?![a-z])|(?<![a-z])jk(?![a-z])|coat(?!ed|ing)|parka|blouson|bomber|\bvest\b|gilet|caban|trench|riders|\bbiker\b|anorak|\bcape\b|poncho|ジャケット|コート|ブルゾン|ライダース|ボンバー|ベスト|ジレ|マウンテンパーカ|ケープ|マント|자켓|재킷|코트|점퍼|파카|베스트|조끼|블루종|카반|라이더/i],
  ['데님', /denim|jeans|\bjean\b|デニム|ジーンズ|데님|청바지/i],
  ['팬츠', /pants|trousers|slacks|shorts|leggings|long[\s-]?johns|パンツ|スラックス|トラウザー|ショーツ|ボトム|レギンス|팬츠|바지|슬랙스|반바지|트라우저|레깅스/i],
  ['셔츠', /(?<!\bt[\s-]?)shirt(?!s?\s*jacket)|button[\s-]?(?:up|down)s?(?![a-z])|blouse|(?<![tTｔＴ])シャツ(?!\s*ジャケット)|ブラウス|(?<!티)셔츠|블라우스/i],
  ['상의', /\bt[\s-]?shirt|\btee\b|cut\s*(?:and\s*)?sew|knit|sweater|jumper|cardigan|hoodie|sweatshirt|\btanks?\b|\btops?\b|turtleneck|jersey|\bpolo\b|long[\s-]?sleeves?|tシャツ|カットソー|ニット|セーター|カーディガン|パーカー|フーディ|タンク|スウェット|トップス|티셔츠|니트|스웨터|가디건|후드|맨투맨|나시|반팔|긴팔/i],
  ['가방·소품', /\bbelts?\b|gloves?\b|mittens|scarf|stole|muffler|\bhats?\b|\bcaps?\b|beanie|socks|\btie\b|key\s*(?:ring|chain|holder)|metal\s*tag|ベルト|グローブ|手袋|マフラー|ストール|帽子|キャップ|ハット|ビーニー|ソックス|靴下|ネクタイ|キーリング|キーホルダー|メタルタグ|벨트|장갑|머플러|스카프|모자|비니|양말|넥타이|키링/i],
];
export function section(title) {
  const t = nk(title);
  for (const [s, re] of SECTION) if (re.test(t)) return s;
  return '기타';
}

// ── size ─────────────────────────────────────────────────────────────────
// Only what reads as a size: a labelled size (サイズ48 · size 7 · Sz.46 · 7 size),
// fruitsfamily's bracket ([50] · 50) · (9)), an Italian size standing on its
// own in a garment's title (48 · 44/46 · 50/48), a shoe size standing on its own
// in a shoe's title (boots 7 · DERBYS 9), a length in cm on shoes.
export function size(title, sec = section(title)) {
  const raw = nk(title);
  let m = /(?:size|サイズ|사이즈|sz)\s*[:：.]?\s*((?:uk|us|eu|it|jp)\s*)?(\d{1,3}(?:\.5)?|xxs|xs|s|m|l|xl|xxl|free|f)(?![a-z0-9])/i.exec(raw);
  if (m) return ((m[1] ? m[1].trim().toUpperCase() + ' ' : '') + m[2]).toUpperCase();
  // a scale written with the number stays with it: UK 8 is not EU 8
  if ((m = /(?<![a-z])(uk|us|eu|it|jp)\s*(\d{1,2}(?:\.5)?)(?![\d.])/i.exec(raw))) return m[1].toUpperCase() + ' ' + m[2];
  if ((m = /(?<![\w.])(\d{1,2}(?:\.5)?)\s*size\b/i.exec(raw))) return m[1];
  if ((m = /^\s*\[(\d{1,3})\]/.exec(raw)) || (m = /^\s*(\d{2})\)/.exec(raw)) || (m = /\((\d{1,2}(?:\.5)?)\)\s*$/.exec(raw))) return m[1];
  // cleared of everything that is not a size
  let t = ' ' + clean(raw) + ' ';
  t = t.replace(/(?<!\d)(?:19|20)\d{2}(?!\d)/g, ' ').replace(/['’‘]\d{2}(?!\d)/g, ' ').replace(/(?<!\d)\d{1,2}\s*(?:年|년)\S*/g, ' ')
       .replace(/(?<![a-z0-9])(?:a\/?w|f\/?w|s\/?s|p\/e|a\/i|ss|aw|fw)\s*'?\d{2}(?!\d)|(?<!\d)\d{2}\s*(?:ss|aw|fw|a\/w|s\/s)(?![a-z])/gi, ' ')
       .replace(/(?<!\d)\d{2}\s*[-〜~～]\s*\d{2}(?!\d)/g, ' ')
       .replace(/[A-Za-z]+[\-\/]\d+/g, ' ');                       // codes and fabric codes: CM/2240 · ASA/10 · PTC/33
  const B = '(?<![A-Za-z0-9.:%#°\\-])', E = '(?![A-Za-z0-9.%°\\-])';
  if (sec === '신발') {
    // UK/US numbers (4–13) or EU numbers (35–47), whichever the seller used
    const s = [...t.matchAll(new RegExp(B + '(\\d{1,2}(?:\\.5)?)' + E, 'g'))].map((x) => x[1])
      .filter((v) => (+v >= 4 && +v <= 13) || (+v >= 35 && +v <= 47 && Number.isInteger(+v)));
    if (s.length) return s[s.length - 1];
    const cm = new RegExp(B + '(2\\d(?:\\.\\d)?)\\s*cm(?![a-z])', 'i').exec(t); if (cm) return cm[1].replace(/\.0$/, '') + 'cm';
    return null;
  }
  const it = (v) => +v >= 40 && +v <= 58 && +v % 2 === 0;
  m = new RegExp(B + '(\\d{2})\\s*\\/\\s*(\\d{2})' + E).exec(t);
  if (m && it(m[1]) && it(m[2])) return m[1] + '/' + m[2];
  const one = [...t.matchAll(new RegExp(B + '(\\d{2})' + E, 'g'))].map((x) => x[1]).filter(it);
  if (one.length) return one[0];
  m = /(?<![a-z0-9])(xxs|xs|xxl|xl)(?![a-z0-9])/i.exec(t); if (m) return m[1].toUpperCase();
  return null;
}

// new, unworn — as the title says it (新品同様 "like new" is used)
export const NEW_RE = /新品(?!\s*同様|\s*に近い)|未使用(?!\s*に近い)|未着用|デッドストック|deadstock|\bbnwt\b|\bnwt\b|new\s*with\s*tags|unworn|새상품|새\s*상품|미착용/i;

// printed matter: a lookbook, a catalogue, a book, an exhibition's catalogue. A collection's
// catalogue carries its season and so would read as a dated piece. It is left out when neither
// the title nor the seller's category names a thing to wear or carry: "Undercover SS13 Lookbook
// Leopard Panel Shirt", "AW03 Catalogue Wallet", a dress with a book-shelf print stay.
const PRINTED = new RegExp([
  '(?<![a-z])(?:look\\s*-?\\s*books?|catalog(?:ue)?s?|booklets?|books?|hard\\s*cover|hardback|paperback|zine)(?![a-z])',
  'ルックブック', 'カタログ', 'ブランドブック', 'アートブック', '洋書', '図録', '初版', '展覧会', '衣装展', '美術館', 'ムック',
  'm[^a-z0-9]{0,3}e?moire\\s*de\\s*la\\s*mode', '룩북', '카탈로그', '도록', '화보집',     // Mémoire de la mode: a series of books on couturiers
].join('|'), 'i');
const wearable = (s) => SECTION.some(([, re]) => re.test(s));
export const printed = (title, cat) => { const t = nk(title); return PRINTED.test(t) && !wearable(t) && !(cat && wearable(nk(cat))); };

// item: { title, cat?, size?, replicaLine? } — which brand it is has been settled (brands.mjs)
export function classify(item) {
  const why = excludeReason(item.title, { replicaLine: !!item.replicaLine });
  if (why) return { exclude: why };
  if (printed(item.title, item.cat)) return { exclude: 'not-garment' };
  const e = era(item.title);
  // what the title does not say, the category the seller filed it under may
  // (Rakuma: 靴/シューズ(ブーツ) · Grailed: footwear.boots); the title comes first
  const own = section(item.title);
  const sec = own === '기타' && item.cat ? section(item.cat) : own;
  const z = item.size || size(item.title, sec);
  return { tier: e.tier, era: e.era, ...(e.claim ? { claim: e.claim, claimKind: e.claimKind } : {}),
           section: sec, ...(z ? { size: z } : {}) };
}
