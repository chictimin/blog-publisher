import { useCallback, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
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
  // 키·토큰은 React state 메모리에만 보관한다. storage에 쓰지 않는다.
  const [anthropicKey, setAnthropicKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');

  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState(''); // 기본값 없음
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const approvalResolve = useRef<((approved: boolean) => void) | null>(null);

  const busy = status === 'running' || status === 'waiting_approval';

  const handleLoadModels = useCallback(async () => {
    if (anthropicKey.trim() === '') {
      setModelsError(guidanceFor('MISSING_KEY'));
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await listModels(anthropicKey);
      setModels(list);
      setModel(''); // 목록이 바뀌면 선택 초기화 — 기본값을 박지 않는다
    } catch {
      setModels([]);
      setModelsError(guidanceFor('MODEL_LIST_FAILED'));
    } finally {
      setModelsLoading(false);
    }
  }, [anthropicKey]);

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
    anthropicKey.trim() !== '' &&
    githubToken.trim() !== '' &&
    owner.trim() !== '' &&
    repo.trim() !== '' &&
    model !== '' &&
    draft.trim() !== '';

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setTraces([]);
    setResult(null);
    setPendingApproval(null);
    try {
      const runResult = await runAgent({
        config: {
          anthropicKey,
          githubToken,
          model,
          owner: owner.trim(),
          repo: repo.trim(),
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
  }, [canRun, anthropicKey, githubToken, model, owner, repo, draft, handleApproval]);

  return (
    <main>
      <h1>Blog Publisher</h1>
      <p className="muted">
        상태: {status}
      </p>

      <SettingsForm
        anthropicKey={anthropicKey}
        githubToken={githubToken}
        owner={owner}
        repo={repo}
        disabled={busy}
        onAnthropicKey={setAnthropicKey}
        onGithubToken={setGithubToken}
        onOwner={setOwner}
        onRepo={setRepo}
      />

      <ModelSelect
        models={models}
        model={model}
        loading={modelsLoading}
        error={modelsError}
        canLoad={anthropicKey.trim() !== ''}
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

      <TraceView traces={traces} />

      {status === 'waiting_approval' && pendingApproval !== null && (
        <ApprovalCard
          request={pendingApproval.request}
          onApprove={() => settleApproval(true)}
          onReject={() => settleApproval(false)}
        />
      )}

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
