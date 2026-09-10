/**
 * 모델에 노출하는 도구 정확히 2개. 더 늘리지 않는다(CONTRACT.md).
 */
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ApprovalRequest, ToolName } from './types';
import {
  contentExists,
  createBranch,
  createPull,
  getDefaultBranch,
  getRefSha,
  listRepoPosts,
  putFile,
  type GithubContext,
} from './github';

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'list_repo_posts',
    description:
      '대상 저장소의 기존 포스트 파일명을 읽어 slug 중복을 검사한다. 읽기 전용. 쓰기 전에 반드시 호출한다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: '포스트 디렉토리. 기본 "content/blog".',
        },
      },
    },
  },
  {
    name: 'create_publish_pr',
    description:
      '브랜치를 만들고 변환된 포스트를 커밋하고 PR을 생성한다. 쓰기 작업. main에 직접 push하지 않는다. 커밋 경로: content/blog/<slug>.md. frontmatter는 +++ 구분자를 포함한 TOML 문자열이다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: '파일명용 slug(소문자·숫자·하이픈).' },
        frontmatter: {
          type: 'string',
          description: '+++ ... +++ 구분자를 포함한 TOML 프론트매터 전문.',
        },
        body: { type: 'string', description: '변환된 마크다운 본문(프론트매터 제외).' },
        prTitle: { type: 'string', description: 'PR 제목.' },
        prBody: { type: 'string', description: 'PR 본문(변경 요약).' },
      },
      required: ['slug', 'frontmatter', 'body', 'prTitle', 'prBody'],
    },
  },
];

/** 도구 실행 실패를 RunResult.errorCode로 그대로 옮기기 위한 오류. */
export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  throw new ToolError('MODEL_REQUEST_FAILED', '도구 입력이 객체가 아닙니다.');
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ToolError('MODEL_REQUEST_FAILED', `도구 입력 "${key}"가 비어 있습니다.`);
  }
  return v;
}

export interface CreatePrResult {
  prUrl: string;
  branch: string;
}

function pickBranch(base: string, taken: boolean): string {
  if (!taken) return base;
  return `${base}-2`;
}

export async function executeTool(
  ctx: GithubContext,
  name: ToolName,
  input: unknown,
): Promise<{ files: string[] } | CreatePrResult> {
  const args = asRecord(input);
  if (name === 'list_repo_posts') {
    const rawPath = args['path'];
    const path =
      rawPath === undefined || rawPath === null || rawPath === ''
        ? 'content/blog'
        : String(rawPath);
    const files = await listRepoPosts(ctx, path);
    return { files };
  }

  // create_publish_pr
  const slug = requiredString(args, 'slug').trim();
  if (slug.includes('/') || slug === '.' || slug === '..') {
    throw new ToolError('MODEL_REQUEST_FAILED', `slug가 올바르지 않습니다: ${slug}`);
  }
  const frontmatter = requiredString(args, 'frontmatter');
  const body = requiredString(args, 'body');
  const prTitle = requiredString(args, 'prTitle');
  const prBody = requiredString(args, 'prBody');

  const contentPath = `content/blog/${slug}.md`;
  if (await contentExists(ctx, contentPath)) {
    throw new ToolError(
      'SLUG_CONFLICT',
      `같은 slug가 이미 있습니다: ${contentPath}. slug를 변경하세요.`,
    );
  }

  const base = await getDefaultBranch(ctx);
  const baseSha = await getRefSha(ctx, base);
  if (baseSha === null) {
    throw new ToolError('GITHUB_NOT_FOUND', `기본 브랜치 refs/heads/${base}를 찾을 수 없습니다.`);
  }
  const branchTaken = (await getRefSha(ctx, `publish/${slug}`)) !== null;
  const branch = pickBranch(`publish/${slug}`, branchTaken);
  await createBranch(ctx, branch, baseSha);
  await putFile(ctx, contentPath, `${frontmatter.trim()}\n\n${body.trim()}\n`, branch, `Add blog post: ${slug}`);
  const prUrl = await createPull(ctx, branch, base, prTitle, prBody);
  return { prUrl, branch };
}

/** 승인 카드용 평문 요약. 마크다운이 아니다. */
export function buildApprovalRequest(id: string, input: unknown): ApprovalRequest {
  const args = asRecord(input);
  const slug = String(args['slug'] ?? '');
  const frontmatter = String(args['frontmatter'] ?? '');
  const body = String(args['body'] ?? '');
  const prTitle = String(args['prTitle'] ?? '');
  const head = body.slice(0, 200).replace(/\n/g, ' ');
  const fmLines = frontmatter.split('\n').slice(0, 10).join('\n');
  const lines = [
    'PR을 생성합니다. 승인하면 아래 변경이 대상 저장소에 PR로 올라갑니다.',
    `slug: ${slug}`,
    `경로: content/blog/${slug}.md`,
    `PR 제목: ${prTitle}`,
    `frontmatter:\n${fmLines}`,
    `본문: ${body.length}자, 앞부분: ${head}`,
  ];
  return { id, title: 'PR을 생성합니다', diffPreview: lines.join('\n') };
}
