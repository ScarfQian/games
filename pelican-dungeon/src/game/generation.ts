/*
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * TypeScript 移植：ScarfQian，2026-10-30。
 * 固定来源：SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0。
 * core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/levels/ 下的
 * RegularLevel、SewerLevel、Patch、builders/{Builder,RegularBuilder,LoopBuilder}、
 * rooms/Room、rooms/standard/{StandardRoom,EmptyRoom,StripedRoom,SewerPipeRoom,StandardBridgeRoom,WaterBridgeRoom,
 * entrance/EntranceRoom,exit/ExitRoom}、
 * rooms/connection/{ConnectionRoom,TunnelRoom}、painters/{Painter,RegularPainter}；
 * 矩形基础对应 SPD-classes/src/main/java/com/watabou/utils/Rect.java。
 *
 * 第1—4层是 SewerLevel 生成算法子集：只用 LoopBuilder，不包含 FigureEight；
 * 普通房只抽 SewerPipeRoom、WaterBridgeRoom、StripedRoom，沿原权重16:8:1归一化。
 * 管道支持NORMAL/LARGE/GIANT；水桥NORMAL；条纹NORMAL/LARGE；不是完整原房型池。
 * 保留原版边界几何、闭环、支路、额外连接、门、普通房合并和 Patch 水草算法；
 * 未移植完整房间抽取池、特殊/秘密/商店房、教程隐藏门、感觉、陷阱、物品、NPC和装饰。
 * 内容池和随机调用数与原版不同，因此不承诺同种子地图与 Java 原版一致。
 * 上游的无界生成/闭环/Patch修正循环加有限上限；失败抛错，不生成替代地图。
 * 第5层为登记的网页布局适配：参考SewerBossLevel、SewerBossEntranceRoom、
 * SewerBossExitRoom与WalledGooRoom的空间/水巢，采用固定连接拓扑；不宣称FigureEight等价。
 */

import { Random } from '../engine/random';
import { Tile, solid, type Grid, type TileId } from './terrain';

export interface GeneratedFloor extends Grid {
  entrance: number;
  exit: number;
  rooms: { left: number; top: number; right: number; bottom: number; kind: string }[];
  /** 仅供初始 populate 使用：桥的水带矩形（含桥面）不得放置物品或角色，不入存档。 */
  blockedPlacementCells: number[];
  /** 第5层Goo出生点；初始化角色后应移除该字段，不属于楼层保存结构。 */
  bossSpawn?: number;
}

type Point = { x: number; y: number };
type RoomKind = 'entrance' | 'exit' | 'empty' | 'tunnel' | 'striped' | 'water-bridge' | 'sewer-pipe';
type Direction = 'left' | 'top' | 'right' | 'bottom';
const f = Math.fround;
const gate = (min: number, value: number, max: number): number => Math.max(min, Math.min(max, value));
const DOOR_EMPTY = 0, DOOR_TUNNEL = 1, DOOR_WATER = 2, DOOR_REGULAR = 3, DOOR_UNLOCKED = 4;
type Door = Point & { type: number };

/** Rect 的边长是差值；只有 Room 在右、下边界计入最后一个格子。 */
class Rect {
  constructor(public left = 0, public top = 0, public right = 0, public bottom = 0) {}
  width(): number { return this.right - this.left; }
  height(): number { return this.bottom - this.top; }
  isEmpty(): boolean { return this.right <= this.left || this.bottom <= this.top; }
  set(left: number, top: number, right: number, bottom: number): void {
    this.left = left; this.top = top; this.right = right; this.bottom = bottom;
  }
  setPos(x: number, y: number): void {
    this.set(x, y, x + this.right - this.left, y + this.bottom - this.top);
  }
  shift(x: number, y: number): void { this.set(this.left+x, this.top+y, this.right+x, this.bottom+y); }
  resize(width: number, height: number): void {
    this.right = this.left + width; this.bottom = this.top + height;
  }
  intersect(other: Rect): Rect {
    return new Rect(Math.max(this.left, other.left), Math.max(this.top, other.top),
      Math.min(this.right, other.right), Math.min(this.bottom, other.bottom));
  }
  points(): Point[] {
    const result: Point[] = [];
    for (let x=this.left; x<=this.right; x++) {
      for (let y=this.top; y<=this.bottom; y++) result.push({ x, y });
    }
    return result;
  }
}

class Room extends Rect {
  neighbours: Room[] = [];
  connected = new Map<Room, Door | null>();
  private sizeCategory: 0 | 1 | 2 = 0;
  constructor(readonly kind: RoomKind, random?: Random) {
    super();
    // StandardRoom构造时先选一次尺寸；RegularLevel随后按剩余配额重新选择。
    if (this.standard && random) this.setSizeCategory(random);
  }
  override width(): number { return super.width()+1; }
  override height(): number { return super.height()+1; }
  get standard(): boolean { return this.kind !== 'tunnel'; }
  setSizeCategory(random: Random, maxRoomValue = 3): boolean {
    const weights = this.kind === 'sewer-pipe' ? [3, 2, 1] : this.kind === 'striped' ? [2, 1, 0] : [1, 0, 0];
    for (let i=maxRoomValue; i<weights.length; i++) weights[i] = 0;
    const category = random.weighted(weights);
    if (category < 0) return false;
    this.sizeCategory = category as 0 | 1 | 2;
    return true;
  }
  sizeFactor(): number { return this.sizeCategory+1; }
  connectionWeight(): number { return this.standard ? this.sizeFactor() ** 2 : 1; }
  minDimension(): number {
    if (this.kind === 'tunnel') return 3;
    if (this.sizeCategory === 2) return 14;
    if (this.sizeCategory === 1) return 10;
    if (this.kind === 'sewer-pipe') return 7;
    return this.kind === 'empty' || this.kind === 'striped' ? 4 : 5;
  }
  maxDimension(): number { return this.sizeCategory === 2 ? 18 : this.sizeCategory === 1 ? 14 : 10; }
  setSize(random: Random): void {
    const min = this.minDimension(), max = this.maxDimension();
    this.resize(random.normalInt(min, max)-1, random.normalInt(min, max)-1);
  }
  setSizeWithLimit(random: Random, width: number, height: number): boolean {
    if (width < this.minDimension() || height < this.minDimension()) return false;
    this.setSize(random);
    if (this.width()>width || this.height()>height) {
      this.resize(Math.min(this.width(), width)-1, Math.min(this.height(), height)-1);
    }
    return true;
  }
  randomPoint(random: Random, margin: number): Point {
    return { x: random.range(this.left+margin, this.right-margin),
      y: random.range(this.top+margin, this.bottom-margin) };
  }
  private connectionDirection(other: Room): Direction | null {
    const overlap = this.intersect(other);
    if (overlap.width() === 0 && overlap.left === this.left) return 'left';
    if (overlap.height() === 0 && overlap.top === this.top) return 'top';
    if (overlap.width() === 0 && overlap.right === this.right) return 'right';
    if (overlap.height() === 0 && overlap.bottom === this.bottom) return 'bottom';
    return null;
  }
  private hasConnectionSpace(direction: Direction): boolean {
    if (this.connected.size >= 16) return false;
    let count = 0;
    for (const other of this.connected.keys()) {
      if (this.connectionDirection(other) === direction) count++;
    }
    return count < 4;
  }
  canConnectPoint(point: Point): boolean {
    const edge = (point.x === this.left || point.x === this.right) !==
      (point.y === this.top || point.y === this.bottom);
    return edge && (this.kind !== 'sewer-pipe' ||
      ((point.x > this.left+1 && point.x < this.right-1) || (point.y > this.top+1 && point.y < this.bottom-1)));
  }
  canConnect(other: Room): boolean {
    if ((this.kind === 'entrance' && other.kind === 'exit') ||
      (this.kind === 'exit' && other.kind === 'entrance')) return false;
    const overlap = this.intersect(other);
    if (!overlap.points().some(point => this.canConnectPoint(point) && other.canConnectPoint(point))) return false;
    const direction = this.connectionDirection(other), reverse = other.connectionDirection(this);
    return direction !== null && reverse !== null &&
      this.hasConnectionSpace(direction) && other.hasConnectionSpace(reverse);
  }
  addNeighbour(other: Room): boolean {
    if (this.neighbours.includes(other)) return true;
    const overlap = this.intersect(other);
    if ((overlap.width() === 0 && overlap.height() >= 2) ||
      (overlap.height() === 0 && overlap.width() >= 2)) {
      this.neighbours.push(other); other.neighbours.push(this); return true;
    }
    return false;
  }
  connect(other: Room): boolean {
    if ((this.neighbours.includes(other) || this.addNeighbour(other)) &&
      !this.connected.has(other) && this.canConnect(other)) {
      this.connected.set(other, null); other.connected.set(this, null); return true;
    }
    return false;
  }
  clearConnections(): void {
    for (const other of this.neighbours) other.neighbours = other.neighbours.filter(room => room !== this);
    this.neighbours = [];
    for (const other of this.connected.keys()) other.connected.delete(this);
    this.connected.clear();
  }
  canMerge(grid: Grid, point: Point): boolean {
    if (!this.standard || this.kind === 'entrance' || this.kind === 'sewer-pipe') return false;
    const inside = { ...point };
    if (point.x === this.left) inside.x++;
    else if (point.x === this.right) inside.x--;
    else if (point.y === this.top) inside.y++;
    else if (point.y === this.bottom) inside.y--;
    const tile = grid.tiles[inside.x + inside.y*grid.width]!;
    return this.kind === 'water-bridge' ? tile !== Tile.Water : !solid(tile);
  }
}

// Builder.findFreeSpace：逐一排除碰撞，不另设栅格房间模板。
function findFreeSpace(random: Random, start: Point, collisions: Room[], maxSize: number): Rect {
  const space = new Rect(start.x-maxSize, start.y-maxSize, start.x+maxSize, start.y+maxSize);
  let colliding = [...collisions];
  while (colliding.length > 0) {
    colliding = colliding.filter(room => !room.isEmpty() &&
      Math.max(space.left, room.left) < Math.min(space.right, room.right) &&
      Math.max(space.top, room.top) < Math.min(space.bottom, room.bottom));
    let closest: Room | null = null, closestDistance = Infinity;
    for (const room of colliding) {
      let dx = 0, dy = 0, inside = true;
      if (start.x <= room.left) { inside = false; dx = room.left-start.x; }
      else if (start.x >= room.right) { inside = false; dx = start.x-room.right; }
      if (start.y <= room.top) { inside = false; dy = room.top-start.y; }
      else if (start.y >= room.bottom) { inside = false; dy = start.y-room.bottom; }
      if (inside) return new Rect(start.x, start.y, start.x, start.y);
      const distance = Math.hypot(dx, dy);
      if (distance < closestDistance) { closest = room; closestDistance = distance; }
    }
    if (!closest) break;
    let widthLoss = Infinity, heightLoss = Infinity;
    if (closest.left >= start.x) widthLoss = (space.right-closest.left)*(space.height()+1);
    else if (closest.right <= start.x) widthLoss = (closest.right-space.left)*(space.height()+1);
    if (closest.top >= start.y) heightLoss = (space.bottom-closest.top)*(space.width()+1);
    else if (closest.bottom <= start.y) heightLoss = (closest.bottom-space.top)*(space.width()+1);
    if (widthLoss < heightLoss || (widthLoss === heightLoss && random.int(2) === 0)) {
      if (closest.left >= start.x && closest.left < space.right) space.right = closest.left;
      if (closest.right <= start.x && closest.right > space.left) space.left = closest.right;
    } else {
      if (closest.top >= start.y && closest.top < space.bottom) space.bottom = closest.top;
      if (closest.bottom <= start.y && closest.bottom > space.top) space.top = closest.bottom;
    }
    colliding = colliding.filter(room => room !== closest);
  }
  return space;
}

const DEGREES = 180 / Math.PI;
function roomCenter(room: Room): Point {
  return { x: (room.left+room.right)/2, y: (room.top+room.bottom)/2 };
}
function angleBetweenPoints(from: Point, to: Point): number {
  const slope = f(f(to.y-from.y)/f(to.x-from.x));
  let angle = f(DEGREES * (Math.atan(slope) + Math.PI/2));
  if (from.x > to.x) angle = f(angle-180);
  return angle;
}
function angleBetweenRooms(from: Room, to: Room): number {
  return angleBetweenPoints(roomCenter(from), roomCenter(to));
}

// Builder.placeRoom：以上个房间边缘为连接基准，保留角度与可用空间修正。
function placeRoom(random: Random, collisions: Room[], previous: Room, next: Room, requestedAngle: number): number {
  let angle = f(requestedAngle % 360);
  if (angle < 0) angle = f(angle+360);
  if (!Number.isFinite(angle)) return -1;
  const center = roomCenter(previous);
  const slope = Math.tan(angle/DEGREES + Math.PI/2);
  const intercept = center.y-slope*center.x;
  let start: Point, direction: Direction;
  if (Math.abs(slope) >= 1) {
    if (angle < 90 || angle > 270) {
      direction = 'top'; start = { x: Math.round((previous.top-intercept)/slope), y: previous.top };
    } else {
      direction = 'bottom'; start = { x: Math.round((previous.bottom-intercept)/slope), y: previous.bottom };
    }
  } else if (angle < 180) {
    direction = 'right'; start = { x: previous.right, y: Math.round(slope*previous.right+intercept) };
  } else {
    direction = 'left'; start = { x: previous.left, y: Math.round(slope*previous.left+intercept) };
  }
  if (direction === 'top' || direction === 'bottom') start.x = gate(previous.left+1, start.x, previous.right-1);
  else start.y = gate(previous.top+1, start.y, previous.bottom-1);

  const space = findFreeSpace(random, start, collisions, next.maxDimension());
  if (!next.setSizeWithLimit(random, space.width()+1, space.height()+1)) return -1;
  if (direction === 'top' || direction === 'bottom') {
    const y = direction === 'top' ? previous.top-(next.height()-1)/2 : previous.bottom+(next.height()-1)/2;
    const x = f((y-intercept)/slope);
    next.setPos(Math.round(f(x-(next.width()-1)/2)), direction === 'top' ? previous.top-next.height()+1 : previous.bottom);
    if (next.right < previous.left+2) next.shift(previous.left+2-next.right, 0);
    else if (next.left > previous.right-2) next.shift(previous.right-2-next.left, 0);
    if (next.right > space.right) next.shift(space.right-next.right, 0);
    else if (next.left < space.left) next.shift(space.left-next.left, 0);
  } else {
    const x = direction === 'right' ? previous.right+(next.width()-1)/2 : previous.left-(next.width()-1)/2;
    const y = f(slope*x+intercept);
    next.setPos(direction === 'right' ? previous.right : previous.left-next.width()+1,
      Math.round(f(y-(next.height()-1)/2)));
    if (next.bottom < previous.top+2) next.shift(0, previous.top+2-next.bottom);
    else if (next.top > previous.bottom-2) next.shift(0, previous.bottom-2-next.top);
    if (next.bottom > space.bottom) next.shift(0, space.bottom-next.bottom);
    else if (next.top < space.top) next.shift(0, space.top-next.top);
  }
  return next.connect(previous) ? angleBetweenRooms(previous, next) : -1;
}

/** RegularBuilder：大房占多份房间配额，连接抽取权重为sizeFactor的平方。 */
class RegularBuilder {
  protected entrance: Room | null = null;
  protected exit: Room | null = null;
  protected mainPath: Room[] = [];
  protected multiConnections: Room[] = [];
  protected singleConnections: Room[] = [];
  protected readonly pathTunnels = [2, 2, 1];
  protected readonly branchTunnels = [1, 1, 0];
  constructor(protected readonly random: Random) {}
  protected setupRooms(rooms: Room[]): void {
    this.entrance = this.exit = null;
    this.mainPath = []; this.multiConnections = []; this.singleConnections = [];
    for (const room of rooms) {
      room.set(0, 0, 0, 0);
      if (room.kind === 'entrance') this.entrance = room;
      else if (room.kind === 'exit') this.exit = room;
      else this.multiConnections.push(room);
    }
    // 上游先按连接权重重复引用、洗牌、去重，再洗牌。
    this.weightRooms(this.multiConnections);
    this.random.shuffleList(this.multiConnections);
    this.multiConnections = [...new Set(this.multiConnections)];
    this.random.shuffleList(this.multiConnections);
    let remaining = Math.trunc(this.multiConnections.length * 0.25) + this.random.weighted([0, 0, 0, 1]);
    while (remaining > 0 && this.multiConnections.length > 0) {
      const room = this.multiConnections.shift()!;
      this.mainPath.push(room); remaining -= room.sizeFactor();
    }
  }
  protected weightRooms(rooms: Room[]): void {
    for (const room of [...rooms]) {
      for (let i=1; i<room.connectionWeight(); i++) rooms.push(room);
    }
  }
  protected randomBranchAngle(_room: Room): number { return this.random.float(360); }
  protected createBranches(rooms: Room[], branchable: Room[], toBranch: Room[]): boolean {
    let index = 0, failures = 0, chances = [...this.branchTunnels];
    while (index < toBranch.length) {
      if (failures > 100) return false;
      const room = toBranch[index]!, connections: Room[] = [];
      let current = this.random.choose(branchable);
      let count = this.random.weighted(chances);
      if (count === -1) { chances = [...this.branchTunnels]; count = this.random.weighted(chances); }
      chances[count] = chances[count]! - 1;
      for (let i=0; i<count; i++) {
        const tunnel = new Room('tunnel');
        let angle = -1;
        for (let tries=0; tries<3 && angle === -1; tries++) {
          angle = placeRoom(this.random, rooms, current, tunnel, this.randomBranchAngle(current));
        }
        if (angle === -1) {
          tunnel.clearConnections();
          this.removeBranch(rooms, connections); connections.length = 0; break;
        }
        connections.push(tunnel); rooms.push(tunnel); current = tunnel;
      }
      if (connections.length !== count) { failures++; continue; }
      let angle = -1;
      for (let tries=0; tries<10 && angle === -1; tries++) {
        angle = placeRoom(this.random, rooms, current, room, this.randomBranchAngle(current));
      }
      if (angle === -1) {
        room.clearConnections(); this.removeBranch(rooms, connections); failures++; continue;
      }
      for (const tunnel of connections) if (this.random.int(3) <= 1) branchable.push(tunnel);
      if (this.random.int(3) === 0) {
        for (let i=0; i<room.connectionWeight(); i++) branchable.push(room);
      }
      index++;
    }
    return true;
  }
  private removeBranch(rooms: Room[], connections: Room[]): void {
    for (const tunnel of connections) {
      tunnel.clearConnections();
      const index = rooms.indexOf(tunnel);
      if (index >= 0) rooms.splice(index, 1);
    }
  }
}

class LoopBuilder extends RegularBuilder {
  private loopCenter: Point | null = null;
  constructor(random: Random, private readonly intensity: number, private readonly offset: number) { super(random); }
  private targetAngle(percent: number): number {
    const x = f(percent+this.offset);
    const curve = Math.pow(4, 4)*Math.pow(x%0.5-0.25, 5) + 0.25 + 0.5*Math.floor(2*x);
    return f(360*f(this.intensity*curve + f(f(1-this.intensity)*x) - this.offset));
  }
  build(rooms: Room[]): Room[] | null {
    this.setupRooms(rooms);
    if (!this.entrance) return null;
    const entrance = this.entrance;
    entrance.setSize(this.random); entrance.setPos(0, 0);
    const startAngle = this.random.floatRange(0, 360);
    this.mainPath.unshift(entrance);
    if (this.exit) this.mainPath.splice(Math.trunc((this.mainPath.length+1)/2), 0, this.exit);
    const loop: Room[] = [];
    let pathTunnels = [...this.pathTunnels];
    for (const room of this.mainPath) {
      loop.push(room);
      let count = this.random.weighted(pathTunnels);
      if (count === -1) { pathTunnels = [...this.pathTunnels]; count = this.random.weighted(pathTunnels); }
      pathTunnels[count] = pathTunnels[count]! - 1;
      for (let i=0; i<count; i++) loop.push(new Room('tunnel'));
    }
    let previous = entrance;
    for (let i=1; i<loop.length; i++) {
      const room = loop[i]!;
      const angle = f(startAngle+this.targetAngle(f(i/loop.length)));
      if (placeRoom(this.random, rooms, previous, room, angle) === -1) return null;
      previous = room;
      if (!rooms.includes(room)) rooms.push(room);
    }
    let closingTunnels = 0;
    while (!previous.connect(entrance)) {
      // 原版依赖几何随机成功；网页端有限终止，交给外层重试，不换算法。
      if (closingTunnels++ >= 128) return null;
      const tunnel = new Room('tunnel');
      if (placeRoom(this.random, loop, previous, tunnel, angleBetweenRooms(previous, entrance)) === -1) return null;
      loop.push(tunnel); rooms.push(tunnel); previous = tunnel;
    }
    this.loopCenter = { x: 0, y: 0 };
    for (const room of loop) {
      this.loopCenter.x = f(this.loopCenter.x+(room.left+room.right)/2);
      this.loopCenter.y = f(this.loopCenter.y+(room.top+room.bottom)/2);
    }
    this.loopCenter.x = f(this.loopCenter.x/loop.length);
    this.loopCenter.y = f(this.loopCenter.y/loop.length);
    const branchable = [...loop];
    this.weightRooms(branchable);
    if (!this.createBranches(rooms, branchable, [...this.multiConnections, ...this.singleConnections])) return null;
    for (let i=0; i<rooms.length-1; i++) {
      for (let j=i+1; j<rooms.length; j++) rooms[i]!.addNeighbour(rooms[j]!);
    }
    for (const room of rooms) {
      for (const neighbour of room.neighbours) {
        if (!neighbour.connected.has(room) && this.random.float() < 0.30) room.connect(neighbour);
      }
    }
    return rooms;
  }
  protected override randomBranchAngle(room: Room): number {
    if (!this.loopCenter) return super.randomBranchAngle(room);
    let toCenter = angleBetweenPoints(roomCenter(room), this.loopCenter);
    if (toCenter < 0) toCenter = f(toCenter+360);
    let result = this.random.float(360);
    // 保留上游的一次初值加四次候选，而不是另改为最短角距离算法。
    for (let i=0; i<4; i++) {
      const candidate = this.random.float(360);
      if (Math.abs(toCenter-candidate) < Math.abs(toCenter-result)) result = candidate;
    }
    return result;
  }
}

function setTile(grid: Grid, point: Point, tile: TileId): void {
  grid.tiles[point.x + point.y*grid.width] = tile;
}
function fill(grid: Grid, left: number, top: number, width: number, height: number, tile: TileId): void {
  for (let y=top; y<top+height; y++) {
    for (let x=left; x<left+width; x++) grid.tiles[x+y*grid.width] = tile;
  }
}
function line(grid: Grid, from: Point, to: Point, tile: TileId = Tile.Floor): void {
  // TunnelRoom 只传入水平/竖直线段；按 Painter.drawLine 包含两端。
  const steps = Math.max(Math.abs(to.x-from.x), Math.abs(to.y-from.y));
  for (let i=0; i<=steps; i++) {
    setTile(grid, { x: from.x+Math.sign(to.x-from.x)*i, y: from.y+Math.sign(to.y-from.y)*i }, tile);
  }
}
function setDoorType(door: Door, type: number): void { if (type > door.type) door.type = type; }

function placeDoors(random: Random, room: Room): void {
  for (const [neighbour, door] of room.connected) {
    if (door) continue;
    const choices = room.intersect(neighbour).points()
      .filter(point => room.canConnectPoint(point) && neighbour.canConnectPoint(point));
    if (choices.length === 0) throw new Error('房间连接处没有可放置的门；首层生成失败。');
    const shared: Door = { ...random.choose(choices), type: DOOR_EMPTY };
    room.connected.set(neighbour, shared); neighbour.connected.set(room, shared);
  }
}

function paintTunnel(random: Random, grid: Grid, room: Room): void {
  const doors = [...room.connected.values()].map(door => {
    if (!door) throw new Error('通道缺少连接门；首层生成失败。');
    return door;
  });
  let sumX = 0, sumY = 0;
  for (const door of doors) { sumX = f(sumX+door.x); sumY = f(sumY+door.y); }
  const center = { x: Math.trunc(Math.trunc(sumX)/doors.length), y: Math.trunc(Math.trunc(sumY)/doors.length) };
  if (random.float() < sumX%1) center.x++;
  if (random.float() < sumY%1) center.y++;
  center.x = gate(room.left+1, center.x, room.right-1);
  center.y = gate(room.top+1, center.y, room.bottom-1);
  for (const door of doors) {
    const start = { x: door.x, y: door.y };
    if (start.x === room.left) start.x++;
    else if (start.y === room.top) start.y++;
    else if (start.x === room.right) start.x--;
    else if (start.y === room.bottom) start.y--;
    const middle = door.x === room.left || door.x === room.right ?
      { x: center.x, y: start.y } : { x: start.x, y: center.y };
    line(grid, start, middle); line(grid, middle, center);
  }
  if (room.width() >= 7 && room.height() >= 7 && doors.length >= 4) {
    const cell = center.x + center.y*grid.width, width = grid.width;
    const circle = [-width-1, -width, -width+1, 1, width+1, width, width-1, -1];
    const offset = 2*random.int(4);
    if (grid.tiles[cell+circle[(offset+7)%8]!] === Tile.Floor &&
      grid.tiles[cell+circle[(offset+1)%8]!] === Tile.Floor) {
      grid.tiles[cell+circle[offset]!] = Tile.Floor;
    }
  }
  for (const door of doors) setDoorType(door, DOOR_TUNNEL);
}

function paintStripedRoom(random: Random, grid: Grid, room: Room): void {
  if (room.sizeFactor() === 1) {
    fill(grid, room.left+1, room.top+1, room.width()-2, room.height()-2, Tile.EmptySpecial);
    if (room.width() > room.height() || (room.width() === room.height() && random.int(2) === 0)) {
      for (let x=room.left+2; x<room.right; x+=2) {
        fill(grid, x, room.top+1, 1, room.height()-2, Tile.HighGrass);
      }
    } else {
      for (let y=room.top+2; y<room.bottom; y+=2) {
        fill(grid, room.left+1, y, room.width()-2, 1, Tile.HighGrass);
      }
    }
  } else {
    const layers = Math.trunc((Math.min(room.width(), room.height())-1)/2);
    for (let inset=1; inset<=layers; inset++) {
      fill(grid, room.left+inset, room.top+inset, room.width()-2*inset, room.height()-2*inset,
        inset%2 === 1 ? Tile.EmptySpecial : Tile.HighGrass);
    }
  }
}

function paintWaterBridge(random: Random, floor: GeneratedFloor, room: Room): void {
  const doors = [...room.connected.values()].map(door => {
    if (!door) throw new Error('水桥房缺少连接门；首层生成失败。');
    return door;
  });
  let doorsXY = Math.trunc((room.width()-room.height())/2);
  for (const door of doors) doorsXY += door.x === room.left || door.x === room.right ? 1 : -1;
  const vertical = doorsXY > 0 || (doorsXY === 0 && random.int(2) === 0);
  const points = doors.filter(door => vertical
    ? door.y === room.top || door.y === room.bottom
    : door.x === room.left || door.x === room.right).map(door => vertical ? door.x : door.y);
  points.push(vertical ? room.left+1 : room.top+1, vertical ? room.right-1 : room.bottom-1);
  points.sort((a, b) => a-b);
  let start = -1, end = -1;
  for (let i=0; i<points.length-1; i++) {
    // 严格增大才替换，最大间隔并列时沿原版保留第一个。
    if (end-start < points[i+1]!-points[i]!) { start = points[i]!; end = points[i+1]!; }
  }
  const dimension = vertical ? room.width() : room.height();
  const maxWidth = dimension >= 8 ? 3 : 2;
  while (end-start > maxWidth+1) {
    if (random.int(2) === 0) start++;
    else end--;
  }
  // Rect不包含右/下边，与Room的包含边界语义不同。
  const space = vertical ? new Rect(start+1, room.top+1, end, room.bottom)
    : new Rect(room.left+1, start+1, room.right, end);
  const bridgeAt = vertical ? random.normalInt(space.top+1, space.bottom-2)
    : random.normalInt(space.left+1, space.right-2);
  const bridge = vertical ? new Rect(space.left, bridgeAt, space.right, bridgeAt+1)
    : new Rect(bridgeAt, space.top, bridgeAt+1, space.bottom);
  fill(floor, space.left, space.top, space.width(), space.height(), Tile.Water);
  fill(floor, bridge.left, bridge.top, bridge.width(), bridge.height(), Tile.EmptySpecial);
  // StandardBridgeRoom禁止在整个水带矩形内初始放置角色/物品，桥面同样排除。
  for (let x=space.left; x<space.right; x++) {
    for (let y=space.top; y<space.bottom; y++) floor.blockedPlacementCells.push(x+y*floor.width);
  }
}

/** SewerPipeRoom：以水槽连接门点，外扩一格干地，宽房沿周边接最短通路。 */
function paintSewerPipe(random: Random, floor: GeneratedFloor, room: Room): void {
  fill(floor, room.left, room.top, room.width(), room.height(), Tile.Wall);
  const doors = [...room.connected.values()].map(door => {
    if (!door) throw new Error('管道房缺少连接门。');
    return door;
  });
  let center: Point;
  if (doors.length <= 1) {
    center = { x: Math.trunc((room.left+room.right)/2) + (room.width()%2 === 0 ? random.int(2) : 0),
      y: Math.trunc((room.top+room.bottom)/2) + (room.height()%2 === 0 ? random.int(2) : 0) };
  } else {
    let sumX = 0, sumY = 0;
    for (const door of doors) { sumX = f(sumX+door.x); sumY = f(sumY+door.y); }
    center = { x: Math.trunc(Math.trunc(sumX)/doors.length), y: Math.trunc(Math.trunc(sumY)/doors.length) };
    if (random.float() < sumX%1) center.x++;
    if (random.float() < sumY%1) center.y++;
    center.x = gate(room.left+2, center.x, room.right-2);
    center.y = gate(room.top+2, center.y, room.bottom-2);
  }
  const inset = (door: Point): Point => {
    const point = { ...door };
    if (point.x === room.left) point.x += 2;
    else if (point.y === room.top) point.y += 2;
    else if (point.x === room.right) point.x -= 2;
    else point.y -= 2;
    return point;
  };
  const space = (a: number, b: number): number => Math.abs(a-b)-1;
  const corners = [
    { x: room.left+2, y: room.top+2 }, { x: room.right-2, y: room.top+2 },
    { x: room.right-2, y: room.bottom-2 }, { x: room.left+2, y: room.bottom-2 },
  ];
  const perimeterDistance = (a: Point, b: Point): number => {
    // 保留上游distanceBetweenPoints的门点比较与并列选择顺序。
    if (((a.x === room.left+2 || a.x === room.right-2) && a.y === b.y) ||
      ((a.y === room.top+2 || a.y === room.bottom-2) && a.x === b.x)) {
      return Math.max(space(a.x, b.x), space(a.y, b.y));
    }
    return Math.min(space(room.left, a.x)+space(room.left, b.x), space(room.right, a.x)+space(room.right, b.x))
      + Math.min(space(room.top, a.y)+space(room.top, b.y), space(room.bottom, a.y)+space(room.bottom, b.y))-1;
  };
  const fillBetween = (from: Point, to: Point): void => {
    if (((from.x === room.left+2 || from.x === room.right-2) && from.x === to.x) ||
      ((from.y === room.top+2 || from.y === room.bottom-2) && from.y === to.y)) {
      fill(floor, Math.min(from.x, to.x), Math.min(from.y, to.y), space(from.x, to.x)+2, space(from.y, to.y)+2, Tile.Water);
      return;
    }
    for (const corner of corners) {
      if ((corner.x === from.x || corner.y === from.y) && (corner.x === to.x || corner.y === to.y)) {
        line(floor, from, corner, Tile.Water); line(floor, corner, to, Tile.Water); return;
      }
    }
    let side: Point;
    if (from.y === room.top+2 || from.y === room.bottom-2) {
      side = { x: space(room.left, from.x)+space(room.left, to.x) <= space(room.right, from.x)+space(room.right, to.x)
        ? room.left+2 : room.right-2, y: room.top+Math.trunc(room.height()/2) };
    } else {
      side = { x: room.left+Math.trunc(room.width()/2),
        y: space(room.top, from.y)+space(room.top, to.y) <= space(room.bottom, from.y)+space(room.bottom, to.y)
          ? room.top+2 : room.bottom-2 };
    }
    fillBetween(from, side); fillBetween(side, to);
  };
  if (doors.length === 1 || (doors.length === 2 && room.sizeFactor() === 1)) {
    for (const door of doors) {
      const start = inset(door), middle = door.x === room.left || door.x === room.right
        ? { x: center.x, y: start.y } : { x: start.x, y: center.y };
      line(floor, start, middle, Tile.Water); line(floor, middle, center, Tile.Water);
    }
  } else {
    const doorPoints: Point[] = doors.map(door => ({ x: door.x, y: door.y }));
    if (doorPoints.length === 2) {
      let phantom: Point | undefined;
      for (let tries=0; tries<256; tries++) {
        const point = random.int(2) === 0
          ? { x: random.int(2) === 0 ? room.left : room.right, y: random.range(room.top+2, room.bottom-2) }
          : { x: random.range(room.left+2, room.right-2), y: random.int(2) === 0 ? room.top : room.bottom };
        if (doors.every(door => door.x !== point.x && door.y !== point.y)) { phantom = point; break; }
      }
      if (!phantom) throw new Error('管道房无法生成第三个连接参考点。');
      doorPoints.push(phantom);
    }
    const pending = doorPoints.map(inset), filled = [pending.shift()!];
    while (pending.length) {
      let distance = Infinity, from = filled[0]!, chosen = 0;
      for (const source of filled) for (let index=0; index<pending.length; index++) {
        const candidate = perimeterDistance(source, pending[index]!);
        if (candidate < distance) { distance = candidate; from = source; chosen = index; }
      }
      const to = pending.splice(chosen, 1)[0]!;
      fillBetween(from, to); filled.push(to);
    }
  }
  for (const point of room.points()) {
    const cell = point.x+point.y*floor.width;
    if (floor.tiles[cell] !== Tile.Water) continue;
    for (const offset of [-floor.width-1, -floor.width, -floor.width+1, -1, 1, floor.width-1, floor.width, floor.width+1]) {
      if (floor.tiles[cell+offset] === Tile.Wall) floor.tiles[cell+offset] = Tile.Floor;
    }
  }
  for (const [other, door] of room.connected) {
    if (!door) continue;
    if (other.kind === 'sewer-pipe') {
      fill(floor, door.x-1, door.y-1, 3, 3, Tile.Floor);
      if (door.x === room.left || door.x === room.right) fill(floor, door.x-1, door.y, 3, 1, Tile.Water);
      else fill(floor, door.x, door.y-1, 1, 3, Tile.Water);
      setDoorType(door, DOOR_WATER);
    } else setDoorType(door, DOOR_REGULAR);
  }
}

function paintRoom(random: Random, floor: GeneratedFloor, room: Room): void {
  if (room.kind === 'tunnel') { paintTunnel(random, floor, room); return; }
  if (room.kind === 'sewer-pipe') { paintSewerPipe(random, floor, room); return; }
  fill(floor, room.left, room.top, room.width(), room.height(), Tile.Wall);
  fill(floor, room.left+1, room.top+1, room.width()-2, room.height()-2, Tile.Floor);
  for (const door of room.connected.values()) if (door) setDoorType(door, DOOR_REGULAR);
  if (room.kind === 'striped') paintStripedRoom(random, floor, room);
  else if (room.kind === 'water-bridge') paintWaterBridge(random, floor, room);
  else if (room.kind === 'entrance' || room.kind === 'exit') {
    const point = room.randomPoint(random, 2), cell = point.x+point.y*floor.width;
    if (room.kind === 'entrance') { floor.entrance = cell; floor.tiles[cell] = Tile.Entrance; }
    else { floor.exit = cell; floor.tiles[cell] = Tile.Exit; }
  }
}

function mergeRooms(grid: Grid, room: Room, neighbour: Room, door: Door): boolean {
  const overlap = room.intersect(neighbour);
  const terrain = room.kind === 'striped' && neighbour.kind === 'striped' ? Tile.EmptySpecial : Tile.Floor;
  if (overlap.left === overlap.right) {
    let top = door.y, bottom = door.y;
    const point = { x: overlap.left, y: top };
    while (top > overlap.top && neighbour.canMerge(grid, point) && room.canMerge(grid, point)) { top--; point.y--; }
    point.y = bottom;
    while (bottom < overlap.bottom && neighbour.canMerge(grid, point) && room.canMerge(grid, point)) { bottom++; point.y++; }
    if (bottom-top < 3) return false;
    fill(grid, overlap.left, top+1, 1, bottom-top-1, terrain); return true;
  }
  if (overlap.top === overlap.bottom) {
    let left = door.x, right = door.x;
    const point = { x: left, y: overlap.top };
    while (left > overlap.left && neighbour.canMerge(grid, point) && room.canMerge(grid, point)) { left--; point.x--; }
    point.x = right;
    while (right < overlap.right && neighbour.canMerge(grid, point) && room.canMerge(grid, point)) { right++; point.x++; }
    if (right-left < 3) return false;
    fill(grid, left+1, overlap.top, right-left-1, 1, terrain); return true;
  }
  return false;
}

function paintDoors(random: Random, grid: Grid, rooms: Room[]): void {
  const merged = new Map<Room, Room>();
  for (const room of rooms) {
    for (const [neighbour, door] of room.connected) {
      if (!door) throw new Error('房间缺少共享门；首层生成失败。');
      if (merged.get(room) === neighbour || merged.get(neighbour) === room) continue;
      if (!merged.has(room) && !merged.has(neighbour) && mergeRooms(grid, room, neighbour, door)) {
        // NORMAL房至多合并一次；较大条纹房保留原版允许多次合并的规则。
        if (room.sizeFactor() === 1) merged.set(room, neighbour);
        if (neighbour.sizeFactor() === 1) merged.set(neighbour, room);
        continue;
      }
      if (door.type === DOOR_REGULAR) {
        // 首层正常模式的 hiddenDoorChance 为0；仍消耗上游此处的一次随机抽取。
        random.float(); door.type = DOOR_UNLOCKED;
      }
      setTile(grid, door, door.type === DOOR_UNLOCKED ? Tile.Door : door.type === DOOR_WATER ? Tile.Water : Tile.Floor);
    }
  }
}

/** Patch.generate：保留多数滤波、初始密度修正和最终按相邻块增减密度。 */
function patch(random: Random, width: number, height: number, requestedFill: number, clustering: number): boolean[] {
  const length = width*height;
  let current = new Array<boolean>(length).fill(false), previous = new Array<boolean>(length).fill(false);
  const fillRate = f(requestedFill);
  let difference = -Math.round(f(length*fillRate));
  const seedFill = clustering > 0 ? f(fillRate+f(f(0.5-fillRate)*0.5)) : fillRate;
  for (let i=0; i<length; i++) {
    previous[i] = random.float() < seedFill;
    if (previous[i]) difference++;
  }
  for (let round=0; round<clustering; round++) {
    for (let y=0; y<height; y++) {
      for (let x=0; x<width; x++) {
        let count = 0, neighbours = 0;
        for (let dy=-1; dy<=1; dy++) {
          for (let dx=-1; dx<=1; dx++) {
            if (x+dx<0 || x+dx>=width || y+dy<0 || y+dy>=height) continue;
            neighbours++;
            if (previous[x+dx+(y+dy)*width]) count++;
          }
        }
        const cell = x+y*width;
        current[cell] = 2*count >= neighbours;
        if (current[cell] !== previous[cell]) difference += current[cell] ? 1 : -1;
      }
    }
    [current, previous] = [previous, current];
  }
  if (Math.min(width, height) > 2) {
    const neighbours = [-width-1, -width, -width+1, -1, 0, 1, width-1, width, width+1];
    const growing = difference < 0;
    let rounds = 0;
    while (difference !== 0) {
      if (rounds++ >= length*20) throw new Error('水草区块密度修正未能完成；首层生成失败。');
      let cell: number, tries = 0;
      do {
        cell = 1+random.int(width-2)+(1+random.int(height-2))*width;
        tries++;
      } while (previous[cell] !== growing && tries*10 < length);
      for (const offset of neighbours) {
        if (difference !== 0 && previous[cell+offset] !== growing) {
          previous[cell+offset] = growing;
          difference += growing ? 1 : -1;
        }
      }
    }
  }
  return previous;
}

function paintNature(random: Random, grid: Grid, rooms: Room[]): void {
  const water = patch(random, grid.width, grid.height, 0.30, 5);
  for (const room of rooms) {
    if (room.kind === 'water-bridge' || room.kind === 'sewer-pipe') continue;
    for (const point of room.points()) {
      const cell = point.x+point.y*grid.width;
      if (water[cell] && grid.tiles[cell] === Tile.Floor) grid.tiles[cell] = Tile.Water;
    }
  }
  const grass = patch(random, grid.width, grid.height, 0.20, 4), cells: number[] = [];
  for (const room of rooms) {
    for (const point of room.points()) {
      const cell = point.x+point.y*grid.width;
      if (grass[cell] && grid.tiles[cell] === Tile.Floor) cells.push(cell);
    }
  }
  const w = grid.width, neighbours = [-w-1, -w, -w+1, -1, 1, w-1, w, w+1];
  for (const cell of cells) {
    let count = 1;
    for (const offset of neighbours) if (grass[cell+offset]) count++;
    grid.tiles[cell] = random.float() < f(count/12) ? Tile.HighGrass : Tile.Grass;
  }
}

function paintFloor(random: Random, rooms: Room[]): GeneratedFloor {
  const leftMost = Math.min(...rooms.map(room => room.left))-1;
  const topMost = Math.min(...rooms.map(room => room.top))-1;
  let rightMost = 0, bottomMost = 0;
  for (const room of rooms) {
    room.shift(-leftMost, -topMost);
    rightMost = Math.max(rightMost, room.right); bottomMost = Math.max(bottomMost, room.bottom);
  }
  const width = rightMost+2, height = bottomMost+2;
  const floor: GeneratedFloor = { width, height, tiles: new Array<TileId>(width*height).fill(Tile.Wall),
    entrance: -1, exit: -1, rooms: [], blockedPlacementCells: [] };
  random.shuffleList(rooms);
  for (const room of rooms) {
    if (room.connected.size === 0) throw new Error('生成了没有连接的房间；首层生成失败。');
    placeDoors(random, room); paintRoom(random, floor, room);
  }
  paintDoors(random, floor, rooms);
  // 与 RegularPainter 相同，绘制方差使用子随机流，不改变后续敌人/掉落随机流。
  random.push(random.long());
  try { paintNature(random, floor, rooms); }
  finally { random.pop(); }
  floor.rooms = rooms.map(room => ({ left: room.left, top: room.top,
    right: room.right, bottom: room.bottom, kind: room.kind }));
  if (floor.entrance < 0 || floor.exit < 0) throw new Error('首层没有生成完整的上下楼梯。');
  return floor;
}

/** 首领层的网页拓扑适配。WalledGooRoom内部几何沿源码；整层连接不冒充FigureEightBuilder。 */
function generateBossFloor(random: Random): GeneratedFloor {
  const width = 35, height = 37;
  const floor: GeneratedFloor = { width, height, tiles: new Array<TileId>(width*height).fill(Tile.Wall),
    entrance: 17+31*width, exit: 17+5*width, bossSpawn: 17+18*width, rooms: [], blockedPlacementCells: [] };
  const room = (left: number, top: number, right: number, bottom: number, kind: string): void => {
    floor.rooms.push({ left, top, right, bottom, kind });
    fill(floor, left, top, right-left+1, bottom-top+1, Tile.Wall);
    fill(floor, left+1, top+1, right-left-1, bottom-top-1, Tile.Floor);
  };
  room(13, 27, 21, 35, 'entrance');
  // SewerBossEntranceRoom顶部装饰墙/水带；WALL_DECO在本项目仍使用同阻挡性的Wall。
  fill(floor, 14, 28, 7, 1, Tile.Wall); fill(floor, 14, 29, 7, 1, Tile.Water);
  room(13, 1, 21, 9, 'exit');
  // SewerBossExitRoom的台阶基座；未实现多格转场区，中心Exit由World控制首领前不可使用。
  fill(floor, 16, 4, 3, 2, Tile.Wall); fill(floor, 16, 6, 3, 1, Tile.EmptySpecial);
  room(1, 3, 9, 11, 'empty'); room(1, 14, 9, 22, 'empty'); room(25, 14, 33, 22, 'empty');
  fill(floor, 2, 4, 7, 1, Tile.Water); fill(floor, 2, 21, 7, 1, Tile.Water);
  fill(floor, 26, 15, 7, 1, Tile.Water);

  const left = 11, top = 12, right = 23, bottom = 24, roomWidth = 13, roomHeight = 13;
  room(left, top, right, bottom, 'goo-walled');
  fill(floor, left+1, top+1, roomWidth-2, roomHeight-2, Tile.EmptySpecial);
  fill(floor, left+2, top+2, roomWidth-4, roomHeight-4, Tile.Floor);
  // WalledGooRoom四个L形石墙与中央十字水巢，供绕墙躲蓄力、引离水面使用。
  const pillarW = Math.trunc((roomWidth-6)/2), pillarH = Math.trunc((roomHeight-6)/2);
  fill(floor, left+2, top+2, pillarW, 1, Tile.Wall); fill(floor, left+2, top+2, 1, pillarH, Tile.Wall);
  fill(floor, left+2, bottom-2, pillarW, 1, Tile.Wall); fill(floor, left+2, bottom-1-pillarH, 1, pillarH, Tile.Wall);
  fill(floor, right-1-pillarW, top+2, pillarW, 1, Tile.Wall); fill(floor, right-2, top+2, 1, pillarH, Tile.Wall);
  fill(floor, right-1-pillarW, bottom-2, pillarW, 1, Tile.Wall); fill(floor, right-2, bottom-1-pillarH, 1, pillarH, Tile.Wall);
  fill(floor, left+Math.trunc(roomWidth/2)-1, top+Math.trunc(roomHeight/2)-2, 2+roomWidth%2, 4+roomHeight%2, Tile.Water);
  fill(floor, left+Math.trunc(roomWidth/2)-2, top+Math.trunc(roomHeight/2)-1, 4+roomWidth%2, 2+roomHeight%2, Tile.Water);

  // 两条路线形成绕行：正面穿过水巢，西侧可绕至出口室；首领锁定由World统一处理。
  const corridor = (from: Point, to: Point): void => {
    line(floor, from, to);
    floor.rooms.push({ left: Math.min(from.x, to.x)-1, top: Math.min(from.y, to.y)-1,
      right: Math.max(from.x, to.x)+1, bottom: Math.max(from.y, to.y)+1, kind: 'tunnel' });
  };
  corridor({ x: 17, y: 24 }, { x: 17, y: 29 });
  corridor({ x: 17, y: 9 }, { x: 17, y: 12 });
  corridor({ x: 9, y: 18 }, { x: 11, y: 18 });
  corridor({ x: 23, y: 18 }, { x: 25, y: 18 });
  corridor({ x: 5, y: 11 }, { x: 5, y: 14 });
  corridor({ x: 9, y: 6 }, { x: 13, y: 6 });
  for (const [x, y] of [[17, 24], [17, 27], [17, 9], [17, 12], [9, 18], [11, 18], [23, 18], [25, 18], [5, 11], [5, 14], [9, 6], [13, 6]]) {
    floor.tiles[x!+y!*width] = Tile.Door;
  }
  floor.tiles[floor.entrance] = Tile.Entrance; floor.tiles[floor.exit] = Tile.Exit;
  // 固定拓扑的左右镜像提供两个方向变体；不影响任何回合或怪物参数。
  if (random.int(2) === 0) {
    for (let y=0; y<height; y++) {
      for (let x=0; x<Math.trunc(width/2); x++) {
        const a = x+y*width, b = width-1-x+y*width;
        [floor.tiles[a], floor.tiles[b]] = [floor.tiles[b]!, floor.tiles[a]!];
      }
    }
    floor.rooms = floor.rooms.map(value => ({ ...value, left: width-1-value.right, right: width-1-value.left }));
  }
  return floor;
}

/** 第1—4层普通下水道子池，第5层为独立首领布局。 */
export function generateFloor(random: Random, depth: number): GeneratedFloor {
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) throw new Error('当前开放下水道第1—5层。');
  if (depth === 5) return generateBossFloor(random);
  const builder = new LoopBuilder(random, random.floatRange(0, 0.65), random.floatRange(0, 0.50));
  const initialRooms = [new Room('entrance', random), new Room('exit', random)];
  const count = 4+random.weighted([1, 3, 1]);
  for (let used=0; used<count;) {
    // StandardRoom.chances[1..4]中的原权重：管道16、水桥8、条纹1；只归一化已支持子池。
    const kind = (['sewer-pipe', 'water-bridge', 'striped'] as const)[random.weighted([16, 8, 1])]!;
    const room = new Room(kind, random);
    if (!room.setSizeCategory(random, count-used)) continue;
    used += room.sizeFactor(); initialRooms.push(room);
  }
  // 网页探索扩展：原普通房预算之外增加两间小房，由同一 LoopBuilder 连接。
  // 只影响新生成的1—4层；已保存地图不会重建，第5层首领场地保持原布局。
  initialRooms.push(new Room('empty', random), new Room('empty', random));
  random.shuffleList(initialRooms);
  for (let attempt=0; attempt<256; attempt++) {
    for (const room of initialRooms) { room.neighbours = []; room.connected.clear(); }
    const rooms = builder.build([...initialRooms]);
    if (rooms) return paintFloor(random, rooms);
  }
  throw new Error('下水道随机布局在256次尝试内未能闭环，请用新种子重试。');
}
