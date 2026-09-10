import { useCallback, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import HelpModal from './ui/HelpModal';
import { listModels, runAgent } from './core/index';
import type {
  ApprovalRequest,
  RunResult,
  RunStatus,
  TraceEvent,
} from './core/types';
import SettingsForm from './ui/SettingsForm';
import ModelSelect from './ui/ModelSelect';
import DraftInput from './ui/DraftInput';
import TraceView from './ui/TraceView';
import ApprovalCard from './ui/ApprovalCard';
import ResultView from './ui/ResultView';
import { guidanceFor } from './ui/errorMessages';
import { parseRepo } from './ui/parseRepo';

interface ModelOption {
  id: string;
  display_name: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

const MAX_ITERS = 8;

function PublisherPage() {
  // 로컬 개발 편의용 초기값. import.meta.env.DEV일 때만 VITE_DEV_*를
  // 읽는다. 프로덕션 빌드에서는 항상 빈 문자열이다. 화면·콘솔에 노출 금지.
  const devEnv = import.meta.env.DEV ? import.meta.env : undefined;
  // 키·토큰은 React state 메모리에만 보관한다. storage에 쓰지 않는다.
  const [apiKey, setApiKey] = useState(devEnv?.VITE_DEV_API_KEY ?? '');
  const [baseUrl, setBaseUrl] = useState(devEnv?.VITE_DEV_BASE_URL ?? '');
  const [githubToken, setGithubToken] = useState(devEnv?.VITE_DEV_GITHUB_TOKEN ?? '');
  const [repoInput, setRepoInput] = useState(devEnv?.VITE_DEV_REPO ?? '');

  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState(''); // 기본값 없음
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  // 사용법 모달은 버튼으로만 연다. 자동 오픈 없음(저장소 사용 금지).
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const approvalResolve = useRef<((approved: boolean) => void) | null>(null);

  const busy = status === 'running' || status === 'waiting_approval';

  // 저장소 입력은 owner/repo 또는 URL 모두 받아 정규화한다. 파싱 실패면 실행 불가.
  const parsedRepo = parseRepo(repoInput);
  const repoError =
    repoInput.trim() !== '' && parsedRepo === null
      ? 'owner/repo 형태 또는 저장소 URL을 넣어 주세요.'
      : null;

  const handleLoadModels = useCallback(async () => {
    if (apiKey.trim() === '' || baseUrl.trim() === '') {
      setModelsError(guidanceFor('MISSING_KEY'));
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await listModels(apiKey, baseUrl.trim());
      setModels(list);
      setModel(''); // 목록이 바뀌면 선택 초기화 — 기본값을 박지 않는다
    } catch {
      setModels([]);
      setModelsError(guidanceFor('MODEL_LIST_FAILED'));
    } finally {
      setModelsLoading(false);
    }
  }, [apiKey, baseUrl]);

  const handleApproval = useCallback((req: ApprovalRequest): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      approvalResolve.current = resolve;
      setPendingApproval({ request: req, resolve });
    });
  }, []);

  const settleApproval = useCallback((approved: boolean) => {
    approvalResolve.current?.(approved);
    approvalResolve.current = null;
    setPendingApproval(null);
  }, []);

  const canRun =
    !busy &&
    apiKey.trim() !== '' &&
    baseUrl.trim() !== '' &&
    githubToken.trim() !== '' &&
    parsedRepo !== null &&
    model !== '' &&
    draft.trim() !== '';

  const handleRun = useCallback(async () => {
    if (!canRun || parsedRepo === null) return;
    setTraces([]);
    setResult(null);
    setPendingApproval(null);
    try {
      const runResult = await runAgent({
        config: {
          apiKey,
          baseUrl: baseUrl.trim(),
          githubToken,
          model,
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
          maxIters: MAX_ITERS,
        },
        draft,
        onTrace: (e: TraceEvent) => {
          setTraces((prev) => [...prev, e]);
        },
        onStatus: (s: RunStatus) => {
          setStatus(s);
        },
        onApproval: handleApproval,
      });
      setResult(runResult);
    } catch (err) {
      setResult({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      approvalResolve.current = null;
      setPendingApproval(null);
    }
  }, [canRun, parsedRepo, apiKey, baseUrl, githubToken, model, draft, handleApproval]);

  return (
    <main>
      <header className="app-header">
        <h1>Blog Publisher</h1>
        <button
          type="button"
          ref={helpButtonRef}
          onClick={() => setHelpOpen(true)}
        >
          사용법
        </button>
      </header>
      {helpOpen && (
        <HelpModal
          openerRef={helpButtonRef}
          onClose={() => setHelpOpen(false)}
        />
      )}
      <p className="muted">
        상태: {status}
      </p>
      {status === 'waiting_approval' && (
        <p className="waiting-banner" role="alert">
          승인 대기 중입니다 — 아래 승인 카드에서 변경 내용을 확인하고
          승인 또는 거절해 주세요.
        </p>
      )}

      <SettingsForm
        apiKey={apiKey}
        baseUrl={baseUrl}
        githubToken={githubToken}
        repoInput={repoInput}
        repoError={repoError}
        disabled={busy}
        onApiKey={setApiKey}
        onBaseUrl={setBaseUrl}
        onGithubToken={setGithubToken}
        onRepoInput={setRepoInput}
      />

      <ModelSelect
        models={models}
        model={model}
        loading={modelsLoading}
        error={modelsError}
        canLoad={apiKey.trim() !== '' && baseUrl.trim() !== ''}
        disabled={busy}
        onLoad={handleLoadModels}
        onSelect={setModel}
      />

      <DraftInput draft={draft} disabled={busy} onDraft={setDraft} />

      <section aria-label="실행">
        <button type="button" onClick={handleRun} disabled={!canRun}>
          {busy ? '실행 중…' : '검수·발행 실행'}
        </button>
        {model === '' && (
          <p className="muted">모델을 선택해야 실행할 수 있습니다.</p>
        )}
      </section>

      {status === 'waiting_approval' && pendingApproval !== null && (
        <ApprovalCard
          request={pendingApproval.request}
          onApprove={() => settleApproval(true)}
          onReject={() => settleApproval(false)}
        />
      )}

      <TraceView traces={traces} />

      <ResultView result={result} />
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublisherPage />} />
    </Routes>
  );
}
