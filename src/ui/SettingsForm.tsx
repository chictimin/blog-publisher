interface SettingsFormProps {
  apiKey: string;
  baseUrl: string;
  githubToken: string;
  repoInput: string;
  repoError: string | null;
  disabled: boolean;
  onApiKey: (v: string) => void;
  onBaseUrl: (v: string) => void;
  onGithubToken: (v: string) => void;
  onRepoInput: (v: string) => void;
}

/** 1단계: 설정. 키는 React state 메모리에만 보관한다. */
export default function SettingsForm(props: SettingsFormProps) {
  const { apiKey, baseUrl, githubToken, repoInput, repoError, disabled } = props;
  return (
    <section aria-label="1단계 설정">
      <h2>1. 설정</h2>
      <p className="notice">
        키는 이 탭 메모리에만 보관되며 새로고침하면 사라집니다.
      </p>
      <label>
        API 키
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          disabled={disabled}
          onChange={(e) => props.onApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </label>
      <label>
        baseUrl (OpenAI 호환 엔드포인트)
        <input
          type="text"
          autoComplete="off"
          value={baseUrl}
          disabled={disabled}
          onChange={(e) => props.onBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </label>
      <label>
        GitHub PAT
        <input
          type="password"
          autoComplete="off"
          value={githubToken}
          disabled={disabled}
          onChange={(e) => props.onGithubToken(e.target.value)}
          placeholder="github_pat_..."
        />
      </label>
      <p className="notice">
        PAT 권한: Contents 쓰기, Pull requests 쓰기 — 저장소 1개에만 부여하세요.
      </p>
      <div className="row">
        <label>
          대상 저장소 (owner/repo 또는 저장소 URL)
          <input
            type="text"
            autoComplete="off"
            value={repoInput}
            disabled={disabled}
            onChange={(e) => props.onRepoInput(e.target.value)}
            placeholder="chictimin/chictimin.github.io"
          />
        </label>
      </div>
      {repoError !== null && <p className="error">{repoError}</p>}
    </section>
  );
}
