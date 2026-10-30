/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian · 2026-10-30 · 行囊与强化工作台。
 * 仅呈现本次远征的物品与纯函数预览；消耗、回合与保存由主入口和 World 处理。
 */
import '../equipment.css';
import { itemName, type World } from '../game/world';
import { ITEMS, armorStats, upgradeItem, weaponStats, type Item, type ItemKind } from '../game/items';

export type BagFilter = 'all' | 'equipment' | 'supplies' | 'tools';
export type EquipmentTab = 'bag' | 'forge';
type Icon = (kind: ItemKind) => string;
interface StatLine { label: string; text: string; score: number; lower?: boolean }
interface Material { kind: ItemKind; name: string; operation: string; verb: string; description: string }

const FILTERS: readonly [BagFilter, string][] = [['all', '全部'], ['equipment', '装备'], ['supplies', '补给'], ['tools', '工具']];
const MATERIALS: readonly Material[] = [
  { kind: 'spd:scroll/upgrade', name: '升级卷轴', operation: 'upgrade', verb: '升级装备', description: '提升目标一级；独立纹章最多升至 +1。' },
  { kind: 'spd:scroll/identify', name: '鉴定卷轴', operation: 'identify', verb: '鉴定物品', description: '揭示装备的强化与诅咒状态，或辨认药水、卷轴。' },
  { kind: 'spd:scroll/remove-curse', name: '祛咒卷轴', operation: 'remove-curse', verb: '解除诅咒', description: '清除装备的诅咒，使受束缚的装备能够卸下。' },
  { kind: 'spd:stone/augmentation', name: '增幅符石', operation: 'augment', verb: '选择增幅', description: '武器取舍速度与伤害；护甲取舍闪避与防护。' },
];
const SEAL: ItemKind = 'spd:utility/broken-seal';
const escape = (value: unknown): string => String(value).replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const number = (value: number): string => Number(value.toFixed(2)).toString();
const action = (name: string, label: string, style = '', disabled = false): string =>
  `<button type="button" data-action="${escape(name)}" class="${style}"${disabled ? ' disabled' : ''}>${label}</button>`;
const equipment = (item: Item): boolean => ['weapon', 'armor'].includes(ITEMS[item.kind].category);
const knownType = (world: World, item: Item): boolean =>
  !['potion', 'scroll'].includes(ITEMS[item.kind].category) || world.state.knownTypes.includes(item.kind);
const identified = (world: World, item: Item): boolean => equipment(item)
  ? item.levelKnown && item.cursedKnown : knownType(world, item);
const isEquipped = (world: World, item: Item): boolean => item.id === world.state.hero.weaponId || item.id === world.state.hero.armorId;

function itemIcon(world: World, item: Item, icon: Icon): string {
  // 未知药卷不使用带具体用途的图示，避免从治疗/力量等图标提前获知类型。
  if (!knownType(world, item)) {
    return `<span class="eq-unknown-icon" aria-hidden="true"><b>?</b><small>${ITEMS[item.kind].category === 'potion' ? '药' : '卷'}</small></span>`;
  }
  return `<span class="eq-icon" aria-hidden="true">${icon(item.kind)}</span>`;
}
function badges(world: World, item: Item): string {
  const tags: string[] = [];
  if (isEquipped(world, item)) tags.push('<span class="eq-badge equipped">装备中</span>');
  if (!identified(world, item)) tags.push('<span class="eq-badge unknown">未鉴定</span>');
  if (item.cursedKnown && item.cursed) tags.push('<span class="eq-badge cursed">诅咒</span>');
  if (item.sealLevel !== null) tags.push('<span class="eq-badge">附有纹章</span>');
  const tier = ITEMS[item.kind].tier;
  if (tier !== undefined) tags.push(`<span class="eq-badge">${tier} 阶</span>`);
  return tags.join('');
}
function fits(item: Item, filter: BagFilter): boolean {
  const category = ITEMS[item.kind].category;
  if (filter === 'all') return true;
  if (filter === 'equipment') return ['weapon', 'armor', 'missile'].includes(category);
  if (filter === 'supplies') return ['food', 'potion'].includes(category);
  return !['weapon', 'armor', 'missile', 'food', 'potion'].includes(category);
}
function countMaterial(world: World, kind: ItemKind): number {
  if (ITEMS[kind].category === 'scroll' && !world.state.knownTypes.includes(kind)) return 0;
  return world.state.hero.inventory.filter(item => item.kind === kind).reduce((sum, item) => sum + item.quantity, 0);
}
function displayItem(item: Item): Item {
  // 不读取未知强化值制作“猜测预览”；+0 参考只保留玩家可见的增幅选择。
  return item.levelKnown ? item : { ...item, level: 0, cursed: false };
}
function statLines(item: Item): StatLine[] {
  const category = ITEMS[item.kind].category;
  if (category === 'weapon' || category === 'missile') {
    const stats = weaponStats(item);
    return [
      { label: '基础伤害', text: `${number(stats.min)}—${number(stats.max)}`, score: stats.min + stats.max },
      { label: '伤害倍率', text: `${number(stats.damageFactor)}×`, score: stats.damageFactor },
      { label: '力量需求', text: number(stats.strength), score: stats.strength, lower: true },
      { label: '攻击间隔', text: `${number(stats.delay)} 回合`, score: stats.delay, lower: true },
      { label: '攻击距离', text: `${stats.reach} 格`, score: stats.reach },
      { label: '命中倍率', text: `${number(stats.accuracy)}×`, score: stats.accuracy },
      { label: '格挡加值', text: number(stats.defense), score: stats.defense },
    ];
  }
  if (category === 'armor') {
    const stats = armorStats(item);
    return [
      { label: '基础减伤', text: `${number(stats.min)}—${number(stats.max)}`, score: stats.min + stats.max },
      { label: '力量需求', text: number(stats.strength), score: stats.strength, lower: true },
      { label: '闪避加值', text: `${stats.evasionBonus >= 0 ? '+' : ''}${number(stats.evasionBonus)}`, score: stats.evasionBonus },
    ];
  }
  return [];
}
function comparison(before: Item, after: Item, beforeLabel: string, afterLabel: string): string {
  const current = statLines(before), next = statLines(after);
  return '<div class="eq-comparison-scroll"><table class="eq-comparison"><thead><tr><th scope="col">属性</th>' +
    `<th scope="col">${escape(beforeLabel)}</th><th scope="col">${escape(afterLabel)}</th></tr></thead><tbody>` +
    current.map((line, index) => {
      const target = next[index]!;
      const delta = (target.score - line.score) * (line.lower ? -1 : 1);
      const tone = delta > 0 ? 'better' : delta < 0 ? 'worse' : '';
      return `<tr><th scope="row">${line.label}</th><td>${line.text}</td><td class="${tone}">${target.text}` +
        (delta ? `<span class="eq-change" aria-label="${delta > 0 ? '提高' : '降低'}">${delta > 0 ? '↑' : '↓'}</span>` : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function statsContent(world: World, item: Item): string {
  const sample = displayItem(item), category = ITEMS[item.kind].category;
  const lines = statLines(sample);
  if (!lines.length) return '';
  const unknown = !item.levelKnown;
  const stats = category === 'armor' ? armorStats(sample) : weaponStats(sample);
  const gap = stats.strength - world.state.hero.strength;
  let strengthNote = `当前力量 ${world.state.hero.strength}，满足这件装备的力量需求。`;
  if (unknown) strengthNote = '真实强化等级尚未揭示。这里仅显示 +0 基础参考，已计入当前增幅；鉴定后可进行准确比较。';
  else if (gap > 0) {
    const timeFactor = Math.pow(1.2, gap), abilityFactor = Math.pow(1.5, gap);
    if (category === 'armor') {
      const armor = armorStats(item);
      const evasion = Math.max(1, Math.round(world.state.hero.defenseSkill / abilityFactor + armor.evasionBonus));
      strengthNote = `力量还差 ${gap} 点：每格移动耗时 ${number(Math.fround(timeFactor))} 回合；` +
        `当前闪避能力 ${evasion}，护甲减伤额外减少 ${2 * gap}（最低为 0）。`;
    } else {
      const weapon = weaponStats(item);
      strengthNote = `力量还差 ${gap} 点：攻击耗时 ${number(Math.fround(weapon.delay * timeFactor))} 回合；` +
        `命中能力额外 ×${number(1 / abilityFactor)}，且无法发动偷袭。`;
    }
  }
  return `<h4 class="eq-section-title">${unknown ? '+0 基础参考 · 未鉴定' : '装备属性'}</h4><dl class="eq-stat-list">` +
    lines.map(line => `<div><dt>${line.label}</dt><dd>${line.text}</dd></div>`).join('') + '</dl>' +
    `<p class="eq-note${!unknown && gap > 0 ? ' warning' : ''}">${strengthNote}</p>` +
    (category !== 'armor' ? '<p class="eq-footnote">伤害倍率包含增幅效果。命中、实际伤害与行动时间还受力量和战斗状态影响。</p>' : '');
}
function augmentLabel(item: Item): string {
  const labels: Record<Item['augment'], string> = {
    none: '未增幅', speed: '速度增幅', damage: '伤害增幅', evasion: '闪避增幅', defense: '防护增幅',
  };
  return labels[item.augment];
}
function familiarityContent(world: World, item: Item): string {
  if (!equipment(item) || item.levelKnown) return '';
  // 与 createItem、gainXP、progressIdentification 使用同一熟悉点口径，点数不等于攻击次数。
  const total = ITEMS[item.kind].category === 'weapon' ? 20 : 10;
  const remaining = Math.max(0, item.usesLeftToID), done = Math.max(0, Math.min(total, total - remaining));
  const available = Math.max(0, item.availableUsesToID), exhausted = available <= 0;
  return '<section class="eq-familiarity" aria-label="战斗熟悉进度"><div><h4>战斗熟悉</h4>' +
    `<span>还需 ${number(remaining)} / ${total} 点</span></div>` +
    `<div class="eq-familiarity-meter" role="progressbar" aria-label="已积累熟悉点" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${number(done)}"><span style="width:${done / total * 100}%"></span></div>` +
    `<p class="${exhausted ? 'warning' : ''}">可用熟悉额度：${number(available)} 点。${exhausted
      ? '击败能够提供经验的敌人，恢复当前装备的熟悉额度。'
      : isEquipped(world, item) ? '通过战斗消耗额度，逐渐揭示装备属性。' : '装备后可通过战斗逐渐熟悉。'}</p></section>`;
}
function shieldAmount(world: World, armor: Item): number {
  return 3 + 2 * armorStats(displayItem(armor)).tier + world.state.hero.talents['iron-will'];
}
function shieldContent(world: World, item: Item): string {
  if (ITEMS[item.kind].category === 'armor' && item.sealLevel !== null) {
    return `<p class="eq-note eq-shield-note">${isEquipped(world, item) ? '下次触发' : '穿戴后触发'}纹章可获得 <strong>${shieldAmount(world, item)} 点护盾</strong>` +
      '，基础冷却 150 回合。护盾量取决于护甲阶数与「钢铁意志」。</p>';
  }
  if (item.kind === SEAL) {
    const armor = world.item(world.state.hero.armorId);
    return armor ? `<p class="eq-note eq-shield-note">搭配当前护甲时，纹章可触发 <strong>${shieldAmount(world, armor)} 点护盾</strong>；` +
      '须先贴附并穿戴护甲。升级纹章会转移强化，不会立即增加护盾。</p>' : '';
  }
  return '';
}
function currentComparison(world: World, item: Item): string {
  if (!equipment(item) || isEquipped(world, item)) return '';
  const current = world.item(ITEMS[item.kind].category === 'armor' ? world.state.hero.armorId : world.state.hero.weaponId);
  if (!current) return '';
  if (!item.levelKnown || !current.levelKnown) return '<p class="eq-note">鉴定双方装备的强化等级后，可以查看与当前装备的准确比较。</p>';
  return '<h4 class="eq-section-title">与当前装备比较</h4>' +
    comparison(current, item, '当前装备', '这件装备') +
    `<p class="eq-footnote">当前：${escape(itemName(world.state, current))}。颜色只表示单项变化。</p>`;
}
function slot(world: World, label: string, item: Item | undefined, selectedId: number | null, icon: Icon, note?: string): string {
  if (!item) return `<div class="eq-slot empty"><span class="eq-slot-mark" aria-hidden="true">◇</span><span><small>${label}</small><strong>暂未装备</strong></span></div>`;
  return `<button type="button" class="eq-slot${item.id === selectedId ? ' selected' : ''}" data-action="equipment-item:${item.id}" aria-pressed="${item.id === selectedId}">` +
    itemIcon(world, item, icon) + `<span><small>${label}</small><strong>${escape(note ?? itemName(world.state, item))}</strong></span></button>`;
}
function topSlots(world: World, selectedId: number | null, icon: Icon): string {
  const hero = world.state.hero, weapon = world.item(hero.weaponId), armor = world.item(hero.armorId);
  const attached = armor?.sealLevel !== null && armor?.sealLevel !== undefined ? armor : undefined;
  const packed = hero.inventory.find(item => item.kind === SEAL);
  const seal = attached ?? packed;
  const sealNote = attached ? `护盾 ${shieldAmount(world, attached)} · 附在护甲` : packed ? '收在行囊中' : undefined;
  return '<div class="eq-equipped" aria-label="当前装备">' + slot(world, '武器', weapon, selectedId, icon) +
    slot(world, '护甲', armor, selectedId, icon) + slot(world, '破损纹章', seal, selectedId, () => icon(SEAL), sealNote) + '</div>';
}
function description(world: World, item: Item): string {
  if (!knownType(world, item)) return ITEMS[item.kind].category === 'potion'
    ? '尚未辨认的药水。可以用鉴定卷轴揭示用途；直接饮用会产生效果并辨认类型。'
    : '尚未辨认的卷轴。可以先鉴定；直接展开会揭示用途，展开后放弃也可能消耗卷轴。';
  return ITEMS[item.kind].description;
}

function lootEquipmentCard(world: World, item: Item | undefined, found: boolean, other: Item | undefined, icon: Icon): string {
  const label = found ? '刚刚拾取' : '正在使用';
  if (!item) return `<section class="loot-equipment-card current"><h3>${label}</h3><p>暂未装备</p></section>`;
  const sample = displayItem(item), lines = statLines(sample), previous = other ? statLines(displayItem(other)) : [];
  // 未鉴定一方只呈现 +0 参考。颜色与箭头也不能透露其隐藏强化等级。
  const comparable = found && item.levelKnown && other?.levelKnown;
  const rows = lines.map((line, index) => {
    const delta = comparable && previous[index] ? (line.score - previous[index]!.score) * (line.lower ? -1 : 1) : 0;
    const tone = delta > 0 ? ' is-better' : delta < 0 ? ' is-worse' : !item.levelKnown ? ' is-unknown' : '';
    return `<div class="loot-stat"><dt>${line.label}</dt><dd class="${tone.trim()}">${line.text}` +
      (delta ? `<span aria-label="${delta > 0 ? '该项更有利' : '该项更不利'}"> ${delta > 0 ? '↑' : '↓'}</span>` : '') + '</dd></div>';
  }).join('');
  return `<section class="loot-equipment-card ${found ? 'found' : 'current'}"><h3>${label}</h3>` +
    itemIcon(world, item, icon) + `<h4>${escape(itemName(world.state, item))}</h4><div class="eq-badges">${badges(world, item)}</div>` +
    `<p class="loot-reference${item.levelKnown ? '' : ' is-unknown'}">${item.levelKnown ? augmentLabel(item) : '未鉴定 · 以下仅为 +0 参考'}</p>` +
    `<dl class="loot-stat-list">${rows}</dl></section>`;
}

/** 拾取已由 World 完成；此处仅显示本次数量并提供换装选择，不重复领取或自动鉴定。 */
export function pickupContent(world: World, item: Item, icon: Icon): string {
  const category = ITEMS[item.kind].category, wearable = equipment(item);
  const current = wearable ? world.item(category === 'armor' ? world.state.hero.armorId : world.state.hero.weaponId) : undefined;
  const packed = !!world.item(item.id), wearing = isEquipped(world, item);
  const canEquip = wearable && packed && !wearing;
  const bound = !!current && current.cursedKnown && current.cursed;
  let details = '', warning = '';
  if (canEquip) {
    details = '<div class="loot-compare" aria-label="当前装备与拾取装备比较">' +
      lootEquipmentCard(world, current, false, item, icon) + lootEquipmentCard(world, item, true, current, icon) + '</div>' +
      '<p class="eq-footnote">' + (item.levelKnown && current?.levelKnown
        ? '箭头表示单项变化；实际伤害、命中和行动时间还受力量与战斗状态影响。'
        : '未鉴定的数值只是基础参考，可能与真实属性不同。双方等级明确后才标注优劣。') + '</p>';
    if (bound) warning += '当前装备受诅咒束缚，须先祛咒才能更换。';
    if (!item.cursedKnown) warning += '新装备的诅咒状态未知，穿戴后可能无法脱下。';
    else if (item.cursed) warning += '新装备有诅咒，穿戴后需要祛咒才能脱下。';
    if (item.levelKnown) {
      const stats = category === 'armor' ? armorStats(item) : weaponStats(item);
      if (stats.strength > world.state.hero.strength) warning += `当前力量 ${world.state.hero.strength}，还差 ${stats.strength - world.state.hero.strength} 点，穿戴会受到负重惩罚。`;
    }
    if (category === 'armor' && current?.sealLevel !== null && current?.sealLevel !== undefined) {
      warning += '旧护甲的纹章会留在旧甲上，可在强化工作台拆装。';
    }
  }
  // 通知可能让位于暂停/保存窗口；等待期间在背包换装或丢弃后，按当前归属呈现。
  if (wearable && !packed) warning = '你已拾取过这件装备，随后将它放下；它目前不在背包中。';
  const received = category === 'currency' ? '已收入钱袋' : wearable && !packed ? '已不在行囊中' : wearing ? '当前已装备' : '已放入行囊';
  return '<div class="loot-banner"><div class="loot-art">' + itemIcon(world, item, icon) + '</div><div>' +
    `<p class="loot-kicker">远征收获 · ${received}</p><h3 class="loot-title">${escape(itemName(world.state, item))}` +
    ` <span class="loot-quantity">×${item.quantity}</span></h3><p class="loot-description">${escape(description(world, item))}</p></div></div>` +
    details + (warning ? `<p class="loot-warning">${escape(warning)}</p>` : '') +
    '<div class="loot-actions">' + (canEquip ? action(`loot-equip:${item.id}`, bound ? '当前装备无法卸下'
      : category === 'armor' ? '立即穿戴 · 2 回合' : '立即装备 · 2 回合', 'primary', bound) : '') +
    `<button type="button" data-action="loot-keep" class="${canEquip ? 'quiet' : 'primary'}" autofocus>${canEquip ? '留在背包，暂不更换' : '知道了，继续探索'}</button></div>` +
    '<p class="eq-footnote">' + (canEquip ? '查看与保留不额外消耗回合；确认更换时敌人也会行动。旧装备保留在背包中。' : '查看和关闭此窗口不额外消耗回合。') + '</p>';
}
function bagActions(world: World, item: Item, inCamp: boolean): string {
  if (world.state.phase !== 'playing') return '<p class="eq-note">这次远征已经结束，物品作为远征记录保留。</p>';
  if (inCamp) return '<div class="eq-actions">' + action(`resume-equipment:${item.id}`, '返回原远征操作', 'primary') + '</div>';
  const category = ITEMS[item.kind].category, buttons: string[] = [];
  if (['food', 'potion', 'scroll'].includes(category)) {
    const verb = category === 'food' ? '食用 · 3 回合' : category === 'potion' ? '饮用 · 1 回合' : '阅读卷轴';
    buttons.push(action(`use:${item.id}`, verb, 'primary'));
  }
  if (item.kind === 'spd:stone/augmentation') buttons.push(action(`use:${item.id}`, '使用符石，选择目标', 'primary'));
  if (category === 'missile') buttons.push(action(`aim:${item.id}`, '选择投掷目标', 'primary'));
  if (equipment(item) && !isEquipped(world, item)) {
    const current = world.item(category === 'armor' ? world.state.hero.armorId : world.state.hero.weaponId);
    const bound = !!current && current.cursedKnown && current.cursed;
    buttons.push(action(`equip:${item.id}`, bound ? '当前装备受诅咒束缚' : '更换 · 2 回合', 'primary', bound));
  }
  if (equipment(item) || item.kind === SEAL || MATERIALS.some(material => material.kind === item.kind)) {
    buttons.push(action('equipment-tab:forge', equipment(item) ? '前往强化工作台' : '查看强化工具', 'quiet'));
  }
  if (!isEquipped(world, item)) buttons.push(action(`drop:${item.id}`, '放到脚下 · 1 回合', 'quiet'));
  return '<div class="eq-actions">' + buttons.join('') + '</div>';
}
function operationReason(world: World, item: Item, operation: string): string | null {
  if (operation === 'upgrade') return upgradeItem(item) !== null ? null
    : item.kind === SEAL ? '独立纹章最多升至 +1' : '请选择可升级的装备或独立纹章';
  if (operation === 'augment') return equipment(item) ? null : '请选择武器或护甲';
  if (operation === 'identify') {
    const eligible = equipment(item) || ['potion', 'scroll'].includes(ITEMS[item.kind].category);
    return !eligible ? '此物品不需要鉴定' : identified(world, item) ? '此物品已鉴定' : null;
  }
  if (!equipment(item)) return '请选择武器或护甲';
  return item.cursedKnown && !item.cursed ? '已确认没有诅咒' : null;
}
function sealActions(world: World, item: Item, inCamp: boolean): string {
  if (ITEMS[item.kind].category !== 'armor') return '';
  const hasSeal = item.sealLevel !== null, packedSeal = world.state.hero.inventory.some(value => value.kind === SEAL);
  if (!hasSeal && !packedSeal) return '';
  const blocked = !hasSeal && (!item.cursedKnown || item.cursed);
  const text = hasSeal ? '取下纹章后，可贴附到另一件护甲；强化随纹章转移的部分会在确认时显示。'
    : '行囊里有破损纹章，可以把它贴附到这件护甲。';
  return '<section class="eq-seal-panel"><h4>破损纹章</h4><p>' + text + '</p>' +
    (world.state.phase !== 'playing' ? '<span class="eq-footnote">远征记录仅供查看</span>' : inCamp
      ? action(`resume-equipment:${item.id}`, '返回原远征管理纹章', 'quiet')
      : action(`${hasSeal ? 'detach-seal' : 'affix-seal'}:${item.id}`, blocked ? item.cursedKnown ? '先解除护甲诅咒' : '先确认护甲无诅咒'
        : hasSeal ? '预览取下纹章 · 0 回合' : '预览贴附纹章 · 0 回合', 'quiet', blocked)) + '</section>';
}
function forgeContent(world: World, item: Item, inCamp: boolean): string {
  let preview = '';
  if (upgradeItem(item) !== null) {
    // 只在强化等级已经明确时调用纯预览，未知目标不输出下一真实等级。
    const next = item.levelKnown ? upgradeItem(item) : null;
    preview = '<section class="eq-upgrade-preview"><div class="eq-preview-heading"><h4>升级预览</h4>' +
      `<span>${next ? `${item.level >= 0 ? '+' : ''}${item.level} → ${next.level >= 0 ? '+' : ''}${next.level}` : '强化等级 +1'}</span></div>` +
      (next ? item.kind === SEAL ? '<p class="eq-note">将纹章强化至 +1。之后贴附到护甲时，强化会随纹章转移。</p>'
        : comparison(item, next, '当前', '升级后')
        : '<p class="eq-note">升级会使强化等级提高一级。真实等级尚未鉴定，因此不显示精确前后数值。</p>') + '</section>';
  }
  const ended = world.state.phase !== 'playing';
  const operations = MATERIALS.map(material => {
    const count = countMaterial(world, material.kind), reason = operationReason(world, item, material.operation);
    const unavailable = reason ?? (count > 0 ? null : `缺少已知的${material.name}`);
    return `<article class="eq-operation${unavailable ? ' unavailable' : ''}"><div><h4>${material.verb}</h4><p>${material.description}</p>` +
      `<small>${material.name} ×1 · 1 回合 · 可用 ${count}${unavailable ? ` · ${escape(unavailable)}` : ''}</small></div>` +
      (ended ? '<span class="eq-footnote">仅供查看</span>' : inCamp
        ? '<span class="eq-operation-camp">回到远征后操作</span>'
        : action(`forge-op:${material.operation}`, material.operation === 'augment' ? '选择增幅…' : '查看并确认…', '', !!unavailable)) + '</article>';
  }).join('');
  return preview + '<div class="eq-operations">' + operations + '</div>' + sealActions(world, item, inCamp) +
    (inCamp && !ended ? '<div class="eq-actions">' + action(`resume-equipment:${item.id}`, '返回原远征，打开工作台', 'primary') + '</div>' : '') +
    '<p class="eq-footnote">选择与预览不消耗材料。最终确认时结算材料和行动；每次新远征重新积累。</p>';
}
function itemDetail(world: World, item: Item | undefined, tab: EquipmentTab, inCamp: boolean, icon: Icon): string {
  if (!item) return '<div class="eq-empty-detail"><span aria-hidden="true">◇</span><h3>选择一件物品</h3><p>' +
    (tab === 'forge' ? '先选择目标，再查看升级、鉴定、祛咒或增幅。' : '点选上方装备槽或行囊物品，查看属性与操作。') + '</p></div>';
  const augment = equipment(item) ? augmentLabel(item) : '';
  return '<div class="eq-detail-heading">' + itemIcon(world, item, icon) + `<div><h3>${escape(itemName(world.state, item))}</h3>` +
    '<div class="eq-badges">' + badges(world, item) + (augment ? `<span class="eq-badge">${augment}</span>` : '') + '</div></div></div>' +
    `<p class="eq-description">${escape(description(world, item))}</p>` +
    familiarityContent(world, item) + shieldContent(world, item) +
    (ITEMS[item.kind].category === 'missile' ? `<p class="eq-note">数量 ${item.quantity} · 当前一枚耐久 ${Math.ceil(item.durability)}%</p>` : '') +
    (tab === 'bag' ? statsContent(world, item) + currentComparison(world, item) + bagActions(world, item, inCamp)
      : forgeContent(world, item, inCamp));
}

export function equipmentContent(world: World, selectedId: number | null, filter: BagFilter, tab: EquipmentTab,
  inCamp: boolean, icon: Icon): string {
  const hero = world.state.hero, selected = selectedId === null ? undefined : world.item(selectedId);
  const items = hero.inventory.filter(item => fits(item, filter));
  const cards = items.map(item => {
    const active = item.id === selectedId;
    return `<button type="button" class="eq-item${active ? ' selected' : ''}" data-action="equipment-item:${item.id}" aria-pressed="${active}">` +
      itemIcon(world, item, icon) + `<span class="eq-item-copy"><strong>${escape(itemName(world.state, item))}</strong>` +
      '<span class="eq-badges">' + badges(world, item) + '</span></span>' +
      `<span class="eq-quantity" aria-label="数量 ${item.quantity}">×${item.quantity}</span></button>`;
  }).join('');
  const resources = tab === 'forge' ? '<div class="eq-materials" aria-label="已知强化材料">' + MATERIALS.map(material =>
    `<span>${material.name}<strong>×${countMaterial(world, material.kind)}</strong></span>`).join('') +
    '</div><p class="eq-material-note">卷轴只计入已辨认的类型；未知卷轴可以在行囊中先鉴定或阅读。</p>' : '';
  return `<div class="equipment-workspace" data-equipment-tab="${tab}"><div class="eq-run-summary"><span>${inCamp ? '海风镇 · 本次远征装备' : `海岸下水道 · 第 ${world.state.depth} 层`}</span>` +
    `<div><span>力量 <strong>${hero.strength}</strong></span><span>生命 <strong>${hero.hp}/${hero.maxHP}</strong></span><span>金币 <strong>${hero.gold}</strong></span></div></div>` +
    (inCamp ? '<p class="eq-camp-note">营地可以查看与规划。返回原来的楼层和位置后，再消耗远征物品进行操作。</p>' : '') +
    topSlots(world, selectedId, icon) + '<nav class="eq-tabs" aria-label="装备管理页面">' +
    (['bag', 'forge'] as const).map(value => `<button type="button" data-action="equipment-tab:${value}" aria-pressed="${tab === value}" class="${tab === value ? 'active' : ''}">${value === 'bag' ? '行囊与装备' : '强化工作台'}</button>`).join('') + '</nav>' +
    resources + '<div class="eq-layout"><section class="eq-detail" aria-label="所选物品详情">' +
    itemDetail(world, selected, tab, inCamp, icon) + '</section><section class="eq-list-pane" aria-label="行囊物品"><nav class="eq-filters" aria-label="物品分类">' +
    FILTERS.map(([value, label]) => `<button type="button" data-action="equipment-filter:${value}" aria-pressed="${filter === value}" class="${filter === value ? 'active' : ''}">${label}<span>${hero.inventory.filter(item => fits(item, value)).length}</span></button>`).join('') +
    '</nav><div class="eq-item-list">' + (cards || '<p class="eq-list-empty">这一类暂时没有物品。</p>') + '</div></section></div></div>';
}
