import { useState } from 'react';
import type { ApprovalRequest } from '../core/types';

interface ApprovalCardProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}

/** 5단계: 승인 카드. 되돌리기 어려운 작업(PR 생성) 앞의 게이트다. */
export default function ApprovalCard(props: ApprovalCardProps) {
  const { request } = props;
  // 클릭 후 중복 결정을 막는다.
  const [decided, setDecided] = useState(false);

  const handleApprove = () => {
    if (decided) return;
    setDecided(true);
    props.onApprove();
  };
  const handleReject = () => {
    if (decided) return;
    setDecided(true);
    props.onReject();
  };

  return (
    <section aria-label="5단계 승인 요청" className="approval">
      <h2>5. 승인 요청 — 발행 전 마지막 확인</h2>
      <p>
        <strong>{request.title}</strong>
      </p>
      <p className="notice">
        승인하면 되돌리기 어려운 PR 생성 작업이 실행됩니다. 아래 변경
        내용을 끝까지 확인한 뒤 결정해 주세요.
      </p>
      <pre className="diff-preview">{request.diffPreview}</pre>
      <div className="row approval-actions">
        <button type="button" onClick={handleReject} disabled={decided}>
          거절
        </button>
        <button
          type="button"
          className="primary"
          onClick={handleApprove}
          disabled={decided}
        >
          승인하고 PR 생성
        </button>
      </div>
    </section>
  );
}
