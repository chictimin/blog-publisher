import type { ApprovalRequest } from '../core/types';

interface ApprovalCardProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}

/** 5단계: 승인 카드. 되돌리기 어려운 작업(PR 생성) 앞의 게이트다. */
export default function ApprovalCard(props: ApprovalCardProps) {
  const { request } = props;
  return (
    <section aria-label="5단계 승인 요청" className="approval">
      <h2>5. 승인 요청</h2>
      <p>
        <strong>{request.title}</strong>
      </p>
      <pre className="diff-preview">{request.diffPreview}</pre>
      <div className="row">
        <button type="button" onClick={props.onApprove}>
          승인하고 PR 생성
        </button>
        <button type="button" onClick={props.onReject}>
          거절
        </button>
      </div>
    </section>
  );
}
