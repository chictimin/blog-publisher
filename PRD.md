# PRD — blog-publisher (초안, 2026-09-10)

마크다운 초안을 검수하고 방문자 소유의 Hugo 블로그 GitHub 저장소에 PR로 발행하는 완전 클라이언트사이드 웹앱. 백엔드 서버 없음. GitHub Pages 배포. 아이펠 Main Quest 4 제출물.

본 문서의 인터페이스·화면·오류 코드는 `CONTRACT.md`(2026-09-10, 오케스트레이터 nipe 작성)를 정본으로 따르며, CONTRACT와 다르게 적힌 부분이 있으면 CONTRACT가 우선한다.

## 1. 문제 정의

반복 업무: 마크다운 초안 발행. 초안이 생길 때마다 사람이 직접 하던 일 — frontmatter 형식 맞추기, slug 중복 확인, 위키링크·이미지 경로 정리, 브랜치 생성·커밋·PR 생성을 대신 처리한다.

- 입력: 방문자가 붙여넣은 마크다운 초안 전문, 대상 저장소(owner/repo), 방문자가 직접 입력한 OpenAI 호환 API 키·baseUrl과 GitHub PAT, 방문자가 고른 모델 id.
- 결과물: 대상 저장소의 `content/blog/<slug>.md`를 추가하는 PR 1건(PR URL 반환). `main`에 직접 push하지 않는다.

## 2. 타겟 유저

Hugo + GitHub Pages로 블로그를 운영하는 개인 블로거. devlog 발행 업무를 반복하는 운영자 본인을 기준으로 일반화한 형태이며(가정), 대상 저장소의 구조(`content/blog`, TOML frontmatter)를 이미 갖춘 저장소를 전제로 한다(가정: 저장소 레이아웃이 다르면 `path` 기본값 변경으로 대응).

## 3. 워크플로 설계

트리거는 방문자의 실행 버튼이다. 스케줄·웹훅 등 자동 트리거는 없다.

| 단계 | 에이전트가 판단할 일 | 도구가 처리할 일 |
|---|---|---|
| 1. 초안 검증 | 초안이 비었는지, 파싱 가능한지 판단. 불가면 `BAD_DRAFT`로 종료 | 없음 (로컬 검사) |
| 2. 검수 | TODO 마커 잔존, 깨진 위키링크, frontmatter 필수 필드 누락, 미래 `date`, 이미지 참조 누락을 탐지 | 없음 (모델 판단) |
| 3. slug 중복 검사 | 중복 시 새 slug를 제안할지, 중단할지 판단 | `list_repo_posts`가 기존 포스트 파일명 목록 반환 (읽기 전용) |
| 4. 변환 | frontmatter YAML→TOML 변환, 위키링크 정리, 이미지 경로 재작성. 대상 저장소 포맷 판단 | (가정) 변환은 모델이 수행하고, 포맷 근거는 `list_repo_posts`로 읽은 기존 파일에서 얻는다. 별도 `fetch_post_format` 도구는 CONTRACT 확정 2개에 없으므로 두지 않는다 |
| 5. 승인 요청 | diff 요약 평문(`diffPreview`) 작성 | 없음. `onApproval` 호출 후 `waiting_approval` 상태로 대기 |
| 6. 발행 | 승인(true)일 때만 실행. 거절(false)이면 도구 없이 `completed` 종료 | `create_publish_pr`가 브랜치 생성→커밋→PR 생성 (쓰기, 승인 필수) |
| 7. 결과 보고 | 성공·실패 요약 | 없음. `RunResult`(성공 시 `prUrl`, 실패 시 `errorCode`) 반환 |

검수와 발행을 별도 에이전트로 분리하지 않는다. 단일 루프가 순차 수행하며, 단계별 상태는 `RunStatus`(`idle`/`running`/`waiting_approval`/`completed`/`error`)로 관리한다.

## 4. 도구 계획

모델에 노출하는 도구는 정확히 2개이며, 형식은 OpenAI function calling이다. 요청은 `tools: [{ type: 'function', function: { name, description, parameters } }]`로 보내고, 응답의 `choices[0].message.tool_calls[]`(`id`, `function.name`, `function.arguments` JSON 문자열)를 읽어 실행한 뒤 결과를 `{ role: 'tool', tool_call_id, content }` 메시지로 되돌린다. 루프 종료 판정은 `tool_calls` 유무로 한다. 토큰은 `usage.prompt_tokens`/`usage.completion_tokens`에서 읽으며, 제공자가 usage를 주지 않으면 비워 두고 0으로 채우지 않는다.

### `list_repo_posts` (읽기 전용)
- 용도: 기존 포스트 파일명 조회로 slug 중복 검사. 에이전트는 실행 전후에 이 도구를 "언제" 쓰는지 설명(description)에 명시한다.
- 입력 스키마: `{ path?: string }` (기본 `"content/blog"`)
- 출력 스키마: `{ files: string[] }`
- API: `GET /repos/{owner}/{repo}/contents/{path}`
- 실패 처리: 401/403이면 재시도 없이 `GITHUB_AUTH_FAILED`로 종료(PAT 권한 안내). 404면 `GITHUB_NOT_FOUND`로 종료(owner/repo 확인 안내). 그 외 네트워크 오류는 1회 재시도 후 `MODEL_REQUEST_FAILED`가 아니라 GitHub 오류로 취급한다(가정: 재시도 횟수 1회).

### `create_publish_pr` (쓰기, 승인 필수)
- 용도: 브랜치 생성→변환 포스트 커밋→PR 생성. `main` 직접 push 금지.
- 입력 스키마: `{ slug, frontmatter, body, prTitle, prBody }` (`frontmatter`는 `+++ ... +++` 포함 TOML 문자열)
- 출력 스키마: `{ prUrl, branch }`
- API 순서: `GET /repos/{o}/{r}/git/ref/heads/{default}` → `POST /repos/{o}/{r}/git/refs` → `PUT /repos/{o}/{r}/contents/{path}` → `POST /repos/{o}/{r}/pulls`. 커밋 경로 `content/blog/<slug>.md`.
- 실패 처리: 401/403이면 `GITHUB_AUTH_FAILED`로 종료. 같은 slug 존재가 확인되면 `SLUG_CONFLICT`로 종료(slug 변경 안내). 중간 단계(브랜치 생성 후 커밋 실패 등) 실패 시 재시도하지 않고 `errorCode`와 함께 종료한다(가정: 부분 생성된 브랜치는 사람이 GitHub UI에서 정리. 자동 롤백 없음).

### 공통
- 위험 도구 권한 최소화: PAT는 대상 저장소 1개에 Contents write·Pull requests write만 요구하며, 설정 화면에 한 줄로 안내한다.
- 키·토큰을 콘솔에 로그하지 않고 `TraceEvent.detail`에도 넣지 않는다.

## 5. 사람 개입 지점

승인 게이트는 1곳이다. `create_publish_pr` 실행 직전, `diffPreview`(사람이 읽을 변경 요약 평문)를 보여주고 승인·거절을 받는다.

- 왜 거기인지: PR 생성은 외부 저장소에 기록이 남는 되돌리기 어려운 작업이기 때문이다. PR까지만 만들고 머지하지 않는 구조 자체가 두 번째 안전장치다(되돌리기는 GitHub UI에서 클릭 한 번).
- 거절은 오류가 아니다. 도구를 실행하지 않고 `status: 'completed'`로 끝낸다.
- 검수 단계에는 별도 승인 게이트를 두지 않는다(HANDOFF안의 2게이트에서 CONTRACT 정본 1게이트로 축소). 검수 결과는 trace에서 사람이 직접 확인한다.

## 6. 핵심 기능(MVP)과 화면 구성

한 페이지, HashRouter(`#/`만 사용. GitHub Pages는 SPA 경로를 지원하지 않으므로).

1. **설정** — API 키, baseUrl, GitHub PAT, owner/repo 입력. "키는 이 탭 메모리에만 보관되며 새로고침하면 사라집니다" 안내 필수. PAT 필요 권한 한 줄 안내.
2. **모델 선택** — 키·baseUrl 입력 후 `listModels(apiKey, baseUrl)`(GET {baseUrl}/models, 하드코딩 금지)로 채운다. `display_name`이 없는 제공자 응답은 id를 그대로 쓴다. 기본 선택 없음. 미선택 시 실행 버튼 비활성.
3. **초안 입력** — 마크다운 textarea.
4. **실행 / trace** — `onTrace` 이벤트를 시간순 목록으로. 각 행에 kind 배지·label·소요시간, `detail`은 접기. 하단에 누적 토큰(입력/출력)과 총 소요시간.
5. **승인 카드** — `waiting_approval`이면 `diffPreview` 표시와 승인·거절 버튼.
6. **결과** — 성공 시 PR 링크를 새 탭으로 여는 앵커. 실패 시 오류 코드별 다음 행동 문구.

토큰·비용 표시는 토큰 수만 한다. 단가 테이블을 넣지 않는다(API가 단가를 주지 않으므로).

## 7. 종료 조건

- 최대 반복 `maxIters`(기본 8, `RunConfig`로 변경 가능) 초과 시 `errorCode: 'LIMIT_EXCEEDED'`로 종료. 무한 루프를 만들지 않는다.
- 오류 코드별 종료와 화면 문구는 CONTRACT 표를 따른다: `GITHUB_REQUEST_FAILED`(1회 재시도 후 실패, 재시도 안내), `MISSING_KEY`(입력 요청), `MODEL_LIST_FAILED`(키 확인 요청), `CORS_BLOCKED`(다른 키 필요 안내), `MODEL_REQUEST_FAILED`(재시도 안내), `GITHUB_AUTH_FAILED`(PAT 권한 확인 요청), `GITHUB_NOT_FOUND`(owner/repo 확인 요청), `SLUG_CONFLICT`(slug 변경 요청), `BAD_DRAFT`(입력 확인 요청).

## 8. 관찰 가능성

- `runAgent`는 모든 단계에서 `onTrace(TraceEvent)`를 호출한다. `TraceEvent`는 `seq`(1부터 증가)·`at`(ISO8601)·`kind`(`model_call`/`tool_call`/`tool_result`/`approval`/`done`/`error`)·`label`(한 줄 요약)·`detail`(펼침 본문, JSON 허용)·`tokensIn`·`tokensOut`(`model_call`에만)·`ms`(단계 소요시간)를 남긴다.
- 화면의 실행/trace 목록이 그대로 관찰 수단이다. 누적 토큰과 총 소요시간으로 어느 단계가 병목인지 판단한다.
- 비용(금액)은 기록하지 않는다. 단가 미제공이 이유이며, 토큰 수 표기로 대체한다.

## 9. 평가 계획

draft 3개 × 모델 2종 = 6회 실행으로 아래 표를 채운다. 표는 계획이며 수치는 아직 없다.

| # | draft | 모델 | 완료 여부 | 변환 정확도 | 소요시간 | 토큰(입력/출력) | 비고(실패 단계·원인) |
|---|---|---|---|---|---|---|---|
| 1–3 | archive 8쌍 중 대표 3개 선정 | 방문자 baseUrl에서 조회되는 모델 2종 중 1 (특정 모델명 지정 없음) | — | — | — | — | — |
| 4–6 | 동일 3개 | 동일 2종 중 다른 1 | — | — | — | — | — |

- 측정 기준: 완료율(6회 중 PR 생성까지 도달 비율), 변환 정확도(대응 발행 포스트와의 diff 비교), 소요시간, 토큰.
- 평가 세트: `devlog/draft/archive/`의 발행 완료 draft와 Hugo 저장소 `content/blog/`의 대응 포스트 쌍을 입력/정답으로 재사용한다. 새로 만들지 않는다. **파일명이 일치하는 쌍은 11개가 아니라 8개다**(실측 2026-09-10). 나머지 3개(`ai-coding-session-capture`, `cuttoon-copilot-hackathon-retrospective`, `obsidian-capture-skill-cost-redesign`)는 Hugo에 같은 slug가 없어 정답 대조가 불가하므로 평가 세트에서 제외한다.
- 실패 실행(잘못된 도구 선택, 중간 포기, 환각된 결과, 불필요한 반복)은 비고란에 모아 어느 단계가 원인인지 정리한다.
- (가정) 평가는 사람이 브라우저에서 6회를 직접 실행하고 표를 수기로 채운다. 자동 평가 harness는 MVP 밖이다.

## 10. Out of Scope

다음은 MVP에 넣지 않으며, 넣지 않기로 선언한다: 이미지 업로드 도구, 포맷 학습 도구, 검수/발행 에이전트 분리, IndexedDB 재개, Web Worker 격리, 비용 단가 표시, MCP 서버, 자동 트리거, 로그인, 다크모드 토글.

## 11. 기술 제약과 근거

- **브라우저 직접 호출**: `openai` 패키지는 브라우저 지원을 공식 제공한다. 클라이언트 생성 시 `dangerouslyAllowBrowser: true`가 필수다. 근거: https://developers.openai.com/api/reference/typescript/ (Requirements 절 원문, 확인 2026-09-10). 공식 문서에 CORS 정책이 명시돼 있지는 않으나, 프리플라이트 실측으로 아래 두 엔드포인트의 브라우저 직접 호출 가능을 확인했다(실측 2026-09-10. OPTIONS 요청에 `Origin: https://chictimin.github.io`와 `Access-Control-Request-Headers: authorization,content-type` 부여): (1) `https://api.openai.com/v1/models` → HTTP 200, `access-control-allow-origin: *`, 허용 methods에 GET·POST 등 포함, 허용 headers에 authorization·content-type 포함. (2) `https://opencode.ai/zen/go/v1/models` → HTTP 200, `access-control-allow-origin: *`, 허용 methods GET·POST·OPTIONS, 허용 headers Content-Type·Authorization 포함. CORS 허용 여부는 방문자가 입력한 baseUrl의 제공자에 달려 있고 앱이 통제할 수 없으므로, 제3의 제공자에서는 차단될 수 있다. 차단되면 `CORS_BLOCKED`로 분류하고 다른 baseUrl·키를 안내한다. 이는 결함이 아니라 구조적 한계다. 브라우저 키 노출 위험에 대한 공식 경고가 있으므로, 키·baseUrl은 타인의 것이 아닌 방문자 본인의 것으로 한정한다(BYOK).
- **GitHub Pages**: 게시 사이트 최대 1GB, 배포 10분 타임아웃, 대역폭 월 100GB(soft). 근거: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits (확인 2026-09-10). SPA 경로 미지원이므로 라우팅은 `#/`만 쓴다.
- **PAT가 유일 경로인 이유**: 서버가 없으므로 GitHub OAuth의 client secret 보관·교환 주체가 없다. 브라우저에서 `api.github.com`을 `Authorization: Bearer <PAT>`로 직접 호출(CORS 허용)하고, 권한은 대상 저장소의 Contents write·PR write로 한정한다. 키 보관 방식 중 localStorage·sessionStorage는 OWASP가 인증정보 보관처로 명시적 비권고이므로 메모리만 보관하고 새로고침 시 재입력으로 한다. 근거: OWASP Session Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet (확인 2026-09-10).
