# blog-publisher

마크다운 초안을 검수해서 Hugo 블로그 저장소에 PR로 발행하는 완전 클라이언트사이드 웹앱. 백엔드 서버 없음.

배포 URL: `https://chictimin.github.io/blog-publisher/`

## 무엇을 하는 앱인가

- 입력: 마크다운 초안 전문, 대상 저장소(owner/repo), 방문자가 직접 입력한 OpenAI 호환 API 키·baseUrl과 GitHub PAT.
- 결과물: 대상 저장소 `content/blog/<slug>.md`를 추가하는 PR 1건. `main`에 직접 push하지 않고 PR까지만 만든다.

## 준비할 것

(a) **OpenAI 호환 API 키 + baseUrl** — 키 하나가 아니라 키·baseUrl 조합이다. CORS 실측(2026-09-10)으로 확인된 예시 2개: `https://api.openai.com/v1` (본가, 권장), `https://opencode.ai/zen/go/v1` (호환 게이트웨이). 권장은 본가다. 호환 게이트웨이는 공유 쿼터 소진으로 실행 중 끊길 수 있다. 값을 미리 채우지 않으며, 방문자가 제3의 제공자를 넣을 수도 있다. 모델 목록 조회와 실행에 사용한다.

(b) **GitHub fine-grained PAT** — 권한은 대상 저장소 1개 한정, 아래 2개만:

- Contents: Read and write
- Pull requests: Read and write

발급 경로: GitHub 우측 상단 프로필 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token → Repository access에서 대상 저장소 1개만 선택 → 위 2개 권한을 Read and write로 설정.

(c) **대상 저장소 전제** — Hugo 구조(`content/blog` 디렉토리, TOML frontmatter)여야 한다. 다른 레이아웃에서는 slug 검사 경로 기본값(`content/blog`)을 바꿔야 한다.

## 사용 순서

1. 설정 — 키 2개와 owner/repo 입력.
2. 모델 선택 — 목록은 키·baseUrl로 조회하며 기본 선택 없음. 고르지 않으면 실행 불가.
3. 초안 입력 — 마크다운 붙여넣기.
4. 실행 — 단계별 trace(도구 호출·결과, 토큰, 소요시간)를 목록으로 확인.
5. 승인 — 변경 요약(diffPreview)을 보고 승인·거절. 거절해도 오류가 아니다.
6. 결과 — PR 링크로 이동하거나 오류별 다음 행동 안내를 본다.

## 키 취급 방식

과제 사양은 "민감 정보를 환경변수로 관리"를 요구하지만, 이 앱에는 서버가 없어 환경변수를 둘 곳이 없다. 대신 방문자가 매번 직접 입력하는 BYOK 구조다.

- 키·baseUrl·토큰은 브라우저 탭 메모리에만 둔다. `localStorage`·`sessionStorage`에 저장하지 않으며, 새로고침하면 사라지고 다시 입력해야 한다.
- 모델 API를 브라우저에서 직접 호출하므로 키가 클라이언트 코드에 노출된다는 위험이 있다. `openai` 패키지 공식 문서에도 이 위험을 경고하는 문구가 있다. 그래서 타인의 키가 아닌 방문자 본인의 키·baseUrl로만 동작하도록 범위를 한정했다.
- CORS 허용 여부는 방문자가 입력한 baseUrl의 제공자에 달려 있고 앱이 통제할 수 없다. 차단되면 `CORS_BLOCKED` 안내가 나가며, 다른 baseUrl·키로 바꿔야 한다.

## 로컬 실행

```bash
npm install
npm run dev
npm run build
```

## 배포

GitHub Actions로 빌드해 GitHub Pages에 배포한다. 워크플로는 `.github/workflows/` 디렉토리 참조.

## 한계와 Out of Scope

- 이미지 업로드 미지원. 이미지가 포함된 초안은 경로 정리까지만 하고 에셋 업로드는 하지 않는다.
- 새로고침하면 입력한 키·실행 상태가 모두 초기화된다. 이어하기(재개) 없음.
- 발행 중간 실패 시 자동 롤백 없음. 부분 생성된 브랜치는 GitHub UI에서 직접 정리한다.
- 그 외 MVP 밖 선언: 포맷 학습 도구, 검수/발행 에이전트 분리, IndexedDB 재개, Web Worker 격리, 비용 단가 표시, MCP 서버, 자동 트리거, 로그인, 다크모드 토글.

## 평가

PRD 9절 계획(draft 3개 × 모델 2종 = 6회 실행, 완료율·변환 정확도·소요시간·토큰 측정)에 따라 실행하고 결과 표는 추후 채운다.
