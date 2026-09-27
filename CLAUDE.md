# PELAGIA 개발 메모

브라우저용 2.5D 스쿠버 게임. TypeScript + Vite + Three.js, 서버 없음. 플레이어용 소개는 README.md에 있습니다.

## 명령

Node.js 24 LTS 권장.

```sh
npm ci
npm run dev        # http://localhost:5173/my-game/
npm test           # vitest 단위 테스트
npm run build      # tsc --noEmit + vite build → dist/
npm run test:e2e   # Playwright (데스크톱 1440×900 4개, 모바일 가로 844×390 1개)
npm run preview
```

- 로컬 e2e는 설치된 Google Chrome, CI는 Playwright Chromium을 씁니다. 없으면 `npx playwright install chromium`.
- 브라우저 테스트는 소프트웨어 WebGL(SwiftShader)과 저품질 설정으로 돌아 느립니다(로컬 약 3분). CI는 렌더 픽셀 비율 0.5, 타임아웃과 재시도가 더 깁니다. 자세한 건 `playwright.config.ts`.
- e2e는 5180 포트 개발 서버를 띄우거나 이미 떠 있는 것을 재사용합니다.

## 구성

- `src/core`: 맵 생성, 이동·충돌, 생물·전투, 성장, IndexedDB 저장과 저장 파일 검증
- `src/render`: Three.js 장면과 코드로 만든 절차적 3D 모델·애니메이션
- `src/audio.ts`: Web Audio 앰비언스·효과음과 배경음악
- `src/main.ts`, `src/style.css`: 한국어 메뉴, HUD, 키보드·마우스·터치 입력
- `tests`: 단위 테스트(`core`, `storage`)와 데스크톱/모바일 UI 통합 테스트(`e2e.spec.ts`)

게임 판정은 XY 평면, 배경과 모델은 3D입니다. 모델·물 효과·효과음은 코드에서 생성하고 글꼴은 Fontsource로 번들하므로 실행 중 외부 에셋 서버에 접속하지 않습니다.

개발 모드에서만 `window.__PELAGIA_TEST__`(save, expedition, scene)가 노출되고 배포 빌드에서는 제거됩니다. e2e는 이것으로 이동 거리·재료 반복을 줄이고, 실제 조작은 UI 입력으로 합니다.

## 에셋과 배경음악

- 정적 파일은 `public/`에 둡니다. `dist/`는 빌드 결과물이라 gitignore되고 빌드할 때마다 비워집니다. CI도 소스에서 새로 빌드합니다.
- 배경음악은 `public/audio/`의 mp3 4곡이고 `src/audio.ts`의 `MUSIC`에서 환경별로 연결합니다: 기지(로비) `horizons-hush`, 산호초 `crystal-clear-ocean`, 난파선 `endless-descent`, 심해 `fading-sunlight-below`.
  - 스트리밍 `HTMLAudioElement` → `MediaElementSource` → 음악 버스 → master 구조라 음소거 설정이 그대로 적용됩니다. 곡 음량은 `MUSIC_VOLUME`.
  - 환경이 바뀌면 크로스페이드하고, 떠난 곡은 3초 뒤 멈추고 처음으로 되감습니다. 탭을 숨기면 `suspend()`로 멈추고 다음 사용자 입력의 `start()`에서 이어집니다.
  - 브라우저 자동 재생 정책 때문에 첫 클릭 전에는 소리가 나지 않습니다.
- 음악은 프로젝트 소유자의 친구가 이 게임을 위해 만들어 허락받고 사용합니다. 에셋을 추가·변경하면 `ASSETS.md`와 `public/credits.txt`를 함께 갱신합니다.

## 배포

- GitHub Pages 게시 소스는 GitHub Actions(`.github/workflows/deploy.yml`)입니다. `main`에 푸시하면 단위 테스트 → 빌드 → e2e를 통과한 `dist/`를 Pages에 배포합니다. 전체 약 10분.
- Vite `base`는 `/my-game/`, 주소는 https://dgh06175.github.io/my-game/ 입니다.
- 워크플로는 `cancel-in-progress`라서 배포가 도는 중에 `main`에 다시 푸시하면 진행 중인 실행이 취소되고 새로 시작합니다.

## README 스크린샷

`docs/screenshot.jpg`(1920×1200)는 헤드리스 Chrome으로 찍은 기지 화면입니다. 다시 찍을 때:

- `chromium.launch({ channel: "chrome", args: ["--use-angle=metal"] })`로 실제 GPU(Apple Metal)를 쓰고, 뷰포트 1440×900, `deviceScaleFactor: 2`, 그래픽 품질 "높음"으로 찍습니다.
- 꾸며진 기지를 보여주려면 설정의 저장 파일 가져오기로 중반 진행 저장을 넣습니다. 수족관에 전시하는 종(`displayed`)은 수집 가능 종이어야 하고 `stock`에 `specimen:<종>`이 1 이상 있어야 검증을 통과합니다. 장식은 발견 종 수로 해금되고 12×6 격자 안에서 겹치지 않아야 합니다.
- 토스트는 CSS로 숨기고 찍은 뒤 `sips -s format jpeg -s formatOptions 88 --resampleWidth 1920`으로 줄입니다.

## 목표와 기록

- 성능 목표: PC 1080p 60fps, 모바일 저품질 30fps. 아직 실제 기기별로 측정하지 않았습니다.
- 밸런스 기준: 탐사 5–10분, 첫 목표(빛결가오리 기록) 달성 30–60분에 맞춰 초기 산소와 성장 비용을 정했습니다.
- 검사 범위와 기기 측정 여부는 `VALIDATION.md`, 에셋·글꼴 라이선스는 `ASSETS.md`에 기록합니다.
