/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pixel Dungeon © Oleg Dolya; Shattered Pixel Dungeon © Evan Debenham.
 * ScarfQian · 2026-10-30 · SPD v4.0.2 Hero.java、Dungeon.posNeeded/souNeeded。
 * 首章成长口径集中维护；营地展示与局内结算使用同一门槛。
 */
import type { Random } from '../engine/random';
import type { GameState } from './model';
import type { ItemKind } from './items';

export type TalentId = 'hearty-meal' | 'veterans-intuition' | 'provoked-anger' | 'iron-will';
export const TALENTS: Record<TalentId, { name: string; description: string; ranks: readonly [string, string] }> = {
  'hearty-meal': { name: '丰盛一餐', description: '生命低于约三分之一时，进食同时恢复生命。', ranks: ['额外恢复4点生命', '额外恢复6点生命'] },
  'veterans-intuition': { name: '老兵直觉', description: '通过战斗更快熟悉装备；二级时穿戴护甲即可鉴定。', ranks: ['武器鉴定速度×1.75，护甲×2', '武器鉴定速度×2.5，穿戴护甲立即鉴定'] },
  'provoked-anger': { name: '激怒', description: '护盾被伤害击破后，5回合内下一次命中额外造成伤害。', ranks: ['额外造成3点伤害', '额外造成5点伤害'] },
  'iron-will': { name: '钢铁意志', description: '提高破损纹章下次触发的护盾量，不立即补盾。', ranks: ['最大护盾+1', '最大护盾+2'] },
};
export function initialTalents(): Record<TalentId, number> {
  return { 'hearty-meal': 0, 'veterans-intuition': 0, 'provoked-anger': 0, 'iron-will': 0 };
}
export function availableTalentPoints(hero: { level: number; talents: Record<TalentId, number> }): number {
  return Math.max(0, Math.min(5, hero.level - 1) - Object.values(hero.talents).reduce((sum, rank) => sum + rank, 0));
}

export const MAX_HERO_LEVEL = 30;
export const experienceToLevel = (level: number): number => 5 + level * 5;
export const baseHealthAtLevel = (level: number): number => 20 + (level - 1) * 5;

/** 只在新层首次生成时调用；首章2瓶力量药、3张升级卷轴，回访不重发。 */
export function chapterSupplies(random: Random, depth: number, drops: GameState['drops']): ItemKind[] {
  if (depth < 1 || depth > 4) return [];
  const result: ItemKind[] = [];
  let targetLeft = 2 - Math.floor(depth / 2);
  if (depth % 2 === 1 && random.int(2) === 0) targetLeft--;
  if (2 - drops.strength > 0 && targetLeft < 2 - drops.strength) {
    result.push('spd:potion/strength'); drops.strength++;
  }
  if (3 - drops.upgrades > 0 && random.int(5 - depth) < 3 - drops.upgrades) {
    result.push('spd:scroll/upgrade'); drops.upgrades++;
  }
  return result;
}
