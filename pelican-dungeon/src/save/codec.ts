/* SPDX-License-Identifier: GPL-3.0-or-later
 * 浏览器存档适配：ScarfQian，2026-10-30。
 * 对照固定 SPD 基线 Dungeon/Hero/Level/Item 的持久状态；不兼容 Java Bundle 存档。
 * 本模块验证已接入的五层数据，再返回独立对象；不补造缺失物品、随机状态或行动时间。
 */

import version from '../../version.json';
import type { GameState } from '../game/model';
import { FORGE_MATERIALS, ITEMS } from '../game/items';
import { MOB_DEFINITIONS } from '../game/enemies';
import { Tile, avoid, blocksSight, inside, passable, solid, type Grid, type TileId } from '../game/terrain';

export const SAVE_PROJECT = version.project;
export const SAVE_SCHEMA_VERSION = 4;
type Fields = Record<string, unknown>;
const tileIds = new Set<number>(Object.values(Tile));
const itemKinds = Object.keys(ITEMS);
const mobKinds = Object.keys(MOB_DEFINITIONS);
const talentKeys = ['hearty-meal', 'veterans-intuition', 'provoked-anger', 'iron-will'] as const;

function invalid(path: string, reason: string): never {
  throw new Error(`无法读取存档：${path}${reason}。原存档未被修改。`);
}
function object(value: unknown, path: string): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, '不是完整对象');
  return value as Fields;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(path, '缺少有效文字');
  return value;
}
function numeric(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(path, '数值无效');
  return value;
}
function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = numeric(value, path, min, max);
  if (!Number.isSafeInteger(result)) invalid(path, '必须是有效整数');
  return result;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, '不是布尔值');
  return value;
}
function choice<T extends string | number>(value: unknown, values: readonly T[], path: string): T {
  if (!values.includes(value as T)) invalid(path, '包含当前版本不支持的类型');
  return value as T;
}
function list<T>(value: unknown, path: string, read: (entry: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) invalid(path, '不是数组');
  return Array.from(value, (entry: unknown, index: number) => read(entry, `${path}[${index}]`));
}
function uniqueId(id: number, used: Set<number>, path: string): void {
  if (used.has(id)) invalid(path, '与已有编号重复');
  used.add(id);
}

/** 旧首层档只补充新格式字段；原始对象与数据库记录均不在读取时改写。 */
function migrateFirstFloor(original: Fields): Fields {
  if (original.depth !== 1) invalid('旧存档楼层', '不是已支持的首层');
  choice(original.phase, ['playing', 'dead', 'floor-complete', 'retired'], '旧存档远征状态');
  const state = structuredClone(original);
  const hero = object(state.hero, '旧存档英雄');
  const time = numeric(hero.time, '旧存档英雄行动时间');
  const nextActorId = integer(state.nextActorId, '旧存档下一角色编号', 1, Number.MAX_SAFE_INTEGER - 1);
  const level = object(state.level, '旧存档地图');
  list(level.mobs, '旧存档怪物', (entry, path) => {
    const mob = object(entry, path);
    mob.generation = 0;
    mob.pumpedUp = 0;
  });
  Object.assign(level, { depth: 1, lastTime: time, locked: false, lockedLeft: 0, bossDefeated: false, spawner: null });
  state.archivedLevels = {};
  state.deepestFloor = 1;
  // 旧版首层已经固定投放一张卷轴，不能从当前背包推断它是否曾出现。
  state.drops = { strength: 0, upgrades: 1, swarmHealing: 0 };
  state.ooze = { kind: 'ooze', id: nextActorId, time, priority: -30, left: 0, acted: false };
  state.nextActorId = nextActorId + 1;
  state.schemaVersion = 2;
  return state;
}

/** schema 2 没有记录自动鉴定进度；只初始化新字段，不推算过去的命中或补发物品。 */
function migrateEquipment(original: Fields): Fields {
  const state = structuredClone(original);
  const hero = object(state.hero, '旧存档英雄');
  function addItemFields(value: unknown, path: string): void {
    const entry = object(value, path);
    const kind = choice(entry.kind, itemKinds, `${path}.kind`) as keyof typeof ITEMS;
    const category = ITEMS[kind].category;
    const uses = category === 'weapon' ? 20 : category === 'armor' ? 10 : 0;
    if (entry.augment === undefined) entry.augment = 'none';
    if (entry.usesLeftToID === undefined) entry.usesLeftToID = uses;
    if (entry.availableUsesToID === undefined) entry.availableUsesToID = uses / 2;
  }
  list(hero.inventory, '旧存档背包', addItemFields);
  function addLevelFields(value: unknown, path: string): void {
    const level = object(value, path);
    list(level.heaps, `${path}.heaps`, (entry, heapPath) => {
      addItemFields(object(entry, heapPath).item, `${heapPath}.item`);
    });
  }
  addLevelFields(state.level, '旧存档当前地图');
  const archived = object(state.archivedLevels, '旧存档已离开楼层');
  for (const [key, level] of Object.entries(archived)) addLevelFields(level, `旧存档已离开楼层.${key}`);
  if (hero.talents === undefined) hero.talents = Object.fromEntries(talentKeys.map(key => [key, 0]));
  if (hero.provokedUntil === undefined) hero.provokedUntil = 0;
  const drops = object(state.drops, '旧存档区域掉落记录');
  if (drops.slimeWeapons === undefined) drops.slimeWeapons = 0;
  state.schemaVersion = 3;
  return state;
}

/** 旧层不补放探索设施，不重新抽取奖励；新功能只从后续首次生成的楼层开始。 */
function migrateExploration(original: Fields): Fields {
  const state = structuredClone(original);
  object(state.level, '旧存档当前地图').features = [];
  const archived = object(state.archivedLevels, '旧存档已离开楼层');
  for (const [key, value] of Object.entries(archived)) {
    object(value, `旧存档已离开楼层.${key}`).features = [];
  }
  state.awarenessUntil = 0;
  state.schemaVersion = 4;
  return state;
}

/** 只接受本项目的导出包；同 schema 的版本号保留原值，不因补丁版不同而拒绝。 */
export function decodeSave(value: unknown): GameState {
  const envelope = object(value, '存档包');
  if (envelope.project !== SAVE_PROJECT) invalid('项目标识', '不属于鹈鹕地牢网页版');
  if (![1, 2, 3, SAVE_SCHEMA_VERSION].includes(envelope.schemaVersion as number)) invalid('存档格式', '尚未支持，不能自动迁移');
  const source = object(envelope.state, '游戏状态');
  if (source.schemaVersion !== envelope.schemaVersion) invalid('游戏状态格式', '与存档包不一致');
  let state = envelope.schemaVersion === 1 ? migrateFirstFloor(source) : source;
  if (state.schemaVersion === 2) state = migrateEquipment(state);
  if (state.schemaVersion === 3) state = migrateExploration(state);
  const gameVersion = text(state.gameVersion, '游戏版本');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(gameVersion)) invalid('游戏版本', '格式无效');
  if (state.upstreamCommit !== version.upstream.commit) invalid('上游基线', '尚未支持');
  text(state.runId, '远征编号');
  const seed = text(state.seed, '随机种子');
  if (!/^-?\d+$/.test(seed)) invalid('随机种子', '不是十进制整数');
  // 种子保持十进制字符串，不经 Number 转换；Random 自身执行 64 位截断。
  const phase = choice(state.phase, ['playing', 'dead', 'floor-complete', 'chapter-complete', 'retired'] as const, '远征状态');
  const depth = integer(state.depth, '楼层', 1, 5);
  const deepestFloor = integer(state.deepestFloor, '最深楼层', depth, 5);
  const nextActorId = integer(state.nextActorId, '下一角色编号', 1);
  const nextItemId = integer(state.nextItemId, '下一物品编号', 1);
  const nextMessageId = integer(state.nextMessageId, '下一消息编号', 1);
  numeric(state.awarenessUntil, '觉察结束时间', 0);

  const actorIds = new Set<number>(), itemIds = new Set<number>();
  const featureIds = new Set<string>();
  function actor(value: unknown, path: string, kind: string): Fields {
    const entry = object(value, path);
    if (entry.kind !== kind) invalid(path, '角色类型不匹配');
    const id = integer(entry.id, `${path}.id`, 1, nextActorId - 1);
    uniqueId(id, actorIds, `${path}.id`);
    numeric(entry.time, `${path}.time`);
    integer(entry.priority, `${path}.priority`, Number.MIN_SAFE_INTEGER);
    return entry;
  }
  function item(value: unknown, path: string): Fields {
    const entry = object(value, path);
    const id = integer(entry.id, `${path}.id`, 1, nextItemId - 1);
    uniqueId(id, itemIds, `${path}.id`);
    const kind = choice(entry.kind, itemKinds, `${path}.kind`) as keyof typeof ITEMS;
    const category = ITEMS[kind].category;
    const quantity = integer(entry.quantity, `${path}.quantity`, 1);
    if (!ITEMS[kind].stackable && quantity !== 1) invalid(path, '不可堆叠的装备数量不为一');
    integer(entry.level, `${path}.level`, Number.MIN_SAFE_INTEGER);
    if (kind === 'spd:utility/broken-seal') choice(entry.level, [0, 1], `${path}.level`);
    boolean(entry.levelKnown, `${path}.levelKnown`);
    boolean(entry.cursed, `${path}.cursed`);
    boolean(entry.cursedKnown, `${path}.cursedKnown`);
    const augments = category === 'weapon' ? ['none', 'speed', 'damage']
      : category === 'armor' ? ['none', 'evasion', 'defense'] : ['none'];
    choice(entry.augment, augments, `${path}.augment`);
    const uses = category === 'weapon' ? 20 : category === 'armor' ? 10 : 0;
    // 自动鉴定的最后一次触发可能越过零；已鉴定后不重置或截断这个历史进度。
    numeric(entry.usesLeftToID, `${path}.usesLeftToID`, uses > 0 ? -Infinity : 0, uses);
    numeric(entry.availableUsesToID, `${path}.availableUsesToID`, 0, uses / 2);
    numeric(entry.durability, `${path}.durability`, 0, 100);
    const setId = integer(entry.setId, `${path}.setId`, 0, nextItemId - 1);
    if (kind === 'spd:missile/throwing-stone' && setId === 0) invalid(path, '投掷套组编号缺失');
    if (kind !== 'spd:missile/throwing-stone' && setId !== 0) invalid(path, '非投掷物携带了套组编号');
    boolean(entry.extraThrownLeft, `${path}.extraThrownLeft`);
    if (entry.sealLevel !== null) {
      choice(entry.sealLevel, [0, 1], `${path}.sealLevel`);
      if (ITEMS[kind].category !== 'armor') invalid(path, '纹章没有附着于护甲');
    }
    return entry;
  }

  const hero = actor(state.hero, '英雄', 'hero');
  integer(hero.strength, '英雄力量', 1);
  const heroLevel = integer(hero.level, '英雄等级', 1);
  integer(hero.xp, '英雄经验');
  numeric(hero.attackSkill, '英雄攻击能力', 0);
  numeric(hero.defenseSkill, '英雄防御能力', 0);
  integer(hero.gold, '金币');
  const talents = object(hero.talents, '英雄天赋');
  for (const key of Object.keys(talents)) choice(key, talentKeys, `英雄天赋.${key}`);
  let talentPoints = 0;
  for (const key of talentKeys) talentPoints += integer(talents[key], `英雄天赋.${key}`, 0, 2);
  if (talentPoints > Math.min(5, Math.max(0, heroLevel - 1))) invalid('英雄天赋', '超过当前等级可用点数');
  numeric(hero.provokedUntil, '激怒结束时间', 0);
  const inventory = list(hero.inventory, '背包', item);
  const weaponId = integer(hero.weaponId, '已装备武器编号', 1);
  const armorId = integer(hero.armorId, '已装备护甲编号', 1);
  // 当前 World 需要两件装备；徒手/无护甲尚未接入，不能用默认物品补齐损坏引用。
  if (!inventory.some(entry => entry.id === weaponId && ITEMS[entry.kind as keyof typeof ITEMS].category === 'weapon')) invalid('已装备武器', '没有对应的背包武器');
  if (!inventory.some(entry => entry.id === armorId && ITEMS[entry.kind as keyof typeof ITEMS].category === 'armor')) invalid('已装备护甲', '没有对应的背包护甲');

  function readLevel(value: unknown, path: string, expectedDepth: number, active: boolean): Fields {
    const level = object(value, path);
    if (level.depth !== expectedDepth) invalid(`${path}.depth`, '与登记楼层不一致');
    numeric(level.lastTime, `${path}.lastTime`);
    boolean(level.locked, `${path}.locked`);
    // Goo 在水中恢复会扣除锁层预算；预算允许为负，不可把旧值截断为零。
    numeric(level.lockedLeft, `${path}.lockedLeft`);
    boolean(level.bossDefeated, `${path}.bossDefeated`);
    if (!active && 'hero' in level) invalid(path, '归档层不应保存英雄副本');
    const width = integer(level.width, `${path}.width`, 3), height = integer(level.height, `${path}.height`, 3);
    const size = integer(width * height, `${path}.格子数量`, 9);
    const tiles = list(level.tiles, `${path}.tiles`, (entry, tilePath) => {
      const tile = integer(entry, tilePath);
      if (!tileIds.has(tile)) invalid(tilePath, '包含尚未支持的地形');
      return tile as TileId;
    });
    if (tiles.length !== size) invalid(`${path}.tiles`, '与地图尺寸不一致');
    const grid: Grid = { width, height, tiles };
    function cell(value: unknown, cellPath: string, interior = false): number {
      const result = integer(value, cellPath, 0, size - 1);
      if (interior && !inside(grid, result)) invalid(cellPath, '不在地图内圈');
      return result;
    }
    for (let index = 0; index < size; index++) {
      if (inside(grid, index)) continue;
      const tile = tiles[index]!;
      if (passable(tile) || avoid(tile) || !solid(tile) || !blocksSight(tile)) invalid(`${path}.边界`, '没有封闭');
    }
    const entrance = cell(level.entrance, `${path}.entrance`, true), exit = cell(level.exit, `${path}.exit`, true);
    if (entrance === exit || tiles[entrance] !== Tile.Entrance || tiles[exit] !== Tile.Exit) invalid(`${path}.楼梯位置`, '与地形不一致');
    const visited = list(level.visited, `${path}.visited`, boolean);
    if (visited.length !== size) invalid(`${path}.visited`, '与地图尺寸不一致');
    list(level.rooms, `${path}.rooms`, (entry, roomPath) => {
      const room = object(entry, roomPath);
      const left = integer(room.left, `${roomPath}.left`, 0, width - 1);
      const right = integer(room.right, `${roomPath}.right`, 0, width - 1);
      const top = integer(room.top, `${roomPath}.top`, 0, height - 1);
      const bottom = integer(room.bottom, `${roomPath}.bottom`, 0, height - 1);
      if (right <= left || bottom <= top) invalid(roomPath, '边界无效');
      choice(room.kind, ['entrance', 'exit', 'empty', 'tunnel', 'striped', 'water-bridge', 'sewer-pipe', 'goo-walled'], `${roomPath}.kind`);
    });
    // 不同楼层可以复用格子编号；只有当前层参与英雄与怪物的占位检查。
    const occupied = new Set<number>();
    function character(entry: Fields, characterPath: string): number {
      const pos = cell(entry.pos, `${characterPath}.pos`, true);
      cell(entry.previousPos, `${characterPath}.previousPos`, true);
      choice(entry.facing, [-1, 1], `${characterPath}.facing`);
      const maxHP = integer(entry.maxHP, `${characterPath}.maxHP`, 1);
      const hp = integer(entry.hp, `${characterPath}.hp`, 0, maxHP);
      if (!passable(tiles[pos]!) && !avoid(tiles[pos]!)) invalid(`${characterPath}.pos`, '位于不可进入的地形');
      if (hp > 0) {
        if (occupied.has(pos)) invalid(`${characterPath}.pos`, '与存活角色重叠');
        occupied.add(pos);
      }
      return hp;
    }
    if (active) {
      const heroHP = character(hero, '英雄');
      if ((phase === 'dead') !== (heroHP === 0)) invalid('英雄生命值', '与远征状态不一致');
    }
    list(level.mobs, `${path}.mobs`, (entry, mobPath) => {
      const mob = actor(entry, mobPath, 'mob');
      if (character(mob, mobPath) <= 0) invalid(mobPath, '仍登记了已经死亡的怪物');
      choice(mob.species, mobKinds, `${mobPath}.species`);
      choice(mob.state, ['sleeping', 'wandering', 'hunting'], `${mobPath}.state`);
      if (mob.target !== -1) cell(mob.target, `${mobPath}.target`, true);
      boolean(mob.enemySeen, `${mobPath}.enemySeen`);
      boolean(mob.alerted, `${mobPath}.alerted`);
      integer(mob.generation, `${mobPath}.generation`);
      integer(mob.pumpedUp, `${mobPath}.pumpedUp`, 0, 2);
    });
    list(level.heaps, `${path}.heaps`, (entry, heapPath) => {
      const heap = object(entry, heapPath);
      cell(heap.cell, `${heapPath}.cell`, true);
      item(heap.item, `${heapPath}.item`);
      boolean(heap.seen, `${heapPath}.seen`);
    });
    const featureCells = new Set<number>();
    list(level.features, `${path}.features`, (entry, featurePath) => {
      const feature = object(entry, featurePath);
      const id = text(feature.id, `${featurePath}.id`);
      if (featureIds.has(id)) invalid(`${featurePath}.id`, '与已有探索设施编号重复');
      featureIds.add(id);
      const kind = choice(feature.kind, ['chest', 'health-well', 'awareness-well', 'supply-cache'], `${featurePath}.kind`);
      const pos = cell(feature.cell, `${featurePath}.cell`, true);
      const tile = tiles[pos]!;
      if (!passable(tile) || tile === Tile.Entrance || tile === Tile.Exit || tile === Tile.Door || tile === Tile.OpenDoor) {
        invalid(`${featurePath}.cell`, '不在可放置设施的通行格');
      }
      if (featureCells.has(pos)) invalid(`${featurePath}.cell`, '与本层其他探索设施重叠');
      featureCells.add(pos);
      // 人物可以走过设施，开启后的掉落也可留在原格，不参与角色占位去重。
      boolean(feature.seen, `${featurePath}.seen`);
      const status = choice(feature.status, ['ready', 'used'], `${featurePath}.status`);
      const contents = list(feature.items, `${featurePath}.items`, item);
      if (status === 'used' || kind === 'health-well' || kind === 'awareness-well') {
        if (contents.length !== 0) invalid(`${featurePath}.items`, '此设施不应保留物品');
      } else if (kind === 'chest' && contents.length === 0) {
        invalid(`${featurePath}.items`, '未开启宝箱缺少封存物品');
      } else if (kind === 'supply-cache' && contents.length !== 2) {
        invalid(`${featurePath}.items`, '未领取补给必须保留两件候选物品');
      }
    });
    if (expectedDepth >= 2 && expectedDepth <= 4) {
      const spawner = actor(level.spawner, `${path}.spawner`, 'spawner');
      list(spawner.bag, `${path}.spawner.bag`, (entry, bagPath) => choice(entry, mobKinds, bagPath));
    } else if (level.spawner !== null) invalid(`${path}.spawner`, '此楼层不应有补怪器');
    return level;
  }

  const level = readLevel(state.level, '当前地图', depth, true);
  const archived = object(state.archivedLevels, '已离开楼层');
  for (const [key, value] of Object.entries(archived)) {
    if (!/^[1-5]$/.test(key)) invalid(`已离开楼层.${key}`, '楼层编号无效');
    const archivedDepth = Number(key);
    if (archivedDepth === depth) invalid(`已离开楼层.${key}`, '重复保存了当前层');
    if (archivedDepth > deepestFloor) invalid(`已离开楼层.${key}`, '超过最深楼层记录');
    readLevel(value, `已离开楼层.${key}`, archivedDepth, false);
  }
  if (phase === 'chapter-complete' && (depth !== 5 || !level.bossDefeated)) invalid('首章完成状态', '与首领进度不一致');
  if (phase === 'floor-complete' && depth !== 1) invalid('旧首层完成状态', '与楼层不一致');
  const drops = object(state.drops, '区域掉落记录');
  integer(drops.strength, '区域力量药水投放');
  integer(drops.upgrades, '区域升级卷轴投放');
  integer(drops.swarmHealing, '蝇群治疗药水掉落');
  integer(drops.slimeWeapons, '史莱姆武器掉落');
  const hunger = actor(state.hunger, '饥饿', 'hunger');
  numeric(hunger.level, '饥饿程度', 0);
  numeric(hunger.partialDamage, '饥饿伤害余量', 0);
  const regeneration = actor(state.regeneration, '自然恢复', 'regeneration');
  numeric(regeneration.partial, '自然恢复余量', 0);
  const healing = actor(state.healing, '治疗效果', 'healing');
  integer(healing.left, '待恢复生命', 0);
  const seal = actor(state.seal, '纹章', 'seal');
  numeric(seal.shield, '纹章护盾', 0);
  numeric(seal.cooldown, '纹章冷却', 0);
  integer(seal.turnsSinceEnemies, '纹章脱战回合');
  numeric(seal.initialShield, '纹章初始护盾', 0);
  if (Number(seal.shield) > 0 && Number(seal.initialShield) === 0) invalid('纹章初始护盾', '与当前护盾不一致');
  const ooze = actor(state.ooze, '腐蚀效果', 'ooze');
  numeric(ooze.left, '腐蚀剩余时间', 0);
  boolean(ooze.acted, '腐蚀行动标记');

  const knownTypes = list(state.knownTypes, '已鉴定类型', (entry, path) => choice(entry, itemKinds, path));
  if (new Set(knownTypes).size !== knownTypes.length) invalid('已鉴定类型', '有重复记录');
  if (state.pendingChoice !== null) {
    const pending = object(state.pendingChoice, '待选择物品操作');
    const type = choice(pending.type, ['upgrade', 'identify', 'remove-curse', 'augment'] as const, '待选择操作类型');
    if (phase !== 'playing') invalid('待选择物品操作', '与远征状态不一致');
    const sourceKind = FORGE_MATERIALS[type];
    const sourceId = integer(pending.sourceId, '操作来源编号', 1, nextItemId - 1);
    const consumed = boolean(pending.consumed, '操作来源消耗状态');
    const source = inventory.find(entry => entry.id === sourceId);
    if ((!consumed && !source) || (source && source.kind !== sourceKind)) invalid('操作来源物品', '没有对应的有效来源');
    if (type === 'augment') {
      if (consumed) invalid('增幅符石', '不应在选择增幅前消耗');
    } else if (!knownTypes.includes(sourceKind)) invalid('操作来源卷轴', '尚未登记鉴定状态');
    // consumed=true 的最后一张未知卷轴已从背包删除，恢复后只继续选择，不能再次扣除。
  }
  const randomStates = list(state.randomStates, '随机生成器状态', (entry, path) => {
    const encoded = text(entry, path);
    if (!/^\d+$/.test(encoded) || BigInt(encoded) > (1n << 48n) - 1n) invalid(path, '不是有效的48位状态');
    return encoded;
  });
  if (randomStates.length === 0) invalid('随机生成器状态', '缺失');
  const messageIds = new Set<number>();
  list(state.messages, '消息', (entry, path) => {
    const message = object(entry, path);
    uniqueId(integer(message.id, `${path}.id`, 1, nextMessageId - 1), messageIds, `${path}.id`);
    text(message.text, `${path}.text`);
    choice(message.tone, ['normal', 'good', 'danger', 'hint'], `${path}.tone`);
  });
  const stats = object(state.stats, '远征统计');
  for (const key of ['actions', 'kills', 'steps', 'thrown']) integer(stats[key], `远征统计.${key}`);
  if (state.deathCause !== null) text(state.deathCause, '死亡原因');

  // 保留同 schema 的附加信息，不把未来兼容字段静默抹掉；只恢复已验证的对象副本。
  return structuredClone(state) as unknown as GameState;
}

export function serializeSave(state: GameState): string {
  const envelope = { project: SAVE_PROJECT, schemaVersion: SAVE_SCHEMA_VERSION, state };
  const validated = decodeSave(envelope);
  return JSON.stringify({ ...envelope, state: validated }, null, 2);
}
