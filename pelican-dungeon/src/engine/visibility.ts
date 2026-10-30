/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * TypeScript 移植：ScarfQian，2026-10-30。
 * SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0 / core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/mechanics/ShadowCaster.java
 */

import type { Grid } from '../game/terrain';

export function fieldOfView(grid: Grid, origin: number, blocking: (cell: number) => boolean, radius = 8): boolean[] {
  const distance=Math.min(20,Math.max(0,Math.trunc(radius)));
  const fov=new Array<boolean>(grid.width*grid.height).fill(false);
  fov[origin]=true;
  const rounding=new Array<number>(distance+1).fill(0);
  for(let j=1;j<=distance;j++) rounding[j]=Math.min(j,Math.round(distance*Math.cos(Math.asin(j/(distance+0.5)))));
  if(distance===2) rounding[2]=2;
  const x=origin%grid.width,y=Math.floor(origin/grid.width);
  function scan(row:number,leftSlope:number,rightSlope:number,mx:number,my:number,swap:boolean):void {
    let inBlocking=false;
    for(;row<=distance;row++) {
      if(rightSlope<leftSlope) return;
      const start=leftSlope===0?0:Math.floor((row-0.5)*leftSlope+0.499);
      const end=rightSlope===1?rounding[row]!:Math.min(rounding[row]!,Math.ceil((row+0.5)*rightSlope-0.499));
      for(let col=start;col<=end;col++) {
        if(col===end && inBlocking && Math.ceil((row-0.5)*rightSlope-0.499)!==end) break;
        const cx=x+(swap?my*row:mx*col),cy=y+(swap?mx*col:my*row);
        const valid=cx>=0&&cx<grid.width&&cy>=0&&cy<grid.height;
        const cell=cx+cy*grid.width;
        if(valid) fov[cell]=true;
        if(!valid || blocking(cell)) {
          if(!inBlocking) {
            inBlocking=true;
            if(col!==start) scan(row+1,leftSlope,(col-0.5)/(row+0.5),mx,my,swap);
          }
        } else if(inBlocking) {
          inBlocking=false; leftSlope=(col-0.5)/(row-0.5);
        }
      }
      if(inBlocking) return;
    }
  }
  for(const [mx,my,swap] of [[1,-1,false],[-1,1,true],[1,1,true],[1,1,false],[-1,1,false],[1,-1,true],[-1,-1,true],[-1,-1,false]] as const) scan(1,0,1,mx,my,swap);
  return fov;
}

