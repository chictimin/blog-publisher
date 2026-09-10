export interface ParsedRepo {
  owner: string;
  repo: string;
}

/**
 * 저장소 입력을 owner/repo로 정규화한다.
 * 받는 형태: owner/repo, github.com/owner/repo,
 * https://github.com/owner/repo, https://github.com/owner/repo.git.
 * 뒤에 붙은 슬래시·.git은 제거한다. 파싱 불가면 null.
 */
export function parseRepo(input: string): ParsedRepo | null {
  let s = input.trim();
  if (s === '') return null;

  s = s.replace(/\/+$/, '');
  s = s.replace(/\.git$/, '');
  s = s.replace(/\/+$/, '');

  const gh = s.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)$/i,
  );
  if (gh) return { owner: gh[1], repo: gh[2] };

  const short = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) {
    if (/^(https?:)?$/i.test(short[1])) return null;
    if (short[1].includes('.') && short[1].includes(':')) return null;
    return { owner: short[1], repo: short[2] };
  }
  return null;
}
