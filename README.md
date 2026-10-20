# Archive Index — Brands

데이터 https://rozykuzy.github.io/BRAND/ · 보는 곳 https://rozykuzy.github.io/?view=brands

L'Eclaireur 패션 브랜드 131개(`brands.json`)의 중고 매물. 매일 12:00 KST 수집·정리·발행(`.github/workflows/daily.yml`).
Carol Christian Poell은 따로 있는 인덱스(`rozykuzy/ccp`)를 그대로 쓴다.

| 파일 | 하는 일 |
|---|---|
| `brands.json` | 브랜드 131개 — 이름 · Grailed 디자이너 이름 · 일본어/한국어 표기 · 큰 브랜드 · 흔한 낱말 표시 |
| `brands.mjs` | 상품명이 어느 브랜드의 매물인지 읽는다 · 검색어 목록(브랜드마다 라틴 이름 + 일본어 표기) |
| `collect.mjs` | 모든 수집기 → `data/raw/*.json`. `--only` · `--brands` · `--max-pages` 로 일부만 |
| `sources.mjs` | 야후옥션(진행 · 낙찰) · 라쿠마 · 야후 플리마 · 세컨드스트리트 검색 페이지 |
| `mercari.mjs` | 메루카리 검색 페이지를 브라우저로 그려 읽는다 |
| `fruitsfamily.mjs` | 후루츠패밀리 브랜드 페이지 · 대장에 있는 매물 다시 보기 |
| `grailed.mjs` · `ebay.mjs` | Grailed 검색 서비스 · eBay 공식 API(키가 있을 때만) |
| `lib.mjs` | robots.txt 준수 · 호스트당 2.5초 · 이름을 밝힌 UA · 403/429/봇 확인 화면이면 그 호스트는 그날 멈춤 · 페이지 읽기 |
| `classify.mjs` | 상품명 읽기 — 연도·시즌, 분류, 사이즈, 제외 |
| `build.mjs` | 대장(`data/ledger/`) 갱신 → `site/index.json` · `site/b/<slug>.json` · `site/new.json` · `data/mail_lines.txt` |
| `store.mjs` | 대장과 낙찰 기록을 나눠 적고 읽는다 — 대장 16조각(`data/ledger/0–f.json` + `meta.json`), 낙찰 기록은 달마다(`data/sold/YYYY-MM.json`) |
| `test.mjs` | 매일 수집 전에 도는 시험. 실패하면 그날은 발행하지 않는다 |
| `test_corpus.json` | 실제 매물 제목 354건 (CCP, 2026-09-27, 판매자 정보 없음) |
| `RUNBOOK.md` | 규칙 · 수집처 판정 · PC에서 돌리기 · 문제가 생기면 |

`data/ledger/`(대장)과 `data/sold/`(낙찰 기록)은 지우지 않는다.
