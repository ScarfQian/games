/* SPDX-License-Identifier: GPL-3.0-or-later
 * Canvas 平台适配：ScarfQian，2026-10-30。图形来源见 assets/catalog.json。
 * 画面时间只驱动过渡；本模块不推进回合、不抽取玩法随机数。
 */
import pelicanURL from '../../assets/pelican.svg';
import ratURL from '../../assets/upstream/rat.png';
import snakeURL from '../../assets/upstream/snake.png';
import gnollURL from '../../assets/upstream/gnoll.png';
import crabURL from '../../assets/upstream/crab.png';
import swarmURL from '../../assets/upstream/swarm.png';
import slimeURL from '../../assets/upstream/slime.png';
import gooURL from '../../assets/upstream/goo.png';
import itemsURL from '../../assets/upstream/items.png';
import sewerTilesURL from '../../assets/upstream/tiles-sewers.png';
import catalog from '../../assets/catalog.json';
import { Tile, distance } from '../game/terrain';
import { ballistics, STOP_TARGET, STOP_SOLID, IGNORE_SOFT_SOLID } from '../engine/ballistics';
import { ITEMS, type ItemKind } from '../game/items';
import { MOB_DEFINITIONS, type World } from '../game/world';
import type { Hero, Level, Mob, MobKind, WorldEvent } from '../game/model';
import { loadPelicanWalk } from './pelican';
import { TerrainCache } from './terrain';

export { pelicanURL, itemsURL };
export const ITEM_FRAMES = catalog.entries.find(entry => entry.sourceAssetId === 'SPD-ITEMS')!.frames! as Record<ItemKind, number[]>;
export const STEP_DURATION_MS = 160;
const MONSTER_URLS: Record<MobKind, string> = { 'spd:mob/rat': ratURL, 'spd:mob/snake': snakeURL,
  'spd:mob/gnoll': gnollURL, 'spd:mob/crab': crabURL, 'spd:mob/swarm': swarmURL, 'spd:mob/slime': slimeURL, 'spd:mob/goo': gooURL };
interface MonsterArt { frameSize: [number, number]; idleFPS: number;
  animationMap: { idle: number[]; move: number[]; attack: number[]; charge?: number[]; chargeAttack?: number[] } }
const MONSTER_ART = Object.fromEntries(Object.keys(MONSTER_URLS).map(kind => [kind,
  catalog.entries.find(entry => entry.sourceAssetId === 'SPD-MON-' + kind.split('/')[1]!.toUpperCase())])) as unknown as Record<MobKind, MonsterArt>;
interface Sprites { walk: HTMLImageElement[]; monsters: Record<MobKind, HTMLImageElement>; items: HTMLImageElement; sewerTiles: HTMLImageElement }
interface Motion { cells: number[]; start: number; duration: number; stride: number }
interface ActorPose { x: number; y: number; walking: boolean; phase: number; facing: number }
interface Effect extends WorldEvent { start: number; duration: number; lane: number; reactionDuration: number }
interface Defeated { actor: Mob; start: number; end: number }
interface HealthChange { actorId: number; start: number; before: number; after: number }
type StrikeStyle = 'blade' | 'thrust' | 'whip' | 'blunt';
interface DangerCell { cell: number; charged: boolean }
interface AimPreview { target: number; cells: number[]; complete: boolean; collision: number }
function strikeStyle(kind: ItemKind | undefined): StrikeStyle {
  if (kind === 'spd:weapon/whip') return 'whip';
  if (['spd:weapon/spear', 'spd:weapon/dagger', 'spd:weapon/dirk', 'spd:weapon/sai'].includes(kind ?? '')) return 'thrust';
  if (['spd:weapon/gloves', 'spd:weapon/quarterstaff', 'spd:weapon/mace', 'spd:weapon/round-shield'].includes(kind ?? '')) return 'blunt';
  return 'blade';
}
export async function loadSprites(): Promise<Sprites> {
  const load = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图形资源加载失败，请重新加载页面。'));
    image.src = url;
  });
  const [walk, monsters, items, sewerTiles] = await Promise.all([loadPelicanWalk(load),
    Promise.all(Object.entries(MONSTER_URLS).map(async ([kind, url]) => [kind, await load(url)] as const)), load(itemsURL), load(sewerTilesURL)]);
  return { walk, monsters: Object.fromEntries(monsters) as Record<MobKind, HTMLImageElement>, items, sewerTiles };
}

export class SceneRenderer {
  private context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private size = 40;
  private offsetX = 0;
  private offsetY = 0;
  private effects: Effect[] = [];
  private defeated: Defeated[] = [];
  private motions = new Map<number, Motion[]>();
  private health: HealthChange[] = [];
  private target: number | null = null;
  private focus: number | null = null;
  private zoom = 1;
  private readonly terrain = new TerrainCache();
  private cacheWorld: World | null = null;
  private cacheLevel: Level | null = null;
  private cacheRevision = -1;
  private dangers: DangerCell[] = [];
  private minimapImage: HTMLCanvasElement | null = null;
  private minimapScale = 1;
  private aimPreview: AimPreview | null = null;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(readonly canvas: HTMLCanvasElement, private sprites: Sprites) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建二维画布。');
    this.context = context;
  }
  setTarget(cell: number | null): void { this.target = cell; }
  setFocus(actorId: number | null): void { this.focus = actorId; }
  setZoom(value: number): void { this.zoom = Math.max(0.75, Math.min(1.5, value)); }
  reset(): void {
    this.effects = []; this.defeated = []; this.motions.clear(); this.health = []; this.target = null; this.focus = null;
    this.cacheWorld = null; this.cacheLevel = null; this.cacheRevision = -1;
    this.aimPreview = null; this.minimapImage = null; this.dangers = []; this.terrain.reset();
  }
  play(events: WorldEvent[], spent: number, before: readonly (Mob | Hero)[]): Promise<void> {
    const start = performance.now();
    const effectStart = this.effects.length, defeatedStart = this.defeated.length;
    const paths = new Map<number, Motion[]>(), available = new Map<number, number>(), impacts = new Map<number, number>();
    const targetImpacts = new Map<number, number>();
    const sources = new Map<number, number>(), hp = new Map(before.map(actor => [actor.id, actor.hp]));
    this.health = [];
    const opening = events.find(event => event.hero && (event.type === 'attack' || event.type === 'throw'));
    const lead = opening?.type === 'attack' ? 240 : opening?.type === 'throw' ? 260 : 0;
    let duration = spent > 0 ? STEP_DURATION_MS : 0, resolvedAt = 0;
    for (const [index, event] of events.entries()) {
      if (event.type === 'move' && event.actorId !== undefined && event.from !== undefined) {
        const id = event.actorId, segments = paths.get(id) ?? [], previous = segments.at(-1) ?? this.motions.get(id)?.at(-1);
        const offset = available.get(id) ?? (event.hero ? 0 : lead);
        const path: Motion = { cells: [event.from, event.cell], start: start + offset, duration: STEP_DURATION_MS,
          stride: previous ? previous.stride + previous.cells.length - 1 : 0 };
        segments.push(path); paths.set(id, segments);
        available.set(id, offset + STEP_DURATION_MS); duration = Math.max(duration, offset + STEP_DURATION_MS);
        continue;
      }
      let offset = event.sourceId === undefined ? resolvedAt : (impacts.get(event.sourceId) ?? resolvedAt), life = 750;
      if ((event.type === 'attack' || event.type === 'throw') && event.actorId !== undefined) {
        offset = available.get(event.actorId) ?? (event.hero ? 0 : lead);
        life = event.type === 'throw' ? 260 : 240;
        const windup = event.type === 'throw' ? life : 105, result = events[index + 1];
        // 吃饭等多回合动作可能同时出现原地攻击和走近后攻击；同目标命中按逻辑顺序错开。
        // 一并延后来源挥击，不能只排序血条，否则画面会先显示后一次结算。
        if (result?.actorId !== undefined && result.sourceId === event.actorId && ['hit', 'block', 'miss'].includes(result.type)) {
          const previous = targetImpacts.get(result.actorId);
          if (previous !== undefined) offset = Math.max(offset, previous + 60 - windup);
          targetImpacts.set(result.actorId, offset + windup);
        }
        available.set(event.actorId, offset + life);
        impacts.set(event.actorId, offset + windup);
        if (event.from !== undefined) sources.set(event.actorId, event.from);
        duration = Math.max(duration, offset + life);
      } else if (event.type === 'death' && !event.hero) {
        const actor = before.find(mob => mob.id === event.actorId);
        if (actor?.kind === 'mob') this.defeated.push({ actor: { ...actor, pos: event.cell }, start: start + offset, end: start + offset + 240 });
        duration = Math.max(duration, offset + 240);
      }
      // 同一个受击者的飘字分列；不改变怪物实际的行动顺序和耗时。
      const labels = ['hit', 'block', 'miss', 'heal', 'level-up'];
      if (labels.includes(event.type)) resolvedAt = Math.max(resolvedAt, offset);
      const lane = labels.includes(event.type) ? this.effects.filter(effect => labels.includes(effect.type)
        && effect.cell === event.cell && Math.abs(effect.start - start - offset) < 300).length : 0;
      const reactionDuration = ['hit', 'block', 'miss'].includes(event.type) ? 130 : 0;
      if (reactionDuration) duration = Math.max(duration, offset + reactionDuration);
      this.effects.push({ ...event, from: event.from ?? (event.sourceId === undefined ? undefined : sources.get(event.sourceId)),
        start: start + offset, duration: life, lane, reactionDuration });
      const actorId = event.actorId ?? (event.hero ? before.find(actor => actor.kind === 'hero')?.id : undefined);
      if (actorId !== undefined && hp.has(actorId) && event.hp !== undefined) {
        targetImpacts.set(actorId, Math.max(targetImpacts.get(actorId) ?? 0, offset));
        const previousHP = hp.get(actorId)!;
        const nextHP = event.hp;
        this.health.push({ actorId, start: start + offset, before: previousHP, after: nextHP }); hp.set(actorId, nextHP);
      }
    }
    // 先保留同来源/同目标的因果次序，再压缩整批显示时间。
    // 飘字继续淡出，但不把敌人数量转换成额外的输入等待。
    const maxDuration = spent > 1.001 ? 680 : 560;
    const rate = duration > maxDuration ? maxDuration / duration : 1;
    if (rate < 1) {
      for (const segments of paths.values()) for (const motion of segments) {
        motion.start = start + (motion.start - start) * rate; motion.duration *= rate;
      }
      for (let i = effectStart; i < this.effects.length; i++) {
        const effect = this.effects[i]!;
        effect.start = start + (effect.start - start) * rate;
        if (effect.type === 'attack' || effect.type === 'throw') effect.duration *= rate;
        effect.reactionDuration *= rate;
      }
      for (let i = defeatedStart; i < this.defeated.length; i++) {
        const defeated = this.defeated[i]!;
        defeated.start = start + (defeated.start - start) * rate;
        defeated.end = start + (defeated.end - start) * rate;
      }
      for (const change of this.health) change.start = start + (change.start - start) * rate;
      duration = maxDuration;
    }
    for (const [id, motion] of paths) this.motions.set(id, motion);
    // 动画与存档并行完成后才允许下一次动作，避免逻辑先跑过数格、画面再追赶。
    // 使用计时器收尾，后台 rAF 暂停也不会把输入锁永远留在 busy。
    return new Promise(resolve => globalThis.setTimeout(resolve, duration));
  }
  private attackAt(actorId: number, now: number): Effect | undefined {
    return this.effects.find(effect => (effect.type === 'attack' || effect.type === 'throw') && effect.actorId === actorId
      && now >= effect.start && now < effect.start + effect.duration);
  }
  private pose(actor: { id: number; pos: number; facing: number }, width: number, now: number): ActorPose {
    const motion = this.motions.get(actor.id)?.find(segment => now < segment.start + segment.duration);
    if (!motion) {
      return { x: actor.pos % width, y: Math.floor(actor.pos / width), walking: false, phase: 0, facing: actor.facing };
    }
    const progress = Math.max(0, (now - motion.start) / motion.duration);
    const step = Math.min(motion.cells.length - 2, Math.floor(progress)), t = Math.min(1, progress - step);
    const from = motion.cells[step]!, to = motion.cells[step + 1]!;
    const fromX = from % width, fromY = Math.floor(from / width), dx = to % width - fromX;
    return { x: fromX + dx * t, y: fromY + (Math.floor(to / width) - fromY) * t,
      walking: now >= motion.start, phase: (motion.stride + progress) * Math.PI, facing: dx === 0 ? actor.facing : Math.sign(dx) };
  }
  displayHP(actor: { id: number; hp: number }, now: number): number {
    const changes = this.health.filter(change => change.actorId === actor.id);
    const pending = changes.find(change => now < change.start);
    return pending?.before ?? changes.at(-1)?.after ?? actor.hp;
  }
  actorAt(clientX: number, clientY: number, world: World, now: number): number | null {
    const rect = this.canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
    const candidates = world.visibleEnemies().map(actor => {
      const pose = this.pose(actor, world.state.level.width, now);
      const px = (pose.x + .5) * this.size + this.offsetX, py = (pose.y + .5) * this.size + this.offsetY;
      return { id: actor.id, distance: Math.hypot(x - px, y - py), px, py };
    }).filter(actor => Math.abs(x - actor.px) <= this.size * .45 && Math.abs(y - actor.py) <= this.size * .48)
      .sort((a, b) => a.distance - b.distance);
    return candidates[0]?.id ?? null;
  }
  cellAt(clientX: number, clientY: number, world: World): number | null {
    const bounds = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - bounds.left - this.offsetX) / this.size);
    const y = Math.floor((clientY - bounds.top - this.offsetY) / this.size);
    return x >= 0 && y >= 0 && x < world.state.level.width && y < world.state.level.height ? x + y * world.state.level.width : null;
  }
  private refreshStatic(world: World): void {
    const { level } = world.state;
    if (this.cacheWorld === world && this.cacheLevel === level && this.cacheRevision === world.revision) return;
    if (this.cacheWorld !== world) this.terrain.reset();
    this.cacheWorld = world; this.cacheLevel = level; this.cacheRevision = world.revision; this.aimPreview = null;
    this.dangers = [];
    // 怪物位置、蓄力、可见性和门状态都只在逻辑动作后改变，静止时无需重新发射射线。
    const flags = STOP_TARGET | STOP_SOLID | IGNORE_SOFT_SOLID;
    for (const goo of world.visibleEnemies().filter(mob => mob.species === 'spd:mob/goo' && mob.pumpedUp > 0)) {
      const gx = goo.pos % level.width, gy = Math.floor(goo.pos / level.width);
      for (let y = Math.max(0, gy - 2); y <= Math.min(level.height - 1, gy + 2); y++) {
        for (let x = Math.max(0, gx - 2); x <= Math.min(level.width - 1, gx + 2); x++) {
          const cell = x + y * level.width;
          if (cell === goo.pos || !world.visible[cell] || distance(level, goo.pos, cell) > 2 || level.tiles[cell] === Tile.Wall
            || ballistics(level, goo.pos, cell, () => false, flags).collision !== cell
            || ballistics(level, cell, goo.pos, () => false, flags).collision !== goo.pos) continue;
          this.dangers.push({ cell, charged: goo.pumpedUp > 1 });
        }
      }
    }
    this.minimapScale = Math.min(2.5, 112 / level.width, 112 / level.height);
    const scale = this.minimapScale, image = document.createElement('canvas');
    image.width = Math.ceil(level.width * scale * 2); image.height = Math.ceil(level.height * scale * 2);
    const ctx = image.getContext('2d');
    if (!ctx) throw new Error('无法绘制远征小地图。');
    ctx.scale(2, 2);
    for (let cell = 0; cell < level.tiles.length; cell++) {
      if (!level.visited[cell]) continue;
      ctx.fillStyle = level.tiles[cell] === Tile.Wall ? '#42574b' : level.tiles[cell] === Tile.Water ? '#62968b' : '#929f78';
      if (cell === level.exit || cell === level.entrance) ctx.fillStyle = '#e5bd78';
      ctx.fillRect(cell % level.width * scale, Math.floor(cell / level.width) * scale, scale, scale);
    }
    for (const feature of level.features) {
      if (!feature.seen || !level.visited[feature.cell] || feature.status === 'used') continue;
      ctx.fillStyle = feature.kind === 'health-well' ? '#9ad6c3' : feature.kind === 'awareness-well' ? '#f4de9c' : '#dfa75e';
      ctx.fillRect(feature.cell % level.width * scale, Math.floor(feature.cell / level.width) * scale, Math.max(2, scale), Math.max(2, scale));
    }
    this.minimapImage = image;
  }
  draw(world: World, now: number, aiming = false): void {
    const rect = this.canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    if (this.width !== rect.width || this.height !== rect.height || this.canvas.width !== Math.round(rect.width * ratio)) {
      this.width = rect.width; this.height = rect.height;
      this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
      this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    }
    const ctx = this.context;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#101d20'; ctx.fillRect(0, 0, this.width, this.height);
    const { level, hero } = world.state;
    this.size = Math.round((this.width < 500 ? 32 : 40) * this.zoom);
    const size = this.size;
    this.refreshStatic(world);
    this.terrain.sync(level, world.revision, size, ratio);
    const heroPose = this.pose(hero, level.width, now);
    this.offsetX = this.width / 2 - (heroPose.x + 0.5) * size;
    this.offsetY = this.height / 2 - (heroPose.y + 0.5) * size;
    const firstX = Math.max(0, Math.floor(-this.offsetX / size) - 1);
    const firstY = Math.max(0, Math.floor(-this.offsetY / size) - 1);
    const lastX = Math.min(level.width - 1, Math.ceil((this.width - this.offsetX) / size));
    const lastY = Math.min(level.height - 1, Math.ceil((this.height - this.offsetY) / size));
    for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
      const cell = x + y * level.width;
      if (!level.visited[cell]) continue;
      const px = x * size + this.offsetX, py = y * size + this.offsetY;
      ctx.globalAlpha = world.visible[cell] ? 1 : 0.28;
      this.terrain.draw(ctx, cell, px, py, size, now, this.reduceMotion);
      if (world.visible[cell] && level.tiles[cell] !== Tile.Wall) {
        // 视野内部的明暗只作用于已显示地形，不拓宽视野或泄露迷雾后的物体。
        const distance = Math.hypot(x - heroPose.x, y - heroPose.y);
        ctx.fillStyle = 'rgba(11,31,34,' + Math.min(.19, Math.max(0, distance - 2) * .035) + ')';
        ctx.fillRect(px, py, size, size);
      }
    }
    ctx.globalAlpha = 1;
    for (const danger of this.dangers) {
      const [x, y] = this.point(danger.cell, level.width);
      ctx.fillStyle = danger.charged ? '#e76b5359' : '#e5ac4d3d';
      ctx.fillRect(x - size / 2 + 2, y - size / 2 + 2, size - 4, size - 4);
    }
    this.features(world, now);
    for (const heap of level.heaps) {
      if (!heap.seen || !level.visited[heap.cell]) continue;
      const px = (heap.cell % level.width + 0.5) * size + this.offsetX;
      const py = (Math.floor(heap.cell / level.width) + 0.72) * size + this.offsetY;
      ctx.globalAlpha = world.visible[heap.cell] ? 1 : 0.35;
      ctx.fillStyle = '#0b1d20aa'; ctx.beginPath(); ctx.ellipse(px, py + 2, size * .23, size * .08, 0, 0, Math.PI * 2); ctx.fill();
      const category = ITEMS[heap.item.kind].category;
      const unknown = ['potion','scroll'].includes(category) && !world.state.knownTypes.includes(heap.item.kind);
      // 同类未知药卷统一用一个图帧与问号，固定图集映射不能提前泄露用途。
      const displayKind = unknown ? category === 'potion' ? 'spd:potion/healing' : 'spd:scroll/upgrade' : heap.item.kind;
      const [sx, sy, sw, sh] = ITEM_FRAMES[displayKind] as [number, number, number, number];
      const scale = size / 40 * 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.sprites.items, sx, sy, sw, sh, px - sw * scale / 2, py - sh * scale, sw * scale, sh * scale);
      if (unknown) {
        ctx.save(); ctx.fillStyle = '#102c2b'; ctx.strokeStyle = '#f6e2b9'; ctx.lineWidth = 2;
        ctx.font = 'bold ' + Math.round(size * .3) + 'px system-ui'; ctx.textAlign = 'center';
        ctx.strokeText('?', px, py - size * .2); ctx.fillText('?', px, py - size * .2); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (this.target !== null && world.visible[this.target]) {
      const [px, py] = this.point(this.target, level.width);
      ctx.strokeStyle = '#ecd393'; ctx.lineWidth = 2;
      ctx.strokeRect(px - size / 2 + 2, py - size / 2 + 2, size - 4, size - 4);
    }
    if (aiming && this.target !== null) this.aim(world, this.target);
    this.defeated = this.defeated.filter(enemy => now < enemy.end && world.visible[enemy.actor.pos]);
    const actors = [...world.visibleEnemies(), ...this.defeated.map(enemy => enemy.actor), hero]
      .map(actor => ({ actor, pose: this.pose(actor, level.width, now) }))
      .sort((a, b) => a.pose.y - b.pose.y || a.pose.x - b.pose.x);
    for (const { actor, pose } of actors) {
      const px = (pose.x + .5) * size + this.offsetX, py = (pose.y + .5) * size + this.offsetY;
      const defeated = this.defeated.find(enemy => enemy.actor.id === actor.id);
      const fade = defeated ? Math.max(0, (now - defeated.start) / (defeated.end - defeated.start)) : 0;
      const strike = this.attackAt(actor.id, now), swing = strike ? (now - strike.start) / strike.duration : 0;
      const lunge = strike && !this.reduceMotion ? Math.sin(swing * Math.PI) * size * .14 : 0;
      const direction = strike?.from === undefined ? 0 : Math.atan2(Math.floor(strike.cell / level.width) - Math.floor(strike.from / level.width), strike.cell % level.width - strike.from % level.width);
      const reaction = this.effects.find(effect => effect.actorId === actor.id && ['hit', 'block', 'miss'].includes(effect.type)
        && now >= effect.start && now < effect.start + effect.reactionDuration);
      const recoil = reaction && !this.reduceMotion
        ? Math.sin((now - reaction.start) / reaction.reactionDuration * Math.PI) * size * .08 : 0;
      const hitDirection = reaction?.from === undefined ? 0 : Math.atan2(Math.floor(reaction.cell / level.width) - Math.floor(reaction.from / level.width), reaction.cell % level.width - reaction.from % level.width);
      ctx.save(); ctx.translate(px, py + size * .35);
      ctx.globalAlpha = 1 - fade;
      if (actor.id === this.focus && !defeated) {
        const near = world.canAttack(actor.pos);
        ctx.fillStyle = near ? '#df98742b' : '#efcf8b22'; ctx.strokeStyle = near ? '#efab89' : '#e6ce8d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, size * .4, size * .18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (actor.kind === 'hero' && world.state.seal.shield > 0) {
        ctx.strokeStyle = '#94d6ceaa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -size * .28, size * .39, size * .55, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#081a1b77'; ctx.beginPath(); ctx.ellipse(0, 0, size * .27, size * .10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(Math.cos(direction) * lunge, Math.sin(direction) * lunge);
      ctx.translate(Math.cos(hitDirection) * recoil, Math.sin(hitDirection) * recoil);
      if (fade > 0 && !this.reduceMotion) { ctx.translate(0, fade * 4); ctx.rotate(fade * .3); }
      const facing = strike?.from !== undefined && strike.cell % level.width !== strike.from % level.width
        ? Math.sign(strike.cell % level.width - strike.from % level.width) : pose.facing;
      ctx.scale(facing, 1);
      if (reaction?.type === 'hit' && now - reaction.start < reaction.reactionDuration * .5 && !this.reduceMotion) ctx.filter = 'brightness(1.6)';
      if (actor.kind === 'hero') {
        // 固定母版脚点(0,0)，角色只有一格碰撞，不按长嘴视觉宽度扩大占位。
        const height = size * 1.30, width = height * 120 / 126;
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = this.displayHP(actor, now) > 0 ? 1 : .45;
        const frame = pose.walking && !this.reduceMotion
          ? this.sprites.walk[Math.floor(pose.phase / (Math.PI * 2) * this.sprites.walk.length) % this.sprites.walk.length]!
          : this.sprites.walk[0]!;
        ctx.drawImage(frame, -width * .45, -height * (110 / 126), width, height);
        this.weapon(world, facing, strike, swing, direction);
        ctx.globalAlpha = 1;
        if (world.state.ooze.left > 0) {
          ctx.strokeStyle = '#a3bd68'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, -size * .18, size * .3, size * .12, 0, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        const art = MONSTER_ART[actor.species], [sw, sh] = art.frameSize, frames = art.animationMap;
        const image = this.sprites.monsters[actor.species];
        const sequence = strike ? (strike.amount && frames.chargeAttack ? frames.chargeAttack : frames.attack)
          : actor.pumpedUp > 0 && frames.charge ? frames.charge : pose.walking ? frames.move : frames.idle;
        const progress = strike ? Math.min(.999, swing) : pose.walking ? pose.phase / Math.PI : now * art.idleFPS / (1000 * sequence.length);
        const frame = this.reduceMotion || actor.state === 'sleeping' ? frames.idle[0]!
          : sequence[Math.floor(progress * sequence.length) % sequence.length]!;
        const columns = Math.floor(image.width / sw), sx = (frame % columns) * sw, sy = Math.floor(frame / columns) * sh;
        ctx.imageSmoothingEnabled = false;
        const spriteScale = size / 40 * (actor.species === 'spd:mob/goo' ? 2.25 : 2);
        ctx.drawImage(image, sx, sy, sw, sh, -sw * spriteScale / 2, -sh * spriteScale, sw * spriteScale, sh * spriteScale);
      }
      ctx.restore();
      if (actor.kind === 'mob' && !defeated) {
        const hp = this.displayHP(actor, now);
        if (hp < actor.maxHP || actor.pos === this.target || actor.id === this.focus) {
          const barWidth = size * .72;
          ctx.fillStyle = '#102626'; ctx.fillRect(px - barWidth / 2 - 1, py - size * .55 - 1, barWidth + 2, 5);
          ctx.fillStyle = '#dda078'; ctx.fillRect(px - barWidth / 2, py - size * .55, barWidth * hp / actor.maxHP, 3);
        } else if (actor.state === 'sleeping') {
          ctx.fillStyle = '#becdc0'; ctx.font = '11px system-ui'; ctx.fillText('z', px + 8, py - size * .4);
        }
        if (actor.pos === this.target) {
          const name = MOB_DEFINITIONS[actor.species].name + ' ' + hp + '/' + actor.maxHP;
          ctx.font = '11px system-ui'; ctx.textAlign = 'center';
          const labelWidth = ctx.measureText(name).width + 12;
          ctx.fillStyle = '#102923ed'; ctx.fillRect(px - labelWidth / 2, py - size * .95, labelWidth, 19);
          ctx.fillStyle = '#f2deb4'; ctx.fillText(name, px, py - size * .95 + 13); ctx.textAlign = 'left';
        }
      }
    }
    this.effects = this.effects.filter(effect => now - effect.start < effect.duration);
    for (const effect of this.effects) {
      if (now < effect.start || !world.visible[effect.cell]) continue;
      const age = (now - effect.start) / effect.duration;
      const [px, py] = this.point(effect.cell, level.width);
      ctx.globalAlpha = 1 - age;
      if (effect.type === 'attack') { this.slash(world, effect, age); continue; }
      ctx.font = 'bold ' + Math.round(size * .36) + 'px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = effect.type === 'heal' ? '#a9deae' : effect.hero && effect.type === 'hit' ? '#f6a38f' : '#ffe2a4';
      const label = effect.type === 'hit' ? (effect.surprise ? '偷袭 ' : '') + effect.amount : effect.type === 'heal' ? '+' + effect.amount :
        effect.type === 'block' ? effect.blocked ? '护盾 ' + effect.blocked : '格挡' :
        effect.type === 'miss' ? '闪避' : effect.type === 'alert' ? '!' : effect.type === 'charge' ? (effect.amount === 1 ? '蓄力' : '危险！') : effect.type === 'level-up' ? '升级' : effect.type === 'pickup' ? '拾取' : '';
      const laneX = [0, -size * .55, size * .55][effect.lane % 3] ?? 0;
      const textY = py - size * .65 - (effect.lane % 3) * 6 - Math.floor(effect.lane / 3) * 19 - (this.reduceMotion ? 0 : age * 22);
      ctx.strokeStyle = '#142a2b'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.strokeText(label, px + laneX, textY); ctx.fillText(label, px + laneX, textY);
      if (effect.type === 'hit' || effect.type === 'block') this.impact(world, effect, now - effect.start);
      if (effect.type === 'throw' && effect.from !== undefined) {
        const [fx, fy] = this.point(effect.from, level.width), t = this.reduceMotion ? 1 : age;
        ctx.globalAlpha = 1;
        if (!this.reduceMotion) {
          ctx.strokeStyle = '#f3deb77a'; ctx.lineWidth = 2; ctx.beginPath();
          for (let i = 0; i <= 5; i++) {
            const progress = Math.max(0, t - .16 + i * .032);
            const x = fx + (px - fx) * progress, y = fy + (py - fy) * progress - Math.sin(progress * Math.PI) * size * .24;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        const [sx, sy, sw, sh] = ITEM_FRAMES['spd:missile/throwing-stone'] as [number, number, number, number];
        ctx.save(); ctx.translate(fx + (px - fx) * t, fy + (py - fy) * t - Math.sin(t * Math.PI) * size * .24);
        if (!this.reduceMotion) ctx.rotate(t * Math.PI * 2);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(this.sprites.items, sx, sy, sw, sh, -size * .14, -size * .12, size * .28, size * .24); ctx.restore();
      }
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * .2,
      this.width / 2, this.height / 2, Math.hypot(this.width, this.height) * .56);
    vignette.addColorStop(0, '#07171c00'); vignette.addColorStop(1, '#07171c66');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, this.width, this.height);
    this.minimap(world, heroPose);
  }
  private features(world: World, now: number): void {
    const { level, hero } = world.state, ctx = this.context, size = this.size;
    for (const feature of level.features) {
      if (!feature.seen || !level.visited[feature.cell]) continue;
      const chest = feature.kind === 'chest' || feature.kind === 'supply-cache';
      if (chest && feature.status === 'used') continue;
      const [x, y] = this.point(feature.cell, level.width);
      if (x < -size || y < -size || x > this.width + size || y > this.height + size) continue;
      const visible = !!world.visible[feature.cell], active = feature.status === 'ready';
      const color = feature.kind === 'awareness-well' ? '#f2d992' : '#a3e2ca';
      ctx.save(); ctx.globalAlpha = visible ? 1 : .35;
      if (!chest && active && visible) {
        const glow = ctx.createRadialGradient(x, y, size * .08, x, y, size * .55);
        glow.addColorStop(0, color + '66'); glow.addColorStop(1, color + '00');
        ctx.fillStyle = glow; ctx.fillRect(x - size * .55, y - size * .55, size * 1.1, size * 1.1);
      }
      ctx.fillStyle = '#0b22285c'; ctx.beginPath();
      ctx.ellipse(x, y + size * .28, size * .33, size * .10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.imageSmoothingEnabled = false;
      if (chest) {
        ctx.drawImage(this.sprites.items, 64, 32, 16, 14, x - size * .4, y - size * .38, size * .8, size * .7);
        if (feature.kind === 'supply-cache') {
          // 只标补给类别，不依据箱内物品改变图案或颜色。
          ctx.fillStyle = '#f5e5b4'; ctx.fillRect(x - size * .035, y - size * .10, size * .07, size * .20);
          ctx.fillRect(x - size * .10, y - size * .035, size * .20, size * .07);
        }
      } else {
        ctx.drawImage(this.sprites.sewerTiles, active ? 32 : 48, 16, 16, 16,
          x - size * .46, y - size * .47, size * .92, size * .92);
        if (active && visible) {
          const pulse = this.reduceMotion ? .65 : .60 + Math.sin(now / 850 + feature.cell) * .14;
          ctx.strokeStyle = color; ctx.globalAlpha = pulse; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(x, y - size * .08, size * .19, size * .065, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      if (active && visible && !world.mobAt(feature.cell)) {
        const nearby = distance(level, hero.pos, feature.cell) <= 1;
        ctx.fillStyle = nearby ? '#fff0c3' : '#ead5a3'; ctx.strokeStyle = '#28534a'; ctx.lineWidth = 1.5;
        const markerY = y - size * .52;
        ctx.beginPath(); ctx.moveTo(x, markerY - 4); ctx.lineTo(x + 4, markerY);
        ctx.lineTo(x, markerY + 4); ctx.lineTo(x - 4, markerY); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (nearby) {
          ctx.strokeStyle = '#f3dfaa8c'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(x, y + size * .3, size * .40, size * .14, 0, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  private slash(world: World, effect: Effect, progress: number): void {
    if (effect.from === undefined || progress < .12 || progress > .82) return;
    const { level, hero } = world.state, ctx = this.context, size = this.size;
    const [x, y] = this.point(effect.from, level.width), [tx, ty] = this.point(effect.cell, level.width);
    const direction = Math.atan2(ty - y, tx - x), sweep = (progress - .12) / .7;
    const length = Math.max(size * .5, Math.hypot(tx - x, ty - y));
    const style = effect.hero ? strikeStyle(world.item(hero.weaponId)?.kind) : 'blade';
    const advance = this.reduceMotion ? 1 : Math.min(1, (progress - .12) / .30);
    ctx.save(); ctx.translate(x, y - size * .08); ctx.rotate(direction);
    ctx.globalAlpha = (1 - sweep * .8) * (effect.hero ? .85 : .6);
    ctx.strokeStyle = effect.hero ? '#ffe4a6' : '#e6a18b'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (style === 'thrust') {
      const tip = size * .18 + (length - size * .18) * advance;
      ctx.lineWidth = size * .07; ctx.beginPath(); ctx.moveTo(size * .18, 0); ctx.lineTo(tip, 0); ctx.stroke();
      ctx.strokeStyle = '#fff6d6'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tip - size * .18, -size * .09); ctx.lineTo(tip, 0); ctx.lineTo(tip - size * .18, size * .09); ctx.stroke();
    } else if (style === 'whip') {
      const tip = size * .2 + (length - size * .2) * advance;
      const curl = this.reduceMotion ? size * .15 : Math.sin(progress * Math.PI * 2) * size * .42;
      ctx.lineWidth = size * .075; ctx.beginPath(); ctx.moveTo(size * .15, 0);
      ctx.bezierCurveTo(tip * .3, -curl, tip * .67, curl, tip, 0); ctx.stroke();
      ctx.strokeStyle = '#fff1c7'; ctx.lineWidth = 1.3; ctx.stroke();
    } else if (style === 'blunt') {
      const radius = Math.max(size * .45, length * .82), end = this.reduceMotion ? .2 : -.85 + advance * 1.05;
      ctx.lineWidth = size * .15; ctx.beginPath(); ctx.arc(0, 0, radius, end - .5, end); ctx.stroke();
      if (advance > .85) {
        ctx.strokeStyle = '#ffebbd'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(length, 0, size * .11, size * .22, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      const radius = Math.max(size * .66, length * .9), end = this.reduceMotion ? .3 : -.8 + advance * 1.1;
      ctx.lineWidth = size * (effect.hero ? .10 : .06);
      ctx.beginPath(); ctx.arc(0, 0, radius, end - .85, end); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = '#fff4cf';
      ctx.beginPath(); ctx.arc(0, 0, radius + size * .06, end - .6, end); ctx.stroke();
    }
    ctx.restore();
  }
  private impact(world: World, effect: Effect, elapsed: number): void {
    if (elapsed < 0 || elapsed >= effect.reactionDuration) return;
    const ctx = this.context, size = this.size, t = elapsed / effect.reactionDuration;
    const [x, y] = this.point(effect.cell, world.state.level.width);
    const outgoing = effect.sourceId === world.state.hero.id;
    const style = outgoing ? strikeStyle(world.item(world.state.hero.weaponId)?.kind) : 'blade';
    ctx.save(); ctx.translate(x, y - size * .09); ctx.globalAlpha = (1 - t) * .9;
    ctx.strokeStyle = effect.type === 'block' ? '#b5e5db' : effect.hero ? '#ffb19b' : '#fff1bb';
    ctx.lineWidth = effect.type === 'block' || style === 'blunt' ? 2 : 1.6; ctx.lineCap = 'round';
    if (effect.type === 'block' || style === 'blunt') {
      const radius = size * (this.reduceMotion ? .19 : .09 + t * .25);
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
    }
    if (!this.reduceMotion) {
      const count = effect.type === 'block' ? 4 : style === 'thrust' ? 5 : 7;
      const seed = (effect.cell % 9) * .19;
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count + seed, start = size * (.05 + t * .14);
        const end = start + size * (.16 - t * .08);
        ctx.beginPath(); ctx.moveTo(Math.cos(angle) * start, Math.sin(angle) * start);
        ctx.lineTo(Math.cos(angle) * end, Math.sin(angle) * end); ctx.stroke();
      }
    } else if (effect.type !== 'block' && style !== 'blunt') {
      ctx.beginPath(); ctx.moveTo(-size * .12, -size * .12); ctx.lineTo(size * .12, size * .12);
      ctx.moveTo(size * .12, -size * .12); ctx.lineTo(-size * .12, size * .12); ctx.stroke();
    }
    ctx.restore();
  }
  private weapon(world: World, facing: number, strike: Effect | undefined, progress: number, direction: number): void {
    const item = world.item(world.state.hero.weaponId);
    if (!item || strike?.type === 'throw') return;
    const [sx, sy, sw, sh] = ITEM_FRAMES[item.kind] as [number, number, number, number];
    const ctx = this.context, scale = this.size / 40 * 1.7, style = strikeStyle(item.kind);
    ctx.save(); ctx.translate(this.size * .22, -this.size * .41);
    if (strike && !this.reduceMotion) {
      const localAngle = Math.atan2(Math.sin(direction), Math.cos(direction) * facing);
      if (style === 'thrust') {
        const extension = Math.sin(progress * Math.PI) * this.size * .22;
        ctx.translate(Math.cos(localAngle) * extension, Math.sin(localAngle) * extension);
        ctx.rotate(localAngle + Math.PI / 4);
      } else {
        const sweep = style === 'blunt' ? 2.7 : style === 'whip' ? 3.0 : 2.2;
        ctx.rotate(localAngle + Math.PI / 4 + (progress - .5) * sweep);
      }
    } else ctx.rotate(.18);
    ctx.imageSmoothingEnabled = false;
    // 各图帧仍来自固定图集；柄端靠左下，长兵器触达由 from→cell 的轨迹表达。
    ctx.drawImage(this.sprites.items, sx, sy, sw, sh, -2 * scale, -(sh - 2) * scale, sw * scale, sh * scale);
    ctx.restore();
  }
  private aim(world: World, target: number): void {
    const { level, hero } = world.state;
    if (!world.visible[target] || target === hero.pos) return;
    // 只使用已可见敌人，且路线在未知格前截断；预览不透露迷雾中的占位。
    if (!this.aimPreview || this.aimPreview.target !== target) {
      const shot = ballistics(level, hero.pos, target, cell => !!world.visible[cell] && !!world.mobAt(cell));
      const cells: number[] = [];
      for (const cell of shot.path.slice(0, shot.distance + 1)) {
        if (!world.visible[cell]) break;
        cells.push(cell);
      }
      this.aimPreview = { target, cells, complete: cells.length === shot.distance + 1, collision: shot.collision };
    }
    const { cells, complete, collision } = this.aimPreview, ctx = this.context;
    ctx.save(); ctx.strokeStyle = !complete ? '#aabeb2' : collision === target ? '#e9ce86' : '#e3a184'; ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]); ctx.beginPath();
    cells.forEach((cell, index) => {
      const [x, y] = this.point(cell, level.width);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]);
    const last = cells.at(-1);
    if (last !== undefined) {
      const [x, y] = this.point(last, level.width);
      ctx.beginPath(); ctx.arc(x, y, this.size * .2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  private point(cell: number, width: number): [number, number] {
    return [(cell % width + .5) * this.size + this.offsetX, (Math.floor(cell / width) + .5) * this.size + this.offsetY];
  }
  private minimap(world: World, heroPose: ActorPose): void {
    const { level } = world.state, ctx = this.context;
    const scale = this.minimapScale;
    const width = level.width * scale, height = level.height * scale, left = this.width - width - 16;
    ctx.fillStyle = '#0b2020d9'; ctx.fillRect(left - 6, 10, width + 12, height + 12);
    if (this.minimapImage) ctx.drawImage(this.minimapImage, left, 16, width, height);
    ctx.fillStyle = '#fff3ce';
    ctx.fillRect(left + heroPose.x * scale - 1, 16 + heroPose.y * scale - 1, Math.max(scale, 3), Math.max(scale, 3));
  }
}
