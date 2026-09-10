import type { RunResult } from '../core/types';
import { guidanceFor } from './errorMessages';

interface ResultViewProps {
  result: RunResult | null;
}

/** 6단계: 결과. 성공 시 PR 링크, 실패 시 오류 코드별 안내 문구. */
export default function ResultView(props: ResultViewProps) {
  const { result } = props;
  return (
    <section aria-label="6단계 결과">
      <h2>6. 결과</h2>
      {result === null ? (
        <p className="muted">아직 실행 결과가 없습니다.</p>
      ) : result.status === 'completed' && result.prUrl ? (
        <p>
          PR이 생성되었습니다.{' '}
          <a href={result.prUrl} target="_blank" rel="noreferrer">
            {result.prUrl}
          </a>
        </p>
      ) : result.status === 'completed' ? (
        <p>승인이 거절되어 PR을 생성하지 않고 종료되었습니다.</p>
      ) : (
        <div>
          <p className="error">{guidanceFor(result.errorCode)}</p>
          {result.errorMessage && (
            <details>
              <summary>오류 상세</summary>
              <pre>{result.errorMessage}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
