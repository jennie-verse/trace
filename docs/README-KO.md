# Trace

Trace는 다른 개인용 앱이 GitHub 비공개 저장소에 남긴 시각 기록을 읽어, 선택한 하루를 시간순으로 보여 주는 정적 PWA입니다. 사용자가 Trace에서 직접 입력하는 데이터는 날짜별 한 줄 메모입니다.

## 데이터원 (파서)

| 파서 | 읽는 경로 | 상태 | 만드는 이벤트 |
|---|---|---|---|
| `tide` | `tide/archive/<YYYY-MM>.json` | 운영 중 | `Saved a clip` / `Wrote a note` |
| `clip` | `clip/data.<기기>.json` | 은퇴한 앱의 과거 기록 (읽기만) | `Saved a clip` |
| `events` | `events/<앱>.<기기>.<YYYY-MM>.json` | 운영 중 (공용) | 각 앱이 적어 넣은 `title`·`detail` 그대로 |

tide·clip 파서는 항목의 `createdAt`(만든 시각)을, events 파서는 이벤트의 `at` 을 기준으로 그날의 이벤트를 만듭니다.

### events 파서 — 앱마다 파서를 새로 만들지 않기 위한 층

앱이 늘어날 때마다 Trace에 파서를 하나씩 더하면, 앱이 데이터 모양을 바꿀 때마다 Trace도 같이 고쳐야 합니다. 그래서 각 앱이 **정해진 한 가지 모양**으로 활동 기록을 남기고, Trace는 그 모양만 읽습니다. 앞으로 focus·loom·grove·vault가 여기에 기록을 남겨도 Trace 코드는 그대로입니다.

레코드 모양입니다.

```json
{ "v": 1, "id": "focus:1a2b3c4d", "app": "focus", "kind": "session.completed",
  "at": "2026-08-09T14:03:00+09:00", "title": "Finished a 25-min focus session",
  "detail": "딥워크 블록" }
```

- `v` 가 `1` 이 아닌 레코드, `at` 이 날짜가 아닌 레코드, `title` 이 빈 레코드는 조용히 건너뜁니다.
- 같은 `id` 가 여러 번 나오면 마지막 것을 씁니다. `"deleted": true` 로 뒤에 붙은 것은 목록에서 빠집니다.
- 파일 이름이 `<앱>.<기기>.<YYYY-MM>.json` 모양이 아닌 항목(`.gitkeep` 등)은 무시합니다.

> **읽는 범위는 최근 3개월입니다.**
> 이벤트 파일은 앱 × 기기 × 달마다 하나씩 생깁니다. 제한이 없으면 새로고침 한 번에 GitHub 요청이 수백 회로 늘어나 모바일에서 눈에 띄게 느려집니다. 3개월보다 오래된 날을 열면 그날의 events 기록은 비어 보입니다(tide·clip 기록은 그대로 보입니다).

> **tide 항목은 며칠 뒤에 나타납니다.**
> tide는 **7일간 손대지 않아 만료된 항목만** 아카이브에 올립니다. 따라서 오늘이나 이번 주 화면은 비어 있는 것이 정상이고, 지난 날짜를 넘겨 보면 그날 만든 항목이 채워집니다. 계속 쓰고 있거나 핀을 꽂은 항목은 만료되지 않으므로 Trace에 나타나지 않습니다.

`webapp-data`에 해당 폴더가 없으면 그 파서는 조용히 비활성화됩니다. 나중에 `clip/` 폴더를 지워도 Trace는 오류 없이 tide 기록만 보여 줍니다.

## 파일 구조

```text
trace/
├── .nojekyll
├── index.html
├── manifest.webmanifest
├── sw.js
├── assets/
│   └── app.css
├── icons/
│   ├── icon-source.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── fonts/
│   ├── lexend-400.woff2
│   └── lexend-700.woff2
├── licenses/
│   └── Lexend-OFL.txt
├── src/
│   └── app.js
└── docs/
    ├── README-KO.md
    ├── USER-GUIDE-KO.md
    └── TEST-REPORT.md
```

Trace는 빌드 과정과 외부 JavaScript 패키지가 없습니다. `index.html`을 포함한 폴더를 그대로 GitHub Pages에 배포합니다. 동기화 모듈은 저장소 루트의 `shared/v1/sync.js`를 사용합니다.

## 배포 전 저장소 구조

GitHub Pages 저장소의 기본 브랜치에 다음 구조가 있어야 합니다.

```text
repository-root/
├── shared/
│   └── v1/
│       └── sync.js
└── trace/
    └── (이 폴더의 전체 파일)
```

`trace/src/app.js`에서 `../../shared/v1/sync.js`를 불러오므로, 배포 URL 기준으로는 `https://jennie-verse.github.io/shared/v1/sync.js`가 됩니다. 앱 자체는 `https://jennie-verse.github.io/trace/`에서 실행됩니다.

## GitHub Pages 배포

1. GitHub의 `jennie-verse.github.io` 저장소를 엽니다.
2. 저장소 루트에 `trace` 폴더 전체를 업로드합니다.
3. 저장소 루트의 `shared/v1/sync.js`가 준비되어 있는지 확인합니다.
4. 저장소의 **Settings → Pages**를 엽니다.
5. **Build and deployment**에서 기본 브랜치의 루트 폴더를 배포 대상으로 선택합니다.
6. 배포가 끝나면 `https://jennie-verse.github.io/trace/`를 Safari에서 엽니다.

GitHub Pages 반영에는 잠시 시간이 걸릴 수 있습니다. 이전 화면이 계속 보이면 Safari 탭을 닫았다가 다시 열거나, 홈 화면 앱을 완전히 종료한 뒤 다시 실행합니다. `sw.js`를 변경해 배포할 때는 `CACHE_NAME`의 버전을 올려 이전 앱 셸 캐시와 구분합니다.

## GitHub 데이터와 토큰

Trace는 `https://api.github.com` 외의 외부 주소로 요청하지 않습니다. GitHub Personal Access Token은 코드나 동기화 큐에 포함하지 않고 브라우저의 `localStorage` 키 `sync.token.v1`에 저장합니다. 같은 오리진에서 실행되는 Atlas·Clip과 이 키를 공유합니다.

기본 동기화 설정은 다음과 같습니다.

```text
owner: jennie-verse
repo: webapp-data
branch: main
```

토큰에는 비공개 저장소 `webapp-data`의 Contents API를 읽고 쓸 수 있는 권한이 필요합니다. 토큰이 저장되면 Settings에는 전체 값 대신 마지막 네 자리만 표시합니다.

## 읽기와 병합

새로고침할 때 저장소 루트의 폴더 목록을 먼저 읽습니다. `PARSERS`에 등록된 이름과 같은 폴더만 처리하며, 현재는 `clip`만 등록되어 있습니다. 알 수 없는 폴더는 건너뜁니다.

`clip/data.<contextId>.json` 파일의 클립은 다음 규칙으로 합칩니다.

- 같은 `id`가 여러 파일에 있으면 `updatedAt`이 가장 최근인 항목을 사용합니다.
- 같은 `id`의 삭제 기록이 여러 개면 `at`이 가장 최근인 기록을 사용합니다.
- 삭제 시각 `at`이 항목의 `updatedAt`보다 뒤이면 그 항목을 타임라인에서 제외합니다.
- 선택한 날짜에 `createdAt`이 속한 항목만 시간 오름차순으로 표시합니다.
- 표시 문구에는 `label`을 우선 사용하고, 없으면 `text`의 첫 40자를 사용합니다.

Trace 메모는 `trace/memo.<contextId>.json` 파일 전체를 읽습니다. 같은 날짜의 메모가 여러 컨텍스트에 있으면 `at`이 가장 최근인 값을 표시합니다.

## 메모 저장과 오프라인 처리

메모를 입력하면 즉시 `trace.local.v1`에 저장됩니다. 입력이 멈춘 뒤 4초가 지나면 현재 컨텍스트 파일의 SHA를 읽고 GitHub에 씁니다. 네트워크나 권한 문제로 전송되지 않으면 `trace` 전용 IndexedDB outbox에 최신 파일 내용을 한 건으로 보관합니다. 앱 시작과 온라인 복귀 시 `Sync.outboxWatch()`가 큐를 다시 전송합니다.

원격 타임라인과 메모 캐시는 `trace.cache.v1`에 저장됩니다. 앱은 이 캐시를 먼저 표시한 뒤 GitHub 데이터를 갱신합니다. 오프라인일 때는 캐시된 화면과 기기에 저장된 메모를 사용할 수 있습니다.

## 글꼴

`assets/app.css`에는 Lexend Regular(400)와 Bold(700)의 `@font-face`가 선언되어 있고, 폰트 파일은 `trace/fonts/`에 포함되어 있습니다.

```text
trace/fonts/lexend-400.woff2
trace/fonts/lexend-700.woff2
```

외부 CDN을 사용하지 않으며 오프라인에서도 그대로 적용됩니다. 파일이 없거나 로딩에 실패해도 Verdana와 시스템 폰트로 자연스럽게 대체됩니다. 라이선스 파일은 `trace/licenses/Lexend-OFL.txt`에 함께 포함되어 있습니다.

## 보안과 접근성

- 동적 이벤트와 메모는 `textContent` 또는 DOM 노드로 렌더링합니다.
- `eval`과 외부 스크립트를 사용하지 않습니다.
- 입력창 글자 크기는 iPhone Safari 자동 확대를 막기 위해 16px로 고정합니다.
- 버튼은 44×44px 이상의 터치 영역을 유지합니다.
- Safe Area, 키보드 탐색, 가시적 Focus, `prefers-reduced-motion`을 지원합니다.
- 글자 크기는 6/8/10/12/14/17px 여섯 단계이며 입력창과 터치 영역의 크기는 유지됩니다.

자세한 사용 방법은 [USER-GUIDE-KO.md](./USER-GUIDE-KO.md)를 참고하세요.
