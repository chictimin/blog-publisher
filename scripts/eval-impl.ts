/**
 * 평가용 headless 실행: draft 3개 x 모델 2종 = 6회 순차 실행.
 * - 병렬 실행 금지(rate limit).
 * - onApproval 기본은 거절(false). --approve 명시 시에만 승인한다. 기본값을 반대로 만들지 않는다.
 * - 실패한 실행도 표에 남긴다. 수치를 추정으로 채우지 않는다. 못 얻은 값은 빈칸 + 비고.
 * - 키를 파일이나 로그에 절대 쓰지 않는다.
 * - 실행하지 않는다(키 없음). 작성만 한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listModels, runAgent } from '../src/core/index';
import type { TraceEvent } from '../src/core/index';

const DRAFTS: string[] = [
  '/Users/mjolnir/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian/devlog/draft/archive/obsidian-vault-local-vs-web-connector.md',
  '/Users/mjolnir/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian/devlog/draft/archive/why-ai-suddenly-switches-to-banmal.md',
  '/Users/mjolnir/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian/devlog/draft/archive/accidental-harness-engineering.md',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function die(message: string): never {
  process.stderr.write(`eval: ${message}\n`);
  process.exit(1);
}

function stamp(): string {
  const now = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

interface Row {
  n: number;
  draft: string;
  model: string;
  status: string;
  errorCode: string;
  ms: string;
  tokensIn: string;
  tokensOut: string;
  toolCalls: string;
  approval: string;
  note: string;
}

function esc(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function main(): Promise<void> {
  const apiKey = process.env['OPENAI_API_KEY'] ?? '';
  const baseUrl = process.env['OPENAI_BASE_URL'] ?? '';
  const githubToken = process.env['GITHUB_TOKEN'] ?? '';
  const missing: string[] = [];
  if (!apiKey) missing.push('OPENAI_API_KEY');
  if (!baseUrl) missing.push('OPENAI_BASE_URL');
  if (!githubToken) missing.push('GITHUB_TOKEN');
  if (missing.length > 0) die(`환경변수 없음: ${missing.join(', ')}`);

  if (hasFlag('--list-models')) {
    const models = await listModels(apiKey, baseUrl);
    for (const m of models) process.stdout.write(`${m.id}\n`);
    return;
  }

  const modelsRaw = argValue('--models') ?? '';
  const models = modelsRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (models.length === 0) {
    die('--models <id1,id2> 필요. 목록은 --list-models 로 조회.');
  }
  const owner = argValue('--owner') ?? process.env['EVAL_OWNER'] ?? '';
  const repo = argValue('--repo') ?? process.env['EVAL_REPO'] ?? '';
  if (!owner || !repo) die('대상 저장소 없음: --owner/--repo 또는 EVAL_OWNER/EVAL_REPO 필요.');
  const maxItersRaw = argValue('--max-iters') ?? '8';
  const maxIters = Number.parseInt(maxItersRaw, 10);
  if (!Number.isFinite(maxIters) || maxIters <= 0) die('--max-iters 는 양의 정수.');
  const approve = hasFlag('--approve');

  const dir = path.join(ROOT, 'experiments', stamp());
  mkdirSync(dir, { recursive: true });

  const rows: Row[] = [];
  let n = 0;
  for (const draftPath of DRAFTS) {
    const draftName = path.basename(draftPath);
    let draft = '';
    if (!existsSync(draftPath)) {
      for (const model of models) {
        n += 1;
        rows.push({
          n, draft: draftName, model, status: 'skipped', errorCode: '',
          ms: '', tokensIn: '', tokensOut: '', toolCalls: '', approval: '도달 안 함',
          note: `draft 파일 없음: ${draftPath}`,
        });
      }
      continue;
    }
    draft = readFileSync(draftPath, 'utf8');
    for (const model of models) {
      n += 1;
      const events: TraceEvent[] = [];
      let approvalReached = false;
      const t0 = Date.now();
      const result = await runAgent({
        config: { apiKey, baseUrl, githubToken, model, owner, repo, maxIters },
        draft,
        onTrace: (e) => {
          events.push(e);
          if (e.kind === 'approval') approvalReached = true;
        },
        onStatus: () => {},
        onApproval: async () => {
          if (!approve) {
            process.stdout.write(`[${n}] 승인 요청 도달 → 기본 거절(false)\n`);
            return false;
          }
          return true;
        },
      });
      const ms = Date.now() - t0;
      let tokensIn = 0;
      let tokensOut = 0;
      let hasTokens = false;
      let toolCalls = 0;
      for (const e of events) {
        if (e.kind === 'model_call') {
          if (e.tokensIn !== undefined) { tokensIn += e.tokensIn; hasTokens = true; }
          if (e.tokensOut !== undefined) { tokensOut += e.tokensOut; hasTokens = true; }
        }
        if (e.kind === 'tool_call') toolCalls += 1;
      }
      writeFileSync(
        path.join(dir, `trace-${n}.json`),
        JSON.stringify({ n, draft: draftName, model, result, events }, null, 2),
      );
      rows.push({
        n,
        draft: draftName,
        model,
        status: result.status,
        errorCode: result.errorCode ?? '',
        ms: String(ms),
        tokensIn: hasTokens ? String(tokensIn) : '',
        tokensOut: hasTokens ? String(tokensOut) : '',
        toolCalls: String(toolCalls),
        approval: approvalReached ? (approve ? '승인됨' : '거절됨') : '도달 안 함',
        note: result.status === 'error' ? (result.errorMessage ?? '') : (result.prUrl ?? ''),
      });
      process.stdout.write(`[${n}] ${draftName} x ${model} → ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}\n`);
    }
  }

  const lines: string[] = [
    '# 평가 결과',
    '',
    `- 실행 시각: ${new Date().toISOString()}`,
    `- baseUrl·모델·저장소는 실행 인자로 지정(코드 기본값 없음)`,
    `- 승인: ${approve ? '--approve 명시(실제 PR 생성 가능)' : '기본 거절(실제 PR 생성 안 됨)'}`,
    '',
    '| # | draft | model | status | errorCode | 소요ms | 입력토큰 | 출력토큰 | 도구호출 | 승인 | 비고 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.n} | ${esc(r.draft)} | ${esc(r.model)} | ${esc(r.status)} | ${esc(r.errorCode)} | ${r.ms} | ${r.tokensIn} | ${r.tokensOut} | ${r.toolCalls} | ${esc(r.approval)} | ${esc(r.note)} |`,
    );
  }
  lines.push('');
  writeFileSync(path.join(dir, 'RESULTS.md'), lines.join('\n'));
  process.stdout.write(`결과 저장: ${dir}/RESULTS.md\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`eval 실패: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
