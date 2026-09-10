# API_SPEC — 경계별 약속 (2026-09-10)

## 이 문서의 범위

과제 명세는 제출 폴더에 "화면과 서버의 약속"을 담은 `API_SPEC.md`를 요구한다. **이 앱에는 서버가 없다** (`DECISIONS.md` D1). 따라서 여기서 고정하는 것은 서버 API가 아니라 아래 세 경계다.

| 경계 | 양쪽 | 정본 |
|---|---|---|
| 1. 화면 ↔ 코어 | `src/ui/**` ↔ `src/core/**` | 이 문서 §1, `CONTRACT.md` |
| 2. 코어 ↔ 모델 제공자 | `src/core/loop.ts` ↔ 방문자가 입력한 OpenAI 호환 엔드포인트 | 이 문서 §2 |
| 3. 코어 ↔ GitHub | `src/core/github.ts` ↔ `api.github.com` | 이 문서 §3 |

경계 1은 원래 서버 API가 놓였을 자리다. 서버를 없앤 대신 같은 계약을 모듈 경계에 두었고, 그래서 화면 없이도 같은 코어를 Node에서 실행할 수 있다(`npm run eval`).

시그니처는 `src/core/types.ts`·`src/core/index.ts`의 현재 구현과 대조해 일치를 확인했다(2026-09-10).

## 1. 화면 ↔ 코어

`src/core/index.ts`가 내보내는 것은 함수 2개와 타입 6개뿐이다. 화면은 이 표면만 쓴다.

### 1.1 `listModels`

```ts
listModels(apiKey: string, baseUrl: string): Promise<Array<{ id: string; display_name: string }>>
```

- 언제: 방문자가 API 키와 baseUrl을 입력한 뒤, 모델 선택 목록을 채울 때.
- 목록을 하드코딩하지 않는다. 실제로 그 키가 접근 가능한 모델만 돌아온다.
- 제공자 응답에 `display_name`이 없으면 `id`를 그대로 쓴다.
- 실패는 예외로 던진다. 코드는 `MISSING_KEY`(키·baseUrl 미입력), `CORS_BLOCKED`(fetch 자체 실패), `MODEL_LIST_FAILED`(응답 비정상).

### 1.2 `runAgent`

```ts
runAgent(args: {
  config: RunConfig;
  draft: string;                                          // 마크다운 전문
  onTrace: (e: TraceEvent) => void;                       // 모든 단계에서 호출
  onStatus: (s: RunStatus) => void;
  onApproval: (req: ApprovalRequest) => Promise<boolean>;  // true=승인, false=거절
}): Promise<RunResult>
```

코어가 화면에 지키는 약속 4가지.

1. `create_publish_pr` 실행 **직전에 반드시** `onApproval`을 호출한다. `false`를 받으면 도구를 실행하지 않고 `status: 'completed'`로 끝낸다. 거절은 오류가 아니다.
2. `onApproval`이 pending인 동안 `onStatus('waiting_approval')`을 보낸다. 화면은 이 상태에서 승인 카드를 띄운다.
3. 모든 단계에서 `onTrace`를 호출한다. 화면은 이것 말고 진행 상황을 알 다른 경로가 없다.
4. `maxIters`(기본 8)를 넘기면 `errorCode: 'LIMIT_EXCEEDED'`로 종료한다. 무한 루프를 만들지 않는다.

화면이 코어에 지키는 약속: `onApproval`은 사람의 응답이 올 때까지 resolve하지 않는다. 승인·거절 어느 쪽이든 반드시 한 번 resolve한다(영원히 pending으로 두지 않는다).

### 1.3 타입

```ts
type ToolName = 'list_repo_posts' | 'create_publish_pr';
type RunStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'error';

interface RunConfig {
  apiKey: string;      // 방문자 입력. 코드에 기본값 없음
  baseUrl: string;     // 방문자 입력. 코드에 기본값 없음
  githubToken: string;
  model: string;       // 방문자가 고른 id. 코드에 기본값 없음
  owner: string;
  repo: string;
  maxIters: number;    // 기본 8
}

interface TraceEvent {
  seq: number;         // 1부터 증가
  at: string;          // ISO8601
  kind: 'model_call' | 'tool_call' | 'tool_result' | 'approval' | 'done' | 'error';
  label: string;       // 한 줄 요약
  detail?: string;     // 펼침 본문(JSON 문자열 허용)
  tokensIn?: number;   // model_call에만
  tokensOut?: number;  // model_call에만
  ms?: number;
}

interface ApprovalRequest {
  id: string;
  title: string;
  diffPreview: string; // 평문. 마크다운 아님
}

interface RunResult {
  status: RunStatus;
  prUrl?: string;      // 성공 시
  errorCode?: string;  // 실패 시 §4
  errorMessage?: string;
}
```

`tokensIn`·`tokensOut`은 제공자가 `usage`를 주지 않으면 **비워 둔다.** 0으로 채우지 않는다 — 0은 "안 썼다"는 뜻이 되어 실측을 왜곡한다.

### 1.4 상태 전이

```
idle ──실행──▶ running ──▶ waiting_approval ──승인──▶ running ──▶ completed
                  │                │                              (prUrl 있음)
                  │                └──거절──────────────────────▶ completed
                  │                                               (prUrl 없음)
                  └──실패────────────────────────────────────────▶ error
                                                                   (errorCode 있음)
```

`completed`가 곧 "PR이 생겼다"가 아니다. 거절도 `completed`다. 구분은 `prUrl` 유무로 한다.

## 2. 코어 ↔ 모델 제공자

- 엔드포인트: 방문자가 입력한 `baseUrl`. 코드에 기본값을 박지 않는다.
- 인증: `Authorization: Bearer <apiKey>`.
- 브라우저 직접 호출이므로 `openai` 클라이언트 생성 시 `dangerouslyAllowBrowser: true`가 필수다.

| 용도 | 호출 |
|---|---|
| 모델 목록 | `GET {baseUrl}/models` → `{ data: [{ id, ... }] }` |
| 에이전트 루프 | `POST {baseUrl}/chat/completions` (OpenAI function calling) |

도구 호출 규약(OpenAI function calling):

- 요청: `tools: [{ type: 'function', function: { name, description, parameters } }]`
- 응답: `choices[0].message.tool_calls[]` — 각 항목에 `id`, `function.name`, `function.arguments`(JSON **문자열**)
- 결과 반환: `{ role: 'tool', tool_call_id, content }` 메시지
- **루프 종료 판정은 `tool_calls`의 유무로 한다.** Anthropic의 `stop_reason: 'tool_use'`가 아니다.
- 토큰은 `usage.prompt_tokens` / `usage.completion_tokens`에서 읽는다.

CORS는 방문자가 넣은 baseUrl 제공자에 달렸고 앱이 통제할 수 없다. 차단되면 `CORS_BLOCKED`로 분류한다. 실측으로 허용을 확인한 곳은 `https://api.openai.com/v1`과 `https://opencode.ai/zen/go/v1` 두 곳이다(프리플라이트, 2026-09-10).

## 3. 코어 ↔ GitHub

- 엔드포인트: `https://api.github.com` (CORS 허용).
- 인증: `Authorization: Bearer <PAT>`. fine-grained PAT, 대상 저장소 1개 한정, Contents write + Pull requests write.
- `owner`·`repo`는 **API 호출 전에** 형식을 검증한다. URL 붙여넣기·슬래시·프로토콜이 섞이면 `BAD_REPO_REF`로 즉시 막는다.

### 3.1 `list_repo_posts` (읽기 전용, 승인 불필요)

- 입력: `{ path?: string }` — 기본 `"content/blog"`
- 출력: `{ files: string[] }`
- 호출: `GET /repos/{owner}/{repo}/contents/{path}`

### 3.2 `create_publish_pr` (쓰기, 승인 필수)

- 입력: `{ slug, frontmatter, body, prTitle, prBody }` — `frontmatter`는 `+++ ... +++`를 포함한 TOML 문자열
- 출력: `{ prUrl, branch }`
- 호출 순서:

| 순서 | 호출 | 목적 |
|---|---|---|
| 1 | `GET /repos/{o}/{r}` | 기본 브랜치 이름 확인 |
| 2 | `GET /repos/{o}/{r}/git/ref/heads/{default}` | 기준 SHA |
| 3 | `GET /repos/{o}/{r}/git/ref/heads/publish/{slug}` | 브랜치 중복 확인 |
| 4 | `POST /repos/{o}/{r}/git/refs` | 브랜치 생성 |
| 5 | `PUT /repos/{o}/{r}/contents/content/blog/{slug}.md` | 커밋 |
| 6 | `POST /repos/{o}/{r}/pulls` | PR 생성 |

- 브랜치명: `publish/<slug>`. 이미 있으면 `publish/<slug>-2`.
- 커밋 경로: `content/blog/<slug>.md`. 커밋 메시지: `Add blog post: <slug>`.
- **`main`에 직접 push하지 않는다.** PR까지만 만들고 머지하지 않는다.

### 3.3 실패 규약

| 상황 | 동작 |
|---|---|
| 401 / 403 | 재시도 없이 `GITHUB_AUTH_FAILED` |
| 404 | 재시도 없이 `GITHUB_NOT_FOUND` |
| 네트워크 · 5xx | **1회만** 재시도 후 `GITHUB_REQUEST_FAILED` |
| 같은 slug 존재 | `SLUG_CONFLICT` |
| 중간 단계 실패 | 재시도·자동 롤백 없이 종료. 부분 생성된 브랜치는 사람이 GitHub UI에서 정리 |

## 4. 오류 코드

`RunResult.errorCode`에 담기고 화면이 문구로 매핑한다(`src/ui/errorMessages.ts`).

| 코드 | 의미 | 화면이 안내할 다음 행동 |
|---|---|---|
| `MISSING_KEY` | 키 또는 토큰 미입력 | 입력 요청 |
| `MODEL_LIST_FAILED` | `/models` 실패 | 키 확인 요청 |
| `CORS_BLOCKED` | baseUrl 제공자가 브라우저 직접 호출 차단 | 다른 baseUrl·키 필요 안내 |
| `MODEL_REQUEST_FAILED` | 모델 호출 실패 | 재시도 안내 |
| `GITHUB_AUTH_FAILED` | 401/403 | PAT 권한(Contents·PR write) 확인 요청 |
| `GITHUB_NOT_FOUND` | 404 | owner/repo 확인 요청 |
| `GITHUB_REQUEST_FAILED` | 그 외 GitHub 실패. 1회 재시도 후 이 코드 | 재시도 안내 |
| `SLUG_CONFLICT` | 같은 slug 존재 | slug 변경 요청 |
| `LIMIT_EXCEEDED` | `maxIters` 초과 | 종료 사실만 표시 |
| `BAD_DRAFT` | 초안이 비었거나 파싱 불가 | 입력 확인 요청 |
| `BAD_REPO_REF` | owner/repo 형식 오류. API 호출 전에 차단 | owner/repo 형태 또는 저장소 URL 입력 안내 |

## 5. 경계 공통 규칙

- 키·토큰을 콘솔에 로그하지 않는다. `TraceEvent.detail`에도 넣지 않는다(코어에 스크럽 함수가 있다).
- 키는 브라우저 탭 메모리에만 둔다. `localStorage`·`sessionStorage`에 쓰지 않는다.
- 라우팅은 `#/`만 쓴다. GitHub Pages가 SPA 경로를 지원하지 않는다.
