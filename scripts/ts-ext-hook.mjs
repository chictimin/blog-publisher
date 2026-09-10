/**
 * node의 타입 스트리핑은 확장자 없는 상대 import를 해석하지 못한다.
 * core 파일을 고치지 않기 위해 resolve 훅으로 .ts를 붙여준다.
 * 빌드 없음. node 단독 실행용.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const TS_EXTS = ['.ts', '.mts'];

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(s: string, c: object) => Promise<object>} next
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND') throw err;
    if (!specifier.startsWith('.') || !context.parentURL?.startsWith('file:')) throw err;
    const parentPath = fileURLToPath(context.parentURL);
    const base = path.resolve(path.dirname(parentPath), specifier);
    if (path.extname(base) !== '') throw err;
    for (const ext of TS_EXTS) {
      if (existsSync(base + ext)) {
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    throw err;
  }
}
