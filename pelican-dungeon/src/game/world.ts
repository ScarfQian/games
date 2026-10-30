/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * TypeScript 移植与网页适配：ScarfQian，2026-10-30。
 * SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0。
 * 来源：Dungeon.java；actors/{Char,hero/Hero,hero/HeroClass,mobs/Mob,mobs/Rat,mobs/Snake}.java；
 * actors/buffs/{Hunger,Regeneration,Healing}.java；items/BrokenSeal.java；levels/RegularLevel.java。
 * 首章子集：完整 Generator、任务、高阶天赋、稀有替代与全部掉落内容尚未接入。
 * 力量药/升级卷轴采用原版章节预算；其余开发补给与装备候选池为已登记的网页适配。
 */
import version from '../../version.json';
import { Random } from '../engine/random';
import { nextActor, spend, PRIORITY } from '../engine/scheduler';
import { distanceMap, findPath, nextStep, UNREACHABLE } from '../engine/pathfinder';
import { fieldOfView } from '../engine/visibility';
import { ballistics, STOP_TARGET, STOP_SOLID, IGNORE_SOFT_SOLID } from '../engine/ballistics';
import { generateFloor } from './generation';
import { adjacent, avoid, blocksSight, distance, inside, neighbours, passable, solid, Tile } from './terrain';
import {
  armorStats, createItem, initialInventory, ITEMS, mergeStoneStacks, resolveStoneThrow,
  rollHeroDamage, splitStone, upgradeItem, weaponStats, type Item, type ItemKind,
  augmentChoices, chapterEquipment, forgeEligible, FORGE_MATERIALS, identified, randomizeEquipment, AUGMENT_NAMES,
} from './items';
import type { ActionResult, Command, ExplorationFeature, GameState, Hero, Level, Message, Mob, MobKind, Scheduled, Spawner, WorldEvent } from './model';
import { MOB_DEFINITIONS, FLOOR_BAGS } from './enemies';
import { encounterPopulation, encounterRoomCells, spreadEncounterCells, WEB_ENCOUNTERS } from './encounters';
import { availableTalentPoints, chapterSupplies, experienceToLevel, initialTalents, MAX_HERO_LEVEL, TALENTS } from './progression';
export { MOB_DEFINITIONS } from './enemies';

function seedForFloor(random: Random, seed: bigint, depth: number): bigint {
  random.push(seed);
  for (let index = 0; index < depth; index++) random.long();
  const result = random.long(); random.pop(); return result;
}

export function itemName(state: GameState, item: Item): string {
  const category = ITEMS[item.kind].category;
  if ((category === 'scroll' || category === 'potion') && !state.knownTypes.includes(item.kind)) {
    return category === 'scroll' ? '未鉴定卷轴' : '未鉴定药水';
  }
  return ITEMS[item.kind].name + (item.levelKnown && item.level !== 0 ? ' ' + (item.level > 0 ? '+' : '') + item.level : '');
}

export class World {
  readonly state: GameState;
  private random: Random;
  private events: WorldEvent[] = [];
  private interrupted = false;
  private actionTime = 0;
  private attackReach = new Map<number, boolean>();
  revision = 0;
  visible: boolean[] = [];

  private constructor(state: GameState) {
    this.state = state;
    this.random = Random.restore(state.randomStates);
    this.observe();
  }

  static create(seed: bigint, runId: string): World {
    const random = new Random(seed);
    // Dungeon.seedForDepth(1,0)：楼层随机流与进行中的战斗随机流分离。
    const floorSeed = seedForFloor(random, seed, 1);
    random.push(floorSeed);
    const { blockedPlacementCells, bossSpawn, ...generated } = generateFloor(random, 1);
    const state: GameState = {
      schemaVersion: 4, gameVersion: version.currentVersion ?? version.nextVersion!,
      upstreamCommit: version.upstream.commit, runId, seed: seed.toString(), phase: 'playing', depth: 1,
      nextActorId: 100, nextItemId: 5, nextMessageId: 1,
      hero: {
        kind: 'hero', id: 1, time: 0, priority: PRIORITY.hero,
        pos: generated.entrance, previousPos: generated.entrance, facing: 1,
        hp: 20, maxHP: 20, strength: 10, level: 1, xp: 0, attackSkill: 10, defenseSkill: 5,
        gold: 0, weaponId: 1, armorId: 2, inventory: initialInventory(),
        talents: initialTalents(), provokedUntil: 0,
      },
      level: { ...generated, depth: 1, lastTime: 0, locked: false, lockedLeft: 0, bossDefeated: false, spawner: null,
        visited: new Array<boolean>(generated.tiles.length).fill(false), mobs: [], heaps: [], features: [] },
      archivedLevels: {}, deepestFloor: 1, drops: { strength: 0, upgrades: 0, swarmHealing: 0, slimeWeapons: 0 },
      hunger: { kind: 'hunger', id: 2, time: 0, priority: PRIORITY.buff, level: 0, partialDamage: 0 },
      regeneration: { kind: 'regeneration', id: 3, time: 0, priority: -1, partial: 0 },
      seal: { kind: 'seal', id: 4, time: 0, priority: PRIORITY.buff, shield: 0, cooldown: 0, turnsSinceEnemies: 0, initialShield: 0 },
      healing: { kind: 'healing', id: 5, time: 0, priority: -1, left: 0 },
      ooze: { kind: 'ooze', id: 6, time: 0, priority: PRIORITY.buff, left: 0, acted: false },
      knownTypes: ['spd:potion/healing'], pendingChoice: null, awarenessUntil: 0,
      randomStates: random.snapshot(), messages: [],
      stats: { actions: 0, kills: 0, steps: 0, thrown: 0 }, deathCause: null,
    };
    const world = new World(state);
    world.populate(new Set(blockedPlacementCells), bossSpawn);
    world.random.pop();
    world.state.randomStates = world.random.snapshot();
    world.log('从海风镇出发。探索五层下水道，击败第五层的Goo。', 'hint');
    world.log('移动与行动才会推进时间。利用门与转角，对未察觉你的敌人发动偷袭。', 'hint');
    world.observe();
    return world;
  }

  static restore(state: GameState): World { return new World(structuredClone(state)); }
  snapshot(): GameState {
    this.state.randomStates = this.random.snapshot();
    return structuredClone(this.state);
  }

  private createMob(species: MobKind, pos: number, time = this.state.hero.time): Mob {
    const hp = MOB_DEFINITIONS[species].hp;
    const mob: Mob = { kind: 'mob', id: this.state.nextActorId++, time, priority: PRIORITY.mob,
      species, pos, previousPos: pos, facing: -1, hp, maxHP: hp, state: 'sleeping', target: -1,
      enemySeen: false, alerted: false, generation: 0, pumpedUp: 0 };
    this.state.level.mobs.push(mob); return mob;
  }

  private populate(blocked: ReadonlySet<number>, bossSpawn?: number): void {
    const { level, depth, hero } = this.state;
    if (depth === 5) {
      if (bossSpawn === undefined) throw new Error('首领地图缺少出场位置。');
      this.createMob('spd:mob/goo', bossSpawn); return;
    }
    const initialFOV = fieldOfView(level, level.entrance, cell => blocksSight(level.tiles[cell]!), 8);
    const openDistance = distanceMap(level, [level.entrance], cell => !solid(level.tiles[cell]!), 8);
    const roomCells = encounterRoomCells(level);
    const cells = roomCells.filter(cell => !blocked.has(cell)
      && !initialFOV[cell] && openDistance[cell] === UNREACHABLE);
    // 新地图按实际房间面积增加遭遇；入口安全区与分散间隔优先于目标数量。
    const positions = spreadEncounterCells(level, cells, encounterPopulation(depth, roomCells.length), this.random);
    let bag: MobKind[] = [];
    for (const pos of positions) {
      if (!bag.length) bag = this.random.shuffleList([...FLOOR_BAGS[depth]!]);
      const species = bag.shift()!;
      this.createMob(species, pos);
      if (level.tiles[pos] === Tile.HighGrass) level.tiles[pos] = Tile.Grass;
    }
    if (depth > 1) level.spawner = { kind: 'spawner', id: this.state.nextActorId++, time: hero.time + WEB_ENCOUNTERS.respawnDelay,
      priority: PRIORITY.buff, bag };
    const dropCells = level.tiles.map((_, cell) => cell).filter(cell => inside(level, cell)
      && passable(level.tiles[cell]!) && !blocked.has(cell) && cell !== level.entrance && cell !== level.exit && level.tiles[cell] !== Tile.Door);
    const kinds: ItemKind[] = ['spd:food/ration', 'spd:potion/healing', ...chapterSupplies(this.random, depth, this.state.drops)];
    kinds.push(...chapterEquipment(this.random, depth));
    const goldPiles = 1 + this.random.weighted([6, 3, 1]);
    for (let i = 0; i < goldPiles; i++) kinds.push('spd:currency/gold');
    for (const kind of kinds) {
      const cell = dropCells.splice(this.random.int(dropCells.length), 1)[0]!;
      if (level.tiles[cell] === Tile.HighGrass) level.tiles[cell] = Tile.Grass;
      const quantity = kind === 'spd:currency/gold' ? this.random.range(40, 80) : 1;
      const item = randomizeEquipment(createItem(this.state.nextItemId++, kind, quantity), this.random);
      level.heaps.push({ cell, item, seen: false });
    }
    this.populateExploration(blocked);
  }

  private populateExploration(blocked: ReadonlySet<number>): void {
    const { level, depth } = this.state;
    // 普通箱只封存已有预算，不重复生成力量药、升级卷轴或装备。
    const rewards = this.random.shuffleList(level.heaps.filter(heap =>
      !['food', 'potion'].includes(ITEMS[heap.item.kind].category))).slice(0, 2);
    for (const [index, heap] of rewards.entries()) {
      level.features.push({ id: `floor-${depth}-chest-${index}`, kind: 'chest',
        cell: heap.cell, seen: false, status: 'ready', items: [heap.item] });
      level.heaps.splice(level.heaps.indexOf(heap), 1);
    }
    const eventKinds = this.random.shuffleList(['health-well', 'awareness-well', 'supply-cache'] as const).slice(0, 2);
    const occupied = new Set([...level.features.map(feature => feature.cell), ...level.heaps.map(heap => heap.cell), ...level.mobs.map(mob => mob.pos)]);
    const candidates = level.tiles.map((_, cell) => cell).filter(cell => inside(level, cell)
      && passable(level.tiles[cell]!) && !solid(level.tiles[cell]!) && !blocked.has(cell)
      && cell !== level.exit && distance(level, cell, level.entrance) > 4 && !occupied.has(cell)
      && level.rooms.some(room => !['entrance', 'exit', 'tunnel'].includes(room.kind)
        && cell % level.width > room.left && cell % level.width < room.right
        && Math.floor(cell / level.width) > room.top && Math.floor(cell / level.width) < room.bottom));
    const usedRooms = new Set<number>();
    for (const [index, kind] of eventKinds.entries()) {
      const roomAt = (cell: number): number => level.rooms.findIndex(room =>
        cell % level.width > room.left && cell % level.width < room.right
        && Math.floor(cell / level.width) > room.top && Math.floor(cell / level.width) < room.bottom);
      const separate = candidates.filter(cell => !usedRooms.has(roomAt(cell)));
      const smallRooms = separate.filter(cell => level.rooms[roomAt(cell)]?.kind === 'empty');
      const pool = smallRooms.length ? smallRooms : separate.length ? separate : candidates;
      if (!pool.length) throw new Error('本层没有足够的探索事件位置，当前进度未被替换。');
      const cell = this.random.choose(pool);
      candidates.splice(candidates.indexOf(cell), 1); usedRooms.add(roomAt(cell));
      // 事件地面不会挡路，也不同时提供浅水洗淤泥的效果。
      level.tiles[cell] = Tile.EmptySpecial;
      const items = kind === 'supply-cache' ? [createItem(this.state.nextItemId++, 'spd:food/ration'),
        createItem(this.state.nextItemId++, 'spd:missile/throwing-stone', 3)] : [];
      level.features.push({ id: `floor-${depth}-${kind}-${index}`, kind, cell, seen: false, status: 'ready', items });
    }
  }

  private enterFloor(depth: number): void {
    const { state } = this, previous = state.depth;
    // 对齐换层时的零碎行动时间，离开楼层的怪物与补怪时钟随后冻结。
    state.hero.time = Math.ceil(state.hero.time);
    const active: Scheduled[] = [state.hunger, state.regeneration, state.healing, state.seal, state.ooze, ...state.level.mobs];
    if (state.level.spawner) active.push(state.level.spawner);
    for (const actor of active) if (actor.time < state.hero.time) actor.time = Math.ceil(actor.time);
    state.level.lastTime = state.hero.time;
    state.archivedLevels[String(previous)] = state.level;
    let level: Level | undefined = state.archivedLevels[String(depth)];
    state.depth = depth; state.deepestFloor = Math.max(state.deepestFloor, depth);
    if (level) {
      const elapsed = state.hero.time - level.lastTime;
      for (const actor of level.mobs) actor.time = Math.fround(actor.time + elapsed);
      if (level.spawner) level.spawner.time = Math.fround(level.spawner.time + elapsed);
      state.level = level; delete state.archivedLevels[String(depth)];
    } else {
      this.random.push(seedForFloor(this.random, BigInt(state.seed), depth));
      try {
        const { blockedPlacementCells, bossSpawn, ...generated } = generateFloor(this.random, depth);
        level = { ...generated, depth, lastTime: state.hero.time, locked: false, lockedLeft: 0,
          bossDefeated: false, spawner: null, visited: new Array<boolean>(generated.tiles.length).fill(false), mobs: [], heaps: [], features: [] };
        state.level = level;
        this.populate(new Set(blockedPlacementCells), bossSpawn);
      } finally { this.random.pop(); }
    }
    const arrival = depth > previous ? state.level.entrance : state.level.exit;
    const occupant = this.mobAt(arrival);
    if (occupant) {
      const empty = neighbours(state.level, arrival).find(cell => passable(state.level.tiles[cell]!) && !this.mobAt(cell));
      if (empty === undefined) throw new Error('楼梯附近没有可供抵达的位置，当前楼层进度已保留。');
      occupant.pos = empty; occupant.previousPos = empty;
    }
    state.hero.pos = arrival; state.hero.previousPos = arrival; state.level.lastTime = state.hero.time;
    state.gameVersion = version.currentVersion ?? version.nextVersion!;
    this.observe(); this.log('抵达海岸下水道第 ' + depth + ' 层。' + (depth === 5 ? '深处的水面正在颤动。' : '找寻补给，留意新的敌人。'), 'hint');
    state.randomStates = this.random.snapshot();
  }

  private respawn(actor: Spawner): void {
    const { level, hero, depth } = this.state;
    const roomCells = encounterRoomCells(level);
    if (level.mobs.length >= encounterPopulation(depth, roomCells.length)) { spend(actor, WEB_ENCOUNTERS.respawnDelay); return; }
    const distances = distanceMap(level, [hero.pos], cell => passable(level.tiles[cell]!));
    // 仍从视野外至少12步的普通房补怪，优先远离其他怪物，不直接压住探索地点。
    const candidates = roomCells.filter(cell => !this.visible[cell] && !this.mobAt(cell)
      && distances[cell]! >= 12 && distances[cell] !== UNREACHABLE
      && !level.features.some(feature => feature.cell === cell));
    if (!candidates.length) { spend(actor, 1); return; }
    const pos = spreadEncounterCells(level, candidates, 1, this.random, level.mobs.map(mob => mob.pos))[0];
    if (pos === undefined) { spend(actor, 1); return; }
    if (!actor.bag.length) actor.bag = this.random.shuffleList([...FLOOR_BAGS[depth]!]);
    const mob = this.createMob(actor.bag.shift()!, pos, actor.time);
    mob.state = 'wandering'; spend(actor, WEB_ENCOUNTERS.respawnDelay);
  }

  private sealBossFloor(): void {
    if (this.state.depth === 5 && !this.state.level.locked && !this.state.level.bossDefeated) {
      this.state.level.locked = true; this.state.level.lockedLeft = 50;
      this.log('Goo封住了出口！蓄力时拉开距离，避免让它长时间站在水中。', 'danger');
      this.interrupted = true;
    }
  }

  private gooCanAttack(mob: Mob): boolean {
    const { level, hero } = this.state;
    if (!mob.pumpedUp) return adjacent(level, mob.pos, hero.pos);
    const flags = STOP_TARGET | STOP_SOLID | IGNORE_SOFT_SOLID;
    return distance(level, mob.pos, hero.pos) <= 2
      && ballistics(level, mob.pos, hero.pos, () => false, flags).collision === hero.pos
      && ballistics(level, hero.pos, mob.pos, () => false, flags).collision === mob.pos;
  }

  observe(at = this.state.hero.time): void {
    const { level, hero } = this.state;
    this.visible = fieldOfView(level, hero.pos, cell => blocksSight(level.tiles[cell]!), 8);
    if (this.state.awarenessUntil > 0 && this.state.awarenessUntil >= at) {
      // Awareness 的物品邻域视野：只揭开物品周围3×3，不显示整张地图。
      const centers = [...level.heaps.map(heap => heap.cell), ...level.features
        .filter(feature => feature.status === 'ready' && feature.items.length > 0).map(feature => feature.cell)];
      for (const cell of centers) for (const at of [cell, ...neighbours(level, cell)]) this.visible[at] = true;
    }
    for (let cell = 0; cell < this.visible.length; cell++) if (this.visible[cell]) level.visited[cell] = true;
    for (const heap of level.heaps) if (this.visible[heap.cell]) heap.seen = true;
    for (const feature of level.features) if (this.visible[feature.cell]) feature.seen = true;
    this.attackReach.clear(); this.revision++;
  }

  visibleEnemies(): Mob[] { return this.state.level.mobs.filter(mob => mob.hp > 0 && this.visible[mob.pos]); }
  mobAt(cell: number): Mob | undefined { return this.state.level.mobs.find(mob => mob.hp > 0 && mob.pos === cell); }
  item(id: number): Item | undefined { return this.state.hero.inventory.find(item => item.id === id); }

  /** 延伸近战沿八邻域寻找不穿墙、不越过其他角色的最短路线。 */
  canAttack(cell: number): boolean {
    const cached = this.attackReach.get(cell);
    if (cached !== undefined) return cached;
    const reachable = this.computeAttackReach(cell);
    this.attackReach.set(cell, reachable); return reachable;
  }

  private computeAttackReach(cell: number): boolean {
    const { hero, level } = this.state;
    if (!this.visible[cell] || !this.mobAt(cell)) return false;
    if (adjacent(level, hero.pos, cell)) return true;
    const reach = weaponStats(this.item(hero.weaponId)!).reach;
    if (distance(level, hero.pos, cell) > reach) return false;
    const route = distanceMap(level, [cell], position => !solid(level.tiles[position]!)
      && (!this.mobAt(position) || position === cell), reach);
    return route[hero.pos]! <= reach;
  }

  nearbyFeatures(): ExplorationFeature[] {
    return this.state.level.features.filter(feature => feature.status === 'ready' && this.visible[feature.cell]
      && distance(this.state.level, this.state.hero.pos, feature.cell) <= 1 && !this.mobAt(feature.cell));
  }

  /** 点击行走只经过已发现地面；隐藏敌人不参与路线查询。每步仍由dispatch核验占位。 */
  pathTo(cell: number): number[] | null {
    const { level, hero } = this.state;
    if (!inside(level, cell) || !level.visited[cell] || !passable(level.tiles[cell]!)) return null;
    return findPath(level, hero.pos, cell, at => level.visited[at]! && passable(level.tiles[at]!)
      && (!this.visible[at] || !this.mobAt(at)));
  }

  dispatch(command: Command): ActionResult {
    this.attackReach.clear();
    this.events = [];
    this.interrupted = false;
    const { state } = this;
    if (state.phase !== 'playing') return this.reject('这次远征已经结束。');
    if (state.pendingChoice && !['upgrade','apply-forge','cancel-upgrade'].includes(command.type)) {
      return this.reject('请先处理正在阅读的卷轴。');
    }
    const previousVisible = new Set(this.visibleEnemies().map(mob => mob.id));
    const start = state.hero.time;
    this.actionTime = start;
    let cost = 0;
    switch (command.type) {
      case 'move': {
        const cell = command.cell, level = state.level;
        if (!inside(level, cell) || !adjacent(level, state.hero.pos, cell)) return this.reject('只能移动到相邻格。');
        if (!passable(level.tiles[cell]!)) return this.reject('这里无法通行。');
        const enemy = this.mobAt(cell);
        if (enemy) {
          if (!this.visible[cell]) { this.interrupted = true; return this.reject('前方被挡住了。'); }
          cost = this.heroAttack(enemy, this.item(state.hero.weaponId)!);
        } else {
          const armor = this.item(state.hero.armorId)!;
          cost = Math.fround(Math.pow(1.2, Math.max(0, armorStats(armor).strength - state.hero.strength)));
          this.moveActor(state.hero, cell); state.stats.steps++;
        }
        break;
      }
      case 'attack': {
        const enemy = this.mobAt(command.target);
        if (!enemy || !this.canAttack(enemy.pos)) return this.reject('目标超出武器范围，或被墙与其他角色挡住。');
        cost = this.heroAttack(enemy, this.item(state.hero.weaponId)!);
        break;
      }
      case 'wait': cost = 1; break;
      case 'pickup': {
        const index = state.level.heaps.findIndex(heap => heap.item.id === command.itemId && heap.cell === state.hero.pos);
        if (index < 0) return this.reject('先走到物品所在的格子。');
        const item = state.level.heaps[index]!.item;
        if (!this.collect(item)) return this.reject('背包已满。');
        state.level.heaps.splice(index, 1); cost = 1;
        this.log('拾取了' + itemName(state, item) + (item.quantity > 1 ? ' ×' + item.quantity : '') + '。', 'good');
        this.events.push({ type: 'pickup', cell: state.hero.pos });
        break;
      }
      case 'explore': {
        const feature = this.nearbyFeatures().find(candidate => candidate.id === command.featureId);
        if (!feature) return this.reject('先靠近尚未使用的地点；被敌人占据时无法互动。');
        if (feature.kind === 'supply-cache' && (command.choice === undefined
          || !Number.isInteger(command.choice) || !feature.items[command.choice])) return this.reject('先选择一份补给。');
        if (feature.kind === 'chest' || feature.kind === 'supply-cache') {
          const items = feature.kind === 'supply-cache' ? [feature.items[command.choice!]!] : feature.items;
          for (const item of items) state.level.heaps.push({ cell: feature.cell, item, seen: true });
          this.events.push({ type: 'pickup', cell: feature.cell });
          this.log(feature.kind === 'chest' ? '打开了宝箱。物品留在原地，走上去按 G 拾取。'
            : '选定的补给留在原地，走上去按 G 拾取。', 'good');
        } else if (feature.kind === 'health-well') {
          this.heal(state.hero.maxHP);
          state.hunger.level = Math.max(0, state.hunger.level - 450);
          for (const id of [state.hero.weaponId, state.hero.armorId]) {
            const item = this.item(id)!; item.cursed = false; item.cursedKnown = true;
          }
          this.log('井水恢复了生命与饱腹，身上的装备不再受诅咒束缚。生命井已经枯竭。', 'good');
        } else {
          for (const id of [state.hero.weaponId, state.hero.armorId]) this.identify(this.item(id)!);
          for (const item of state.hero.inventory) if (['weapon', 'armor', 'missile'].includes(ITEMS[item.kind].category)) item.cursedKnown = true;
          state.awarenessUntil = state.hero.time + 2;
          this.observe(this.actionTime);
          this.log('装备的秘密显露，短暂感知到本层物品附近的景象。觉察井已经枯竭。', 'good');
        }
        // 使用与奖励领取是原子的一次行动；打开菜单、取消、重开页面均不重掷。
        feature.items = []; feature.status = 'used'; this.interrupted = true; cost = 1;
        break;
      }
      case 'throw': {
        const item = this.item(command.itemId);
        if (!item || item.kind !== 'spd:missile/throwing-stone') return this.reject('没有可投掷的石头。');
        if (!inside(state.level, command.target) || command.target === state.hero.pos || !this.visible[command.target]) return this.reject('选择视野内的另一个格子。');
        const route = ballistics(state.level, state.hero.pos, command.target, cell => !!this.mobAt(cell));
        if (route.collision === state.hero.pos) return this.reject('投掷路线被阻挡。');
        const split = splitStone(item, state.nextItemId++);
        const enemy = this.mobAt(route.collision);
        this.events.push({ type: 'throw', cell: route.collision, from: state.hero.pos, actorId: state.hero.id, hero: true });
        let hit = false;
        if (enemy) hit = this.heroHit(enemy, split.projectile, true);
        const resolved = resolveStoneThrow(split, hit);
        state.hero.inventory = state.hero.inventory.filter(value => value.id !== item.id);
        if (resolved.remaining) state.hero.inventory.push(resolved.remaining);
        if (resolved.landed) state.level.heaps.push({ cell: route.collision, item: resolved.landed, seen: this.visible[route.collision]! });
        if (resolved.broken) this.log('投掷石碎裂了。', 'hint');
        else if (resolved.aboutToBreak) this.log('这套投掷石已明显磨损。', 'hint');
        this.face(state.hero, command.target);
        const stats = weaponStats(item);
        cost = enemy ? Math.fround(stats.delay * Math.pow(1.2, Math.max(0, stats.strength - state.hero.strength))) : 1;
        state.stats.thrown++;
        break;
      }
      case 'use': {
        const item = this.item(command.itemId);
        if (!item) return this.reject('背包中没有这件物品。');
        if (item.kind === 'spd:food/ration') {
          state.hunger.level = Math.max(0, state.hunger.level - 300);
          const points = state.hero.talents['hearty-meal'];
          if (points > 0 && state.hero.hp / state.hero.maxHP < Math.fround(.334)) this.heal(2 + 2 * points);
          this.consume(item); this.log('你吃下一份口粮。', 'good'); cost = 3;
        } else if (item.kind === 'spd:potion/strength') {
          if (!state.knownTypes.includes(item.kind)) state.knownTypes.push(item.kind);
          state.hero.strength++; this.consume(item); cost = 1;
          this.log('力量提高到 ' + state.hero.strength + '，可以更轻松地驾驭装备。', 'good');
        } else if (item.kind === 'spd:potion/healing') {
          if (!state.knownTypes.includes(item.kind)) state.knownTypes.push(item.kind);
          const healing = state.healing;
          if (healing.left <= 0) healing.time = state.hero.time;
          healing.left = Math.max(healing.left, Math.floor(state.hero.maxHP * 0.8 + 14));
          this.consume(item); this.log('温暖的药力开始恢复体力。', 'good'); cost = 1;
        } else if (Object.values(FORGE_MATERIALS).includes(item.kind)) {
          const operation = (Object.keys(FORGE_MATERIALS) as (keyof typeof FORGE_MATERIALS)[])
            .find(key => FORGE_MATERIALS[key] === item.kind)!;
          const consumed = ITEMS[item.kind].category === 'scroll' && !state.knownTypes.includes(item.kind);
          state.pendingChoice = { type: operation, sourceId: item.id, consumed };
          if (consumed) {
            state.knownTypes.push(item.kind); this.consume(item);
            this.log('卷轴的文字显现：' + ITEMS[item.kind].name + '。请选择目标。', 'good');
          }
        } else return this.reject('请使用这件物品对应的装备或投掷操作。');
        break;
      }
      case 'upgrade':
      case 'apply-forge': {
        const pending = state.pendingChoice;
        const item = this.item(command.targetId);
        if (!pending || !item) return this.reject('请选择背包中的装备。');
        if (command.type === 'upgrade' && pending.type !== 'upgrade') return this.reject('当前材料不是升级卷轴。');
        if (!forgeEligible(pending.type, item, state.knownTypes)) return this.reject('这件物品不适合当前操作。');
        const augment = command.type === 'apply-forge' ? command.augment : undefined;
        if (pending.type === 'augment' && (!augment || !augmentChoices(item).includes(augment))) return this.reject('请选择与当前不同的增幅。');
        if (!pending.consumed) {
          const source = this.item(pending.sourceId);
          if (!source || source.kind !== FORGE_MATERIALS[pending.type]) return this.reject('缺少对应材料。');
          this.consume(source);
        }
        if (pending.type === 'upgrade') Object.assign(item, upgradeItem(item)!);
        else if (pending.type === 'identify') this.identify(item);
        else if (pending.type === 'remove-curse') { item.cursed = false; item.cursedKnown = true; }
        else item.augment = augment!;
        this.log(itemName(state, item) + (pending.type === 'upgrade' ? '提高了一级。'
          : pending.type === 'identify' ? '已完成鉴定。' : pending.type === 'remove-curse' ? '已确认不再受穿戴诅咒束缚。'
          : '改为' + AUGMENT_NAMES[item.augment] + '。'), 'good');
        state.pendingChoice = null; cost = 1;
        break;
      }
      case 'cancel-upgrade': {
        if (!state.pendingChoice) return this.reject('没有正在阅读的卷轴。');
        cost = state.pendingChoice.consumed ? 1 : 0;
        if (cost) this.log('你放弃了本次施用，展开的卷轴化为灰烬。', 'hint');
        state.pendingChoice = null; break;
      }
      case 'drop': {
        const item = this.item(command.itemId);
        if (!item) return this.reject('物品不在背包里。');
        if (item.id === state.hero.weaponId || item.id === state.hero.armorId) return this.reject('请先更换身上的装备。');
        state.hero.inventory = state.hero.inventory.filter(value => value.id !== item.id);
        state.level.heaps.push({ cell: state.hero.pos, item, seen: true });
        this.log('放下了' + itemName(state, item) + '。'); cost = 1; break;
      }
      case 'equip': {
        const item = this.item(command.itemId);
        if (!item) return this.reject('物品不在背包里。');
        if (ITEMS[item.kind].category === 'weapon') {
          if (item.id === state.hero.weaponId) return this.reject('已经装备这把武器。');
          if (this.item(state.hero.weaponId)?.cursed) return this.reject('当前武器被诅咒，无法卸下。');
          state.hero.weaponId = item.id;
        } else if (ITEMS[item.kind].category === 'armor') {
          if (item.id === state.hero.armorId) return this.reject('已经装备这件护甲。');
          if (this.item(state.hero.armorId)?.cursed) return this.reject('当前护甲被诅咒，无法卸下。');
          state.hero.armorId = item.id;
          if (state.hero.talents['veterans-intuition'] === 2) this.identify(item);
        } else return this.reject('这件物品不能穿戴。');
        // EquipableItem卸下旧装备1回合，再装备1回合；本切片不支持空装备槽。
        item.cursedKnown = true; cost = 2;
        this.log('装备了' + itemName(state, item) + '。' + (item.cursed ? '诅咒让它无法卸下！' : ''), item.cursed ? 'danger' : 'normal'); break;
      }
      case 'detach-seal': {
        const armor = this.item(command.armorId);
        if (!armor || ITEMS[armor.kind].category !== 'armor' || armor.sealLevel === null) return this.reject('这件护甲没有纹章。');
        const seal = createItem(state.nextItemId++, 'spd:utility/broken-seal');
        seal.level = armor.sealLevel; armor.level -= armor.sealLevel; armor.sealLevel = null;
        if (!this.collect(seal)) state.level.heaps.push({ cell: state.hero.pos, item: seal, seen: true });
        this.log('拆下破损纹章' + (this.item(seal.id) ? '，放进行囊。' : '，背包已满，纹章放在脚下。'), 'good');
        break;
      }
      case 'affix-seal': {
        const armor = this.item(command.armorId), seal = this.item(command.sealId);
        if (!armor || ITEMS[armor.kind].category !== 'armor' || armor.sealLevel !== null) return this.reject('请选择没有纹章的护甲。');
        if (!seal || seal.kind !== 'spd:utility/broken-seal') return this.reject('背包里没有这枚纹章。');
        if (!armor.cursedKnown || armor.cursed) return this.reject('先确认护甲没有诅咒，再装上纹章。');
        armor.sealLevel = seal.level; armor.level += seal.level; this.consume(seal);
        this.log('将纹章装到了' + itemName(state, armor) + '。', 'good'); break;
      }
      case 'learn-talent': {
        if (!(command.talent in TALENTS) || availableTalentPoints(state.hero) < 1 || state.hero.talents[command.talent] >= 2) return this.reject('当前没有可分配的天赋点，或这项天赋已满。');
        state.hero.talents[command.talent]++;
        if (command.talent === 'veterans-intuition' && state.hero.talents[command.talent] === 2) this.identify(this.item(state.hero.armorId)!);
        this.log('学会' + TALENTS[command.talent].name + ' · ' + state.hero.talents[command.talent] + '/2。', 'good'); break;
      }
      case 'finish-floor': {
        if (state.depth !== 5 || !state.level.bossDefeated || state.hero.pos !== state.level.exit) return this.reject('击败Goo后，在第五层出口完成第一章。');
        state.phase = 'chapter-complete';
        this.log('海岸下水道探索完成！带着这次远征记录返回海风镇。', 'good'); break;
      }
      case 'stairs': {
        if (state.level.locked) return this.reject('首领封住了楼层，击败Goo后才能离开。');
        const up = command.direction === 'up';
        if (state.hero.pos !== (up ? state.level.entrance : state.level.exit)) return this.reject('先站到相应的阶梯上。');
        const depth = state.depth + (up ? -1 : 1);
        if (depth < 1 || depth > 5) return this.reject('这里是当前章节的边界，请选择返回营地或完成第一章。');
        // 新层生成与预算消费先在副本完成，失败时不改变当前远征。
        const candidate = World.restore(this.snapshot()); candidate.enterFloor(depth);
        Object.assign(state, candidate.state); this.random = Random.restore(state.randomStates);
        this.events.push({ type: 'floor-change', cell: state.hero.pos, hero: true });
        this.interrupted = true; break;
      }
      case 'retire': state.phase = 'retired'; this.log('这次远征已结束。'); break;
    }
    if (cost > 0 && state.phase === 'playing') {
      spend(state.hero, cost); state.stats.actions++; this.advance();
    }
    this.observe();
    if (this.visibleEnemies().some(mob => !previousVisible.has(mob.id))) this.interrupted = true;
    state.randomStates = this.random.snapshot();
    return { changed: true, spent: state.hero.time - start, events: this.events, interrupted: this.interrupted };
  }

  private advance(): void {
    const state = this.state;
    while (state.phase === 'playing') {
      const actors: Scheduled[] = [state.hero, state.hunger, state.regeneration, state.seal,
        ...state.level.mobs.filter(mob => mob.hp > 0)];
      if (state.healing.left > 0) actors.push(state.healing);
      if (state.ooze.left > 0) actors.push(state.ooze);
      if (state.level.spawner) actors.push(state.level.spawner);
      // Awareness 到期与其他 buff 同优先级；同刻英雄/怪物先行动。
      // 只从保存的结束时刻派生，不新增持久 actor 或抽取随机数。
      if (state.awarenessUntil > 0) actors.push({kind: 'awareness-expiry', id: 0,
        time: state.awarenessUntil, priority: PRIORITY.buff});
      const actor = nextActor(actors)!;
      if (actor.kind === 'hero') break;
      this.actionTime = actor.time;
      // 同时刻英雄优先于 -30 的到期效果；之后的角色不能继续使用已过期激怒。
      if (state.hero.provokedUntil > 0 && actor.time >= state.hero.provokedUntil) state.hero.provokedUntil = 0;
      if (actor.kind === 'awareness-expiry') { state.awarenessUntil = 0; this.observe(actor.time); }
      else if (actor.kind === 'mob') this.mobAct(actor);
      else if (actor.kind === 'spawner') this.respawn(actor);
      else if (actor.kind === 'hunger') {
        // LockedFloor期间饥饿完全暂停，生命自然恢复另受剩余锁层时间限制。
        if (state.level.locked) { spend(actor, 1); continue; }
        if (actor.level >= 450) {
          actor.partialDamage = Math.fround(actor.partialDamage + Math.fround(state.hero.maxHP / 1000));
          if (actor.partialDamage > 1) {
            const damage = Math.trunc(actor.partialDamage);
            actor.partialDamage = Math.fround(actor.partialDamage - damage);
            this.damageHero(damage, '极度饥饿', true);
          }
        } else {
          actor.level = Math.fround(actor.level + 1);
          if (actor.level >= 450) { this.log('你已经极度饥饿，开始失去生命。', 'danger'); this.damageHero(1, '极度饥饿', true); }
          else if (actor.level === 300) this.log('肚子开始咕咕作响。', 'hint');
        }
        spend(actor, 1);
      } else if (actor.kind === 'regeneration') {
        if (state.hero.hp < state.hero.maxHP && state.hunger.level < 450
          && (!state.level.locked || state.level.lockedLeft >= 1)) {
          actor.partial = Math.fround(actor.partial + Math.fround(0.1));
          if (actor.partial >= 1) {
            const amount = Math.trunc(actor.partial); actor.partial = Math.fround(actor.partial - amount);
            this.heal(amount);
          }
        }
        spend(actor, 1);
      } else if (actor.kind === 'healing') {
        const amount = Math.min(actor.left, Math.max(1, Math.round(actor.left * 0.25)));
        actor.left -= amount; this.heal(amount); spend(actor, 1);
      } else if (actor.kind === 'ooze') {
        const water = state.level.tiles[state.hero.pos] === Tile.Water;
        if (actor.acted && water) actor.left = 0;
        else {
          actor.acted = true;
          if (state.depth === 5 || Math.trunc(actor.left) % 2 === 0) this.damageHero(1, '腐蚀淤泥');
          spend(actor, 1); actor.left = Math.max(0, actor.left - 1);
          // 首次淤泥结算仍会受伤，然后水才将淤泥洗去。
          if (water) actor.left = 0;
        }
      } else if (actor.kind === 'seal') {
        if (state.level.locked && state.level.lockedLeft >= 1) state.level.lockedLeft--;
        if (actor.cooldown > 0 && (!state.level.locked || state.level.lockedLeft >= 1)) actor.cooldown--;
        if (actor.shield > 0) {
          if (this.visibleEnemies().length === 0) {
            actor.turnsSinceEnemies++;
            if (actor.turnsSinceEnemies >= 5) {
              actor.cooldown = Math.max(0, Math.trunc(actor.cooldown - 75 * actor.shield / actor.initialShield)); actor.shield = 0;
            }
          } else actor.turnsSinceEnemies = 0;
        }
        spend(actor, 1);
      }
    }
  }

  private mobAct(mob: Mob): void {
    const { level, hero } = this.state;
    const goo = mob.species === 'spd:mob/goo';
    if (goo) {
      if (mob.state !== 'hunting') mob.pumpedUp = 0;
      if (level.tiles[mob.pos] === Tile.Water && mob.hp < mob.maxHP) {
        mob.hp++; if (level.locked) level.lockedLeft -= 1.5;
        if (this.visible[mob.pos]) this.events.push({ type: 'heal', cell: mob.pos, actorId: mob.id, amount: 1, hp: mob.hp });
      }
      if (mob.state !== 'sleeping') this.sealBossFloor();
    }
    const sight = fieldOfView(level, mob.pos, cell => blocksSight(level.tiles[cell]!), 8);
    const sees = sight[hero.pos]!;
    const justAlerted = mob.alerted; mob.alerted = false;
    if (mob.state === 'sleeping') {
      if (sees && this.random.float() < 1 / distance(level, mob.pos, hero.pos)) {
        mob.enemySeen = true; mob.state = 'hunting'; mob.target = hero.pos;
        if (goo) this.sealBossFloor();
        if (this.visible[mob.pos]) this.events.push({ type: 'alert', cell: mob.pos });
      } else mob.enemySeen = false;
      spend(mob, 1); return;
    }
    if (mob.state === 'wandering') {
      if (sees && (justAlerted || this.random.float() < 1 / (distance(level, mob.pos, hero.pos) / 2))) {
        mob.enemySeen = true; mob.alerted = true; mob.state = 'hunting'; mob.target = hero.pos;
        if (this.visible[mob.pos]) this.events.push({ type: 'alert', cell: mob.pos });
        return; // 转入追击本身不花行动，调度器随后再次处理同一 actor。
      }
      mob.enemySeen = false;
    } else {
      mob.enemySeen = sees;
      if (sees) {
        mob.target = hero.pos;
        if (goo ? this.gooCanAttack(mob) : adjacent(level, mob.pos, hero.pos)) {
          if (goo && (mob.pumpedUp === 1 || (mob.pumpedUp === 0 && this.random.int(mob.hp * 2 <= mob.maxHP ? 2 : 5) === 0))) {
            mob.pumpedUp++;
            if (this.visible[mob.pos]) {
              this.events.push({ type: 'charge', cell: mob.pos, actorId: mob.id, amount: mob.pumpedUp });
              this.log(mob.pumpedUp === 1 ? 'Goo开始蓄力！离开两格内的攻击范围。' : 'Goo即将释放强力一击！', 'danger');
            }
            this.interrupted = true;
          } else this.mobAttack(mob);
          spend(mob, 1); return;
        }
      }
    }
    if (goo) mob.pumpedUp = 0; // 原版getCloser/getFurther在移动尝试前解除蓄力。
    const canWalk = (cell: number): boolean => passable(level.tiles[cell]!)
      || (mob.species === 'spd:mob/swarm' && avoid(level.tiles[cell]!));
    const step = mob.target < 0 ? -1 : nextStep(level, mob.pos, mob.target,
      cell => canWalk(cell) && cell !== hero.pos && (!this.mobAt(cell) || cell === mob.pos));
    if (step >= 0 && step !== hero.pos && !this.mobAt(step)) {
      this.moveActor(mob, step); spend(mob, 1 / MOB_DEFINITIONS[mob.species].speed);
    } else {
      if (!sees) {
        mob.state = 'wandering';
        const destinations = level.tiles.map((_, cell) => cell).filter(cell => inside(level, cell) && canWalk(cell));
        mob.target = this.random.choose(destinations);
      }
      spend(mob, 1);
    }
  }

  private heroAttack(mob: Mob, weapon: Item): number {
    this.face(this.state.hero, mob.pos);
    this.events.push({ type: 'attack', cell: mob.pos, from: this.state.hero.pos, actorId: this.state.hero.id, hero: true });
    this.heroHit(mob, weapon, false);
    const stats = weaponStats(weapon);
    return Math.fround(stats.delay * Math.pow(1.2, Math.max(0, stats.strength - this.state.hero.strength)));
  }

  private heroHit(mob: Mob, weapon: Item, ranged: boolean): boolean {
    const { state, random } = this, hero = state.hero, stats = weaponStats(weapon);
    const definition = MOB_DEFINITIONS[mob.species];
    const sight = fieldOfView(state.level, mob.pos, cell => blocksSight(state.level.tiles[cell]!), 8);
    const surprise = (!mob.enemySeen || !sight[hero.pos]) && hero.strength >= stats.strength;
    let accuracy = hero.attackSkill * stats.accuracy / Math.pow(1.5, Math.max(0, stats.strength - hero.strength));
    if (ranged) accuracy *= adjacent(state.level, hero.pos, mob.pos) ? 0.5 : 1.5;
    accuracy = Math.max(1, Math.round(accuracy));
    const defense = definition.defense * (mob.species === 'spd:mob/goo' && mob.hp * 2 <= mob.maxHP ? 1.5 : 1);
    const hit = random.float(accuracy) >= random.float(surprise ? 0 : defense);
    if (hit) {
      // Char.drRoll 即使没有 Barkskin 仍抽两次 Float，不能因范围0..0跳过。
      let dr = random.normalInt(0, 0);
      if (definition.dr > 0) dr += random.normalInt(0, definition.dr);
      const min = surprise ? stats.min + Math.round(Math.fround((stats.max - stats.min) * Math.fround(stats.surpriseFraction))) : stats.min;
      const rolled = rollHeroDamage(random, min, stats.max, Math.max(0, hero.strength - stats.strength), stats.damageFactor);
      // Swarm.defenseProc在减甲前分裂；新生蝇群不再提供经验。
      if (mob.species === 'spd:mob/swarm' && mob.hp >= rolled + 2) {
        const candidates = [mob.pos + 1, mob.pos - 1, mob.pos + state.level.width, mob.pos - state.level.width]
          .filter(cell => inside(state.level, cell) && !solid(state.level.tiles[cell]!) && !this.mobAt(cell)
            && cell !== hero.pos && (passable(state.level.tiles[cell]!) || avoid(state.level.tiles[cell]!)));
        if (candidates.length) {
          const clone = this.createMob(mob.species, random.choose(candidates), Math.ceil(hero.time + 1));
          clone.hp = Math.floor((mob.hp - rolled) / 2); clone.generation = mob.generation + 1;
          clone.state = 'hunting'; clone.target = hero.pos; mob.hp -= clone.hp;
          this.log('蝇群分裂了，利用狭窄通道限制它们。', 'hint');
        }
      }
      let damage = Math.max(0, rolled - dr);
      // 激怒属于 attackProc，护甲减到0的命中也会消费并获得加伤；投掷同样适用。
      if (hero.talents['provoked-anger'] > 0 && hero.provokedUntil > 0 && hero.provokedUntil >= hero.time) {
        damage += 1 + 2 * hero.talents['provoked-anger']; hero.provokedUntil = 0;
      }
      if (!ranged) this.progressIdentification(weapon);
      if (mob.species === 'spd:mob/slime' && damage >= 5) damage = Math.trunc(4 + (Math.sqrt(8 * (damage - 4) + 1) - 1) / 2);
      if (mob.species === 'spd:mob/goo') {
        this.sealBossFloor(); state.level.lockedLeft = Math.min(50, state.level.lockedLeft + damage * 1.5);
        if (mob.hp * 2 > mob.maxHP && (mob.hp - damage) * 2 <= mob.maxHP && mob.hp > damage) {
          this.log('Goo进入狂暴状态，蓄力更加频繁。', 'danger');
        }
      }
      mob.state = 'hunting'; mob.target = hero.pos; mob.alerted = true;
      mob.hp = Math.max(0, mob.hp - damage);
      this.log((surprise ? '偷袭！' : '') + '击中' + definition.name + '，造成 ' + damage + ' 点伤害。');
      this.events.push({ type: damage > 0 ? 'hit' : 'block', cell: mob.pos, amount: damage,
        actorId: mob.id, sourceId: hero.id, surprise, hp: mob.hp });
      if (mob.hp === 0) {
        this.events.push({ type: 'death', cell: mob.pos, actorId: mob.id, sourceId: hero.id }); state.stats.kills++;
        this.log('击败了' + definition.name + '。', 'good');
        this.dropLoot(mob);
        if (hero.hp > 0 && hero.level <= definition.maxLevel && !(mob.species === 'spd:mob/swarm' && mob.generation > 0)) this.gainXP(definition.xp);
        state.level.mobs = state.level.mobs.filter(enemy => enemy.id !== mob.id);
        if (mob.species === 'spd:mob/goo') {
          state.level.locked = false; state.level.lockedLeft = 0; state.level.bossDefeated = true;
          this.log('Goo倒下，封锁解除。走到本层向下的阶梯完成第一章。', 'good'); this.interrupted = true;
        }
      }
    } else {
      this.log(definition.name + '躲开了攻击。'); this.events.push({ type: 'miss', cell: mob.pos, actorId: mob.id, sourceId: hero.id });
    }
    return hit;
  }

  private mobAttack(mob: Mob): void {
    const { hero } = this.state, definition = MOB_DEFINITIONS[mob.species];
    this.face(mob, hero.pos);
    this.events.push({ type: 'attack', cell: hero.pos, from: mob.pos, actorId: mob.id, amount: mob.pumpedUp });
    const armor = armorStats(this.item(hero.armorId)!);
    const missingStrength = Math.max(0, armor.strength - hero.strength);
    const defense = Math.max(1, Math.round(hero.defenseSkill / Math.pow(1.5, missingStrength) + armor.evasionBonus));
    const goo = mob.species === 'spd:mob/goo', enraged = goo && mob.hp * 2 <= mob.maxHP;
    const charged = goo && mob.pumpedUp > 0;
    const attack = (enraged ? 15 : definition.attack) * (charged ? 2 : 1);
    const hit = this.random.float(attack) >= this.random.float(defense);
    if (hit) {
      this.random.normalInt(0, 0); // Char.drRoll，无 Barkskin。
      let dr = Math.max(0, this.random.normalInt(armor.min, armor.max) - 2 * missingStrength);
      const weapon = weaponStats(this.item(hero.weaponId)!);
      dr += Math.max(0, this.random.normalInt(0, weapon.defense) - 2 * Math.max(0, weapon.strength - hero.strength));
      this.progressIdentification(this.item(hero.armorId)!);
      const multiplier = charged ? 3 : 1;
      const damage = Math.max(0, this.random.normalInt(definition.min * multiplier, (enraged ? 12 : definition.max) * multiplier) - dr);
      if (goo && this.random.int(3) === 0) {
        const ooze = this.state.ooze;
        if (ooze.left <= 0) ooze.time = mob.time;
        ooze.left = 20; ooze.acted = false;
        this.log('身上沾满腐蚀淤泥，走入水中可以洗去。', 'danger');
      }
      this.damageHero(damage, definition.name, false, mob.id);
      if (damage === 0) {
        this.events.push({ type: 'block', cell: hero.pos, actorId: hero.id, sourceId: mob.id, hero: true });
        this.log('护甲挡住了' + definition.name + '的攻击。');
      }
    } else {
      this.events.push({ type: 'miss', cell: hero.pos, hero: true, actorId: hero.id, sourceId: mob.id });
      this.log('你躲开了' + definition.name + '的攻击。');
    }
    if (goo) mob.pumpedUp = 0;
    this.interrupted = true;
  }

  private dropLoot(mob: Mob): void {
    if (this.state.hero.level > MOB_DEFINITIONS[mob.species].maxLevel + 2) return;
    let kind: ItemKind | null = null, quantity = 1;
    if (mob.species === 'spd:mob/gnoll' && this.random.float() < 0.5) {
      kind = 'spd:currency/gold'; quantity = this.random.range(30 + 10 * this.state.depth, 60 + 20 * this.state.depth);
    } else if (mob.species === 'spd:mob/swarm'
      && this.random.float() < 1 / (6 * (mob.generation + 1)) * (5 - this.state.drops.swarmHealing) / 5) {
      kind = 'spd:potion/healing'; this.state.drops.swarmHealing++;
    } else if (mob.species === 'spd:mob/slime' && this.random.float() < .2 * Math.pow(.25, this.state.drops.slimeWeapons)) {
      const pool = (Object.keys(ITEMS) as ItemKind[]).filter(candidate => ITEMS[candidate].category === 'weapon' && ITEMS[candidate].tier === 2);
      const item = randomizeEquipment(createItem(this.state.nextItemId++, this.random.choose(pool)), this.random);
      item.level = 0; this.state.drops.slimeWeapons++;
      this.state.level.heaps.push({ cell: mob.pos, item, seen: this.visible[mob.pos]! });
    }
    // 尚未移植的种子与生肉状态不以其他道具代替。
    if (kind) this.state.level.heaps.push({ cell: mob.pos,
      item: createItem(this.state.nextItemId++, kind, quantity), seen: this.visible[mob.pos]! });
  }

  private damageHero(amount: number, source: string, starvation = false, sourceId?: number): void {
    const { hero, seal } = this.state;
    if (amount <= 0) return;
    if (!starvation && seal.cooldown <= 0 && this.item(hero.armorId)?.sealLevel !== null
      && (hero.hp <= Math.floor(hero.maxHP / 2) || hero.hp + seal.shield - amount <= Math.floor(hero.maxHP / 2))) {
      seal.initialShield = 3 + 2 * armorStats(this.item(hero.armorId)!).tier + hero.talents['iron-will'];
      seal.shield += seal.initialShield; seal.cooldown = 150; seal.turnsSinceEnemies = 0;
      this.log('破损纹章亮起，展开 ' + seal.initialShield + ' 点护盾。', 'good');
    }
    const blocked = starvation ? 0 : Math.min(amount, seal.shield);
    seal.shield -= blocked;
    if (blocked > 0 && seal.shield === 0 && hero.talents['provoked-anger'] > 0) {
      hero.provokedUntil = Math.fround(Math.max(this.actionTime, hero.provokedUntil) + 5);
      this.log('护盾破碎激起怒意，下一次命中得到加伤。', 'good');
    }
    const damage = amount - blocked;
    hero.hp = Math.max(0, hero.hp - damage);
    this.interrupted = true;
    this.events.push({ type: damage > 0 ? 'hit' : 'block', cell: hero.pos, amount: damage,
      blocked, hero: true, actorId: hero.id, sourceId, hp: hero.hp });
    this.log(source + '造成 ' + damage + ' 点伤害' + (blocked > 0 ? '，护盾吸收 ' + blocked + ' 点' : '') + '。', 'danger');
    if (hero.hp === 0) {
      this.state.phase = 'dead'; this.state.deathCause = source;
      this.events.push({ type: 'death', cell: hero.pos, hero: true, actorId: hero.id, sourceId });
      this.log('远征止步于此。下一次，带着经验再次出发。', 'danger');
    }
  }

  private heal(amount: number): void {
    const hero = this.state.hero, healed = Math.min(amount, hero.maxHP - hero.hp);
    hero.hp += healed;
    if (healed > 0) this.events.push({ type: 'heal', cell: hero.pos, amount: healed, hero: true, hp: hero.hp });
  }

  private gainXP(amount: number): void {
    const hero = this.state.hero;
    const percent = Math.fround(amount / experienceToLevel(hero.level));
    for (const id of [hero.weaponId, hero.armorId]) {
      const item = this.item(id)!;
      if (item.levelKnown) continue;
      const total = ITEMS[item.kind].category === 'weapon' ? 20 : 10;
      item.availableUsesToID = Math.min(total / 2, Math.fround(item.availableUsesToID
        + Math.fround(Math.fround(percent * this.identificationFactor(item)) * total)));
    }
    hero.xp += amount;
    while (hero.xp >= experienceToLevel(hero.level) && hero.level < MAX_HERO_LEVEL) {
      hero.xp -= experienceToLevel(hero.level); hero.level++; hero.attackSkill++; hero.defenseSkill++;
      hero.maxHP += 5; hero.hp += 5;
      this.events.push({ type: 'level-up', cell: hero.pos, hero: true, hp: hero.hp });
      this.log('升至 ' + hero.level + ' 级：生命上限、命中与闪避提高。' + (hero.level <= 6 ? '获得1点天赋，按 L 分配。' : ''), 'good');
    }
  }

  private identify(item: Item): void {
    if (['potion','scroll'].includes(ITEMS[item.kind].category) && !this.state.knownTypes.includes(item.kind)) this.state.knownTypes.push(item.kind);
    item.levelKnown = true; item.cursedKnown = true;
  }

  private identificationFactor(item: Item): number {
    const points = this.state.hero.talents['veterans-intuition'];
    return ITEMS[item.kind].category === 'weapon' ? 1 + .75 * points : 1 + points;
  }

  private progressIdentification(item: Item): void {
    if (item.levelKnown || identified(item, this.state.knownTypes)) return;
    const uses = Math.min(item.availableUsesToID, this.identificationFactor(item));
    item.availableUsesToID = Math.fround(item.availableUsesToID - uses);
    item.usesLeftToID = Math.fround(item.usesLeftToID - uses);
    if (item.usesLeftToID <= 0) {
      this.identify(item); this.log('战斗中逐渐熟悉了' + itemName(this.state, item) + '，鉴定完成。', 'good');
    }
  }

  private moveActor(actor: Hero | Mob, to: number): void {
    const level = this.state.level, from = actor.pos;
    this.face(actor, to); actor.previousPos = from; actor.pos = to;
    const changedTerrain = level.tiles[to] === Tile.Door || level.tiles[to] === Tile.HighGrass
      || (level.tiles[from] === Tile.OpenDoor && !level.heaps.some(heap => heap.cell === from));
    if (level.tiles[to] === Tile.Door) level.tiles[to] = Tile.OpenDoor;
    if (level.tiles[to] === Tile.HighGrass && !(actor.kind === 'mob' && actor.species === 'spd:mob/swarm')) level.tiles[to] = Tile.Grass;
    if (level.tiles[from] === Tile.OpenDoor && !level.heaps.some(heap => heap.cell === from)) level.tiles[from] = Tile.Door;
    if (actor.kind === 'hero' || changedTerrain) this.observe(this.actionTime);
    if (this.visible[from] || this.visible[to]) this.events.push({ type: 'move', cell: to, from, hero: actor.kind === 'hero', actorId: actor.id });
  }

  private face(actor: Hero | Mob, target: number): void {
    const dx = target % this.state.level.width - actor.pos % this.state.level.width;
    if (dx !== 0) actor.facing = dx < 0 ? -1 : 1;
  }

  private collect(item: Item): boolean {
    const hero = this.state.hero;
    if (item.kind === 'spd:currency/gold') { hero.gold += item.quantity; return true; }
    if (ITEMS[item.kind].stackable) {
      const same = hero.inventory.find(value => value.kind === item.kind && value.level === item.level && value.setId === item.setId);
      if (same) {
        if (item.kind === 'spd:missile/throwing-stone') {
          const merged = mergeStoneStacks(same, item);
          if (!merged) return false;
          hero.inventory[hero.inventory.indexOf(same)] = merged;
        } else same.quantity += item.quantity;
        return true;
      }
    }
    // 已装备物品不占背包槽，首版不带尚未实现的VelvetPouch。
    if (hero.inventory.filter(value => value.id !== hero.weaponId && value.id !== hero.armorId).length >= 20) return false;
    hero.inventory.push({ ...item, extraThrownLeft: false }); return true;
  }

  private consume(item: Item): void {
    item.quantity--;
    if (item.quantity === 0) this.state.hero.inventory = this.state.hero.inventory.filter(value => value.id !== item.id);
  }
  private log(text: string, tone: Message['tone'] = 'normal'): void {
    this.state.messages.push({ id: this.state.nextMessageId++, text, tone });
    if (this.state.messages.length > 80) this.state.messages.shift();
  }
  private reject(reason: string): ActionResult {
    return { changed: false, spent: 0, events: [], interrupted: true, reason };
  }
}
