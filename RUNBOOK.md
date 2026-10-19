# ARCHIVE INDEX — Brands · 일간 발행 지침

L'Eclaireur 패션 브랜드 131개의 중고 매물을 매일 모아 브랜드별 데이터로 발행한다.
Carol Christian Poell 인덱스(`rozykuzy/ccp`)의 수집기·대장·조판을 여러 브랜드로 넓힌 것이다. 같은 원칙, 같은 코드.

- **저장소** `rozykuzy/BRAND` (공개). **데이터** https://rozykuzy.github.io/BRAND/ — `index.json` · `b/<slug>.json` · `new.json`
- **보는 곳** 통합 사이트 https://rozykuzy.github.io/?view=brands (같은 origin에서 위 데이터를 읽는다). `site/index.html` 은 그리로 가는 링크 한 줄
- **발행** GitHub Actions `daily` — 매일 21:41 UTC = **06:41 KST**, 최대 300분. PC가 필요 없다
- **메일** `data/mail_meta.json` · `data/mail_lines.txt` — 신규가 많은 브랜드 8개까지, 한 줄에 하나(`Rick Owens 신규 12`). 메일 작업이 이 줄을 가져다 쓴다
- **브랜드 목록** `brands.json` (2026-10-19 정리). Carol Christian Poell(`existing: "ccp"`)은 수집하지 않고 기존 인덱스를 가리킨다

## 처음 한 번 (저장소 주인)

1. 이 폴더의 파일을 `rozykuzy/BRAND` 에 올린다(워크플로는 `.github/workflows/daily.yml`)
2. **Settings → Pages → Source: GitHub Actions** — 이것이 없으면 워크플로 두 번째 단계에서 멈춘다(아무것도 수집·커밋하지 않고)
3. (선택) **Settings → Secrets and variables → Actions**: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`. 없으면 eBay만 건너뛴다
4. **Actions → daily → Run workflow** 로 첫 발행. 첫날은 모든 검색이 처음이라 `신규` 가 0이다(대장 규칙)

## 규칙 (코드에 들어 있다 — `lib.mjs`)

- 호스트마다 요청 전에 robots.txt를 읽고 따른다. 경로뿐 아니라 파라미터 금지도(야후 `n=` · 라쿠마 `sort=` · 야후 플리마 `sort=`). robots.txt를 못 읽으면(403 · 봇 확인 화면 · 응답 없음) 그 호스트는 읽지 않는다. 리다이렉트마다 다시 확인한다
- UA는 하나: `ArchiveIndex/1.0 (+https://rozykuzy.github.io/BRAND/; personal archive search, one request every few seconds)`. 메루카리 브라우저도 이 UA. 브라우저로 위장하지 않고, 자동화 표시를 숨기지 않고, 쿠키를 다음 실행으로 넘기지 않고, referer를 만들지 않는다. 호출하는 쪽이 UA·쿠키·referer를 넣어도 `lib.get` 이 지운다
- 같은 호스트에는 2.5초에 한 번까지(환경 변수로 더 줄일 수 없다). 호스트마다 줄 하나, 호스트끼리는 동시에
- 403 · 429 · 봇 확인 화면이면 그 호스트는 그날 끝. 그 소스는 "오늘 관측 안 됨" — 매물이 사라진 것으로 치지 않는다. 막힌 곳을 다시 두드리지 않는다
- 판매자 정보(이름 · 아이디 · 핸들 · 프로필 링크)는 저장하지 않는다. 남기는 것: 제목 · 가격 · 통화 · 주소 · 사진 · 사이즈 · 분류 단서 · 날짜 · 경매 입찰 수/마감
- 연도는 지어내지 않는다. 연도·시즌은 제목에 적힌 것만
- 정직한 접속을 거절하거나 약관이 수집을 금지하는 곳은 수집하지 않는다: Depop · Vestiaire · The RealReal · Mercari US · RAGTAG · Vinted · Poshmark · 1stDibs · 번개장터. `test.mjs` 가 수집기 코드에 이 이름이 없는지 본다

## 수집처와 판정

| 파일 키 | 곳 | 경로 | 브랜드마다 | 판정 |
|---|---|---|---|---|
| `grailed` | Grailed 검색 서비스(Algolia, 공개 검색 전용 키) | `mnrwefss2q-dsn.algolia.net` (robots.txt 404 — 규칙 없음). grailed.com의 `/search` 페이지는 열지 않는다 | 아래 "Grailed" | 수집 (2026-09-29 ROK 결정, CCP와 같은 방식) |
| `yahoo` | 야후옥션 진행 | `/search/search?p=` (+`&b=`) | 검색어마다 2쪽(50건) | 수집 |
| `yahoo_sold` | 야후옥션 낙찰 | `/closedsearch/closedsearch?p=` (robots 명시 허용) | 검색어마다 1쪽 | 낙찰 기록(매물 아님) |
| `mercari` | 메루카리 | `/search?keyword=&status=on_sale` (브라우저로 그림) | 검색어마다 1쪽(120건) | 수집 |
| `rakuma` | 라쿠마 | `fril.jp/s?query=` (+`&page=`) | 검색어마다 2쪽(40건) | 수집 |
| `yfm` | 야후 플리마 | `/search/<검색어>` (+`?withSpeller=0&page=`) | 검색어마다 2쪽(100건) | 수집 |
| `second` | 2nd STREET | `/search?keyword=` (+`&page=`) | 검색어마다 2쪽(60건) | 수집. 제목 = 매장이 적은 브랜드 줄 + 칸들 |
| `fruits` | 후루츠패밀리 | `/brand/<브랜드 이름>` · `/product/<id>/` | 브랜드 페이지 1쪽(40건) + 대장 매물 하루 200건까지 다시 보기(3일 간격) | 수집. 브랜드 페이지는 일부뿐이라 안 보였다고 사라짐으로 치지 않는다 |
| `ebay` | eBay Browse API | `api.ebay.com` (`/sch/` 금지, 공식 API만) | 라틴 이름 1검색, 최신순, 5쪽(1,000건)까지 | 키가 있을 때만 |
| — | Depop · Vestiaire · The RealReal · Mercari US · RAGTAG · Vinted · Poshmark · 1stDibs · 번개장터 | — | — | 수집하지 않음 |

**검색어** — 브랜드마다 `latin[0]` 과 일본어 표기 전부. 띄어쓰기·가운뎃점만 다른 표기는 한 번만(`アン ドゥムルメステール` = `アンドゥムルメステール`).
같은 검색어는 하루 한 번만 묻고, 그 결과를 모든 브랜드가 함께 쓴다. 130개 브랜드에 검색어 210개(라틴 130 · 일본어 80).
Dr. Martens x Rick Owens는 라틴 이름이 Rick Owens와 같아서 `rick owens dr. martens` 로 묻는다(titleMust 첫 낱말을 붙임).

**검색 결과는 아직 누구의 매물도 아니다.** 검색 페이지는 설명에만 이름이 있는 다른 물건도 돌려준다. 어느 브랜드인지는 제목이 정한다(아래).

## 제목으로 브랜드 읽기 (`brands.mjs`)

- 검색 페이지 매물은 **제목에 브랜드 이름이 있을 때만** 그 브랜드의 것. 라틴 표기는 대소문자·전각/반각·악센트·띄어쓰기·구두점을 가리지 않는다(`rickowens` · `Rick-Owens` · `ﾘｯｸｵｳｴﾝｽ`). 이름은 낱말이 시작하는 곳에서 시작해야 한다(`marceline` 은 Celine이 아니다, `my project` 는 Y/Project가 아니다). 다섯 글자 미만 이름은 낱말 끝에서도 끝나야 한다(`tabis` 의 복수 s는 된다)
- 일본어·한국어 표기도 같은 방식(띄어쓰기·가운뎃점 무시)
- `noisy: true` 브랜드(흔한 낱말)는 이름이 **낱말 하나로 따로** 있어야 한다. 다른 낱말 안에 든 것은 아니다(`bothersome` ≠ Both, `サカイヤ` ≠ sacai)
- `titleMust` 는 두 번째 필수 낱말(Tabi: `tabi`·`足袋`·`タビ`, Dr. Martens x Rick Owens: `dr martens` 등)
- 다른 브랜드의 더 긴 이름 안에 든 이름은 그 브랜드의 것(`Comme des Garcons PLAY` 는 Comme des Garcons가 아니다)
- `excludeDesigners` 가 제목에 있으면 그 브랜드가 아니다: `UNIQLO` · `ユニクロ` · `+J` → Jil Sander 아님, `MM6` · `H&M` → Maison Margiela 아님, `See by Chloe` · `McQ` · `GU` · `Comme des Garcons PLAY` · `Noir Kei Ninomiya` 도 같다
- 제목이 우리 브랜드 이름을 **다른 것을 설명하는 데** 쓰면 매물 전체를 뺀다: `…風` · `系` · `っぽい` · `ライク` · `スタイル` · `タイプ` · `好きな方` · `のような` · `스타일` · `느낌` · `같은` · `style` · `like` · `type` · `inspired` · `esque` · `inspired by …` · `…ではありません` · `元…` · `not …` (`like new` · `type-2` · `Style RO1234` 는 해당 없음)
- `マルジェラ期` 처럼 이름 바로 뒤 `期` 는 다른 하우스의 그 시기(에르메스 등) — 그 브랜드가 아니다. `本人期` 는 그 브랜드의 시기 표기
- **큰 브랜드(`big: true`, 20개)는 모든 곳에서 제목에 연도나 시즌이 적힌 것(A)만**. 작은 브랜드는 브랜드 확인과 제외를 통과한 것 전부(A·B·C)
- 제목이 우리 브랜드 여럿을 대면 그 모두의 매물이다(대장 항목 하나에 `b: [slug, …]`)
- Grailed(디자이너 필터)와 후루츠패밀리 브랜드 페이지는 사이트가 그 브랜드로 분류한 것이라 제목에 이름이 없어도 된다. 그 밖의 규칙(제외 · 큰 브랜드 연도 · titleMust)은 같다. Tabi는 Grailed에서 Maison Margiela로 분류되므로 제목에 tabi가 있어야 한다. Dr. Martens x Rick Owens는 두 디자이너가 모두 붙은 것(AND)이라 titleMust가 필요 없다
- 메종 마르지엘라 이름이 있으면 `Replica` · `レプリカ` 는 그 라인 이름이라 가품 제외를 하지 않는다

## Grailed (`grailed.mjs`)

- 디자이너 필터 = `grailed` 값들의 OR(`facetFilters:[["designers.name:A","designers.name:B"]]`), `grailedAll` 은 AND(값마다 따로)
- `grailedQuery` 가 있으면 그것을 Algolia `query` 로. **`brands.json` 에는 `grailedQuery` 가 없다** — Tabi처럼 다른 하우스 이름으로 분류되는 브랜드는 titleMust 첫 낱말(`tabi`)을 쓴다(Tabi의 grailedCount 1,485가 이 검색의 수와 같다). 바꾸려면 `brands.json` 에 `grailedQuery` 를 넣는다
- 작은 브랜드: 전부. 한 번에 1,000건까지라 넘치면 가격 구간(0–100 … 10,000–)으로 나누고, 넘치는 구간은 반으로(CCP와 같다). 900건 이하로 알려진 브랜드는 먼저 한 번에 묻는다
- 큰 브랜드: 전부 읽지 않는다. 제목이 시즌·연도를 말할 수 있는 것만 — 앞부분 낱말 16개(`ss` `fw` `aw` `s/s` `f/w` `a/w` `spring` `fall` `autumn` `winter` `resort` `198` `199` `200` `201` `202`)로 하나씩 묻고(디자이너 필터와 함께, 1,000건 넘으면 가격 구간), 조판에서 A만 남긴다
- 하루 **1,500번** 까지. 작은 브랜드가 먼저, 큰 브랜드는 날마다 순서를 돌린다. 다 못 읽은 브랜드는 로그에 적고(`not read today` · `cut short`) 그날 그 브랜드의 Grailed 매물은 사라짐으로 치지 않는다
- `excludeDesigners` 가 붙은 매물은 그 브랜드가 아니다. 판매자 칸(`user`)은 담지 않는다

## 상품명 읽기 (`classify.mjs`)

CCP의 `classify.mjs` 에서 CCP 전용(이름, 모델 번호 `LM/2498` 등, CCP 어휘)만 뺐다. 읽는 규칙은 그대로.

- **A** 연도·시즌 하나: `2009` · `SS97` · `07SS` · `AW2002` · `02fw` · `P/E 2002` · `96〜97AW`(=AW96) · `A/W '98-'99` · `２００１ＳＳ` · `1985`
- **B** 시기 표기: `1990년대` · `80年代` · `2000–01` · `2008–09` · `초기` · `본인기`(本人期) · `아카이브` · 두 해 · `2003년 구입` · `1999년 무렵` · `Y2K`
- **C** 연도 없음
- 연도 범위 1950년 ~ 올해. 두 자리는 CCP와 같이 90–99 → 1990년대, 00–89 → 2000년대(그래서 `85AW` 는 읽지 않는다. `AW1985` · `1985` 는 읽는다). 1990년 전 시즌은 사이트가 두 자리로 읽지 못하므로 연도로만 적는다
- 연도로 읽지 않는 숫자: 가격(`定価` `参考上代` `¥` `€` `$` `£` `円` `EUR`), 사이즈 표기, `no.2003` · `品番` · `管理番号`, 기간(`10年保管` · `20年以上前` · `5년 사용`), 연호(`平成11年`), 자동차 `年式`, 반팔 사이즈(`S/S 36`)
- **제외**: `ブランド不明` · `ノーブランド` · `元ネタ` · `専用`(액세서리 명사가 뒤따르지 않을 때) · `様へ` · `取り置き` · `구매)` · `구해요` · `WTB` · `렌탈` · `レプリカ` · `가품`(정품 보증 문구는 제외 아님) · **옷이 아닌 것**(향수 · 화장품 · CD/LP/레코드 · 잡지 · 포스터 · 자동차 부품 · 빈 상자 · `…のみ`. `雑誌掲載` · `レコードバッグ` · `紙袋付き` 는 옷)
- **분류** 아우터 · 테일러링 · 셔츠 · 상의 · 팬츠 · 데님 · 신발 · 가방·소품 · 주얼리 · 기타 — 제목의 낱말, 제목이 말하지 않으면 사이트 분류(라쿠마 카테고리, Grailed `category_path`)
- **사이즈** 표시된 것만(`サイズ48` · `size 7` · `UK 8` · `[50]` · 옷의 짝수 40–58 · 신발 4–13/35–47 · `27cm`). 사이트의 사이즈 칸이 있으면 그것

## 대장 규칙 (`build.mjs`)

- `data/ledger.json`: 매물 id(`grailed:123` · `yahoo:x123` · `mercari:m…` · `rakuma:…` · `yfm:…` · `2nd:…` · `ff:…` · `ebay:…`)마다 한 줄. `b`(브랜드들) · `d`(사이트가 분류한 브랜드) · `qs`(그 매물을 찾은 검색) · 처음/마지막 본 날 · 판매자 통화의 가격 이력 `h` · 사라진 날. 항목은 지우지 않는다
- 실패한 소스는 관측 안 됨: 다시 본 것도, 사라진 것도 아니다
- **사라짐은 검색 단위로 센다.** 그 매물을 찾은 검색이 모두 그날 끝까지 읽혔을 때만(마지막 쪽이 짧았다, 또는 사이트가 '결과 없음'이라고 했다). 쪽 수 한도(2쪽)에서 멈춘 검색은 끝까지 읽은 것이 아니다. 그렇게 두 번 연속(하루에 한 번만 센다) 없으면 사라짐
- 경매(야후 · eBay)는 스스로 적은 마감 시각이 (그 정밀도만큼 여유를 두고) 지났고, 그 매물을 찾은 검색을 그날 읽었으면 사라짐 — 큰 브랜드 검색은 2쪽에서 멈추므로 끝까지 읽기를 기다리지 않는다
- 판매 완료 배지가 보이면 그날 사라짐. 가격을 못 읽었어도 매물 링크가 페이지에 있으면 '봤다'
- 지난번 끝까지 읽은 날 본 것 가운데 5건 이상, 그리고 80%(야후 60%) 넘게가 안 보이면 그날은 판단 보류 — 최대 3일
- 가격 변동은 판매자 통화로만. 하루에 가격은 하나(같은 날 다시 읽으면 그날 값을 고쳐 적는다). 환율은 ECB(frankfurter), 못 받으면 어제 환율, 그것도 없으면 빌드 중단
- **신규**: 그날 처음 본 매물 가운데, 찾은 검색이 전날까지 한 번이라도 읽힌 것. 검색의 첫 읽기는 신규가 아니다(첫날은 0). 2쪽에서 멈추는 검색에서는 '시장에 새로 나온 것'이 아니라 '이 인덱스에 새로 들어온 것'이다. 코드 수정으로 한 소스가 더 멀리 읽게 되는 날은 `ledger.json` 의 `state.quiet[<파일 키>] = "<그날>"` 로 그 소스의 신규를 끈다
- 같은 날 다시 돌려도 같은 호수. `data/sold.json` 은 낙찰 기록(매물 아님, 신규·사라짐 없음)
- 대장을 읽을 수 없거나 지난 빌드(`status.json`)보다 항목이 적으면 빌드가 멈추고 덮어쓰지 않는다. git 이력이 곧 백업이다

## 내보내는 것

- `site/index.json` — `{ built, today, date, rates, counts, sources, brands: [131개] }`. 브랜드마다 `s` slug · `n` 이름 · `c` 카드 수 · `nw` 오늘 신규 카드 · `big` · `so` 낙찰 기록 수 · `srcs` 판매처별 매물 수 · `ph` 사진 2장까지(연도 표기 카드 먼저, 새것 먼저) · `upd` 그 브랜드 매물을 마지막으로 본 날 · `q` `{en, ja, ko}` 검색어. Carol Christian Poell은 `ex: "ccp"` 만
- `site/b/<slug>.json` — CCP 페이지의 데이터와 같은 모양(`issue` · `date` · `counts` · `sections` · `sellers` · `yearSpan` · `sources` · `items[]` 의 `t k r l i s f c e q qk z p u h w wd ab ae aeq x ls n g v so sk …`) + `brand: {s, n, big}`. 같은 제목 묶기도 CCP와 같다. 브랜드 130개 모두(0건이어도)
- `site/new.json` — `{ today, items }` 오늘 신규 카드, 새것 먼저, 400장까지. 카드마다 `b`(첫 브랜드), 여러 브랜드면 `bs`
- `data/mail_meta.json` — `{ date, fresh, brands: [[이름, 수], …] }` 신규 많은 순 8개. `data/mail_lines.txt` — 한 줄에 하나(`Rick Owens 신규 12`)
- `data/status.json` — 소스별 결과(`ok` · `requests` · `read` · `kept` · `complete` · `searches` · `cut` · `error`), 호스트별 요청 수(`hosts`), 대장 통계

## PC에서 돌려 보기

```
cd C:\Users\PC\BRAND
node test.mjs && node collect.mjs --only=<source> --brands=<slug,...> && node build.mjs
```

예: 브랜드 셋, 야후옥션만, 검색어마다 1쪽

```
node test.mjs && node collect.mjs --only=yahoo --brands=guidi,uma-wang,rick-owens --max-pages=1 && node build.mjs
```

- 소스 키: `grailed` `yahoo` `yahoo_sold` `mercari` `rakuma` `yfm` `second` `fruits`(+`fruits_check`) `ebay`. 여러 개는 쉼표로
- `--max-pages=N` 은 검색어마다 N쪽까지(eBay는 N×200건). Grailed는 하루 한도(1,500번)를 따른다
- 메루카리는 Playwright가 필요하다: `npm i --no-save playwright@1` 후 `npx playwright install chromium`. 설치된 Chrome으로 보려면 `set BRAND_BROWSER_CHANNEL=chrome`
- eBay는 `set EBAY_CLIENT_ID=…` · `set EBAY_CLIENT_SECRET=…` 가 있을 때만. 화면에 키를 찍지 않는다
- 결과: `data/raw/_summary.json`(소스별 `requests` · `read` · `kept`, 호스트별 요청 수) · `data/raw/<소스>.json` · `site/` · `data/status.json`. 콘솔에도 소스마다 `requests · read · kept` 한 줄
- 시험 삼아 돌린 날의 대장을 저장소에 올리지 않으려면 `set BRAND_DATA=C:\Users\PC\brand-trial` 처럼 다른 폴더를 쓴다(`collect.mjs` · `build.mjs` 둘 다 읽는다. 사이트는 `BRAND_SITE`)
- 한 소스의 첫 읽기는 신규가 아니다. 같은 브랜드로 다음 날 다시 돌려야 `nw` 가 생긴다

## 하루 요청 수 (예상, 호스트별, robots.txt 포함)

검색어 210개 기준. 결과가 한 쪽보다 적은 검색은 1쪽에서 멈추므로 실제는 최대치보다 적다.

| 호스트 | 최대 | 예상 | 시간(2.5초 간격) |
|---|---|---|---|
| `auctions.yahoo.co.jp` | 631 (진행 420 + 낙찰 210 + 1) | 450–630 | 20–26분 |
| `fril.jp` | 421 | 300–420 | 13–18분 |
| `paypayfleamarket.yahoo.co.jp` | 421 | 250–420 | 11–18분 |
| `www.2ndstreet.jp` | 421 | 250–420 | 11–18분 |
| `jp.mercari.com` | 211 페이지(브라우저가 그 안에서 부르는 요청은 따로) | 211 | 50–60분(검색마다 4초 간격 + 스크롤) |
| `fruitsfamily.com` | 331 (브랜드 페이지 130 + 다시 보기 200 + 1) | 150–330 | 6–14분 |
| `mnrwefss2q-dsn.algolia.net` (Grailed) | 1,501 (한도 1,500 + 1) | 1,500 (작은 브랜드 약 470 + 큰 브랜드 나머지) | 약 63분 |
| `api.ebay.com` | 652 (토큰 1 + 130 × 5쪽 + 1) | 200–350 | 8–27분 |

호스트끼리는 동시에 돌아서 하루 실행은 1–2시간.

## 문제가 생기면

- `data/status.json` — 그날 소스별 결과와 호스트별 요청 수, 대장 통계(`added` · `vanished` · `ended` · `held` · `notOurs` · `hidden` · `unread` · `flood`)
- `data/raw/_diag.json` — 검색 결과에서 아무것도 못 읽은 소스의 페이지 모양(크기 · `<title>` · 매물 링크 수 · 내장 JSON 키 · 링크 모양). 글자와 판매자는 담지 않는다. 이걸 보고 `sources.mjs` 의 `hrefRe` 나 `lib.listingsFrom` 을 고친다
- 모두 클라우드에서 `https://raw.githubusercontent.com/rozykuzy/BRAND/main/data/status.json` 으로 읽힌다
- **정직한 UA로 막히면(403 · 429 · 봇 확인) 그 소스는 거기서 끝이다.** UA를 바꾸거나 자동화 표시를 숨기거나 간격을 줄이지 않는다. 같은 날 다시 시도하지 않는다
- 한 소스의 읽기 방식을 고쳐 더 많이 읽게 된 날은 `state.quiet` 로 그날 신규를 끈다(대장 규칙)
- Grailed가 날마다 한도에 걸리면 로그의 `not read today` 브랜드가 돌아가며 바뀌는지 본다. 한도를 올리지 말고 큰 브랜드 낱말을 줄이는 쪽을 먼저 본다
- 후루츠패밀리 브랜드 페이지가 없으면(404) `missing` 에 적힌다. 주소는 `brands.json` 의 `name` 을 그대로 쓴다 — 후루츠패밀리 표기와 다르면 거기서 고친다
- 한 브랜드가 엉뚱한 매물로 찬다면(흔한 낱말 이름) `brands.json` 의 별칭을 더 좁게 바꾼다. 특히 `White`(white) · `Both`(both) · `Off-White`(색 이름 off white)

## 확인하지 못한 것 (2026-10-19, 클라우드에서는 판매처에 닿지 않는다)

- 수집기는 실제 판매처 페이지에 대 보지 않았다. 페이지 읽기는 CCP가 2026-09-28부터 매일 읽는 것과 같은 코드이고, 시험은 그 모양을 본뜬 견본이다. PC에서 소스마다 한 번 돌려 `read` 가 0이 아닌지 본다
- 메루카리가 `ArchiveIndex` UA의 브라우저를 받아 주는지(CCP는 브라우저 기본 UA였다). 막히면 그날 메루카리는 관측 안 됨
- `api.ebay.com/robots.txt` 가 API 경로를 막는지. 막으면 eBay는 쓰지 않는다
- 후루츠패밀리 브랜드 페이지 주소가 `brands.json` 의 이름으로 열리는지
- Grailed 검색 결과의 `designers` 칸 모양(없으면 그 브랜드 검색의 필터로 판단한다)과 큰 브랜드 낱말 검색이 한도 안에서 몇 개 브랜드까지 끝나는지
