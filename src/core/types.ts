export type ToolName = 'list_repo_posts' | 'create_publish_pr';

export type RunStatus =
  | 'idle' | 'running' | 'waiting_approval' | 'completed' | 'error';

export interface RunConfig {
  anthropicKey: string;
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
