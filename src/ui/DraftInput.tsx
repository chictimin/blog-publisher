interface DraftInputProps {
  draft: string;
  disabled: boolean;
  onDraft: (v: string) => void;
}

/** 3단계: 초안 입력. */
export default function DraftInput(props: DraftInputProps) {
  return (
    <section aria-label="3단계 초안 입력">
      <h2>3. 초안 입력</h2>
      <label>
        마크다운 초안 전문을 붙여넣으세요
        <textarea
          rows={14}
          value={props.draft}
          disabled={props.disabled}
          onChange={(e) => props.onDraft(e.target.value)}
          placeholder="# 제목&#10;&#10;본문…"
        />
      </label>
    </section>
  );
}
