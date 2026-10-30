/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian · 2026-10-30 · 网页原创环境绘制，非 SPD 地图贴图移植。
 * 只读取已探索地形；装饰取决于格坐标，水草摆动不使用玩法随机数。
 */
import { Tile, type TileId } from '../game/terrain';
import type { Level } from '../game/model';

function knownNeighbour(level: Level, cell: number, dx: number, dy: number): TileId | undefined {
  const x = cell % level.width + dx, y = Math.floor(cell / level.width) + dy;
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return undefined;
  const next = x + y * level.width;
  return level.visited[next] ? level.tiles[next] : undefined;
}

function floor(ctx: CanvasRenderingContext2D, variant: number, row: number): void {
  ctx.fillStyle = ['#a5ab8e', '#abb093', '#a7ac90', '#a3aa8d', '#acaf92'][variant]!;
  ctx.fillRect(0, 0, 1, 1);
  ctx.strokeStyle = '#697e6830'; ctx.lineWidth = .018;
  ctx.beginPath(); ctx.moveTo(0, .98); ctx.lineTo(1, .98);
  const joint = row % 2 ? .33 : .68;
  ctx.moveTo(joint, 0); ctx.lineTo(joint, .98); ctx.stroke();
  ctx.strokeStyle = '#d3d1aa28'; ctx.beginPath();
  ctx.moveTo(0, .025); ctx.lineTo(1, .025); ctx.stroke();
  if (variant === 0) {
    ctx.strokeStyle = '#6a7a6630'; ctx.beginPath();
    ctx.moveTo(.16, .62); ctx.lineTo(.29, .53); ctx.lineTo(.24, .43); ctx.stroke();
  } else if (variant === 3) {
    ctx.fillStyle = '#798b6b40'; ctx.fillRect(.22, .74, .035, .025); ctx.fillRect(.62, .27, .05, .025);
  }
}

export function drawTerrain(ctx: CanvasRenderingContext2D, level: Level, cell: number,
  x: number, y: number, size: number, now: number, reduceMotion: boolean, includeMotion = true): void {
  if (!level.visited[cell]) return;
  const tile = level.tiles[cell], column = cell % level.width, row = Math.floor(cell / level.width);
  const variant = (column * 7 + row * 11) % 5;
  const north = knownNeighbour(level, cell, 0, -1), south = knownNeighbour(level, cell, 0, 1);
  const west = knownNeighbour(level, cell, -1, 0), east = knownNeighbour(level, cell, 1, 0);
  const knownOpen = (value: TileId | undefined): boolean => value !== undefined && value !== Tile.Wall;
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  // 所有墙面、阴影和水岸限定在本格，不能把亮边绘入未知区域。
  ctx.beginPath(); ctx.rect(0, 0, 1, 1); ctx.clip(); ctx.lineCap = 'round';

  if (tile === Tile.Wall) {
    const face = knownOpen(south), top = face ? .67 : 1;
    ctx.fillStyle = '#29423f'; ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = variant % 2 ? '#536e5f' : '#4e695c'; ctx.fillRect(0, 0, 1, top);
    ctx.fillStyle = '#6e857065'; ctx.fillRect(0, .025, 1, .045);
    ctx.strokeStyle = '#334f455c'; ctx.lineWidth = .025;
    ctx.beginPath(); ctx.moveTo(row % 2 ? .28 : .72, 0); ctx.lineTo(row % 2 ? .28 : .72, top);
    ctx.moveTo(0, .36); ctx.lineTo(1, .36); ctx.stroke();
    if (face) {
      ctx.fillStyle = '#71816a'; ctx.fillRect(0, top - .045, 1, .06);
      ctx.fillStyle = variant % 2 ? '#3a534a' : '#364e47'; ctx.fillRect(0, top + .015, 1, .22);
      ctx.fillStyle = '#203a36'; ctx.fillRect(0, .91, 1, .09);
      ctx.strokeStyle = '#253d36'; ctx.beginPath(); ctx.moveTo(.5, top + .03); ctx.lineTo(.5, .89); ctx.stroke();
      ctx.fillStyle = '#8d987047'; ctx.fillRect(.07, top + .045, .22, .035);
    }
    if (knownOpen(west)) { ctx.fillStyle = '#263f3a'; ctx.fillRect(0, 0, .065, top); }
    if (knownOpen(east)) { ctx.fillStyle = '#263f3a'; ctx.fillRect(.935, 0, .065, top); }
    if (knownOpen(north)) { ctx.fillStyle = '#7a8b70'; ctx.fillRect(.02, .025, .96, .055); }
    if (variant === 1 || variant === 4) {
      ctx.fillStyle = '#78915e51';
      ctx.beginPath(); ctx.ellipse(.18, .17, .13, .065, -.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a2a56b51'; ctx.fillRect(.12, .15, .04, .025);
    }
    ctx.restore(); return;
  }

  if (tile === Tile.Chasm) {
    ctx.fillStyle = '#102b2c'; ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#0e2426'; ctx.fillRect(.08, .08, .84, .84);
    ctx.restore(); return;
  }

  floor(ctx, variant, row);
  if (tile === Tile.Water) {
    ctx.fillStyle = '#578e85'; ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#75a79a20'; ctx.fillRect(0, .22, 1, .35);
    // 岸线只由已经探索的邻格确定；未探索的邻水/邻岸使用相同的无边缘表现。
    const shores = [north, east, south, west].map(value => value !== undefined && value !== Tile.Water);
    shores.forEach((shore, side) => {
      if (!shore) return;
      ctx.save(); ctx.translate(.5, .5); ctx.rotate(side * Math.PI / 2); ctx.translate(-.5, -.5);
      ctx.fillStyle = '#2b655e55'; ctx.fillRect(0, 0, 1, .12);
      ctx.fillStyle = '#b4c7a56b'; ctx.fillRect(0, .035, 1, .025);
      ctx.restore();
    });
    if (includeMotion) ripples(ctx, column, row, now, reduceMotion);
    if (variant === 2) {
      ctx.strokeStyle = '#d6dfbd60'; ctx.beginPath(); ctx.arc(.68, .3, .07, .1, Math.PI * .85); ctx.stroke();
    }
  } else if (tile === Tile.EmptySpecial) {
    ctx.fillStyle = '#b6b799'; ctx.fillRect(.025, .025, .95, .95);
    ctx.strokeStyle = '#717f694d'; ctx.lineWidth = .025; ctx.strokeRect(.055, .055, .89, .89);
    ctx.fillStyle = '#d6d1ac66'; ctx.fillRect(.065, .065, .87, .035);
    ctx.fillStyle = '#617b6540'; ctx.fillRect(.07, .88, .86, .055);
    // 同一 EMPTY_SP 用于桥和条纹房通路，临水时才绘制桥沿。
    if (west === Tile.Water) { ctx.fillStyle = '#c9c5a2'; ctx.fillRect(.015, 0, .085, 1); }
    if (east === Tile.Water) { ctx.fillStyle = '#777f69'; ctx.fillRect(.9, 0, .085, 1); }
    if (north === Tile.Water) { ctx.fillStyle = '#d0cbaa'; ctx.fillRect(0, .015, 1, .085); }
    if (south === Tile.Water) { ctx.fillStyle = '#747c67'; ctx.fillRect(0, .9, 1, .085); }
  } else if (tile === Tile.Grass || tile === Tile.HighGrass) {
    const tall = tile === Tile.HighGrass;
    ctx.fillStyle = tall ? '#65825b57' : '#7c93602d';
    ctx.beginPath(); ctx.ellipse(.51, .65, .44, .28, 0, 0, Math.PI * 2); ctx.fill();
    if (!tall || includeMotion) grassBlades(ctx, column, row, tall, now, reduceMotion);
  } else if (tile === Tile.Door || tile === Tile.OpenDoor || tile === Tile.LockedDoor) {
    ctx.save();
    if ((north === Tile.Wall || south === Tile.Wall) && (knownOpen(west) || knownOpen(east))) {
      ctx.translate(.5, .5); ctx.rotate(Math.PI / 2); ctx.translate(-.5, -.5);
    }
    ctx.fillStyle = '#3d584b'; ctx.fillRect(0, .03, .13, .94); ctx.fillRect(.87, .03, .13, .94);
    ctx.fillStyle = '#8b9473'; ctx.fillRect(.025, .035, .08, .76); ctx.fillRect(.895, .035, .08, .76);
    if (tile === Tile.OpenDoor) {
      ctx.fillStyle = '#625a42'; ctx.fillRect(.13, .13, .105, .75);
      ctx.fillStyle = '#b29c65'; ctx.fillRect(.15, .14, .025, .68);
    } else {
      ctx.fillStyle = '#4d4936'; ctx.fillRect(.13, .1, .74, .83);
      ctx.fillStyle = '#8d7952'; ctx.fillRect(.15, .1, .7, .71);
      ctx.strokeStyle = '#4f533e'; ctx.lineWidth = .025; ctx.beginPath();
      for (let i = 1; i < 4; i++) { ctx.moveTo(.15 + i * .175, .12); ctx.lineTo(.15 + i * .175, .8); }
      ctx.stroke();
      ctx.fillStyle = '#baa270'; ctx.fillRect(.16, .12, .68, .045);
      ctx.fillStyle = '#536051'; ctx.fillRect(.16, .29, .68, .065); ctx.fillRect(.16, .67, .68, .065);
      ctx.fillStyle = '#e5c685'; ctx.beginPath(); ctx.arc(.74, .5, .042, 0, Math.PI * 2); ctx.fill();
      if (tile === Tile.LockedDoor) { ctx.fillStyle = '#d2b472'; ctx.fillRect(.43, .43, .14, .18); }
    }
    ctx.restore();
  } else if (tile === Tile.Entrance || tile === Tile.Exit) {
    const down = tile === Tile.Exit;
    ctx.fillStyle = '#d5c799'; ctx.fillRect(.07, .07, .86, .86);
    ctx.fillStyle = '#2e4c44'; ctx.fillRect(.12, .12, .76, .76);
    for (let step = 0; step < 5; step++) {
      const depth = down ? step : 4 - step, inset = depth * .035;
      ctx.fillStyle = ['#b7b99b', '#a6ad90', '#929f84', '#7b9078', '#657e6c'][depth]!;
      ctx.fillRect(.16 + inset, .16 + step * .13, .68 - inset * 2, .105);
      ctx.fillStyle = '#d1cfab66'; ctx.fillRect(.16 + inset, .16 + step * .13, .68 - inset * 2, .025);
    }
    ctx.fillStyle = down ? '#e5c582' : '#bee0bb'; ctx.beginPath();
    const arrowY = down ? .86 : .12;
    ctx.moveTo(.41, arrowY + (down ? -.035 : .035)); ctx.lineTo(.59, arrowY + (down ? -.035 : .035));
    ctx.lineTo(.5, arrowY + (down ? .055 : -.055)); ctx.closePath(); ctx.fill();
  } else if (tile === Tile.Trap || tile === Tile.InactiveTrap) {
    ctx.strokeStyle = tile === Tile.Trap ? '#a05e48' : '#737f68'; ctx.lineWidth = .035;
    ctx.strokeRect(.25, .25, .5, .5);
    ctx.beginPath(); ctx.moveTo(.35, .65); ctx.lineTo(.5, .35); ctx.lineTo(.65, .65); ctx.stroke();
  } else if (tile === Tile.Embers || tile === Tile.EmptyDecor) {
    ctx.fillStyle = tile === Tile.Embers ? '#635d4b60' : '#7d896951';
    ctx.beginPath(); ctx.ellipse(.52, .66, .26, .12, -.2, 0, Math.PI * 2); ctx.fill();
  }

  // 邻墙投影限定在地面边缘，地面仍保持明亮，便于识别敌人和拾取物。
  if (north === Tile.Wall) {
    ctx.fillStyle = '#1b3e3322'; ctx.fillRect(0, 0, 1, .13);
    ctx.fillStyle = '#1b3e3312'; ctx.fillRect(0, .13, 1, .06);
  }
  if (west === Tile.Wall) { ctx.fillStyle = '#1b3e3318'; ctx.fillRect(0, 0, .08, 1); }
  ctx.restore();
}

function ripples(ctx: CanvasRenderingContext2D, column: number, row: number, now: number, reduceMotion: boolean): void {
  const tide = reduceMotion ? 0 : Math.sin(now / 1900 + column * .72 + row * .38) * .025;
  ctx.lineWidth = .018; ctx.strokeStyle = '#acd2b77d'; ctx.beginPath();
  ctx.moveTo(.13, .4 + tide); ctx.quadraticCurveTo(.29, .35 + tide, .48, .4 + tide);
  ctx.moveTo(.55, .76 - tide); ctx.quadraticCurveTo(.7, .8 - tide, .88, .76 - tide); ctx.stroke();
}

function grassBlades(ctx: CanvasRenderingContext2D, column: number, row: number, tall: boolean,
  now: number, reduceMotion: boolean): void {
  const sway = reduceMotion || !tall ? 0 : Math.sin(now / 1400 + column + row * .7) * .025;
  for (let i = 0; i < (tall ? 6 : 3); i++) {
    const gx = .16 + (i % 3) * .29 + (i > 2 ? .035 : 0);
    const gy = .62 + Math.floor(i / 3) * .28 + (i % 2) * .07;
    const height = tall ? .37 + (i % 3) * .055 : .18 + (i % 2) * .06;
    ctx.strokeStyle = tall ? '#406d50' : '#6b8855'; ctx.lineWidth = tall ? .04 : .032;
    ctx.beginPath(); ctx.moveTo(gx - .085 + sway, gy - height * .82);
    ctx.quadraticCurveTo(gx - .015, gy - height * .5, gx, gy);
    ctx.quadraticCurveTo(gx + .015, gy - height * .6, gx + .1 + sway, gy - height); ctx.stroke();
    ctx.strokeStyle = tall ? '#93a66b' : '#9aab70'; ctx.lineWidth = .022;
    ctx.beginPath(); ctx.moveTo(gx, gy - .035); ctx.lineTo(gx + .035 + sway, gy - height * .77); ctx.stroke();
  }
}

/** 地形与已知邻域变化时重取纹理；镜头平移只拷贝纹理，水纹与高草单独绘制。 */
export class TerrainCache {
  private level: Level | null = null;
  private revision = -1;
  private resolution = 0;
  private readonly textures = new Map<string, HTMLCanvasElement>();
  private cells: (HTMLCanvasElement | undefined)[] = [];

  reset(): void {
    this.level = null; this.revision = -1; this.textures.clear(); this.cells = [];
  }
  sync(level: Level, revision: number, size: number, ratio: number): void {
    const resolution = Math.ceil(size * ratio);
    if (this.level !== level || this.resolution !== resolution) {
      this.reset(); this.level = level; this.resolution = resolution;
    }
    if (this.revision === revision) return;
    this.revision = revision;
    this.cells = new Array<HTMLCanvasElement | undefined>(level.tiles.length);
    for (let cell = 0; cell < level.tiles.length; cell++) {
      if (!level.visited[cell]) continue;
      const column = cell % level.width, row = Math.floor(cell / level.width);
      const key = [level.tiles[cell], (column * 7 + row * 11) % 5, row % 2,
        knownNeighbour(level, cell, 0, -1), knownNeighbour(level, cell, 0, 1),
        knownNeighbour(level, cell, -1, 0), knownNeighbour(level, cell, 1, 0)].join(':');
      let texture = this.textures.get(key);
      if (!texture) {
        texture = document.createElement('canvas'); texture.width = resolution; texture.height = resolution;
        const context = texture.getContext('2d');
        if (!context) throw new Error('无法建立地形绘制缓存。');
        drawTerrain(context, level, cell, 0, 0, resolution, 0, true, false);
        this.textures.set(key, texture);
      }
      this.cells[cell] = texture;
    }
  }
  draw(ctx: CanvasRenderingContext2D, cell: number, x: number, y: number, size: number,
    now: number, reduceMotion: boolean): void {
    const texture = this.cells[cell], level = this.level;
    if (!texture || !level) return;
    ctx.drawImage(texture, x, y, size, size);
    const tile = level.tiles[cell];
    if (tile !== Tile.Water && tile !== Tile.HighGrass) return;
    const column = cell % level.width, row = Math.floor(cell / level.width);
    ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
    ctx.beginPath(); ctx.rect(0, 0, 1, 1); ctx.clip(); ctx.lineCap = 'round';
    if (tile === Tile.Water) ripples(ctx, column, row, now, reduceMotion);
    else grassBlades(ctx, column, row, true, now, reduceMotion);
    ctx.restore();
  }
}
