/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian，2026-10-30。纯逻辑工作线程：无 DOM、无存储写入、无墙钟推进。
 */
import { World } from '../game/world';
import type { FloorRequest, FloorResponse } from './floor-loader';

self.onmessage = (event: MessageEvent<FloorRequest>): void => {
  const request = event.data;
  let response: FloorResponse;
  try {
    const world = request.type === 'create' ? World.create(BigInt(request.seed), request.runId) : World.restore(request.state);
    const result = request.type === 'stairs' ? world.dispatch({ type: 'stairs', direction: request.direction }) : null;
    if (result && !result.changed) throw new Error(result.reason ?? '暂时无法使用阶梯。');
    response = { ok: true, state: world.snapshot(), result };
  } catch (error) {
    response = { ok: false, reason: error instanceof Error ? error.message : '地图准备失败，原远征没有被替换。' };
  }
  self.postMessage(response);
};
