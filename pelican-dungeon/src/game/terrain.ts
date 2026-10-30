/*
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * TypeScript 移植：ScarfQian，2026-10-30。
 * 来源：SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0 / core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/levels/Terrain.java
 */

export const Tile = {
  Wall: 4, Floor: 1, Door: 5, OpenDoor: 6, Water: 29, Grass: 2,
  HighGrass: 15, Entrance: 7, Exit: 8, LockedDoor: 10, Chasm: 0,
  Trap: 18, InactiveTrap: 19, Embers: 9, EmptyDecor: 20, EmptySpecial: 14,
} as const;
export type TileId = typeof Tile[keyof typeof Tile];
export interface Grid { width: number; height: number; tiles: TileId[] }
export const DIRECTIONS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const;
export function inside(grid: Grid, cell: number): boolean {
  const x = cell % grid.width, y = Math.floor(cell / grid.width);
  return x > 0 && x < grid.width - 1 && y > 0 && y < grid.height - 1;
}
export function adjacent(grid: Grid, from: number, to: number): boolean {
  const dx = Math.abs(from % grid.width - to % grid.width);
  const dy = Math.abs(Math.floor(from / grid.width) - Math.floor(to / grid.width));
  return Math.max(dx, dy) === 1;
}
export function distance(grid: Grid, from: number, to: number): number {
  return Math.max(Math.abs(from % grid.width - to % grid.width),
    Math.abs(Math.floor(from / grid.width) - Math.floor(to / grid.width)));
}
export function neighbours(grid: Grid, cell: number): number[] {
  const x = cell % grid.width, y = Math.floor(cell / grid.width);
  return DIRECTIONS.filter(([dx,dy]) => x+dx >= 0 && x+dx < grid.width && y+dy >= 0 && y+dy < grid.height)
    .map(([dx,dy]) => cell + dx + dy*grid.width);
}
export function passable(tile: TileId): boolean {
  return tile !== Tile.Wall && tile !== Tile.LockedDoor && tile !== Tile.Chasm && tile !== Tile.Trap;
}
export function avoid(tile: TileId): boolean { return tile === Tile.Chasm || tile === Tile.Trap; }
export function solid(tile: TileId): boolean {
  return tile === Tile.Wall || tile === Tile.Door || tile === Tile.LockedDoor;
}
export function blocksSight(tile: TileId): boolean {
  return solid(tile) || tile === Tile.HighGrass;
}

