/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian，2026-10-30。SPD v4.0.2 普通箱/井水效果子集与网页探索适配。
 * 奖励和地点保存在 Level.features；界面打开、关闭不会抽随机数或消耗行动。
 */
import type { ExplorationFeature } from './model';

export const EXPLORATION = {
  chest: { name: '封存宝箱', mark: '◇',
    description: '箱扣尚未打开。开启消耗1回合，里面的物品留在原地，再走上去拾取。' },
  'health-well': { name: '生命之井', mark: '＋',
    description: '恢复全部生命、消除饥饿，并解除身上武器与护甲的诅咒。使用消耗1回合，井水随后枯竭；不能洗去腐蚀淤泥。' },
  'awareness-well': { name: '觉察之井', mark: '?',
    description: '鉴定身上的武器与护甲，识别行囊装备的诅咒，并短暂感知本层物品周围。使用消耗1回合，井水随后枯竭。' },
  'supply-cache': { name: '旅人的补给', mark: '✦',
    description: '旅人留下了一份口粮和一套三枚投掷石，只能取走其中一种。选择消耗1回合，补给留在原地等待拾取；余下的一份不再可取。' },
} satisfies Record<ExplorationFeature['kind'], {name: string; mark: string; description: string}>;
