/* SPDX-License-Identifier: GPL-3.0-or-later
 * 网页遭遇密度调校：ScarfQian，2026-10-30。
 * 以下数量、间隔和分散规则是鹈鹕骑士的网页参数，不是 SPD v4.0.2 原版数值。
 * 不调整怪物配方、单体属性、经验或掉落，也不向读取中的旧楼层追加初始怪物。
 */
import type { Random } from '../engine/random';
import type { Level } from './model';
import { distance, inside, passable, solid, Tile, type Grid } from './terrain';

export const WEB_ENCOUNTERS = {
  firstFloor: { minimum: 12, maximum: 16, cellsPerMob: 20 },
  deeperFloors: { minimum: 14, maximum: 20, cellsPerMob: 18, perDepth: 2 },
  respawnDelay: 32,
  minimumSeparation: 2,
} as const;

/** 只统计已支持普通房内可站立的格子，不把墙、通道或桥面算成可用面积。 */
export function encounterRoomCells(level: Level): number[] {
  return level.tiles.map((_, cell) => cell).filter(cell => inside(level, cell)
    && passable(level.tiles[cell]!) && !solid(level.tiles[cell]!)
    && cell !== level.entrance && cell !== level.exit
    && level.rooms.some(room => (['empty', 'striped', 'sewer-pipe'].includes(room.kind)
      || (room.kind === 'water-bridge' && ([Tile.Floor, Tile.Grass, Tile.HighGrass] as readonly number[]).includes(level.tiles[cell]!)))
      && cell % level.width > room.left && cell % level.width < room.right
      && Math.floor(cell / level.width) > room.top && Math.floor(cell / level.width) < room.bottom));
}

/** 首层12—16；二至四层分别14—20、16—22、18—24，面积不足时自然减量。 */
export function encounterPopulation(depth: number, area: number): number {
  if (depth < 1 || depth > 4) return 0;
  const settings = depth === 1 ? WEB_ENCOUNTERS.firstFloor : WEB_ENCOUNTERS.deeperFloors;
  const depthBonus = depth === 1 ? 0 : (depth - 2) * WEB_ENCOUNTERS.deeperFloors.perDepth;
  const desired = Math.round(area / settings.cellsPerMob) + depthBonus;
  return Math.min(area, Math.max(settings.minimum + depthBonus, Math.min(settings.maximum + depthBonus, desired)));
}

/** 随机打破并列，再优先放在离已有怪物最远的位置；放不下就少放，不拒绝地图。 */
export function spreadEncounterCells(grid: Grid, cells: readonly number[], count: number,
  random: Random, occupied: readonly number[] = []): number[] {
  const available = random.shuffleList([...cells]);
  const selected: number[] = [];
  while (selected.length < count && available.length > 0) {
    let chosen = 0, largestGap = -1;
    for (let index = 0; index < available.length; index++) {
      let gap = Infinity;
      for (const other of occupied) gap = Math.min(gap, distance(grid, available[index]!, other));
      for (const other of selected) gap = Math.min(gap, distance(grid, available[index]!, other));
      if (gap > largestGap) { largestGap = gap; chosen = index; }
    }
    if (largestGap < WEB_ENCOUNTERS.minimumSeparation) break;
    selected.push(available.splice(chosen, 1)[0]!);
  }
  return selected;
}
