/**
 * 평가용 headless 실행 스크립트 엔트리. 빌드 없이 node로 바로 실행한다.
 * 사용법: node scripts/eval.mjs --models <id1,id2> [--owner o --repo r] [--approve]
 * 환경변수: OPENAI_API_KEY, OPENAI_BASE_URL, GITHUB_TOKEN, (EVAL_OWNER, EVAL_REPO)
 */
import { register } from 'node:module';

register('./ts-ext-hook.mjs', import.meta.url);
await import('./eval-impl.ts');
