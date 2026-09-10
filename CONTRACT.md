# CONTRACT — 소유권과 인터페이스 (오케스트레이터 nipe 작성, 2026-09-10)

이 파일이 정본이다. 여기 적힌 시그니처를 양쪽이 그대로 지킨다. **다른 담당의 파일을 수정하지 않는다.** 계약을 바꿔야 하면 직접 고치지 말고 nipe에게 hcom으로 요청한다.

## 프로젝트 정체

마크다운 초안을 검수하고, 방문자 소유의 Hugo 블로그 GitHub 저장소에 PR로 발행하는 **완전 클라이언트사이드 웹앱**. 백엔드 서버 없음. GitHub Pages 배포. 아이펠 과제 제출물.

- **모델 제공자는 OpenAI 호환 API다(2026-09-10 변경).** Anthropic SDK는 쓰지 않는다. `openai` 패키지를 쓰고, **`baseUrl`도 방문자가 입력한다** — api.openai.com 본가든 OpenAI 호환 게이트웨이든 방문자가 정한다.
- 모델 호출과 GitHub REST를 **브라우저에서 직접 호출**한다. 키·baseUrl 모두 방문자 입력이다(BYOK).
- `openai` 클라이언트 생성 시 `dangerouslyAllowBrowser: true`가 필수다.
- **CORS는 방문자가 넣은 baseUrl 제공자에 달렸다.** 앱이 통제할 수 없으므로, 차단되면 `CORS_BLOCKED`로 분류하고 다른 baseUrl·키가 필요하다고 안내한다. 이건 결함이 아니라 구조적 한계이며 문서에 그렇게 쓴다.
- `api.github.com`은 CORS를 허용한다(`Authorization: Bearer <PAT>`로 직접 호출 가능).
- 키는 **메모리에만** 보관한다. `localStorage`·`sessionStorage`에 쓰지 않는다. 새로고침하면 재입력이며, 그 사실을 화면에 한 줄로 안내한다.

## 소유권

| 담당 | 소유 파일 | 금지 |
|---|---|---|
| **A (셸·UI)** | `index.html`, `vite.config.ts`, `package.json`, `tsconfig*.json`, `.github/workflows/**`, `src/main.tsx`, `src/App.tsx`, `src/ui/**`, `src/styles.css` | `src/core/**` 생성·수정 금지 |
| **B (코어)** | `src/core/**` 전부 | `src/ui/**`, 설정 파일, 워크플로 수정 금지 |
| **nipe** | `CONTRACT.md`, 검증·커밋·배포 | — |
| **mila (문서)** | `PRD.md`, `README.md` | 코드 파일 수정 금지 |

`PRD.md`와 `README.md`는 문서 담당이 소유한다. **A·B는 이 두 파일을 삭제하거나 수정하지 않는다** — 스캐폴드 잔재로 보이더라도 손대지 않는다.

A는 `src/core/`의 구현을 기다리지 않는다. 아래 시그니처대로 import해서 UI를 완성한다. B가 파일을 만들기 전이라도 타입 에러는 무시하고 진행한다(마지막에 합칠 때 맞는다).

## src/core/types.ts — B가 이 파일을 가장 먼저 만든다

```ts
export type ToolName = 'list_repo_posts' | 'create_publish_pr';

export type RunStatus =
  | 'idle' | 'running' | 'waiting_approval' | 'completed' | 'error';

export interface RunConfig {
  apiKey: string;       // OpenAI 호환 API 키. 방문자 입력
  baseUrl: string;      // OpenAI 호환 엔드포인트. 방문자 입력. 기본값을 코드에 박지 않는다
  githubToken: string;
  model: string;        // 방문자가 고른 모델 id. 기본값을 코드에 박지 않는다.
  owner: string;        // 대상 저장소 소유자
  repo: string;         // 대상 저장소 이름
  maxIters: number;     // 종료 조건. 기본 8
}

export interface TraceEvent {
  seq: number;                 // 1부터 증가
  at: string;                  // ISO8601
  kind: 'model_call' | 'tool_call' | 'tool_result' | 'approval' | 'done' | 'error';
  label: string;               // 화면에 한 줄로 보일 요약
  detail?: string;             // 펼쳤을 때 보일 본문(JSON 문자열 허용)
  tokensIn?: number;           // model_call에만
  tokensOut?: number;          // model_call에만
  ms?: number;                 // 이 단계 소요 시간
}

export interface ApprovalRequest {
  id: string;
  title: string;               // 예: "PR을 생성합니다"
  diffPreview: string;         // 사람이 읽을 변경 요약(마크다운 아님, 평문)
}

export interface RunResult {
  status: RunStatus;
  prUrl?: string;              // 성공 시 생성된 PR 주소
  errorCode?: string;          // 실패 시 아래 오류 코드 표 참조
  errorMessage?: string;
}
```

## src/core/index.ts — B가 export할 함수 2개

```ts
import type { RunConfig, RunResult, TraceEvent, ApprovalRequest } from './types';

/** 키가 실제로 접근 가능한 모델 목록. GET {baseUrl}/models 를 호출한다. 목록을 하드코딩하지 않는다.
 *  OpenAI 호환 응답은 { data: [{ id, ... }] } 형태이며 display_name이 없을 수 있다 — 없으면 id를 그대로 쓴다. */
export function listModels(apiKey: string, baseUrl: string): Promise<Array<{ id: string; display_name: string }>>;

/** 에이전트 루프 1회 실행. */
export function runAgent(args: {
  config: RunConfig;
  draft: string;                                   // 방문자가 붙여넣은 마크다운 전문
  onTrace: (e: TraceEvent) => void;                // 모든 단계에서 호출
  onStatus: (s: RunStatus) => void;
  onApproval: (req: ApprovalRequest) => Promise<boolean>;  // true=승인, false=거절
}): Promise<RunResult>;
```

- `runAgent`는 **`create_publish_pr` 실행 직전에 반드시 `onApproval`을 호출**하고, `false`면 도구를 실행하지 않고 `status: 'completed'`로 끝낸다(거절은 오류가 아니다).
- `onApproval`이 pending인 동안 `onStatus('waiting_approval')`을 보낸다.
- `maxIters` 초과 시 `errorCode: 'LIMIT_EXCEEDED'`로 종료한다. 무한 루프를 만들지 않는다.

## 도구 2개 (B 담당)

모델에 노출하는 tool은 **정확히 이 2개**다. 더 늘리지 않는다.

**도구 형식은 OpenAI function calling이다**: 요청은 `tools: [{ type: 'function', function: { name, description, parameters } }]`, 응답은 `choices[0].message.tool_calls[]`(각 항목에 `id`, `function.name`, `function.arguments`(JSON 문자열)), 결과는 `{ role: 'tool', tool_call_id, content }` 메시지로 되돌린다. 루프 종료 판정은 `tool_calls`의 유무로 한다(Anthropic의 `stop_reason: 'tool_use'`가 아니다). 토큰은 `usage.prompt_tokens` / `usage.completion_tokens`에서 읽는다 — 제공자가 usage를 주지 않으면 그 필드를 비워 두고 0으로 채우지 않는다.

### `list_repo_posts`
- 용도: 대상 저장소의 기존 포스트 파일명을 읽어 slug 중복을 검사한다. 읽기 전용.
- 입력: `{ path?: string }` — 기본 `"content/blog"`.
- 출력: `{ files: string[] }`
- API: `GET /repos/{owner}/{repo}/contents/{path}`

### `create_publish_pr`
- 용도: 브랜치를 만들고 변환된 포스트를 커밋하고 PR을 생성한다. **쓰기. 승인 필수.** `main` 직접 push 금지.
- 입력: `{ slug: string; frontmatter: string; body: string; prTitle: string; prBody: string }`
  - `frontmatter`는 TOML 문자열(`+++ ... +++` 포함)이다.
- 출력: `{ prUrl: string; branch: string }`
- API 순서: `GET /repos/{o}/{r}/git/ref/heads/{default}` → `POST /repos/{o}/{r}/git/refs` → `PUT /repos/{o}/{r}/contents/{path}` → `POST /repos/{o}/{r}/pulls`
- 커밋 경로: `content/blog/<slug>.md`

## 오류 코드 (B가 RunResult.errorCode에 넣고, A가 화면 문구로 매핑)

| 코드 | 의미 | 화면에 안내할 다음 행동 |
|---|---|---|
| `MISSING_KEY` | 키 또는 토큰 미입력 | 입력 요청 |
| `MODEL_LIST_FAILED` | `/v1/models` 실패 | 키 확인 요청 |
| `CORS_BLOCKED` | baseUrl 제공자가 브라우저 직접 호출을 차단 | 다른 baseUrl·키가 필요함을 안내 |
| `MODEL_REQUEST_FAILED` | Messages API 실패 | 재시도 안내 |
| `GITHUB_AUTH_FAILED` | 401/403 | PAT 권한(Contents·PR write) 확인 요청 |
| `GITHUB_NOT_FOUND` | 404 | owner/repo 확인 요청 |
| `GITHUB_REQUEST_FAILED` | 그 외 GitHub 호출 실패(네트워크·5xx). **1회만 재시도한 뒤 이 코드로 종료** | 재시도 안내 |
| `SLUG_CONFLICT` | 같은 slug가 이미 있음 | slug 변경 요청 |
| `LIMIT_EXCEEDED` | maxIters 초과 | 종료 사실만 표시 |
| `BAD_DRAFT` | 초안이 비었거나 파싱 불가 | 입력 확인 요청 |

## 화면 (A 담당) — 한 페이지, HashRouter

세로 한 줄 흐름. 라우팅은 `#/`만 쓴다(GitHub Pages는 SPA 경로를 지원하지 않는다).

1. **설정** — API 키, **baseUrl**(예시 문구로 `https://api.openai.com/v1` 형태를 보여주되 값을 미리 채우지 않는다), GitHub PAT, owner/repo 입력. "키는 이 탭 메모리에만 보관되며 새로고침하면 사라집니다" 안내 필수. PAT에 필요한 권한(Contents: write, Pull requests: write, 저장소 1개 한정)을 한 줄로 안내.
2. **모델 선택** — 키와 baseUrl 입력 후 `listModels(apiKey, baseUrl)`로 채운다. **기본 선택 없음.** 고르지 않으면 실행 버튼 비활성.
3. **초안 입력** — 마크다운 textarea.
4. **실행 / trace** — `onTrace`로 들어오는 이벤트를 시간순 목록으로. 각 행에 kind 배지·label·소요시간, `detail`은 접기. 하단에 누적 토큰(입력/출력)과 총 소요시간.
5. **승인 카드** — `waiting_approval`이면 `diffPreview`를 보여주고 승인/거절 버튼. 이게 되돌리기 어려운 작업 앞의 게이트다.
6. **결과** — 성공 시 PR 링크를 새 탭으로 여는 앵커. 실패 시 위 표의 문구.

토큰·비용: **토큰 수만 표시한다.** 단가 테이블을 넣지 않는다(API가 단가를 주지 않으므로 낡은 숫자를 실측처럼 보여주지 않는다).

## 스코프 밖 (넣지 말 것)

이미지 업로드 도구, 포맷 학습 도구, 검수/발행 에이전트 분리, IndexedDB 재개, Web Worker 격리, 비용 단가 표시, MCP 서버, 자동 트리거, 로그인, 다크모드 토글. **PRD의 Out of Scope에 선언된 항목들이다.**

## 공통 규칙

- TypeScript. `any` 남용 금지.
- 실행하지 않은 검증을 했다고 쓰지 않는다. 빌드는 실제로 통과시킨 것만 통과라고 보고한다.
- 키·토큰을 콘솔에 로그하지 않는다. `TraceEvent.detail`에도 넣지 않는다.
- 커밋·push는 하지 않는다. nipe가 한다.
- 작업이 끝나면 무엇을 만들었고 무엇이 안 되는지 hcom으로 nipe에게 보고한다.
