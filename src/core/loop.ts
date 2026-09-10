/**
 * Anthropic SDK 호출 + 프레임워크 없는 에이전트 루프.
 * - 클라이언트 생성 시 dangerouslyAllowBrowser: true 필수
 * - listModels는 SDK의 models.list() 사용. 모델 목록 하드코딩 금지.
 * - 루프: stop_reason이 tool_use인 동안 도구 실행 → 결과 반영 → 반복.
 *   maxIters를 넘으면 LIMIT_EXCEEDED. 무한 루프 금지.
 * - create_publish_pr 실행 직전에 반드시 onApproval을 await. false면
 *   도구 실행 없이 completed로 종료(거절은 오류가 아님).
 * - 모든 단계에서 onTrace 호출. model_call에는 usage의 입력·출력 토큰과 ms.
 * - 키·토큰 문자열을 trace detail이나 콘솔에 절대 넣지 않는다(scrub 적용).
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
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
import { buildSystemPrompt } from './prompt';

const MAX_TOKENS = 4096;

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
    .replace(/sk-ant-[A-Za-z0-9\-_]+/g, '[redacted]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/=]+/g, 'Bearer [redacted]');
}

/**
 * 키가 실제로 접근 가능한 모델 목록. GET /v1/models를 호출한다.
 * 목록을 하드코딩하지 않는다.
 */
export async function listModels(
  anthropicKey: string,
): Promise<Array<{ id: string; display_name: string }>> {
  if (!anthropicKey) {
    throw new CoreError('MISSING_KEY', 'Anthropic 키가 입력되지 않았습니다.');
  }
  const client = new Anthropic({
    apiKey: anthropicKey,
    dangerouslyAllowBrowser: true,
  });
  try {
    const page = await client.models.list();
    return page.data.map((m) => ({ id: m.id, display_name: m.display_name }));
  } catch (err) {
    throw new CoreError(...toCodeMessage(err, true));
  }
}

function toCodeMessage(err: unknown, isList: boolean): [string, string] {
  const fallback = isList ? 'MODEL_LIST_FAILED' : 'MODEL_REQUEST_FAILED';
  if (err instanceof CoreError) return [err.code, err.message];
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : 'unknown';
    return [fallback, scrub(`Anthropic API 오류(${status}): ${err.message}`)];
  }
  if (err instanceof TypeError) {
    return ['CORS_BLOCKED', scrub(`브라우저 호출 차단: ${err.message}`)];
  }
  const message = err instanceof Error ? err.message : String(err);
  return [fallback, scrub(message)];
}

function extractText(blocks: ContentBlock[]): string {
  let out = '';
  for (const b of blocks) {
    if (b.type === 'text') out += b.text;
  }
  return out;
}

/** 다음 턴에 그대로 넣을 수 있게 assistant 응답을 MessageParam 형태로 옮긴다. */
function toParamBlocks(blocks: ContentBlock[]): ContentBlockParam[] {
  const out: ContentBlockParam[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text !== '') out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      });
    }
  }
  if (out.length === 0) out.push({ type: 'text', text: '(비어 있는 모델 응답)' });
  return out;
}

function isToolName(name: string): name is ToolName {
  return name === 'list_repo_posts' || name === 'create_publish_pr';
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

  if (!config.anthropicKey || !config.githubToken) {
    return fail('MISSING_KEY', 'Anthropic 키 또는 GitHub 토큰이 입력되지 않았습니다.');
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
  const client = new Anthropic({
    apiKey: config.anthropicKey,
    dangerouslyAllowBrowser: true,
  });
  const ctx: GithubContext = {
    token: config.githubToken,
    owner: config.owner,
    repo: config.repo,
  };
  const messages: Anthropic.MessageParam[] = [
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
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: config.model,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(todayLocal()),
        messages,
        tools: TOOL_DEFINITIONS,
      });
    } catch (err) {
      const [code, message] = toCodeMessage(err, false);
      return fail(code, message);
    }
    const ms = Date.now() - started;
    const text = extractText(res.content);
    trace({
      kind: 'model_call',
      label: `모델 호출 ${iter + 1} (stop: ${res.stop_reason})`,
      detail: text === '' ? undefined : scrub(text.slice(0, 2000)),
      tokensIn: res.usage.input_tokens,
      tokensOut: res.usage.output_tokens,
      ms,
    });

    messages.push({ role: 'assistant', content: toParamBlocks(res.content) });

    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
      trace({
        kind: 'done',
        label: '모델이 도구 없이 종료',
        detail: text === '' ? undefined : scrub(text.slice(0, 2000)),
      });
      onStatus('completed');
      return { status: 'completed' };
    }

    for (const tu of toolUses) {
      if (tu.type !== 'tool_use' || !isToolName(tu.name)) {
        const name = tu.type === 'tool_use' ? tu.name : '(unknown)';
        return fail('MODEL_REQUEST_FAILED', `알 수 없는 도구 요청: ${name}`);
      }
      const t0 = Date.now();
      trace({
        kind: 'tool_call',
        label: `도구 호출: ${tu.name}`,
        detail: scrub(JSON.stringify(tu.input).slice(0, 2000)),
      });

      if (tu.name === 'create_publish_pr') {
        approvalCount += 1;
        const req = buildApprovalRequest(`approval-${approvalCount}`, tu.input);
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
        const out = await executeTool(ctx, tu.name, tu.input);
        trace({
          kind: 'tool_result',
          label: `도구 결과: ${tu.name}`,
          detail: scrub(JSON.stringify(out).slice(0, 2000)),
          ms: Date.now() - t0,
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(out),
            },
          ],
        });
        if (tu.name === 'create_publish_pr') {
          const prUrl = (out as CreatePrResult).prUrl;
          trace({ kind: 'done', label: 'PR 생성 완료', detail: prUrl });
          onStatus('completed');
          return { status: 'completed', prUrl };
        }
      } catch (err) {
        let code = 'GITHUB_REQUEST_FAILED';
        if (err instanceof GithubError) code = err.code;
        else if (err instanceof ToolError) code = err.code;
        const message = err instanceof Error ? err.message : String(err);
        return fail(code, message);
      }
    }
  }
}
