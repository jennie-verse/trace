# Trace

다른 개인용 앱이 비공개 저장소 `webapp-data`에 남긴 기록을 읽어, 선택한 하루를 시간순으로 보여주는 정적 웹앱입니다. Trace에서 직접 입력하는 데이터는 날짜별 한 줄 메모뿐입니다.

빌드 도구나 서버가 필요하지 않습니다. 이 폴더를 그대로 GitHub Pages에 올리면 `https://jennie-verse.github.io/trace/`에서 실행됩니다.

## 사용

- 날짜를 골라 그날 저장된 clip·note를 시간순으로 확인합니다.
- 하루에 한 줄 메모를 남길 수 있고, 4초 뒤 자동으로 동기화됩니다.
- tide 항목은 **7일간 손대지 않아 만료된 뒤에만** 아카이브에 나타납니다 — 최근 날짜가 비어 있는 것은 정상입니다.

자세한 데이터원과 동기화 방식은 [구조와 데이터 처리](docs/README-KO.md), 사용법은 [사용 안내](docs/USER-GUIDE-KO.md)를 보세요.

## 구성

`src/` 읽기·병합·동기화 로직 · `assets/` 스타일 · `icons/` PWA 아이콘 · `fonts/` 로컬 글꼴 · `docs/` 한국어 안내 · `manifest.webmanifest` · `sw.js` · `.nojekyll`
