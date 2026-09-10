/** CONTRACT 오류 코드 → 화면 안내 문구 매핑. */
export const ERROR_GUIDANCE: Record<string, string> = {
  MISSING_KEY: '키 또는 토큰이 입력되지 않았습니다. 1단계에서 Anthropic 키와 GitHub PAT를 입력해 주세요.',
  MODEL_LIST_FAILED: '모델 목록을 불러오지 못했습니다. Anthropic 키가 올바른지 확인해 주세요.',
  CORS_BLOCKED: '브라우저에서의 API 호출이 차단되었습니다. 조직 설정 문제일 수 있으니 다른 키로 시도해 주세요.',
  MODEL_REQUEST_FAILED: 'Anthropic API 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.',
  GITHUB_AUTH_FAILED: 'GitHub 인증에 실패했습니다(401/403). PAT의 Contents·Pull requests 쓰기 권한을 확인해 주세요.',
  GITHUB_NOT_FOUND: '저장소를 찾을 수 없습니다(404). owner/repo 입력이 정확한지 확인해 주세요.',
  GITHUB_REQUEST_FAILED: 'GitHub 호출이 실패했습니다(네트워크 오류 또는 서버 오류, 1회 재시도 후 종료). 잠시 후 다시 시도해 주세요.',
  SLUG_CONFLICT: '같은 slug의 포스트가 이미 있습니다. slug를 바꿔서 다시 실행해 주세요.',
  LIMIT_EXCEEDED: '최대 반복 횟수를 초과해 종료되었습니다.',
  BAD_DRAFT: '초안이 비어 있거나 파싱할 수 없습니다. 3단계 입력을 확인해 주세요.',
}

export function guidanceFor(code: string | undefined): string {
  if (!code) return '알 수 없는 오류가 발생했습니다.';
  return ERROR_GUIDANCE[code] ?? `알 수 없는 오류 코드(${code})가 발생했습니다.`;
}
