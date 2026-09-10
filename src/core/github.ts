/**
 * GitHub REST API 호출 계층. 브라우저 fetch로 직접 호출한다.
 *
 * 실패 분류(CONTRACT.md 오류 코드 + nipe 지시 2026-09-10):
 * - 401/403 → GITHUB_AUTH_FAILED (재시도 없음)
 * - 404     → GITHUB_NOT_FOUND (재시도 없음)
 * - 그 외(네트워크 오류·5xx·기타 4xx) → 1회만 재시도한 뒤 GITHUB_REQUEST_FAILED
 *
 * 토큰은 Authorization 헤더에만 쓰고, TraceEvent.detail이나 콘솔에 절대 넣지 않는다.
 */

export type GithubErrorCode =
  | 'GITHUB_AUTH_FAILED'
  | 'GITHUB_NOT_FOUND'
  | 'GITHUB_REQUEST_FAILED'
  | 'BAD_REPO_REF';

export class GithubError extends Error {
  readonly code: GithubErrorCode;
  constructor(code: GithubErrorCode, message: string) {
    super(message);
    this.name = 'GithubError';
    this.code = code;
  }
}

export interface GithubContext {
  token: string;
  owner: string;
  repo: string;
}

interface RepoInfo {
  default_branch?: string;
}

interface RefObject {
  sha?: string;
}

interface GitRef {
  object?: RefObject;
}

interface ContentEntry {
  name?: string;
  type?: string;
}

interface PullInfo {
  html_url?: string;
}

/**
 * owner·repo 검증. API를 호출하기 전에 막는다.
 * 값이 통째로 URL인 경우(슬래시·프로토콜 포함) fetch까지 가면
 * 엉뚱한 URL이 되어 Failed to fetch가 나므로 여기서 차단한다.
 * 오류 메시지에는 무엇이 잘못됐는지만 넣고 값 전체는 노출하지 않는다.
 */
function validateSegment(kind: 'owner' | 'repo', value: string): void {
  if (value === '') {
    throw new GithubError(
      'BAD_REPO_REF',
      `${kind}가 비어 있습니다. 저장소 URL 전체가 아니라 소유자와 저장소 이름을 각각 입력하세요.`,
    );
  }
  if (value.includes('://')) {
    throw new GithubError(
      'BAD_REPO_REF',
      `${kind}에 URL 형식이 들어 있습니다. 저장소 주소 전체가 아니라 이름만 입력하세요.`,
    );
  }
  if (value.includes('/')) {
    throw new GithubError(
      'BAD_REPO_REF',
      `${kind}에 슬래시가 들어 있습니다. 저장소 주소가 아니라 이름만 입력하세요.`,
    );
  }
  if (value.includes(':')) {
    throw new GithubError(
      'BAD_REPO_REF',
      `${kind}에 콜론이 들어 있습니다. 저장소 주소가 아니라 이름만 입력하세요.`,
    );
  }
  if (/\s/.test(value)) {
    throw new GithubError(
      'BAD_REPO_REF',
      `${kind}에 공백이 들어 있습니다. 앞뒤 공백을 제거하고 이름만 입력하세요.`,
    );
  }
}

function repoPath(ctx: GithubContext, path: string): string {
  validateSegment('owner', ctx.owner);
  validateSegment('repo', ctx.repo);
  // path는 슬래시를 포함하므로 제외하고 owner·repo 세그먼트만 인코딩한다.
  return `/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}${path}`;
}

async function readBodyText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? text.slice(0, 500) : text;
  } catch {
    return '';
  }
}

/**
 * GitHub API 1회 호출. 재시도하지 않는다. 실패는 GithubError로 분류해서 던진다.
 * 401/403/404가 아닌 실패(네트워크·5xx 등)는 호출자가 1회 재시도한다.
 */
async function singleRequest(
  ctx: GithubContext,
  method: string,
  path: string,
  body?: Record<string, string>,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Failed to fetch는 CORS 차단과 네트워크 오류를 구분할 수 없다.
    // 잘못된 경로가 원인일 수도 있으므로 힌트를 남긴다.
    throw new GithubError(
      'GITHUB_REQUEST_FAILED',
      `네트워크 오류로 GitHub 호출 실패: ${method} ${path} (${err instanceof Error ? err.message : 'unknown'}). owner/repo·경로 오타 또는 네트워크 문제일 수 있습니다.`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new GithubError(
      'GITHUB_AUTH_FAILED',
      `GitHub 인증 실패(${res.status}): PAT 권한(Contents·Pull requests 쓰기)을 확인하세요.`,
    );
  }
  if (res.status === 404) {
    throw new GithubError(
      'GITHUB_NOT_FOUND',
      `GitHub 리소스를 찾을 수 없음(404): ${method} ${path}. owner/repo를 확인하세요.`,
    );
  }
  if (!res.ok) {
    const bodyText = await readBodyText(res);
    throw new GithubError(
      'GITHUB_REQUEST_FAILED',
      `GitHub 호출 실패(${res.status}): ${method} ${path}${bodyText ? ` — ${bodyText}` : ''}`,
    );
  }
  if (res.status === 204) return null;
  return (await res.json()) as unknown;
}

/** 재시도 1회 포함. 401/403/404는 재시도하지 않고 즉시 분류 코드를 던진다. */
async function githubRequest(
  ctx: GithubContext,
  method: string,
  path: string,
  body?: Record<string, string>,
): Promise<unknown> {
  try {
    return await singleRequest(ctx, method, path, body);
  } catch (err) {
    if (!(err instanceof GithubError)) throw err;
    if (err.code !== 'GITHUB_REQUEST_FAILED') throw err;
    // 1회만 재시도. 그래도 실패하면 GITHUB_REQUEST_FAILED로 종료.
    return await singleRequest(ctx, method, path, body);
  }
}

/** GET /repos/{owner}/{repo}/contents/{path} → 파일명 목록. */
export async function listRepoPosts(
  ctx: GithubContext,
  path: string,
): Promise<string[]> {
  const data = await githubRequest(ctx, 'GET', repoPath(ctx, `/contents/${path}`));
  if (Array.isArray(data)) {
    return (data as ContentEntry[])
      .filter((e) => e.type === 'file' && typeof e.name === 'string')
      .map((e) => e.name as string);
  }
  if (data !== null && typeof data === 'object' && (data as ContentEntry).type === 'file') {
    const name = (data as ContentEntry).name;
    return typeof name === 'string' ? [name] : [];
  }
  return [];
}

/** 대상 경로에 파일이 이미 존재하는지 확인한다. */
export async function contentExists(
  ctx: GithubContext,
  contentPath: string,
): Promise<boolean> {
  try {
    await githubRequest(ctx, 'GET', repoPath(ctx, `/contents/${contentPath}`));
    return true;
  } catch (err) {
    if (err instanceof GithubError && err.code === 'GITHUB_NOT_FOUND') return false;
    throw err;
  }
}

export async function getDefaultBranch(ctx: GithubContext): Promise<string> {
  const data = (await githubRequest(ctx, 'GET', repoPath(ctx, ''))) as RepoInfo;
  if (typeof data.default_branch !== 'string' || data.default_branch === '') {
    throw new GithubError('GITHUB_REQUEST_FAILED', '저장소의 기본 브랜치를 확인할 수 없습니다.');
  }
  return data.default_branch;
}

export async function getRefSha(
  ctx: GithubContext,
  branch: string,
): Promise<string | null> {
  try {
    const data = (await githubRequest(
      ctx,
      'GET',
      repoPath(ctx, `/git/ref/heads/${branch}`),
    )) as GitRef;
    const sha = data.object?.sha;
    return typeof sha === 'string' ? sha : null;
  } catch (err) {
    if (err instanceof GithubError && err.code === 'GITHUB_NOT_FOUND') return null;
    throw err;
  }
}

export async function createBranch(
  ctx: GithubContext,
  branch: string,
  sha: string,
): Promise<void> {
  await githubRequest(ctx, 'POST', repoPath(ctx, '/git/refs'), {
    ref: `refs/heads/${branch}`,
    sha,
  });
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function putFile(
  ctx: GithubContext,
  contentPath: string,
  content: string,
  branch: string,
  message: string,
): Promise<void> {
  await githubRequest(ctx, 'PUT', repoPath(ctx, `/contents/${contentPath}`), {
    message,
    content: toBase64Utf8(content),
    branch,
  });
}

export async function createPull(
  ctx: GithubContext,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<string> {
  const data = (await githubRequest(ctx, 'POST', repoPath(ctx, '/pulls'), {
    head,
    base,
    title,
    body,
  })) as PullInfo;
  if (typeof data.html_url !== 'string' || data.html_url === '') {
    throw new GithubError('GITHUB_REQUEST_FAILED', 'PR 생성 응답에 주소가 없습니다.');
  }
  return data.html_url;
}
