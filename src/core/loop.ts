/**
 * openai 패키지 호출 + 프레임워크 없는 에이전트 루프(OpenAI function calling).
 * - 클라이언트 생성 시 { apiKey, baseURL, dangerouslyAllowBrowser: true }.
 *   baseURL 철자 주의(openai SDK는 baseURL, 계약 필드명은 baseUrl).
 * - listModels(apiKey, baseUrl): GET {baseUrl}/models 직접 호출.
 *   OpenAI 호환 응답 { data: [{ id, ... }] }. display_name이 없으면 id를 쓴다.
 * - 루프 종료 판정은 tool_calls 유무다(stop_reason: 'tool_use'는 Anthropic 전용).
 * - function.arguments는 JSON 문자열. 파싱 실패에 대비한다.
 * - 토큰은 usage.prompt_tokens / usage.completion_tokens에서 읽는다.
 *   제공자가 usage를 안 주면 비워 두고 0으로 채우지 않는다.
 * - create_publish_pr 실행 직전에 반드시 onApproval을 await. false면
 *   도구 실행 없이 completed로 종료(거절은 오류가 아님).
 * - 모든 단계에서 onTrace 호출. model_call에는 토큰과 ms.
 * - 키·토큰 문자열을 trace detail이나 콘솔에 절대 넣지 않는다(scrub 적용).
 */
import OpenAI, { APIConnectionError, APIError } from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import type {
  ApprovalRequest,
  RunConfig,
  RunResult,
  RunStatus,
  ToolName,
  TraceEvent,
} from './types';
import { GithubError, type GithubContext } from './github';
import {
  TOOL_DEFINITIONS,
  ToolError,
  buildApprovalRequest,
  executeTool,
  type CreatePrResult,
} from './tools';
import { buildSystemMessages } from './prompt';

export class CoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}

/** 오류 메시지·trace 본문에 섞일 수 있는 키·토큰 패턴을 지운다. */
function scrub(text: string): string {
  return text
    .replace(/sk-(proj|ant)-[A-Za-z0-9\-_]+/g, '[redacted]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/=]+/g, 'Bearer [redacted]');
}

interface ModelEntry {
  id?: unknown;
  display_name?: unknown;
}

/**
 * 키가 실제로 접근 가능한 모델 목록. GET {baseUrl}/models를 호출한다.
 * 목록을 하드코딩하지 않는다.
 */
export async function listModels(
  apiKey: string,
  baseUrl: string,
): Promise<Array<{ id: string; display_name: string }>> {
  if (!apiKey) {
    throw new CoreError('MISSING_KEY', 'API 키가 입력되지 않았습니다.');
  }
  if (!baseUrl) {
    throw new CoreError('MISSING_KEY', 'baseUrl이 입력되지 않았습니다.');
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (err) {
    throw new CoreError(
      'CORS_BLOCKED',
      scrub(`baseUrl 제공자가 브라우저 직접 호출을 차단했습니다: ${err instanceof Error ? err.message : 'unknown'}`),
    );
  }
  if (!res.ok) {
    throw new CoreError(
      'MODEL_LIST_FAILED',
      `/models 호출 실패(${res.status}): 키·baseUrl을 확인하세요.`,
    );
  }
  const data = (await res.json()) as { data?: unknown };
  if (!Array.isArray(data.data)) {
    throw new CoreError('MODEL_LIST_FAILED', '/models 응답 형식이 올바르지 않습니다.');
  }
  const out: Array<{ id: string; display_name: string }> = [];
  for (const m of data.data as ModelEntry[]) {
    if (typeof m.id !== 'string' || m.id === '') continue;
    out.push({
      id: m.id,
      display_name: typeof m.display_name === 'string' && m.display_name !== '' ? m.display_name : m.id,
    });
  }
  return out;
}

function toCodeMessage(err: unknown, isList: boolean): [string, string] {
  const fallback = isList ? 'MODEL_LIST_FAILED' : 'MODEL_REQUEST_FAILED';
  if (err instanceof CoreError) return [err.code, err.message];
  if (err instanceof APIConnectionError) {
    return ['CORS_BLOCKED', scrub(`baseUrl 제공자가 브라우저 직접 호출을 차단했습니다: ${err.message}`)];
  }
  if (err instanceof APIError) {
    const status = typeof err.status === 'number' ? err.status : 'unknown';
    return [fallback, scrub(`모델 API 오류(${status}): ${err.message}`)];
  }
  if (err instanceof TypeError) {
    return ['CORS_BLOCKED', scrub(`브라우저 호출 차단: ${err.message}`)];
  }
  const message = err instanceof Error ? err.message : String(err);
  return [fallback, scrub(message)];
}

function isToolName(name: string): name is ToolName {
  return name === 'list_repo_posts' || name === 'create_publish_pr';
}

function functionCalls(
  toolCalls: ChatCompletionMessageToolCall[] | undefined,
): ChatCompletionMessageFunctionToolCall[] {
  if (!toolCalls) return [];
  return toolCalls.filter((tc): tc is ChatCompletionMessageFunctionToolCall => {
    if (tc.type !== 'function') return false;
    return typeof tc.function.name === 'string';
  });
}

function todayLocal(): string {
  const now = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 에이전트 루프 1회 실행. */
export async function runAgent(args: {
  config: RunConfig;
  draft: string; // 방문자가 붙여넣은 마크다운 전문
  onTrace: (e: TraceEvent) => void; // 모든 단계에서 호출
  onStatus: (s: RunStatus) => void;
  onApproval: (req: ApprovalRequest) => Promise<boolean>; // true=승인, false=거절
}): Promise<RunResult> {
  const { config, draft, onTrace, onStatus, onApproval } = args;
  let seq = 0;
  const trace = (e: Omit<TraceEvent, 'seq' | 'at'>): void => {
    seq += 1;
    onTrace({ ...e, seq, at: new Date().toISOString() });
  };
  const fail = (code: string, message: string): RunResult => {
    trace({ kind: 'error', label: `실패: ${code}`, detail: scrub(message) });
    onStatus('error');
    return { status: 'error', errorCode: code, errorMessage: scrub(message) };
  };

  if (!config.apiKey || !config.githubToken) {
    return fail('MISSING_KEY', 'API 키 또는 GitHub 토큰이 입력되지 않았습니다.');
  }
  if (!config.baseUrl) {
    return fail('MISSING_KEY', 'baseUrl이 입력되지 않았습니다.');
  }
  if (!draft || draft.trim() === '') {
    return fail('BAD_DRAFT', '초안이 비어 있습니다.');
  }
  if (!config.model) {
    return fail('MODEL_REQUEST_FAILED', '모델이 선택되지 않았습니다.');
  }
  if (!config.owner || !config.repo) {
    return fail('GITHUB_NOT_FOUND', 'owner/repo가 입력되지 않았습니다.');
  }

  onStatus('running');
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true,
  });
  const ctx: GithubContext = {
    token: config.githubToken,
    owner: config.owner,
    repo: config.repo,
  };
  const messages: ChatCompletionMessageParam[] = [
    ...buildSystemMessages(todayLocal()),
    {
      role: 'user',
      content: `아래 마크다운 초안을 검수·변환·발행하라.\n\n--- 초안 ---\n${draft}`,
    },
  ];

  const maxIters = config.maxIters > 0 ? config.maxIters : 8;
  let approvalCount = 0;

  for (let iter = 0; ; iter += 1) {
    if (iter >= maxIters) {
      return fail(
        'LIMIT_EXCEEDED',
        `반복 상한(maxIters=${maxIters})을 넘겨 종료합니다.`,
      );
    }
    const started = Date.now();
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    try {
      const res = await client.chat.completions.create({
        model: config.model,
        messages,
        tools: TOOL_DEFINITIONS,
      });
      const choice = res.choices[0];
      if (!choice) {
        return fail('MODEL_REQUEST_FAILED', '모델 응답에 choice가 없습니다.');
      }
      // 제공자가 usage를 안 주면 비워 둔다. 0으로 채우지 않는다.
      tokensIn = res.usage?.prompt_tokens;
      tokensOut = res.usage?.completion_tokens;
      const calls = functionCalls(choice.message.tool_calls);
      const assistantMsg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: choice.message.content ?? undefined,
      };
      if (calls.length > 0) {
        assistantMsg.tool_calls = calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      messages.push(assistantMsg);

      const ms = Date.now() - started;
      const text = choice.message.content ?? '';
      trace({
        kind: 'model_call',
        label: `모델 호출 ${iter + 1} (tool_calls: ${calls.length})`,
        detail: text === '' ? undefined : scrub(text.slice(0, 2000)),
        ...(tokensIn === undefined ? {} : { tokensIn }),
        ...(tokensOut === undefined ? {} : { tokensOut }),
        ms,
      });

      if (calls.length === 0) {
        trace({
          kind: 'done',
          label: '모델이 도구 없이 종료',
          detail: text === '' ? undefined : scrub(text.slice(0, 2000)),
        });
        onStatus('completed');
        return { status: 'completed' };
      }

      for (const tc of calls) {
        if (!isToolName(tc.function.name)) {
          return fail('MODEL_REQUEST_FAILED', `알 수 없는 도구 요청: ${tc.function.name}`);
        }
        const t0 = Date.now();
        trace({
          kind: 'tool_call',
          label: `도구 호출: ${tc.function.name}`,
          detail: scrub(tc.function.arguments.slice(0, 2000)),
        });

        let toolInput: unknown;
        try {
          toolInput = JSON.parse(tc.function.arguments) as unknown;
        } catch {
          return fail('MODEL_REQUEST_FAILED', `도구 인자 JSON 파싱 실패: ${tc.function.name}`);
        }

        if (tc.function.name === 'create_publish_pr') {
          approvalCount += 1;
          const req = buildApprovalRequest(`approval-${approvalCount}`, toolInput);
          onStatus('waiting_approval');
          trace({ kind: 'approval', label: '승인 대기 중', detail: req.diffPreview });
          let ok = false;
          try {
            ok = await onApproval(req);
          } catch {
            ok = false;
          }
          trace({ kind: 'approval', label: ok ? '승인됨' : '거절됨' });
          onStatus('running');
          if (!ok) {
            trace({ kind: 'done', label: '승인 거절로 종료(오류 아님)' });
            onStatus('completed');
            return { status: 'completed' };
          }
        }

        try {
          const out = await executeTool(ctx, tc.function.name, toolInput);
          trace({
            kind: 'tool_result',
            label: `도구 결과: ${tc.function.name}`,
            detail: scrub(JSON.stringify(out).slice(0, 2000)),
            ms: Date.now() - t0,
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(out),
          });
          if (tc.function.name === 'create_publish_pr') {
            const prUrl = (out as CreatePrResult).prUrl;
            trace({ kind: 'done', label: 'PR 생성 완료', detail: prUrl });
            onStatus('completed');
            return { status: 'completed', prUrl };
          }
        } catch (err) {
          let code = 'GITHUB_REQUEST_FAILED';
          if (err instanceof GithubError) code = err.code;
          else if (err instanceof ToolError) code = err.code;
          const errMessage = err instanceof Error ? err.message : String(err);
          return fail(code, errMessage);
        }
      }
    } catch (err) {
      const [code, codeMessage] = toCodeMessage(err, false);
      return fail(code, codeMessage);
    }
  }
}
