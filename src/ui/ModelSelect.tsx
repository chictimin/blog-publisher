interface ModelOption {
  id: string;
  display_name: string;
}

interface ModelSelectProps {
  models: ModelOption[];
  model: string;
  loading: boolean;
  error: string | null;
  canLoad: boolean;
  disabled: boolean;
  onLoad: () => void;
  onSelect: (id: string) => void;
}

/** 2단계: 모델 선택. 기본 선택 없음 — 고르기 전엔 실행 버튼이 비활성이다. */
export default function ModelSelect(props: ModelSelectProps) {
  const { models, model, loading, error, canLoad, disabled } = props;
  return (
    <section aria-label="2단계 모델 선택">
      <h2>2. 모델 선택</h2>
      <div className="row">
        <button
          type="button"
          onClick={props.onLoad}
          disabled={!canLoad || loading || disabled}
        >
          {loading ? '불러오는 중…' : '모델 목록 불러오기'}
        </button>
        <select
          value={model}
          disabled={disabled || models.length === 0}
          onChange={(e) => props.onSelect(e.target.value)}
          aria-label="모델 선택"
        >
          <option value="">— 모델을 선택하세요 —</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name} ({m.id})
            </option>
          ))}
        </select>
      </div>
      {error !== null && <p className="error">{error}</p>}
    </section>
  );
}
