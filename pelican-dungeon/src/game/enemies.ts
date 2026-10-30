/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © Oleg Dolya; Shattered Pixel Dungeon © Evan Debenham.
 * ScarfQian · 2026-10-30 · SPD v4.0.2 actors/mobs/{Rat,Snake,Gnoll,Crab,Swarm,Slime,Goo,MobSpawner}.java。
 * 无挑战/天赋基线；分裂、硬化、蓄力与补怪在World中实现。
 */
import type { MobKind } from './model';
export interface MobDefinition {
  name: string; hp: number; attack: number; defense: number; min: number; max: number;
  dr: number; xp: number; maxLevel: number; speed: number; description: string;
}
export const MOB_DEFINITIONS: Record<MobKind, MobDefinition> = {
  'spd:mob/rat': { name: '啮齿鼠', hp: 8, attack: 8, defense: 2, min: 1, max: 4, dr: 1, xp: 1, maxLevel: 5, speed: 1, description: '普通近战敌人。利用转角，将多个敌人分开应对。' },
  'spd:mob/snake': { name: '下水道蛇', hp: 4, attack: 10, defense: 25, min: 1, max: 4, dr: 0, xp: 2, maxLevel: 7, speed: 1, description: '闪避很高。绕过门或转角，对尚未发现你的蛇发动偷袭。' },
  'spd:mob/gnoll': { name: '豺狼侦察兵', hp: 12, attack: 10, defense: 4, min: 1, max: 6, dr: 2, xp: 2, maxLevel: 8, speed: 1, description: '生命与攻击比啮齿鼠更强，可能携带金币。' },
  'spd:mob/crab': { name: '下水道蟹', hp: 15, attack: 12, defense: 5, min: 1, max: 7, dr: 4, xp: 4, maxLevel: 9, speed: 2, description: '移动速度是普通敌人的两倍，攻击仍按正常行动耗时。不要在开阔处盲目后退。' },
  'spd:mob/swarm': { name: '蝇群', hp: 50, attack: 10, defense: 5, min: 1, max: 4, dr: 0, xp: 3, maxLevel: 9, speed: 1, description: '受到非致命攻击会向相邻空格分裂，分体不提供经验。狭窄地形能限制分裂。' },
  'spd:mob/slime': { name: '史莱姆', hp: 20, attack: 12, defense: 5, min: 2, max: 5, dr: 0, xp: 4, maxLevel: 9, speed: 1, description: '胶质躯体会削减较高的单次伤害。保持稳定输出和足够的护甲。' },
  'spd:mob/goo': { name: 'Goo · 下水道之主', hp: 100, attack: 10, defense: 8, min: 1, max: 8, dr: 2, xp: 10, maxLevel: 29, speed: 1, description: '站在水中会恢复生命；蓄力重击覆盖两格，及时离开预警范围。半血后更凶猛；腐蚀可用水洗去。' },
};
export const FLOOR_BAGS: Record<number, MobKind[]> = {
  1: ['spd:mob/rat','spd:mob/rat','spd:mob/rat','spd:mob/snake'],
  2: ['spd:mob/rat','spd:mob/rat','spd:mob/snake','spd:mob/gnoll','spd:mob/gnoll'],
  3: ['spd:mob/rat','spd:mob/snake','spd:mob/gnoll','spd:mob/gnoll','spd:mob/gnoll','spd:mob/swarm','spd:mob/crab'],
  4: ['spd:mob/gnoll','spd:mob/swarm','spd:mob/crab','spd:mob/crab','spd:mob/slime','spd:mob/slime'],
};
