import type { TraceEvent } from '../core/types';

interface TraceViewProps {
  traces: TraceEvent[];
}

/** 4단계: 실행 trace. onTrace 이벤트를 시간순 목록으로 보여준다. */
export default function TraceView(props: TraceViewProps) {
  const { traces } = props;
  const tokensIn = traces.reduce((sum, e) => sum + (e.tokensIn ?? 0), 0);
  const tokensOut = traces.reduce((sum, e) => sum + (e.tokensOut ?? 0), 0);
  const totalMs = traces.reduce((sum, e) => sum + (e.ms ?? 0), 0);

  return (
    <section aria-label="4단계 실행 기록">
      <h2>4. 실행 / trace</h2>
      {traces.length === 0 ? (
        <p className="muted">아직 실행 기록이 없습니다.</p>
      ) : (
        <>
          <ol className="trace-list">
            {traces.map((e) => (
              <li key={e.seq}>
                <span className={`badge badge-${e.kind}`}>{e.kind}</span>
                <span className="trace-label">{e.label}</span>
                {e.ms !== undefined && (
                  <span className="trace-ms">{e.ms}ms</span>
                )}
                {e.detail !== undefined && (
                  <details>
                    <summary>자세히</summary>
                    <pre>{e.detail}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
          <p className="totals">
            누적 토큰 — 입력 {tokensIn} / 출력 {tokensOut} · 총 소요시간 {totalMs}ms
          </p>
        </>
      )}
    </section>
  );
}
