/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian，2026-10-30。地图副本在 Worker 中生成，成功返回后才替换当前远征。
 */
import type { ActionResult, GameState } from '../game/model';

export type FloorRequest = { type: 'create'; seed: string; runId: string }
  | { type: 'stairs'; state: GameState; direction: 'up' | 'down' };
export type FloorResponse = { ok: true; state: GameState; result: ActionResult | null } | { ok: false; reason: string };

export function prepareFloor(request: FloorRequest): Promise<{state: GameState; result: ActionResult | null}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./floor-worker.ts', import.meta.url), { type: 'module' });
    const finish = (): void => { window.clearTimeout(timer); worker.terminate(); };
    const timer = window.setTimeout(() => {
      finish(); reject(new Error('地图准备超时，原远征仍保留在本页。可以关闭提示后重新尝试。'));
    }, 30000);
    worker.onmessage = (event: MessageEvent<FloorResponse>) => {
      finish();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.reason));
    };
    worker.onerror = event => {
      event.preventDefault(); finish();
      reject(new Error('地图资源未能加载，原远征没有被替换。请稍后重试，或导出保存当前进度。'));
    };
    worker.onmessageerror = () => { finish(); reject(new Error('地图数据未能传回，原远征没有被替换。')); };
    try { worker.postMessage(request); } catch (error) { finish(); reject(error); }
  });
}
