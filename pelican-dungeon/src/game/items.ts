/*
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * TypeScript 移植：ScarfQian，2026-10-30。
 * 来源：SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0。
 * 对照 core/src/main/java/com/shatteredpixel/shatteredpixeldungeon 下：
 * actors/hero/Hero.java、HeroClass.java，items/Item.java、KindOfWeapon.java、
 * weapon/Weapon.java、weapon/melee/MeleeWeapon.java、WornShortsword.java、
 * weapon/missiles/MissileWeapon.java、ThrowingStone.java，armor/Armor.java、
 * ClothArmor.java，food/Food.java，potions/PotionOfHealing.java、scrolls/ScrollOfUpgrade.java。
 * 范围：基础近战/护甲、增幅、鉴定与纹章。职业主动、附魔、刻印、戒指、神器尚未接入。
 * 不实现投掷物升级；它依赖 UpgradedSetTracker 与场上旧枚失效，不能只增加等级。
 * Waterskin 与 VelvetPouch 暂未移植，因此不在首片背包中；治疗药和升级卷轴不是开局赠品。
 * setId 使用同一局唯一物品 id 派生并随拆分保留，不消耗战斗随机序列。
 * 状态效果、行动耗时、药水/卷轴类型鉴定及纹章护盾由世界模块负责。
 */

import type { Random } from '../engine/random';

export type ItemKind =
  | 'spd:weapon/worn-shortsword'
  | 'spd:weapon/shortsword'
  | 'spd:weapon/dagger' | 'spd:weapon/gloves' | 'spd:weapon/hand-axe'
  | 'spd:weapon/spear' | 'spd:weapon/quarterstaff' | 'spd:weapon/dirk' | 'spd:weapon/sickle'
  | 'spd:weapon/sword' | 'spd:weapon/mace' | 'spd:weapon/scimitar'
  | 'spd:weapon/round-shield' | 'spd:weapon/sai' | 'spd:weapon/whip'
  | 'spd:armor/cloth'
  | 'spd:armor/leather'
  | 'spd:armor/mail' | 'spd:armor/scale' | 'spd:armor/plate'
  | 'spd:missile/throwing-stone'
  | 'spd:food/ration'
  | 'spd:potion/healing'
  | 'spd:potion/strength'
  | 'spd:scroll/upgrade'
  | 'spd:scroll/identify' | 'spd:scroll/remove-curse'
  | 'spd:stone/augmentation' | 'spd:utility/broken-seal'
  | 'spd:currency/gold';

export type Augment = 'none' | 'speed' | 'damage' | 'evasion' | 'defense';
export type ForgeOperation = 'upgrade' | 'identify' | 'remove-curse' | 'augment';
export const FORGE_MATERIALS: Record<ForgeOperation, ItemKind> = {
  upgrade: 'spd:scroll/upgrade', identify: 'spd:scroll/identify',
  'remove-curse': 'spd:scroll/remove-curse', augment: 'spd:stone/augmentation',
};
export const AUGMENT_NAMES: Record<Augment, string> = { none: '无增幅', speed: '迅捷', damage: '强击', evasion: '闪避', defense: '防护' };

export interface Item {
  id: number;
  kind: ItemKind;
  quantity: number;
  level: number;
  levelKnown: boolean;
  cursed: boolean;
  cursedKnown: boolean;
  durability: number;
  setId: number;
  /** null 表示未附纹章；0 为初始纹章，首次护甲升级后变为 1。 */
  sealLevel: number | null;
  /** 投出同套石头后保留，合并或拾取时清除。 */
  extraThrownLeft: boolean;
  augment: Augment;
  usesLeftToID: number;
  availableUsesToID: number;
}

export interface ItemDefinition {
  name: string;
  description: string;
  category: 'weapon' | 'armor' | 'missile' | 'food' | 'potion' | 'scroll' | 'currency' | 'utility';
  tier?: number;
  stackable: boolean;
  /** 仅表示本切片实际支持的升级目标。 */
  upgradable: boolean;
}

export const ITEMS: Readonly<Record<ItemKind, ItemDefinition>> = {
  'spd:weapon/shortsword': {
    name: '短剑', description: '二阶短剑，基础力量需求12。力量足够时能发挥更高伤害；强化逐步降低力量需求。',
    category: 'weapon', tier: 2, stackable: false, upgradable: true,
  },
  'spd:armor/leather': {
    name: '皮甲', description: '二阶护甲，基础力量需求12。力量不足会拖慢移动、降低闪避；原布甲的纹章不会自动转移。',
    category: 'armor', tier: 2, stackable: false, upgradable: true,
  },
  'spd:potion/strength': {
    name: '力量药水', description: '本次远征力量永久提高1点。首章在第1—2层与第3—4层各能找到一瓶；等级本身不增加力量。',
    category: 'potion', stackable: true, upgradable: false,
  },
  'spd:weapon/worn-shortsword': {
    name: '破旧短剑',
    description: '一把可靠的近战短剑。强化提高伤害，并逐步降低力量需求。',
    category: 'weapon', tier: 1, stackable: false, upgradable: true,
  },
  'spd:armor/cloth': {
    name: '布甲',
    description: '轻便的基础护甲，可以减免部分伤害；强化增加防护。',
    category: 'armor', tier: 1, stackable: false, upgradable: true,
  },
  'spd:missile/throwing-stone': {
    name: '投掷石',
    description: '投出后可以拾回。命中敌人会磨损，远投比贴身投掷更容易命中。',
    category: 'missile', stackable: true, upgradable: false,
  },
  'spd:food/ration': {
    name: '口粮',
    description: '吃下需要三个回合，减少 300 点饥饿。口粮本身不直接恢复生命。',
    category: 'food', stackable: true, upgradable: false,
  },
  'spd:potion/healing': {
    name: '治疗药水',
    description: '喝下后在接下来的回合逐步恢复生命。不能洗去Goo的腐蚀淤泥，淤泥需要进入水中清除。',
    category: 'potion', stackable: true, upgradable: false,
  },
  'spd:scroll/upgrade': {
    name: '升级卷轴',
    description: '武器或护甲提高一级，清除穿戴诅咒；不代替鉴定。独立纹章可从0升至1级。消耗一张卷轴与一回合。',
    category: 'scroll', stackable: true, upgradable: false,
  },
  'spd:currency/gold': {
    name: '金币',
    description: '地下城中找到的钱币。',
    category: 'currency', stackable: true, upgradable: false,
  },
  'spd:weapon/dagger': { name:'匕首', description:'偷袭时伤害更接近上限，适合借助门与转角。', category:'weapon',tier:1,stackable:false,upgradable:true },
  'spd:weapon/gloves': { name:'镶钉手套', description:'单次伤害较低，但基础攻击只需半回合。', category:'weapon',tier:1,stackable:false,upgradable:true },
  'spd:weapon/hand-axe': { name:'手斧', description:'命中能力提高32%，适合对付灵活的敌人。', category:'weapon',tier:2,stackable:false,upgradable:true },
  'spd:weapon/spear': { name:'长矛', description:'可攻击两格内可达的敌人，基础攻击耗时1.5回合。墙与其他角色会阻挡延伸攻击。', category:'weapon',tier:2,stackable:false,upgradable:true },
  'spd:weapon/quarterstaff': { name:'长棍', description:'每次受击额外随机减免0—2点伤害，力量不足会降低效果。', category:'weapon',tier:2,stackable:false,upgradable:true },
  'spd:weapon/dirk': { name:'短刺剑', description:'偷袭能显著提高最低伤害，保持隐蔽更有优势。', category:'weapon',tier:2,stackable:false,upgradable:true },
  'spd:weapon/sickle': { name:'镰刀', description:'伤害较高，命中能力降低32%。普通挥击不会造成流血。', category:'weapon',tier:2,stackable:false,upgradable:true },
  'spd:weapon/sword': { name:'单手剑', description:'三阶均衡武器，伤害稳定、攻击耗时一回合。', category:'weapon',tier:3,stackable:false,upgradable:true },
  'spd:weapon/mace': { name:'硬头锤', description:'命中能力提高28%的三阶钝器。', category:'weapon',tier:3,stackable:false,upgradable:true },
  'spd:weapon/scimitar': { name:'弯刀', description:'基础攻击耗时0.8回合，便于连续出手。', category:'weapon',tier:3,stackable:false,upgradable:true },
  'spd:weapon/round-shield': { name:'圆盾', description:'以盾缘攻击；每次受击额外随机减免0—(4+等级)点伤害。', category:'weapon',tier:3,stackable:false,upgradable:true },
  'spd:weapon/sai': { name:'双钗', description:'基础攻击耗时半回合，以多次出手弥补较低单次伤害。', category:'weapon',tier:3,stackable:false,upgradable:true },
  'spd:weapon/whip': { name:'长鞭', description:'可攻击三格内可达的单个敌人。墙与其他角色会挡住攻击。', category:'weapon',tier:3,stackable:false,upgradable:true },
  'spd:armor/mail': { name:'链甲', description:'三阶护甲，基础力量需求14；比皮甲更厚重。', category:'armor',tier:3,stackable:false,upgradable:true },
  'spd:armor/scale': { name:'鳞甲', description:'四阶护甲，基础力量需求16；先提升力量或强化，再考虑穿戴。', category:'armor',tier:4,stackable:false,upgradable:true },
  'spd:armor/plate': { name:'板甲', description:'五阶重甲，基础力量需求18；高防护也伴随更高负重要求。', category:'armor',tier:5,stackable:false,upgradable:true },
  'spd:scroll/identify': { name:'鉴定卷轴', description:'揭示一件装备的等级和诅咒，或辨认一种药水/卷轴。不会改变属性或解除诅咒。', category:'scroll',stackable:true,upgradable:false },
  'spd:scroll/remove-curse': { name:'祛咒卷轴', description:'解除一件装备的穿戴诅咒并确认诅咒状态；不揭示等级。', category:'scroll',stackable:true,upgradable:false },
  'spd:stone/augmentation': { name:'增幅符石', description:'武器选择迅捷或强击，护甲选择闪避或防护，也可恢复无增幅。每次替换消耗一块符石，不叠加。', category:'utility',stackable:true,upgradable:false },
  'spd:utility/broken-seal': { name:'破损纹章', description:'可装到已确认无诅咒的护甲。1级纹章能携带一级强化，在护甲间转移；拆装不耗回合。', category:'utility',stackable:false,upgradable:true },
};

export function createItem(id: number, kind: ItemKind, quantity = 1): Item {
  const category = ITEMS[kind].category;
  const alwaysKnown = ['food', 'currency', 'utility'].includes(category);
  return {
    id, kind, quantity, level: 0,
    levelKnown: alwaysKnown, cursed: false, cursedKnown: alwaysKnown,
    durability: 100, setId: kind === 'spd:missile/throwing-stone' ? id : 0,
    sealLevel: null, extraThrownLeft: false,
    augment: 'none', usesLeftToID: category === 'weapon' ? 20 : category === 'armor' ? 10 : 0,
    availableUsesToID: category === 'weapon' ? 10 : category === 'armor' ? 5 : 0,
  };
}

export function initialInventory(): Item[] {
  const sword = createItem(1, 'spd:weapon/worn-shortsword');
  const armor = createItem(2, 'spd:armor/cloth');
  const stones = createItem(3, 'spd:missile/throwing-stone', 3);
  for (const item of [sword, armor, stones]) {
    item.levelKnown = true;
    item.cursedKnown = true;
  }
  armor.sealLevel = 0;
  return [sword, armor, stones, createItem(4, 'spd:food/ration')];
}

function tierOneStrength(level: number): number {
  return 10 - Math.floor((Math.sqrt(8 * Math.max(0, level) + 1) - 1) / 2);
}

export function weaponStats(item: Item): {
  min: number; max: number; strength: number; delay: number; reach: number;
  accuracy: number; defense: number; damageFactor: number; surpriseFraction: number;
} {
  if (item.kind === 'spd:missile/throwing-stone') {
    return {
      min: Math.max(0, 2 + item.level), max: Math.max(0, 5 + item.level),
      strength: tierOneStrength(item.level) - 1, delay: 1, reach: 1,
      accuracy: 1, defense: 0, damageFactor: 1, surpriseFraction: 0,
    };
  }
  const data = WEAPON_RULES[item.kind];
  if (!data) throw new TypeError('此物品不是武器。');
  const [max, scaling, delay = 1, accuracy = 1, reach = 1, defense = 0, surpriseFraction = 0] = data;
  const tier = ITEMS[item.kind].tier!;
  return {
    min: Math.max(0, tier + item.level), max: Math.max(0, max + scaling * item.level),
    strength: tierOneStrength(item.level) + (tier - 1) * 2,
    delay: Math.fround(delay * (item.augment === 'speed' ? 2 / 3 : item.augment === 'damage' ? 5 / 3 : 1)),
    reach, accuracy, defense: Math.max(0, defense + (item.kind === 'spd:weapon/round-shield' ? item.level : 0)),
    damageFactor: item.augment === 'speed' ? 0.7 : item.augment === 'damage' ? 1.5 : 1, surpriseFraction,
  };
}

/** max0 / 每级上限增量 / 动作耗时 / 命中能力倍率 / 射程 / 防御 / 偷袭下界比例。 */
const WEAPON_RULES: Partial<Record<ItemKind, readonly [number, number, number?, number?, number?, number?, number?, number?]>> = {
  'spd:weapon/worn-shortsword': [10,2], 'spd:weapon/dagger': [8,2,1,1,1,0,.75],
  'spd:weapon/gloves': [5,1,.5], 'spd:weapon/shortsword': [15,3],
  'spd:weapon/hand-axe': [12,3,1,1.32], 'spd:weapon/spear': [20,4,1.5,1,2],
  'spd:weapon/quarterstaff': [12,3,1,1,1,2], 'spd:weapon/dirk': [12,3,1,1,1,0,.67],
  'spd:weapon/sickle': [20,3,1,.68], 'spd:weapon/sword': [20,4],
  'spd:weapon/mace': [16,4,1,1.28], 'spd:weapon/scimitar': [16,4,.8],
  'spd:weapon/round-shield': [12,2,1,1,1,4], 'spd:weapon/sai': [10,2,.5], 'spd:weapon/whip': [15,3,1,1,3],
};

export function armorStats(item: Item): { min: number; max: number; strength: number; evasionBonus: number; tier: number } {
  if (ITEMS[item.kind].category !== 'armor') throw new TypeError('此物品不是护甲。');
  const tier = ITEMS[item.kind].tier!;
  const level = item.level;
  const factor = item.augment === 'defense' ? 1 : item.augment === 'evasion' ? -1 : 0;
  const baseMax = tier * (2 + level) + factor * (2 + level);
  const max = level > baseMax ? Math.trunc((level - baseMax + 1) / 2) : baseMax;
  return {
    min: level >= max ? level - max : level,
    max, strength: tierOneStrength(level) + (tier - 1) * 2, evasionBonus: -factor * 2 * (2 + level), tier,
  };
}

/** 每次英雄伤害抽取都保留 Clover 判定的 Float；超额力量是第二次独立抽取。 */
export function rollHeroDamage(random: Random, min: number, max: number, extraStrength = 0, factor = 1): number {
  random.float();
  let damage = Math.round(Math.fround(random.normalInt(min, max) * Math.fround(factor)));
  if (extraStrength > 0) {
    random.float();
    damage += random.normalInt(0, extraStrength);
  }
  return damage;
}

/** 不消耗卷轴或行动；调用方在确认后提交返回的新物品并执行消耗。 */
export function upgradeItem(item: Item): Item | null {
  if (!ITEMS[item.kind].upgradable) return null;
  if (item.kind === 'spd:utility/broken-seal' && item.level !== 0) return null;
  return {
    ...item, level: item.level + 1, cursed: false,
    sealLevel: ITEMS[item.kind].category === 'armor' && item.sealLevel === 0 ? 1 : item.sealLevel,
  };
}

export function identified(item: Item, knownTypes: readonly ItemKind[]): boolean {
  return ['potion','scroll'].includes(ITEMS[item.kind].category)
    ? knownTypes.includes(item.kind) : item.levelKnown && item.cursedKnown;
}

export function forgeEligible(operation: ForgeOperation, item: Item, knownTypes: readonly ItemKind[]): boolean {
  const equipment = ['weapon','armor'].includes(ITEMS[item.kind].category);
  if (operation === 'upgrade') return upgradeItem(item) !== null;
  if (operation === 'augment') return equipment;
  if (operation === 'identify') return !identified(item, knownTypes);
  return equipment && (item.cursed || !item.cursedKnown);
}

export function augmentChoices(item: Item): Augment[] {
  const values: Augment[] = ITEMS[item.kind].category === 'weapon' ? ['none','speed','damage']
    : ITEMS[item.kind].category === 'armor' ? ['none','evasion','defense'] : [];
  return values.filter(value => value !== item.augment);
}

/** 已接入的普通装备随机等级与穿戴诅咒；附魔/刻印尚未迁移，不生成虚构词条。 */
export function randomizeEquipment(item: Item, random: Random): Item {
  if (!['weapon','armor'].includes(ITEMS[item.kind].category)) return item;
  item.level = random.int(4) === 0 ? (random.int(5) === 0 ? 2 : 1) : 0;
  random.push(random.long());
  try { item.cursed = random.float() < .3; } finally { random.pop(); }
  return item;
}

/** 首章可用池：首层轻武器，后续按已接入二/三阶75:20抽取；是网页内容分配适配。 */
export function chapterEquipment(random: Random, depth: number): ItemKind[] {
  const tier = depth === 1 ? 1 : depth === 2 ? 2 : random.weighted([75,20]) + 2;
  const weapons = (Object.keys(ITEMS) as ItemKind[]).filter(kind => ITEMS[kind].category === 'weapon' && ITEMS[kind].tier === tier);
  const armorTier = random.weighted([0,75,20,4,1]) + 1;
  const armor = (Object.keys(ITEMS) as ItemKind[]).find(kind => ITEMS[kind].category === 'armor' && ITEMS[kind].tier === armorTier)!;
  // 每层有限材料与候选装备；回访旧层不补发，不以营地免费发放替代探索。
  return [random.choose(weapons), armor,
    depth % 2 ? 'spd:scroll/identify' : 'spd:scroll/remove-curse',
    ...(depth >= 3 ? ['spd:stone/augmentation' as const] : [])];
}

export interface StoneSplit {
  /** 替换背包中的原栈；null 表示最后一枚已整个移出。 */
  remaining: Item | null;
  /** 单枚投出物；只剩一枚时保留原 id 与耐久，projectileId 此时不使用。 */
  projectile: Item;
  /** 源码 parent 指针的可保存替代；只在此次投掷结算期间有效。 */
  parentId: number | null;
}

export interface StoneThrowResult {
  remaining: Item | null;
  /** ThrowingStone 不粘敌；非 null 时由调用方放到命中/落地格。 */
  landed: Item | null;
  broken: boolean;
  aboutToBreak: boolean;
}

/** 不修改输入。拆分与 resolveStoneThrow 必须在同一逻辑行动中提交。 */
export function splitStone(stack: Item, projectileId: number): StoneSplit {
  if (stack.kind !== 'spd:missile/throwing-stone' || stack.quantity < 1) {
    throw new TypeError('需要至少一枚投掷石。');
  }
  if (stack.quantity === 1) {
    return { remaining: null, projectile: { ...stack }, parentId: null };
  }
  return {
    remaining: { ...stack, quantity: stack.quantity - 1, extraThrownLeft: true },
    projectile: { ...stack, id: projectileId, quantity: 1, durability: 100, extraThrownLeft: true },
    parentId: stack.id,
  };
}

/** 无天赋/戒指/增幅时的 MissileWeapon.durabilityPerUse；保留 Java float 舍入。 */
export function stoneDurabilityPerUse(item: Item): number {
  let uses = Math.fround(5 * Math.fround(Math.pow(1.5, item.level)));
  if (uses >= 100) return 0;
  uses = Math.round(uses);
  return Math.fround(Math.fround(100 / uses) + Math.fround(0.001));
}

/** hit 表示命中判定成功，伤害被护甲降至 0 也仍磨损；落空/投空地传 false。 */
export function resolveStoneThrow(split: StoneSplit, hit: boolean): StoneThrowResult {
  const remaining = split.remaining ? { ...split.remaining } : null;
  const projectile = { ...split.projectile };
  let aboutToBreak = false;
  if (hit) {
    projectile.cursedKnown = true;
    if (remaining && split.parentId === remaining.id) {
      remaining.cursedKnown = true;
      const cost = stoneDurabilityPerUse(remaining);
      if (remaining.durability <= cost) {
        projectile.durability = 0;
        remaining.durability = 100;
        remaining.extraThrownLeft = false;
      } else {
        remaining.durability = Math.fround(remaining.durability - cost);
        aboutToBreak = remaining.durability > 0 && remaining.durability <= cost;
      }
    } else {
      const cost = stoneDurabilityPerUse(projectile);
      projectile.durability = Math.fround(projectile.durability - cost);
      aboutToBreak = projectile.durability > 0 && projectile.durability <= cost;
    }
  }
  return {
    remaining, landed: projectile.durability > 0 ? projectile : null,
    broken: projectile.durability <= 0, aboutToBreak,
  };
}

/** 仅合并同种、同等级、同 setId 的石头；不相似时返回 null，应另放一栈。 */
export function mergeStoneStacks(stack: Item, incoming: Item): Item | null {
  if (stack.kind !== 'spd:missile/throwing-stone'
    || incoming.kind !== stack.kind || incoming.level !== stack.level || incoming.setId !== stack.setId) {
    return null;
  }
  let quantity = stack.quantity + incoming.quantity;
  let durability = Math.fround(Math.fround(stack.durability + incoming.durability) - 100);
  while (durability <= 0) {
    quantity--;
    durability = Math.fround(durability + 100);
  }
  if (quantity > 3 && stack.setId !== 0) {
    quantity = 3;
    durability = 100;
  }
  return {
    ...stack, quantity, durability, extraThrownLeft: false,
    levelKnown: stack.levelKnown || incoming.levelKnown,
    cursedKnown: stack.cursedKnown || incoming.cursedKnown,
  };
}
