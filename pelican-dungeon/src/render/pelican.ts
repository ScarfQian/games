/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian · 2026-10-30 · CHR-001 r2 的网页行走姿势。
 * 使用既有 SVG 骨架与挂点；身体、嘴、帽巾的母版路径不变。
 */
import source from '../../assets/pelican.svg?raw';

export const WALK_FRAMES = 16;

export async function loadPelicanWalk(load: (url: string) => Promise<HTMLImageElement>): Promise<HTMLImageElement[]> {
  const original = new DOMParser().parseFromString(source, 'image/svg+xml');
  const serializer = new XMLSerializer();
  return Promise.all(Array.from({ length: WALK_FRAMES }, async (_, frame) => {
    const svg = original.documentElement.cloneNode(true) as SVGElement;
    const phase = frame / WALK_FRAMES * Math.PI * 2;
    const bob = -1.6 * Math.sin(phase) ** 2;
    // 交替抬脚；每跨一格走半个周期，在格子交界处双脚回到站姿，连续走时不重置相位。
    for (const [part, hipX, hipY, footX, footY, offset] of [
      ['legA', -7, -34, -10, -2, 0], ['legB', 2, -33, 4, -1, Math.PI],
    ] as const) {
      const stride = Math.sin(phase + offset), lift = Math.max(0, stride) * 6;
      const x = footX + stride * 11, y = footY - lift;
      const kneeX = (hipX + x) / 2 - lift * .5;
      svg.querySelector('[data-part="' + part + '"]')!.setAttribute('d',
        `M${hipX} ${hipY + bob} Q${kneeX} ${-18 + bob} ${x} ${y} h10`);
    }
    for (const part of ['body', 'scarf', 'hat', 'hand', 'arm']) {
      const node = svg.querySelector('[data-part="' + part + '"]')!;
      node.setAttribute('transform', `translate(0 ${bob}) ` + (node.getAttribute('transform') ?? ''));
    }
    svg.querySelector('[data-part="tail"]')!.setAttribute('transform', `rotate(${Math.sin(phase) * 3} 9 -57)`);
    svg.querySelector('[data-part="arm"]')!.setAttribute('transform', `translate(0 ${bob}) rotate(${Math.sin(phase) * 4} 8 -46)`);
    // 地面阴影由场景绘制，不随身体摆动或产生第二道阴影。
    svg.querySelector('[data-part="shadow"]')!.setAttribute('opacity', '0');
    const url = URL.createObjectURL(new Blob([serializer.serializeToString(svg)], { type: 'image/svg+xml' }));
    try { return await load(url); } finally { URL.revokeObjectURL(url); }
  }));
}
