# Trace — Test Report

검토일: 2026-08-03
검토 방식: 로컬 정적 서버(`python3 -m http.server`, `Deliverable/` 루트에서 실행)로 `http://localhost:8765/trace/`를 열어 확인. `../../shared/v1/sync.js` 상대 경로가 GitHub Pages와 동일한 폴더 구조(`Deliverable/trace`, `Deliverable/shared`)에서 정상 해석되는 것을 전제로 함. (Atlas 검토 이후 `.claude/launch.json`에 `trace-preview`(포트 4176) 항목도 추가함.)

## 1. 코드 검토에서 발견해 고친 문제

ChatGPT가 만든 원본 코드(`index.html`, `src/app.js`, `assets/app.css`, `sw.js`, `manifest.webmanifest`)를 신뢰하지 않고 전부 확인했습니다.

| 항목 | 결과 |
|---|---|
| `sync.js` 함수 시그니처 일치 여부 (`readFile`, `writeFile`, `listDir`, `outboxEnqueueReplace`, `ensureContextId`, `contextFilePath`) | 문제 없음. `pushMemosNow()`가 `readFile`로 최신 `sha`를 읽고 `writeFile(config, path, content, {sha, message})`로 쓴 뒤, 실패 시 `outboxEnqueueReplace(namespace, {path, content, message})`로 폴백하는 구조가 시그니처와 정확히 일치 |
| `ensureContextId('trace', promptFn)` 사용 | 문제 없음. `Sync.ensureContextId(APP.namespace, () => requestContextName(''))` 형태로 정확히 호출되고, `promptFn`이 다이얼로그를 통해 사용자 입력을 `Promise`로 반환 |
| 절대 규칙 위반 문구 검사 (`low`, `behind`, `missed`, `only`, streak, 빈 날 경고 등) | **없음.** 전체 코드베이스 grep 결과 평가성 문구·연속 기록(streak) 집계·빈 날 경고가 전혀 없음. 요약 문구는 `"3 clips saved"`처럼 중립적 개수만 표시하고, 빈 날에는 `"No entries this day"` 한 줄만 표시 |
| 미래 날짜 이동 차단 | 문제 없음. `renderDay()`가 `selectedDate > today`이면 오늘로 되돌리고, `next-day` 버튼은 `selectedDate >= today`일 때 `disabled` 처리되어 이중으로 막음 |
| 날짜 경계(자정, 시간대) 로컬 기준 일관성 | 문제 없음. `localDateKey()`는 `Date`의 로컬 `getFullYear/getMonth/getDate`만 사용하고, `dateFromKey()`는 DST 경계 문제를 피하기 위해 해당 날짜의 로컬 정오(12:00)로 `Date`를 생성함. 클립의 `createdAt`(UTC ISO)도 `new Date(...)` 후 `localDateKey()`로 변환해 동일 기준을 사용 |
| `innerHTML`/`outerHTML`/`insertAdjacentHTML` 사용 여부 | 없음. 클립 텍스트·라벨·메모는 전부 `textContent`로만 렌더링 |
| 토큰 노출 (console, 화면 전체 표시) | 없음. `console.*` 호출이 코드에 없고, 화면에는 끝 4자리만 표시 |
| 존재하지 않는 파일 참조 | **발견됨 — 고침.** `index.html`이 `icons/icon-source.svg`만 아이콘으로 참조하고 PNG 아이콘이 없었음. `app.css`의 `@font-face`가 `fonts/lexend-regular.woff2`, `fonts/lexend-medium.woff2`를 참조했지만 `trace/fonts/` 폴더 자체가 없었음. `sw.js`의 프리캐시 목록에도 이 파일들이 없었음. 아래 2번 항목에서 모두 채움 |
| CSP 메타 태그 | **없음 — 추가함.** Atlas와 동일한 수준으로 `default-src 'self'; connect-src 'self' https://api.github.com; ...`를 추가 |
| Service Worker의 캐시 인터셉트 범위 | **잠재적 낭비 발견 — 고침.** 원본 `fetch` 핸들러는 `origin`만 검사해서, 같은 GitHub Pages 오리진의 다른 앱(Atlas, Clip 등) 요청까지 이 SW가 가로챌 수 있는 구조였음. `self.registration.scope` 기준으로 `trace/` 하위 요청과 `shared/v1/sync.js`만 처리하도록 좁힘 (Atlas 검토 때 적용한 패턴과 동일) |
| `clip` 파서 vs 실제 저장 형식 | 문제 없음. `clip/data.<contextId>.json`의 `{items[], deleted[]}` 형식을 기대하고, 병합 규칙(같은 id는 `updatedAt` 최신 우선, `deleted.at`이 `updatedAt`보다 나중이면 제외)도 Atlas의 `mergeRemote`와 동일한 tombstone 로직으로 구현됨 |
| `eval`/`new Function` 사용 | 없음 |

## 2. 이번에 직접 보완한 작업

1. **폰트**: `atlas/fonts/lexend-400.woff2`, `lexend-700.woff2`를 `trace/fonts/`에 복사. 라이선스 `atlas/licenses/Lexend-OFL.txt`를 `trace/licenses/`에 복사. `app.css`의 `@font-face` 파일명과 `font-weight`(400/700)를 실제 파일에 맞춰 수정 (기존 `lexend-regular.woff2`/`lexend-medium.woff2`, `font-weight: 500` 선언은 존재하지 않는 파일을 가리켜 아무 폰트도 로드되지 않는 상태였음).
2. **아이콘**: `icons/icon-source.svg`를 `rsvg-convert`로 180×180(`apple-touch-icon.png`), 192×192(`icon-192.png`), 512×512(`icon-512.png`) PNG로 변환. `index.html`과 `manifest.webmanifest`의 아이콘 참조를 PNG로 갱신.
3. **CSP**: Atlas와 동일한 `Content-Security-Policy` 메타 태그를 `index.html`에 추가.
4. **Service Worker**: `PRECACHE_URLS`에 새 폰트·아이콘·라이선스·`docs/TEST-REPORT.md`를 추가하고, `fetch` 핸들러를 스코프 기준으로 좁힘. 캐시 내용이 바뀌었으므로 `CACHE_NAME`을 `trace-shell-v5` → `trace-shell-v6`로 올림 (이전 캐시 자동 제거).
5. **문서**: `README-KO.md`의 파일 구조·폰트 경로 설명을 실제 파일과 일치하도록 갱신.
6. **테스트 서버 설정**: `.claude/launch.json`에 `trace-preview`(포트 4176, `Deliverable/` 루트 기준 `python3 -m http.server`) 항목 추가.

## 3. 통과 항목 (로컬 확인 완료)

### 기능
- [x] 콘솔 오류 0건 (초기 로드, 컨텍스트 이름 입력, 토큰 저장, 잘못된 토큰 새로고침, 가짜 클립 데이터 렌더링, 한글 메모 입력, 글자 크기 변경, 리사이즈 전 구간)
- [x] 토큰 없는 상태: Settings의 Sync 영역에 `"Add a GitHub token in Settings."` 안내가 오류 없이 표시됨
- [x] 잘못된 토큰으로 Save 후 자동 Refresh: 조용히 실패하지 않고 `"Authorization failed. Check the token and repository access."`가 표시됨
- [x] 가짜 `clip` 캐시 데이터(한글 텍스트, 라벨만 있는 항목, 다른 시각 2건)를 `trace.cache.v1`에 직접 넣고 새로고침 → 시간순으로 타임라인 생성되고 `"3 clips saved"` 중립 문구 표시 확인
- [x] `mergeClipDocuments`/`mergeMemoMaps`의 tombstone 제외 로직(같은 id 최신 `updatedAt` 우선, `deleted.at`이 `updatedAt`보다 늦으면 제외)을 코드 레벨로 재확인 — 로직 결함 없음 (실제 두 컨텍스트 파일 간 병합은 4번 항목의 실기기 확인 필요)
- [x] 메모 입력 → 4초 디바운스 후 전송 시도 → (잘못된 토큰이므로) 인증 오류 발생 → `outboxEnqueueReplace`로 큐 적재 → Settings의 `"1 to send"`로 확인
- [x] Service Worker가 `./sw.js`로 정상 등록됨, `scope`가 `/trace/`로 제한됨 (`navigator.serviceWorker.getRegistrations()`로 확인)
- [x] `caches.open('trace-shell-v6')`로 프리캐시 내용 확인 — 폰트, PNG 아이콘, 라이선스, 문서, `../shared/v1/sync.js`까지 전부 정상 캐시됨
- [x] `../../shared/v1/sync.js`가 GitHub Pages와 동일한 상대 경로 구조에서 200 OK로 로드됨

### 화면
- [x] 375px 폭 (iPhone 세로 기준): 버튼 겹침·글자 잘림 없음, 다음 날짜 버튼이 시각적으로 비활성 상태로 표시됨
- [x] 768px 폭 (iPad 세로 기준): 카드형 레이아웃(`content-max: 720px`)이 중앙 정렬되어 정상 표시
- [x] 글자 크기 6단계(6/8/10/12/14/17px) 중 6px 확인 — Settings의 모든 버튼이 44×44px 터치 영역을 유지한 채 글자만 작아짐
- [x] 메모 입력창·토큰 입력창은 모든 글자 크기 단계에서 16px 고정 유지 (`.memo-dock input, .settings-input` 규칙)
- [x] 한글·영문 혼용 텍스트(`"첫 번째 클립 한글 테스트"`, `"오늘의 한 줄 메모"`, 컨텍스트 이름 `"테스트폰"`) 줄바꿈·정렬·저장 정상, 조합 중(IME) 오작동 없음
- [x] 라이트 모드만 지원 (`color-scheme: light` 고정) — Atlas와 동일하게 요청 범위에 다크 모드가 없어 별도 대응 안 함

### 코드/PWA
- [x] `manifest.webmanifest` 아이콘 경로(`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) 전부 실제 파일과 일치
- [x] `sw.js` 프리캐시 목록이 실제 파일 목록과 일치 (누락·오참조 없음)
- [x] `.nojekyll` 파일 존재 확인 (GitHub Pages Jekyll 비활성화)

## 4. 실기기(iPhone/iPad Safari)에서 직접 확인해야 할 항목 (Pending)

로컬 데스크톱 브라우저 자동화로는 검증할 수 없는 항목입니다.

- [ ] 실제 `webapp-data` 저장소 + 유효한 토큰으로 `clip` 폴더 데이터를 읽고, 메모를 실제로 저장/전송하는지
- [ ] 여러 기기(예: iPhone Safari 탭 vs 홈 화면 앱)에서 만든 `trace/memo.<contextId>.json` 파일들이 실제로 병합되어 같은 날짜에는 가장 최근 값만 남는지
- [ ] 실제 오프라인(비행기 모드) → 메모 입력 → 온라인 복귀 시 `outboxWatch`가 자동으로 재전송하는지, GitHub 저장소에 파일이 실제로 반영되는지
- [ ] Add to Home Screen 후 standalone 모드 아이콘이 새로 만든 PNG로 올바르게 표시되는지
- [ ] iPhone/iPad 가로 화면, Dynamic Island/Notch/홈 인디케이터 Safe Area 가림 여부
- [ ] 키보드가 열린 상태에서 메모 입력창·토큰 입력창 사용성
- [ ] 기기를 완전히 껐다 켠 뒤에도 localStorage 캐시·토큰·컨텍스트 ID·글자 크기 설정이 유지되는지
- [ ] 오프라인 상태에서 Service Worker 캐시로 재실행이 실제로 되는지 (첫 방문 후 캐시가 채워진 다음)
- [ ] Safari 폰트 폴백: Lexend 로드 실패를 가정한 시나리오에서 Verdana로 자연스럽게 전환되는지 실기기 렌더링으로 육안 확인
- [ ] 자정을 지나 앱을 계속 켜둔 상태에서 "Today" 버튼과 다음 날짜 이동 제한이 새 날짜 기준으로 갱신되는지
