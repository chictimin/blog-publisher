import { useEffect, useRef } from 'react';

interface HelpModalProps {
  openerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/** 사용법 모달. 버튼으로만 열고, 자동으로 띄우지 않는다. */
export default function HelpModal(props: HelpModalProps) {
  const { openerRef, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 열릴 때 모달 안으로 포커스, 닫힐 때 원래 버튼으로 복귀.
    dialogRef.current?.focus();
    const opener = openerRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [onClose, openerRef]);

  const onBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={onBackdropMouseDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        className="modal-dialog"
      >
        <div className="modal-header">
          <h2 id="help-title">사용법</h2>
          <button type="button" onClick={onClose} aria-label="사용법 닫기">
            닫기
          </button>
        </div>
        <div className="modal-body">
          <section aria-label="준비물">
            <h3>준비물</h3>
            <ul>
              <li>
                OpenAI 호환 API 키 + baseUrl. 예시:{' '}
                <code>https://api.openai.com/v1</code> (본가, 권장),{' '}
                <code>https://opencode.ai/zen/go/v1</code> (호환
                게이트웨이 — 공유 쿼터 소진 시 끊길 수 있음). 본가
                사용을 권장하며, 다른 호환 제공자를 넣어도 된다.
              </li>
              <li>
                GitHub fine-grained PAT — 대상 저장소 1개 한정, 권한
                2개: Contents 쓰기, Pull requests 쓰기. 발급:{' '}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  토큰 발급 페이지
                </a>
              </li>
              <li>
                대상 저장소는 Hugo 구조(
                <code>content/blog</code> 디렉토리)여야 한다.
              </li>
            </ul>
          </section>
          <section aria-label="사용 순서">
            <h3>사용 순서</h3>
            <ol>
              <li>설정 — API 키·baseUrl, PAT, 저장소를 입력한다.</li>
              <li>모델 선택 — 목록은 키·baseUrl로 조회한다. 고르지 않으면 실행 불가.</li>
              <li>초안 입력 — 마크다운 전문을 붙여넣는다.</li>
              <li>실행 — 단계별 trace와 누적 토큰을 확인한다.</li>
              <li>승인 — 변경 요약을 보고 승인 또는 거절한다.</li>
              <li>결과 — PR 링크로 이동하거나 오류 안내를 본다.</li>
            </ol>
          </section>
          <section aria-label="승인 게이트">
            <h3>승인 게이트가 하는 일과 하지 않는 일</h3>
            <ul>
              <li>
                하는 일: 승인하면 새 브랜치를 만들고 변환된 포스트를
                커밋한 뒤 PR을 생성한다.
              </li>
              <li>
                하지 않는 일: <code>main</code>에 머지하지 않으므로
                블로그에 즉시 게시되지 않는다. 거절해도 오류가 아니다.
              </li>
            </ul>
          </section>
          <section aria-label="키 취급과 한계">
            <h3>키 취급과 한계</h3>
            <ul>
              <li>
                키·baseUrl·토큰은 이 탭 메모리에만 있으며 새로고침하면
                사라진다. 다시 입력해야 한다.
              </li>
              <li>이미지 업로드 미지원 — 에셋 업로드는 하지 않는다.</li>
              <li>새로고침하면 입력과 실행 상태가 모두 초기화된다.</li>
              <li>
                중간 실패 시 자동 롤백 없음 — 부분 생성된 브랜치는
                GitHub 화면에서 직접 정리한다.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
