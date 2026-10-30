/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * 网页数据适配：ScarfQian，2026-10-30。
 * 基线 SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0。
 * 对应 Dungeon、Hero、Mob、Item、Hunger、Regeneration、Healing、Ooze、BrokenSeal 的首章子集。
 */
import type { TimedActor } from '../engine/scheduler';
import type { Grid } from './terrain';
import type { Augment, ForgeOperation, Item, ItemKind } from './items';
import type { TalentId } from './progression';

export type MobKind = 'spd:mob/rat' | 'spd:mob/snake' | 'spd:mob/gnoll' | 'spd:mob/crab' | 'spd:mob/swarm' | 'spd:mob/slime' | 'spd:mob/goo';
export interface Hero extends TimedActor {
  kind: 'hero'; pos: number; previousPos: number; facing: -1 | 1;
  hp: number; maxHP: number; strength: number; level: number; xp: number;
  attackSkill: number; defenseSkill: number; gold: number;
  weaponId: number; armorId: number; inventory: Item[];
  talents: Record<TalentId, number>;
  provokedUntil: number;
}
export interface Mob extends TimedActor {
  kind: 'mob'; species: MobKind; pos: number; previousPos: number; facing: -1 | 1;
  hp: number; maxHP: number; state: 'sleeping' | 'wandering' | 'hunting';
  target: number; enemySeen: boolean; alerted: boolean;
  generation: number; pumpedUp: number;
}
export interface Hunger extends TimedActor { kind: 'hunger'; level: number; partialDamage: number }
export interface Regeneration extends TimedActor { kind: 'regeneration'; partial: number }
export interface Healing extends TimedActor { kind: 'healing'; left: number }
export interface Ooze extends TimedActor { kind: 'ooze'; left: number; acted: boolean }
export interface Spawner extends TimedActor { kind: 'spawner'; bag: MobKind[] }
/** 由 awarenessUntil 重建的到期事件，没有独立持久编号或副本。 */
export interface AwarenessExpiry extends TimedActor { kind: 'awareness-expiry' }
export interface Seal extends TimedActor {
  kind: 'seal'; shield: number; cooldown: number; turnsSinceEnemies: number; initialShield: number;
}
export type Scheduled = Hero | Mob | Hunger | Regeneration | Healing | Seal | Ooze | Spawner | AwarenessExpiry;
export interface GroundItem { cell: number; item: Item; seen: boolean }
/** 容器奖励在生成时封存；使用后保留地点，但不再持有奖励。 */
export interface ExplorationFeature {
  id: string; kind: 'chest' | 'health-well' | 'awareness-well' | 'supply-cache';
  cell: number; seen: boolean; status: 'ready' | 'used'; items: Item[];
}
export interface RoomRecord { left: number; top: number; right: number; bottom: number; kind: string }
export interface Level extends Grid {
  depth: number; lastTime: number; locked: boolean; lockedLeft: number; bossDefeated: boolean; spawner: Spawner | null;
  entrance: number; exit: number; rooms: RoomRecord[];
  visited: boolean[]; mobs: Mob[]; heaps: GroundItem[]; features: ExplorationFeature[];
}
export interface Message { id: number; text: string; tone: 'normal' | 'good' | 'danger' | 'hint' }
export interface UpgradeChoice { type: ForgeOperation; sourceId: number; consumed: boolean }
export interface GameState {
  schemaVersion: 4; gameVersion: string; upstreamCommit: string; runId: string; seed: string;
  phase: 'playing' | 'dead' | 'floor-complete' | 'chapter-complete' | 'retired'; depth: number;
  nextActorId: number; nextItemId: number; nextMessageId: number;
  hero: Hero; level: Level; archivedLevels: Record<string, Level>; deepestFloor: number;
  drops: { strength: number; upgrades: number; swarmHealing: number; slimeWeapons: number };
  hunger: Hunger; regeneration: Regeneration; healing: Healing; seal: Seal; ooze: Ooze;
  knownTypes: ItemKind[]; pendingChoice: UpgradeChoice | null; awarenessUntil: number;
  randomStates: string[]; messages: Message[];
  stats: { actions: number; kills: number; steps: number; thrown: number };
  deathCause: string | null;
}
export type Command =
  | { type: 'move'; cell: number }
  | { type: 'wait' }
  | { type: 'attack'; target: number }
  | { type: 'throw'; itemId: number; target: number }
  | { type: 'pickup'; itemId: number }
  | { type: 'explore'; featureId: string; choice?: number }
  | { type: 'use'; itemId: number }
  | { type: 'upgrade'; targetId: number }
  | { type: 'cancel-upgrade' }
  | { type: 'apply-forge'; targetId: number; augment?: Augment }
  | { type: 'detach-seal'; armorId: number }
  | { type: 'affix-seal'; armorId: number; sealId: number }
  | { type: 'learn-talent'; talent: TalentId }
  | { type: 'drop'; itemId: number }
  | { type: 'equip'; itemId: number }
  | { type: 'finish-floor' }
  | { type: 'stairs'; direction: 'up' | 'down' }
  | { type: 'retire' };
export interface WorldEvent {
  type: 'move' | 'attack' | 'hit' | 'block' | 'miss' | 'heal' | 'death' | 'throw' | 'pickup' | 'alert' | 'level-up' | 'charge' | 'floor-change';
  cell: number; from?: number; amount?: number; hero?: boolean; actorId?: number;
  sourceId?: number; surprise?: boolean; blocked?: number; hp?: number;
}
export interface ActionResult {
  changed: boolean; spent: number; events: WorldEvent[]; interrupted: boolean; reason?: string;
}
