/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * TypeScript 移植：ScarfQian，2026-10-30。
 * SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0 / core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/mechanics/Ballistica.java
 */

import { inside,passable,avoid,solid,type Grid } from '../game/terrain';
export const STOP_TARGET=1, STOP_CHARS=2, STOP_SOLID=4, IGNORE_SOFT_SOLID=8;
export const PROJECTILE=7, MAGIC_BOLT=6;
export interface BallisticPath { path:number[]; collision:number; distance:number }
export function ballistics(grid:Grid,from:number,to:number,occupied:(cell:number)=>boolean,flags=PROJECTILE):BallisticPath {
  if(from===to) return {path:[from],collision:from,distance:0};
  const w=grid.width;
  let dx=to%w-from%w,dy=Math.floor(to/w)-Math.floor(from/w);
  const sx=dx>0?1:-1,sy=dy>0?1:-1;
  dx=Math.abs(dx); dy=Math.abs(dy);
  const stepA=dx>dy?sx:sy*w,stepB=dx>dy?sy*w:sx;
  const da=Math.max(dx,dy),db=Math.min(dx,dy);
  let error=Math.floor(da/2),cell=from,collision:number|undefined;
  const path:number[]=[];
  while(inside(grid,cell)) {
    const tile=grid.tiles[cell]!;
    if(collision===undefined && (flags&STOP_SOLID) && cell!==from && !passable(tile)&&!avoid(tile)&&!occupied(cell)) collision=path[path.length-1];
    path.push(cell);
    if(collision===undefined && (flags&STOP_SOLID) && cell!==from && solid(tile)) {
      if(!(flags&IGNORE_SOFT_SOLID) || !(passable(tile)||avoid(tile))) collision=cell;
    }
    if(collision===undefined && (flags&STOP_CHARS) && cell!==from && occupied(cell)) collision=cell;
    if(collision===undefined && (flags&STOP_TARGET) && cell===to) collision=cell;
    cell+=stepA; error+=db;
    if(error>=da) { error-=da; cell+=stepB; }
  }
  if(path.length===0) path.push(from);
  collision??=path[path.length-1]!;
  return {path,collision,distance:path.indexOf(collision)};
}

