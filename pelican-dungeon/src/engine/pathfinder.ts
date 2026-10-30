/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * TypeScript 移植：ScarfQian，2026-10-30。
 * SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0 / SPD-classes/src/main/java/com/watabou/utils/PathFinder.java
 */

import type { Grid } from '../game/terrain';

export const UNREACHABLE = 2147483647;
export function distanceMap(grid: Grid, targets: readonly number[], canPass: (cell: number) => boolean, limit = UNREACHABLE, source = -1): Int32Array {
  const size = grid.width * grid.height, distances = new Int32Array(size).fill(UNREACHABLE);
  const queue: number[] = [];
  for (const target of targets) {
    if (target >= 0 && target < size && distances[target] !== 0) {
      distances[target] = 0; queue.push(target);
    }
  }
  const w = grid.width, offsets = [-w-1,-1,w-1,-w,w,-w+1,1,w+1];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!, next = distances[cell]! + 1;
    if (next > limit) continue;
    const left = cell % w === 0, right = cell % w === w - 1;
    for (let i = 0; i < offsets.length; i++) {
      if ((left && i < 3) || (right && i > 4)) continue;
      const neighbour = cell + offsets[i]!;
      if (neighbour < 0 || neighbour >= size || distances[neighbour]! <= next) continue;
      if (neighbour !== source && !canPass(neighbour)) continue;
      distances[neighbour] = next; queue.push(neighbour);
    }
  }
  return distances;
}
function downhill(grid: Grid, from: number, distances: Int32Array): number {
  let best = from, value = distances[from]!;
  const w=grid.width, x=from%w;
  for (const offset of [-1,1,-w,w,-w-1,-w+1,w-1,w+1]) {
    const cell=from+offset;
    if (cell<0 || cell>=distances.length || Math.abs(cell%w-x)>1) continue;
    if (distances[cell]! < value) { best=cell; value=distances[cell]!; }
  }
  return best;
}
export function findPath(grid: Grid, from: number, to: number, canPass: (cell: number) => boolean): number[] | null {
  if (from===to) return null;
  const distances=distanceMap(grid,[to],canPass,UNREACHABLE,from);
  if (distances[from]===UNREACHABLE) return null;
  const path:number[]=[];
  let current=from;
  while(current!==to) {
    const next=downhill(grid,current,distances);
    if(next===current) return null;
    path.push(next); current=next;
  }
  return path;
}
export function nextStep(grid: Grid, from: number, to: number, canPass: (cell: number) => boolean): number {
  return findPath(grid,from,to,canPass)?.[0] ?? -1;
}

