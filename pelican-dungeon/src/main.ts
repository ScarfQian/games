/* SPDX-License-Identifier: GPL-3.0-or-later
 * 网页装配与输入适配：ScarfQian，2026-10-30。
 * 玩家动作经 World 提交；菜单、动画、存储等待与后台停留均不推进游戏时间。
 */
import './style.css';
import version from '../version.json';
import { World, itemName, MOB_DEFINITIONS } from './game/world';
import { ITEMS, armorStats, weaponStats, upgradeItem, augmentChoices, forgeEligible, FORGE_MATERIALS, AUGMENT_NAMES,
  type Augment, type ForgeOperation, type Item, type ItemKind } from './game/items';
import { availableTalentPoints, baseHealthAtLevel, experienceToLevel, TALENTS, type TalentId } from './game/progression';
import type { Command, Mob } from './game/model';
import { EXPLORATION } from './game/exploration';
import { distance, Tile } from './game/terrain';
import { openStorage, type Storage as GameStorage, type SaveRecord } from './platform/storage';
import { decodeSave, serializeSave } from './save/codec';
import { prepareFloor } from './platform/floor-loader';
import { SceneRenderer, loadSprites, pelicanURL, itemsURL, ITEM_FRAMES, STEP_DURATION_MS } from './render/scene';
import { CampScene, type CampPlace } from './render/camp';
import { equipmentContent, pickupContent, type BagFilter, type EquipmentTab } from './ui/equipment';
import { adventureIcon, type AdventureIcon } from './ui/art';
import './adventure.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const buildVersion = version.currentVersion ?? version.nextVersion ?? 'dev';
const escapeHTML = (value: unknown): string => String(value).replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const ACTION_ICONS: Partial<Record<string, AdventureIcon>> = {
  attack: 'attack', bag: 'bag', pickup: 'chest', wait: 'rest', inspect: 'inspect',
  rest: 'rest', growth: 'book', 'quick-heal': 'potion', forge: 'armor',
};
const actionLabel = (action: string, label: string): string =>
  (ACTION_ICONS[action] ? adventureIcon(ACTION_ICONS[action]!) : '') + label;
const button = (action: string, label: string, style = ''): string =>
  '<button type="button" data-action="' + action + '" class="' + style + '">' + actionLabel(action, label) + '</button>';
const directions = [[-1,-1,'↖'],[0,-1,'↑'],[1,-1,'↗'],[-1,0,'←'],[0,0,'·'],[1,0,'→'],[-1,1,'↙'],[0,1,'↓'],[1,1,'↘']] as const;
const moveKeys: Record<string, [number, number]> = {
  arrowup:[0,-1],w:[0,-1],arrowdown:[0,1],s:[0,1],arrowleft:[-1,0],a:[-1,0],arrowright:[1,0],d:[1,0],
  q:[-1,-1],e:[1,-1],z:[-1,1],c:[1,1],
};
app.innerHTML =
  '<section class="camp-shell" id="camp-shell" aria-label="海风镇营地">' +
    '<header class="game-header"><div class="brand"><img src="' + pelicanURL + '" alt=""><div><h1>鹈鹕骑士</h1><p>海风镇 · 远征从这里开始</p></div></div>' +
    '<div class="header-right"><span class="version-tag">v' + escapeHTML(buildVersion) + '</span>' + button('slots', '远征存档', 'small quiet') +
    button('help', '指南', 'small quiet') + button('about', '关于', 'small quiet') + '</div></header>' +
    '<div id="camp-stage" aria-label="自由行走的海风镇"></div><footer class="camp-footer"><p id="camp-summary">围紧围巾，去镇上走走。</p>' +
    '<div class="row">' + button('camp-gate', '启程 · 冒险入口', 'primary') + button('import', '导入存档', 'quiet') + '</div></footer></section>' +
  '<main class="game-shell hidden" id="game-shell">' +
    '<header class="game-header"><div class="brand"><img src="' + pelicanURL + '" alt=""><div><h1>鹈鹕骑士</h1><p>地牢远征 · 海岸下水道</p></div></div>' +
    '<div class="header-right"><span id="save-state" class="save-state"></span><span class="version-tag">v' + escapeHTML(buildVersion) + '</span>' +
    button('pause', '暂停 · 菜单', 'small quiet') + '</div></header>' +
    '<div class="play-layout"><section class="board" aria-label="地牢地图"><canvas id="world" tabindex="0" aria-label="地牢地图，方向键移动，空格等待，I背包，G拾取，T投掷"></canvas>' +
    '<div id="map-transition" class="map-transition" hidden role="status" aria-live="polite"><div class="transition-stairs" aria-hidden="true">╲<br>　╲<br>　　╲</div><p id="transition-kicker"></p><h2 id="transition-title"></h2><p id="transition-note"></p></div>' +
    '<div class="board-label" id="floor-label">海岸下水道 · 第 1 层</div><section class="combat-target" id="combat-target" aria-label="当前敌人" hidden>' +
    '<div class="target-heading"><span id="target-state"></span>' + button('cycle-target', '换目标', 'small quiet') + '</div>' +
    '<div class="target-name"><strong id="target-name"></strong><span id="target-hp"></span></div>' +
    '<div class="target-meter"><span id="target-hp-bar"></span></div><p id="target-hint"></p></section>' +
    '<div class="board-help" id="board-help"></div><div class="supply-bar" id="supply-bar" aria-label="快捷补给与成长"></div>' +
    '<div class="board-tools">' + button('zoom-out', '−', 'small') + button('zoom-in', '+', 'small') + '</div></section>' +
    '<aside class="right-panel"><section class="panel hero-panel" id="hero-panel"></section>' +
    '<section class="panel objectives" id="objectives"></section>' +
    '<section class="panel journal"><h2>远征手记</h2><div class="journal-list" id="journal-list" role="log" aria-live="polite"></div></section></aside></div>' +
    '<footer class="game-footer"><div class="quick-actions">' + button('attack', '攻击 <kbd>F</kbd>', 'primary') + button('bag', '背包 <kbd>I</kbd>') + button('pickup', '拾取 <kbd>G</kbd>') +
    button('throw', '投掷 <kbd>T</kbd>') + button('wait', '等待 <kbd>空格</kbd>') + button('inspect', '查看 <kbd>X</kbd>', 'quiet') +
    button('rest', '休息 <kbd>R</kbd>', 'quiet') + button('growth', '成长 <kbd>L</kbd>', 'quiet') + '</div><p class="key-guide">WASD 行走 · F 攻击 · Tab 换目标<br>1 治疗 · 2 食物 · B 强化 · L 天赋</p>' +
    '<div class="mobile-controls" aria-label="八方向移动">' + directions.map(([dx,dy,label]) =>
      '<button type="button" data-dir="' + dx + ',' + dy + '" aria-label="' + (dx === 0 && dy === 0 ? '等待' : '向' + label + '移动') + '">' + label + '</button>').join('') +
    '</div><p class="mobile-hint">打开背包和菜单不会推进回合</p></footer></main>' +
  '<dialog id="dialog" aria-labelledby="dialog-title"></dialog><div class="toast" id="toast" role="status"></div>' +
  '<input type="file" id="import-file" accept=".json,application/json" hidden>';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const dialog = el<HTMLDialogElement>('dialog'), canvas = el<HTMLCanvasElement>('world');
let world: World | null = null, storage: GameStorage | null = null, renderer: SceneRenderer, camp: CampScene | null = null;
let activeSlot: number | null = null, revision: number | null = null, busy = true, savePaused = false;
let mode = 'camp', throwingItem: number | null = null, inspecting = false;
let pathToken = 0, zoom = 1, lastFocus: HTMLElement | null = null;
let toastTimer: number | undefined, lastLogId = -1, storageProblem = '';
let slots: SaveRecord[] = [];
let confirmation: (() => void | Promise<void>) | null = null;
const heldDirections = new Map<string, [number, number]>();
let controlToken = 0, manualPending = false, nextManualAt = 0;
let pendingInteraction: (() => void) | null = null;
let queuedDirection: [number, number] | null = null;
let transitioning = false;
let resting = false;
let selectedEnemyId: number | null = null, aimCell: number | null = null, touchAimCell: number | null = null;
let hoverCell: number | null = null, lastCombatLabel = '';
let selectedEquipmentId: number | null = null, bagFilter: BagFilter = 'all', equipmentTab: EquipmentTab = 'bag';
let confirmationBack: (() => void) | null = null;
// 本次领取数量独立于背包合并后的数量；通知不写入存档、不发放任何奖励。
let pendingLoot: { runId: string; item: Item } | null = null;

function visibleTargets(): Mob[] {
  if (!world) return [];
  return world.visibleEnemies().sort((a, b) => distance(world!.state.level, world!.state.hero.pos, a.pos)
    - distance(world!.state.level, world!.state.hero.pos, b.pos) || a.id - b.id);
}
function selectedEnemy(): Mob | undefined { return world?.visibleEnemies().find(enemy => enemy.id === selectedEnemyId); }
function refreshTarget(): void {
  if (!selectedEnemy()) selectedEnemyId = visibleTargets()[0]?.id ?? null;
  renderer.setFocus(selectedEnemyId);
}
function clearAim(): void {
  throwingItem = null; aimCell = null; touchAimCell = null; hoverCell = null; renderer.setTarget(null);
}
function cycleTarget(): void {
  const enemies = visibleTargets();
  if (!enemies.length) { toast('视野内没有敌人。'); return; }
  const next = enemies[(enemies.findIndex(enemy => enemy.id === selectedEnemyId) + 1) % enemies.length]!;
  selectedEnemyId = next.id; hoverCell = null; renderer.setFocus(next.id); renderer.setTarget(null);
  if (throwingItem !== null) { aimCell = next.pos; touchAimCell = null; renderer.setTarget(aimCell); }
  syncHUD();
}
async function attackSelected(): Promise<void> {
  if (!world || world.state.phase !== 'playing') return;
  if (throwingItem !== null) {
    const target = aimCell;
    if (target === undefined || target === null) { toast('先点击格子选择投掷落点。'); return; }
    await perform({ type: 'throw', itemId: throwingItem, target }); return;
  }
  refreshTarget(); const enemy = selectedEnemy();
  if (!enemy) { toast('视野内没有敌人。'); return; }
  if (!world.canAttack(enemy.pos)) { toast('目标超出武器范围，或被墙与其他角色挡住。'); return; }
  await perform({ type: 'attack', target: enemy.pos });
}

function syncCombat(now: number): void {
  if (!world) return;
  const hero = world.state.hero, enemy = selectedEnemy();
  const hp = renderer.displayHP(hero, now), hpLabel = document.getElementById('hero-hp-text');
  if (hpLabel && hpLabel.textContent !== hp + ' / ' + hero.maxHP) {
    hpLabel.textContent = hp + ' / ' + hero.maxHP;
    el('hero-hp-bar').style.width = 100 * hp / hero.maxHP + '%';
    el('hero-hp-meter').setAttribute('aria-valuenow', String(hp));
  }
  const enemyHP = enemy ? renderer.displayHP(enemy, now) : 0;
  const near = enemy && world.canAttack(enemy.pos);
  const targets = world.visibleEnemies();
  const label = [enemy?.id, enemyHP, enemy?.state, enemy?.enemySeen, enemy?.pumpedUp, near, targets.length, throwingItem, aimCell, hero.hp, world.state.phase].join(':');
  if (label === lastCombatLabel) return;
  lastCombatLabel = label;
  const panel = el('combat-target'), attack = document.querySelector<HTMLButtonElement>('[data-action="attack"]')!;
  panel.hidden = !enemy || world.state.phase !== 'playing';
  attack.innerHTML = actionLabel('attack', (throwingItem !== null ? '投出' : '攻击') + ' <kbd>F</kbd>');
  attack.disabled = world.state.phase !== 'playing' || (throwingItem !== null
    ? aimCell === null || aimCell === hero.pos || !world.visible[aimCell] : !near);
  attack.title = throwingItem !== null ? '确认投向已选落点' : near ? '攻击武器范围内的选中敌人，一次一击' : '目标不在武器范围；T 可选择投掷石';
  if (!enemy) return;
  el('target-name').textContent = MOB_DEFINITIONS[enemy.species].name;
  el('target-hp').textContent = enemyHP + ' / ' + enemy.maxHP;
  el('target-hp-bar').style.width = 100 * enemyHP / enemy.maxHP + '%';
  el('target-state').textContent = (enemy.pumpedUp > 0 ? '蓄力 ' + enemy.pumpedUp + '/2' : enemy.state === 'sleeping' ? '熟睡' : enemy.enemySeen ? '已发现你' : '尚未察觉') + ' · 视野内 ' + targets.length + ' 只';
  el('target-hint').textContent = enemy.pumpedUp > 0 ? '危险范围已标出！离开两格范围或绕到墙后。' : throwingItem !== null ? '查看虚线落点，再确认投出。' :
    MOB_DEFINITIONS[enemy.species].description;
  document.querySelector<HTMLButtonElement>('[data-action="cycle-target"]')!.disabled = targets.length < 2;
}

function stopTravel(): void {
  pathToken++; controlToken++; heldDirections.clear(); queuedDirection = null; nextManualAt = 0; pendingInteraction = null;
  if (resting) { resting = false; syncHUD(); }
}
function holdDirection(key: string, direction: [number, number]): void {
  if (transitioning) return;
  if (resting) { resting = false; syncHUD(); }
  pathToken++; controlToken++; heldDirections.set(key, direction); pendingInteraction = null;
  queuedDirection = combinedDirection();
  clearAim(); inspecting = false; syncHUD();
  driveMovement(performance.now());
}
function releaseDirection(key: string): void {
  if (heldDirections.delete(key)) {
    controlToken++;
    if (heldDirections.size && queuedDirection) queuedDirection = combinedDirection();
  }
}
function combinedDirection(): [number, number] {
  let x = 0, y = 0;
  for (const [dx, dy] of heldDirections.values()) { x += dx; y += dy; }
  return [Math.sign(x), Math.sign(y)];
}
function interactWhenReady(action: () => void): void {
  if (transitioning) return;
  // 最多保留一次新的点击意图；改道/打开菜单不要求玩家等动画结束后再点击一遍。
  if (busy) pendingInteraction = action;
  else action();
}
function driveMovement(now: number): void {
  if ((!heldDirections.size && !queuedDirection) || manualPending || busy || transitioning || dialog.open || document.hidden || mode !== 'game'
    || world?.state.phase !== 'playing' || now < nextManualAt) return;
  const [dx, dy] = heldDirections.size ? combinedDirection() : queuedDirection!;
  queuedDirection = null;
  if (dx === 0 && dy === 0) return;
  const token = controlToken;
  manualPending = true; nextManualAt = now + STEP_DURATION_MS;
  // 忙碌期间的一次短按保留到本批动画结束；只有一个意图槽，连续按住不积压路径。
  void move(dx, dy).then(keepGoing => {
    if (!keepGoing && token === controlToken) stopTravel();
  }).catch(error => { stopTravel(); reportError(error); }).finally(() => { manualPending = false; });
}

function toast(message: string): void {
  el('toast').textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el('toast').textContent = ''; }, 4000);
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
function setSaveLabel(message: string, warning = false): void {
  const label = el('save-state'); label.textContent = message; label.classList.toggle('warning', warning);
}
function showDialog(kind: string, title: string, content: string): void {
  const focusAction = dialog.open ? (document.activeElement as HTMLElement | null)?.dataset.action : undefined;
  stopTravel(); dialog.dataset.kind = kind;
  if (!dialog.open) lastFocus = document.activeElement as HTMLElement | null;
  dialog.innerHTML = '<div class="dialog-inner"><header class="dialog-header"><h2 id="dialog-title">' + escapeHTML(title) +
    '</h2>' + button('close', '×') + '</header>' + content + '<p class="dialog-error" id="dialog-error" role="alert"></p></div>';
  if (!dialog.open) dialog.showModal();
  else if (focusAction) dialog.querySelector<HTMLElement>('[data-action="' + CSS.escape(focusAction) + '"]')?.focus({ preventScroll: true });
}
function closeDialog(): void {
  dialog.close(); dialog.dataset.kind = '';
  if (mode === 'game') canvas.focus({ preventScroll: true });
  else if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
function closeCurrentDialog(): void {
  const kind = dialog.dataset.kind;
  if (kind === 'confirm') {
    confirmation = null;
    if (confirmationBack) { const back = confirmationBack; confirmationBack = null; back(); return; }
    if (mode === 'game' && world?.state.pendingChoice) showUpgrade(); else closeDialog();
  } else if (kind === 'forge-preview') showUpgrade();
  else if (kind === 'upgrade') cancelUpgrade();
  else {
    closeDialog();
    if (kind !== 'result') showActionOutcome();
  }
}
function showPickup(): void {
  if (!world || !pendingLoot || mode !== 'game' || dialog.open) return;
  if (pendingLoot.runId !== world.state.runId) { pendingLoot = null; return; }
  // 拾取的一回合可能致死，先呈现结算；保存错误和其他已打开菜单不会被通知覆盖。
  if (world.state.phase !== 'playing') { showResult(); return; }
  if (world.state.pendingChoice) return;
  const received = pendingLoot.item;
  const item = { ...(world.item(received.id) ?? received), quantity: received.quantity };
  pendingLoot = null;
  clearAim(); inspecting = false; syncHUD();
  showDialog('loot', '你捡到了', pickupContent(world, item, icon));
  dialog.querySelector<HTMLButtonElement>('[data-action="loot-keep"]')?.focus({ preventScroll: true });
}
function showActionOutcome(): void {
  if (!world || mode !== 'game') return;
  if (world.state.phase !== 'playing') {
    // 死亡结算优先于动画中打开的暂停窗；存储错误仍先让玩家处理。
    if (!dialog.open || dialog.dataset.kind !== 'save-error') showResult();
  } else if (!dialog.open) {
    if (world.state.pendingChoice) showUpgrade();
    else showPickup();
  }
}
function hasUnstoredCurrent(): boolean { return !!world && (activeSlot === null || savePaused); }
function confirmAction(title: string, description: string, label: string, onConfirm: () => void | Promise<void>, onBack: (() => void) | null = null): void {
  confirmation = onConfirm;
  confirmationBack = onBack;
  showDialog('confirm', title, '<p class="muted">' + escapeHTML(description) + '</p><div class="dialog-actions">' +
    button('confirmed', escapeHTML(label), 'primary') + button('cancel-confirm', '返回', 'quiet') + '</div>');
}
function icon(kind: ItemKind): string {
  const [x,y] = ITEM_FRAMES[kind]!;
  return '<span class="item-icon" aria-hidden="true" style="background-image:url(' + itemsURL + ');background-position:-' +
    x! * 2 + 'px -' + y! * 2 + 'px"></span>';
}
function syncHUD(): void {
  if (!world) return;
  const { state } = world, hero = state.hero;
  refreshTarget();
  const hp = renderer.displayHP(hero, performance.now());
  const hunger = state.hunger.level >= 450 ? '极度饥饿' : state.hunger.level >= 300 ? '饥饿' : '饱腹';
  const nextLevel = experienceToLevel(hero.level);
  el('floor-label').textContent = '海岸下水道 · 第 ' + state.depth + ' / 5 层' + (state.level.locked ? ' · 首领封锁' : '');
  el('objectives').innerHTML = '<strong>' + (state.depth === 5 ? state.level.bossDefeated ? '封锁已经解除' : '击败深处的 Goo' : '循着阶梯前行') + '</strong><br>' +
    (state.depth === 5 ? state.level.bossDefeated ? '前往向下阶梯，完成第一章。' : '蓄力时离开危险范围。<br>水能洗掉淤泥，也会让 Goo 回血。' : '寻找补给、力量药和升级卷轴。<br>第 2—4 层会随行动时间补充敌人。') +
    '<div class="dialog-actions">' + button('growth', '查看成长', 'small quiet') + '</div>';
  el('hero-panel').innerHTML = '<h2>远征者</h2><div class="hero-line"><img class="hero-portrait" src="' + pelicanURL + '" alt="鹈鹕战士">' +
    '<div><p class="hero-name">鹈鹕 <small>战士</small></p><span class="muted">等级 ' + hero.level + '</span></div></div>' +
    '<div class="meter-label"><span>' + adventureIcon('heart') + '生命' + (state.seal.shield > 0 ? ' · 护盾 ' + state.seal.shield : '') + '</span><span id="hero-hp-text">' + hp + ' / ' + hero.maxHP + '</span></div>' +
    '<div id="hero-hp-meter" class="meter" role="meter" aria-label="生命" aria-valuemin="0" aria-valuemax="' + hero.maxHP + '" aria-valuenow="' + hp + '"><span id="hero-hp-bar" style="width:' + 100 * hp / hero.maxHP + '%"></span></div>' +
    '<div class="meter-label"><span>经验 · ' + hero.level + ' 级</span><span>' + hero.xp + ' / ' + nextLevel + '</span></div><div class="meter xp"><span style="width:' +
    Math.min(100,100 * hero.xp / nextLevel) + '%"></span></div><div class="hero-stats"><div>力量<strong>' + hero.strength + '</strong></div><div>' + adventureIcon('gold') + '金币<strong>' + hero.gold +
    '</strong></div><div>击败<strong>' + state.stats.kills + '</strong></div></div><div class="status-line"><span>' + hunger +
    '</span><span>纹章' + (state.seal.cooldown > 0 ? '冷却 ' + state.seal.cooldown : '就绪') + '</span></div>';
  const weapon = world.item(hero.weaponId), armor = world.item(hero.armorId);
  const stones = hero.inventory.filter(item => item.kind === 'spd:missile/throwing-stone').reduce((sum, item) => sum + item.quantity, 0);
  el('hero-panel').insertAdjacentHTML('beforeend', '<div class="equipment-line">' +
    button('equipment-item:' + hero.weaponId, escapeHTML(weapon ? itemName(state, weapon) : ''), 'small quiet') +
    button('equipment-item:' + hero.armorId, escapeHTML(armor ? itemName(state, armor) : ''), 'small quiet') + '<span>投石 ×' + stones + '</span></div>');
  const healingCount = hero.inventory.filter(item => item.kind === 'spd:potion/healing' && state.knownTypes.includes(item.kind)).reduce((sum,item) => sum + item.quantity, 0);
  const foodCount = hero.inventory.filter(item => item.kind === 'spd:food/ration').reduce((sum,item) => sum + item.quantity, 0);
  const points = availableTalentPoints(hero);
  el('supply-bar').innerHTML = button('quick-heal', '治疗 ' + healingCount + ' <kbd>1</kbd>', 'small') +
    button('quick-food', '口粮 ' + foodCount + ' <kbd>2</kbd>', 'small') +
    button('growth', points ? '可分配天赋 +' + points : '成长 <kbd>L</kbd>', points ? 'small primary' : 'small quiet');
  el('supply-bar').querySelector<HTMLButtonElement>('[data-action="quick-heal"]')!.disabled = healingCount === 0 || state.phase !== 'playing';
  el('supply-bar').querySelector<HTMLButtonElement>('[data-action="quick-food"]')!.disabled = foodCount === 0 || state.phase !== 'playing';
  if (hero.provokedUntil > 0 && hero.provokedUntil >= hero.time) el('hero-panel').insertAdjacentHTML('beforeend', '<p class="status-warning">激怒 · 下一次命中 +' + (1 + 2 * hero.talents['provoked-anger']) + '</p>');
  if (state.ooze.left > 0) el('hero-panel').insertAdjacentHTML('beforeend', '<p class="status-warning">腐蚀淤泥 ' + state.ooze.left + ' · 入水洗去</p>');
  const restButton = document.querySelector<HTMLButtonElement>('[data-action="rest"]');
  if (restButton) { restButton.innerHTML = actionLabel('rest', (resting ? '停止休息' : '休息') + ' <kbd>R</kbd>'); restButton.classList.toggle('resting', resting); }
  const throwButton = document.querySelector<HTMLButtonElement>('.quick-actions [data-action="throw"]')!;
  throwButton.innerHTML = (throwingItem !== null ? '取消' : '投掷') + ' <kbd>T</kbd>';
  const newest = state.messages.at(-1)?.id ?? 0;
  if (newest !== lastLogId) {
    const journal = el('journal-list');
    journal.innerHTML = state.messages.slice(-24).map(message => '<p class="' + message.tone + '">' + escapeHTML(message.text) + '</p>').join('');
    journal.scrollTop = journal.scrollHeight; lastLogId = newest;
  }
  const floorItems = state.level.heaps.filter(heap => heap.cell === hero.pos);
  const nearby = world.nearbyFeatures();
  const pickup = document.querySelector<HTMLButtonElement>('.quick-actions [data-action="pickup"]')!;
  pickup.innerHTML = actionLabel('pickup', (floorItems.length ? '拾取' : hero.pos === state.level.exit || hero.pos === state.level.entrance ? '阶梯' : nearby.length ? '互动' : '拾取') + ' <kbd>G</kbd>');
  el('board-help').textContent = throwingItem !== null ? '选落点查看虚线 · F / 投出确认 · 触屏再点落点投出 · T 取消' :
    inspecting ? '点击格子查看 · 再按 X 结束' :
    resting ? '正在休息 · 敌人和饥饿仍会推进 · R 或移动取消' :
    state.phase !== 'playing' ? '本次远征已结束，可从菜单查看结算。' :
    floorItems.length ? '脚下有物品 · 按 G 或点击「拾取」' :
    hero.pos === state.level.exit ? '找到向下的阶梯 · 按 G 查看' :
    nearby.length ? EXPLORATION[nearby[0]!.kind].name + ' · 按 G 或点击地点互动' : '';
  if (state.awarenessUntil > 0 && state.awarenessUntil >= hero.time) el('hero-panel').insertAdjacentHTML('beforeend', '<p class="status-warning">觉察 · 短暂感知物品周围</p>');
  lastCombatLabel = ''; syncCombat(performance.now());
}
function showWorld(): void {
  mode = 'game'; camp?.setActive(false); el('camp-shell').classList.add('hidden'); el('game-shell').classList.remove('hidden');
  clearAim(); selectedEnemyId = null; inspecting = false; stopTravel(); renderer.reset(); lastLogId = -1;
  closeDialog(); syncHUD();
  showActionOutcome();
}
function showCamp(): void {
  mode = 'camp'; stopTravel(); closeDialog();
  el('game-shell').classList.add('hidden'); el('camp-shell').classList.remove('hidden');
  el('camp-summary').textContent = world?.state.phase === 'playing'
    ? '远征暂停在第 ' + world.state.depth + ' 层 · 等级 ' + world.state.hero.level + ' · 从冒险入口继续。' + (hasUnstoredCurrent() ? '本页进度尚未保存，请导出保留。' : '')
    : '逛逛铁匠铺与学堂，再从冒险入口出发。';
  camp?.setActive(true);
}
function growthContent(): string {
  let cumulative = 0;
  const rows = Array.from({ length: 8 }, (_, index) => {
    const level = index + 1;
    if (level > 1) cumulative += experienceToLevel(level - 1);
    return '<tr' + (world?.state.hero.level === level ? ' class="current-level"' : '') + '><td>' + level + '</td><td>' + cumulative +
      '</td><td>' + experienceToLevel(level) + '</td><td>' + baseHealthAtLevel(level) + '</td></tr>';
  }).join('');
  const hero = world?.state.hero, points = hero ? availableTalentPoints(hero) : 0;
  const talents = '<section class="talent-section"><div class="talent-heading"><h3>战士 · 第一层天赋</h3><span>' +
    (hero ? '可用 ' + points + ' 点' : '2级开始获得天赋点') + '</span></div><p class="muted">2—6级每级获得1点，共5点；每项最多2级，本次远征内不能重置。</p><div class="talent-grid">' +
    (Object.keys(TALENTS) as TalentId[]).map(id => {
      const data = TALENTS[id], rank = hero?.talents[id] ?? 0;
      return '<article class="talent-card' + (rank ? ' learned' : '') + '"><div class="row"><h4>' + data.name + '</h4><strong>' + rank + '/2</strong></div><p>' + data.description +
        '</p><p class="muted">Ⅰ ' + data.ranks[0] + '<br>Ⅱ ' + data.ranks[1] + '</p>' +
        (hero && world?.state.phase === 'playing' && rank < 2 && points > 0 ? button(mode === 'camp' ? 'resume-growth' : 'learn-talent:' + id,
          mode === 'camp' ? '返回远征分配' : '投入1点 · ' + (rank + 1) + '/2', 'primary') : '<span class="muted">' + (rank === 2 ? '已学满' : '升级获得天赋点') + '</span>') + '</article>';
    }).join('') + '</div></section>';
  return talents + '<details class="growth-details"><summary>等级曲线、力量与装备成长</summary><p>等级提高生命、命中与闪避；力量药帮助你驾驭更重的装备；升级卷轴提高装备属性并逐步降低力量需求。</p>' +
    (world ? '<p class="growth-current">当前远征：等级 ' + world.state.hero.level + ' · 经验 ' + world.state.hero.xp + ' / ' + experienceToLevel(world.state.hero.level) +
      ' · 力量 ' + world.state.hero.strength + ' · 生命上限 ' + world.state.hero.maxHP + '</p>' : '') +
    '<div class="table-scroll"><table class="growth-table"><thead><tr><th>等级</th><th>累计经验</th><th>下级所需</th><th>基础生命</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<ul class="help-list"><li>每次升级增加 5 点生命上限与当前生命，命中、闪避各提高 1；力量不会随等级自动增加。</li>' +
    '<li>新远征前四层共放置 2 瓶力量药和 3 张升级卷轴：力量药分别在第 1—2 层、第 3—4 层各有一瓶，记得探索房间与拾取。返回旧层不会再次生成。</li>' +
    '<li>力量不足会降低武器命中并拖慢攻击；穿戴过重的护甲会拖慢移动、降低闪避与防护。升级装备也能降低力量要求。</li>' +
    '<li>同类弱敌提供经验有等级上限，蝇群分体不提供经验。继续深入，寻找更适合当前等级的挑战。</li>' +
    '<li>以上成长只属于本次远征。新的远征从等级 1、力量 10、生命 20 重新开始。第二层及后续职业天赋尚未开放。</li></ul></details>';
}
async function visitCamp(place: CampPlace): Promise<void> {
  if (mode !== 'camp' || busy) return;
  if (place === 'school') {
    showDialog('camp-school', '仙鹤学堂 · 成长与天赋', growthContent());
  } else if (place === 'forge') {
    equipmentTab = 'forge'; bagFilter = 'equipment';
    if (world) openInventory(selectedEquipmentId ?? world.state.hero.weaponId);
    else showDialog('camp-forge', '熊猫铁匠铺 · 强化工作台', '<p>“带上在地下城找到的装备与材料，再来看看能怎样改善。”</p><p class="muted">工作台可以升级、鉴定、祛咒、增幅和转移纹章。先从冒险入口开始或读取一局远征。</p><div class="dialog-actions">' + button('camp-gate','前往冒险入口','primary') + button('slots','读取远征') + '</div>');
  } else if (place === 'hall') {
    showDialog('camp-hall', '秦王行政厅 · 远征委托', '<p class="muted">正在读取远征记录…</p>');
    const records = storage ? await storage.list() : [];
    if (mode !== 'camp' || !dialog.open || dialog.dataset.kind !== 'camp-hall') return;
    const current = world?.state, depth = current?.deepestFloor ?? 0, defeated = current?.level.bossDefeated || current?.archivedLevels['5']?.bossDefeated;
    showDialog('camp-hall', '秦王行政厅 · 远征委托', '<p>“沿下水道逐层查探，清除盘踞第五层的 Goo，再把见闻带回海风镇。”</p>' +
      '<ol class="help-list"><li>' + (depth >= 1 ? '已出发' : '待出发') + '：进入海岸下水道。</li><li>' + (depth >= 4 ? '已抵达' : '探索中') +
      '：调查前四层，收集补给和成长道具。</li><li>' + (defeated ? '已击败' : '待完成') + '：击败 Goo。</li><li>' +
      (current?.phase === 'chapter-complete' ? '已完成' : '待完成') + '：从第五层出口完成第一章。</li></ol>' +
      '<p class="muted">委托记录本次远征进度，无额外属性奖励。存档中保留 ' + records.length + ' 次远征，其中 ' +
      records.filter(record => record.state.phase === 'chapter-complete').length + ' 次已完成第一章。</p><div class="dialog-actions">' + button('slots', '查看远征记录', 'primary') + '</div>');
  } else if (place === 'notice') {
    showDialog('camp-notice', '海风镇公告 · v' + buildVersion, '<ul class="help-list"><li>本次更新：拾取后显示收获，装备可与身上装备并排比较，选择立即穿戴或留在背包。</li>' +
      '<li>前四层按房间面积增加并分散敌人，后续普通层补怪更快。旧楼层不重新填怪；新远征可体验完整分配。</li>' +
      '<li>加入像素图标、森林林缘与羊皮纸界面，手机补给和生命状态移出地图。</li><li>海风镇可自由行走，拜访熊猫铁匠、仙鹤先生与秦王。</li>' +
      '<li>海岸下水道开放五层，楼层状态保留，可沿阶梯返回。</li><li>新加入豺狼、螃蟹、蝇群、史莱姆与首领 Goo，不同楼层使用不同敌人组合。</li>' +
      '<li>装备扩充到15种近战武器、5阶护甲，加入升级、鉴定、祛咒、增幅与纹章转移。</li><li>学堂开放战士第一层四项天赋；升级后按 L 分配。</li>' +
      '<li>按 I 整理装备、B 打开强化台，1/2 快捷使用治疗药/口粮；旧存档继续读取。</li></ul>');
  } else if (place === 'rack') {
    showDialog('camp-rack', '武器架 · 此行装备', '<p>本次远征可以找到匕首、拳套、长矛、圆盾、长鞭等15种近战武器。射程、攻速、命中与防护各有取舍，在行囊里比较和更换。</p>' +
      '<p class="muted">架上的弓箭、刀盾、太刀、双手武器、法杖与散弹枪是海风镇已有的收藏。对应武器体系将随移植进度开放，当前不能从营地免费领取或切换。</p>' +
      (world?.state.phase === 'playing' ? '<div class="dialog-actions">' + button('resume-bag', '返回远征查看装备', 'primary') + '</div>' : ''));
  } else if (place === 'garage') {
    showDialog('camp-garage', '海风车行', '<p>普通自行车、山地车、公路车和摩托车已经停放在镇上。</p><p class="muted">当前地牢按步行回合行动，坐骑还在整备中，暂不提供速度或攻击加成。</p>');
  } else {
    showDialog('camp-gate', '出发 · 海岸下水道', '<p>第 1—4 层探索与成长，第 5 层挑战 Goo。沿途的地图、敌人和物品会保留；完成第一章后带着记录回到营地。</p>' +
      '<p class="muted">在营地停留时，本次远征的时间暂停。继续时会回到原来的位置、生命和装备状态。</p><div class="dialog-actions">' +
      (world ? button('resume-current', world.state.phase === 'playing' ? '继续第 ' + world.state.depth + ' 层远征' : '查看本次结算', 'primary') : '') +
      button('new', '开始新的远征', world ? '' : 'primary') + button('slots', '读取存档', 'quiet') + '</div>');
  }
}
async function persist(): Promise<boolean> {
  if (!world) return true;
  if (!storage || activeSlot === null || savePaused) { setSaveLabel('临时进度 · 请导出', true); return true; }
  setSaveLabel('正在保存…');
  try {
    const record = await storage.save(activeSlot, world.snapshot(), revision);
    revision = record.revision;
    setSaveLabel('存档 ' + activeSlot + ' · 已保存'); return true;
  } catch (error) {
    savePaused = true; setSaveLabel('保存暂停 · 请导出', true);
    showSaveProblem(errorText(error)); return false;
  }
}
function showSaveProblem(message: string): void {
  showDialog('save-error', '进度尚未保存', '<p class="muted">' + escapeHTML(message) +
    '</p><p class="muted">本页的当前进度仍在。可以先导出；重新读取会使用已保存的版本。</p><div class="dialog-actions">' +
    button('export', '导出当前进度', 'primary') + button('retry-save', '重试保存') +
    button('slots', '查看已保存进度', 'quiet') + button('memory-play', '暂时在本页继续', 'quiet') + '</div>');
}
function fadeMap(opacity: number, duration: number): Promise<void> {
  const overlay = el('map-transition');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = overlay.animate([{opacity: Number(overlay.style.opacity || 0)}, {opacity}],
    {duration: reduced ? 60 : duration, easing: 'ease-in-out', fill: 'forwards'});
  return animation.finished.then(() => { overlay.style.opacity = String(opacity); animation.cancel(); }, () => {});
}
async function coverMap(depth: number, returning: boolean): Promise<void> {
  transitioning = true; stopTravel(); clearAim();
  const overlay = el('map-transition'); overlay.hidden = false; overlay.style.opacity = '0';
  canvas.setAttribute('aria-busy', 'true');
  el('transition-kicker').textContent = returning ? '沿旧路返回' : '向地牢深处';
  el('transition-title').textContent = '海岸下水道 · 第 ' + depth + ' 层';
  el('transition-note').textContent = returning ? '熟悉的阶梯，仍然等待探索的角落。' : depth === 5 ? '深处的水面正在颤动。' : '新的通道、宝箱与偶遇正在前方。';
  await fadeMap(1, 180);
}
async function revealMap(): Promise<void> {
  if (world && !document.hidden) renderer.draw(world, performance.now());
  await new Promise<void>(resolve => window.setTimeout(resolve, 320));
  await fadeMap(0, 260);
}
function endMapTransition(): void {
  const overlay = el('map-transition');
  for (const animation of overlay.getAnimations()) animation.cancel();
  overlay.hidden = true; transitioning = false; canvas.removeAttribute('aria-busy');
  stopTravel();
}
async function perform(command: Command, walking = false): Promise<boolean> {
  if (!world || busy || mode !== 'game') return false;
  if (!walking) pathToken++;
  busy = true;
  try {
    const groundItem = command.type === 'pickup' ? world.state.level.heaps.find(heap =>
      heap.item.id === command.itemId && heap.cell === world!.state.hero.pos)?.item : undefined;
    const received = groundItem ? { ...groundItem } : null;
    const before = [...world.visibleEnemies().map(enemy => ({ ...enemy })), { ...world.state.hero }];
    const target = command.type === 'attack' || command.type === 'throw' ? command.target : command.type === 'move' ? command.cell : null;
    const enemy = target === null || !world.visible[target] ? undefined : world.mobAt(target);
    if (enemy) selectedEnemyId = enemy.id;
    let result;
    if (command.type === 'stairs') {
      const depth = world.state.depth + (command.direction === 'up' ? -1 : 1);
      const cover = coverMap(depth, !!world.state.archivedLevels[String(depth)]);
      const [prepared] = await Promise.all([prepareFloor({type: 'stairs', state: world.snapshot(), direction: command.direction}), cover]);
      // 后台只处理副本；失败不会消费奖励预算或丢失原楼层。
      world = World.restore(prepared.state); result = prepared.result!;
    } else result = world.dispatch(command);
    if (!result.changed) { if (result.reason) toast(result.reason); return false; }
    if (received && result.events.some(event => event.type === 'pickup')) {
      pendingLoot = { runId: world.state.runId, item: received };
      stopTravel();
    }
    // 是否真正投出由 dispatch 决定；被拒绝的落点保留瞄准，不消耗石头或行动。
    if (command.type === 'throw') clearAim();
    const floorChanged = result.events.some(event => event.type === 'floor-change');
    if (floorChanged) { stopTravel(); clearAim(); selectedEnemyId = null; renderer.reset(); lastLogId = -1; }
    const animation = floorChanged ? revealMap() : renderer.play(result.events, result.spent, before); syncHUD();
    const [saved] = await Promise.all([persist(), animation]);
    if (saved) showActionOutcome();
    return saved && !result.interrupted;
  } catch (error) {
    showDialog('error', '这次操作未完成', '<p class="muted">' + escapeHTML(errorText(error)) +
      '</p><div class="dialog-actions">' + button('close', '返回当前地图', 'primary') + button('export', '导出当前进度') + button('slots', '读取已保存进度') + '</div>');
    return false;
  } finally {
    if (transitioning) endMapTransition();
    busy = false;
  }
}
async function openNew(): Promise<void> {
  slots = storage ? await storage.list() : [];
  const empty = storage ? [1,2,3].filter(slot => !slots.some(record => record.slot === slot)) : [];
  showDialog('new', '新的远征', '<p class="muted">以战士的装备出发：破旧短剑、布甲、三枚投掷石与一份口粮。探索五层海岸下水道，挑战 Goo。</p>' +
    '<form id="new-form"><label class="field-label" for="seed-input">远征种子（可留空）</label><input id="seed-input" type="text" inputmode="numeric" autocomplete="off" placeholder="留空生成新的地牢">' +
    '<p class="muted">相同版本与相同种子可以重新生成同一开局。</p>' +
    '<label class="field-label" for="slot-input">保存位置</label><select id="slot-input">' + empty.map(slot => '<option value="' + slot + '">空存档 ' + slot + '</option>').join('') +
    '<option value="0">临时远征 · 手动导出保存</option></select>' +
    (storageProblem ? '<p class="dialog-error">' + escapeHTML(storageProblem) + '</p>' : '') +
    (!empty.length && storage ? '<p class="muted">三个存档已满。可从「继续远征」导出并管理旧记录。</p>' : '') +
    '<div class="dialog-actions"><button class="primary" type="submit">进入地牢 →</button>' + button('slots', '管理存档', 'quiet') + '</div></form>');
  el<HTMLFormElement>('new-form').onsubmit = event => { event.preventDefault(); void startNew().catch(reportError); };
}
async function startNew(): Promise<void> {
  if (busy) return;
  const entered = el<HTMLInputElement>('seed-input').value.trim();
  let seed: bigint;
  if (entered) {
    if (!/^-?\d+$/.test(entered)) throw new Error('种子请填写整数，或留空随机生成。');
    seed = BigInt(entered);
    if (seed < -(1n << 63n) || seed > (1n << 63n) - 1n) throw new Error('种子超出了64位整数范围。');
  } else {
    const values = crypto.getRandomValues(new Uint32Array(2));
    seed = BigInt.asIntN(64, BigInt(values[0]!) << 32n | BigInt(values[1]!));
  }
  const selectedSlot = Number(el<HTMLSelectElement>('slot-input').value) || null;
  const begin = async (): Promise<void> => {
    busy = true;
    try {
      showDialog('preparing', '正在准备远征', '<p class="muted">正在连接地下通道，安放补给与探索地点……</p>');
      const prepared = await prepareFloor({ type: 'create', seed: seed.toString(), runId: crypto.randomUUID() });
      const next = World.restore(prepared.state);
      // 创建失败前保持原远征；成功后才切换当前对象。
      world = next; pendingLoot = null; activeSlot = storage ? selectedSlot : null; revision = null; savePaused = false;
      showWorld(); await persist();
    } finally { busy = false; }
  };
  if (hasUnstoredCurrent()) {
    confirmAction('替换本页的未保存远征？', '开始新局会替换本页仍未保存的进度。需要保留时，请先取消并导出。', '开始新局', begin);
  } else await begin();
}
async function openSlots(): Promise<void> {
  if (!storage) {
    showDialog('slots', '本地存档暂不可用', '<p class="muted">' + escapeHTML(storageProblem || '当前浏览器未能打开本地存档。') +
      '</p><div class="dialog-actions">' + button('import', '导入到本页') + button('reopen-storage', '重试连接') +
      (world ? button('resume-current', '继续本页远征', 'primary') + button('export', '导出当前进度') : '') + '</div>'); return;
  }
  slots = await storage.list();
  const contents = [1,2,3].map(slot => {
    const record = slots.find(entry => entry.slot === slot);
    if (!record) return '<article class="slot"><h3>存档 ' + slot + '</h3><p>空</p></article>';
    const status = record.state.phase === 'playing' ? '远征中' : record.state.phase === 'dead' ? '已倒下' : record.state.phase === 'chapter-complete' ? '第一章完成' : record.state.phase === 'floor-complete' ? '旧版首层记录' : '已结束';
    return '<article class="slot"><h3>存档 ' + slot + '<span class="tag">' + status + '</span></h3><p>第 ' + record.state.depth +
      ' 层 · 战士 ' + record.state.hero.level + ' 级 · 生命 ' + record.state.hero.hp + '/' + record.state.hero.maxHP + '</p><p>' +
      escapeHTML(new Date(record.savedAt).toLocaleString('zh-CN')) + '</p><div class="row wrap">' + button('load:' + slot, '打开', 'primary small') +
      button('export-slot:' + slot, '导出', 'small quiet') + button('delete:' + slot, '删除', 'small danger') + '</div></article>';
  }).join('');
  showDialog('slots', '远征存档', (world ? '<div class="dialog-actions">' + button('resume-current', '继续本页远征', 'primary') + '</div><div class="divider"></div>' : '') +
    '<div class="load-list">' + contents + '</div><div class="dialog-actions">' +
    button('new', '开始新的远征') + button('import', '导入到空槽', 'quiet') + '</div>');
}
async function loadSlot(slot: number): Promise<void> {
  if (!storage) return;
  busy = true;
  try {
    const record = await storage.load(slot);
    if (!record) throw new Error('该存档槽为空。');
    world = World.restore(record.state); pendingLoot = null; activeSlot = slot; revision = record.revision; savePaused = false;
    showWorld(); setSaveLabel('存档 ' + slot + ' · 已读取');
  } finally { busy = false; }
}
function downloadState(state: World['state']): void {
  const blob = new Blob([serializeSave(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'pelican-dungeon-' + state.runId + '.json';
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importFile(file: File): Promise<void> {
  const parsed: unknown = JSON.parse(await file.text());
  const candidate = decodeSave(parsed);
  const applyImport = async (): Promise<void> => {
    busy = true;
    try {
      slots = storage ? await storage.list() : [];
      const slot = storage ? [1,2,3].find(id => !slots.some(record => record.slot === id)) : undefined;
      if (storage && slot === undefined) throw new Error('没有空存档槽。请先导出并管理旧存档，导入不会覆盖它们。');
      let record: SaveRecord | null = null;
      if (storage && slot !== undefined) record = await storage.save(slot, candidate, null);
      world = World.restore(candidate); pendingLoot = null; activeSlot = record?.slot ?? null; revision = record?.revision ?? null; savePaused = false;
      showWorld(); setSaveLabel(record ? '已导入存档 ' + record.slot : '导入到本页 · 请导出', !record);
    } finally { busy = false; }
  };
  if (hasUnstoredCurrent()) confirmAction('导入另一份远征？', '导入会替换本页尚未保存的进度，但不会覆盖现有存档槽。需要保留当前局时请先导出。', '继续导入', applyImport);
  else await applyImport();
}
function openInventory(id: number | null = selectedEquipmentId): void {
  if (!world) return;
  const listScroll = dialog.querySelector<HTMLElement>('.eq-item-list')?.scrollTop ?? 0;
  selectedEquipmentId = id !== null && world.item(id) ? id : world.state.hero.weaponId;
  showDialog('bag', mode === 'camp' ? '熊猫铁匠铺 · 行囊与强化' : '行囊与装备',
    equipmentContent(world, selectedEquipmentId, bagFilter, equipmentTab, mode === 'camp', icon));
  const list = dialog.querySelector<HTMLElement>('.eq-item-list');
  if (list) list.scrollTop = listScroll;
}
const forgeLabels: Record<ForgeOperation, string> = { upgrade:'升级', identify:'鉴定', 'remove-curse':'祛咒', augment:'增幅' };
function knownIcon(item: Item): string {
  return ['potion','scroll'].includes(ITEMS[item.kind].category) && !world!.state.knownTypes.includes(item.kind)
    ? '<span class="eq-unknown-icon" aria-hidden="true">?</span>' : icon(item.kind);
}
function showUpgrade(): void {
  if (!world?.state.pendingChoice) return;
  const pending = world.state.pendingChoice;
  const candidates = world.state.hero.inventory.filter(item => forgeEligible(pending.type, item, world!.state.knownTypes));
  showDialog('upgrade', '选择' + forgeLabels[pending.type] + '目标', '<p class="muted">' +
    (pending.consumed ? '这张卷轴已展开。放弃仍消耗卷轴与一回合。' : '选择目标查看效果，最终确认才消耗一份材料与一回合。') +
    '</p><div class="forge-target-list">' + candidates.map(item =>
      button('forge-target:' + item.id, knownIcon(item) + '<span><strong>' + escapeHTML(itemName(world!.state, item)) +
        '</strong><small>' + (item.levelKnown ? '查看变化与确认' : '等级未知 · 不提前揭示属性') + '</small></span>', 'item-card')
    ).join('') + '</div>' + (!candidates.length ? '<p class="muted">当前没有适合这份材料的目标。</p>' : '') +
    '<div class="dialog-actions">' + button('cancel-upgrade', pending.consumed ? '放弃施用…' : '取消', 'quiet') + '</div>');
}
function equipmentSummary(item: Item): string {
  const category = ITEMS[item.kind].category;
  if (!item.levelKnown) return '强化等级与真实属性尚未鉴定';
  if (category === 'weapon') {
    const stats = weaponStats(item);
    return '伤害 ' + Math.round(stats.min * stats.damageFactor) + '—' + Math.round(stats.max * stats.damageFactor) +
      ' · 攻击 ' + Number(stats.delay.toFixed(2)) + ' 回合 · 距离 ' + stats.reach + ' 格 · 力量 ' + stats.strength;
  }
  if (category === 'armor') {
    const stats = armorStats(item);
    return '减伤 ' + stats.min + '—' + stats.max + ' · 闪避加值 ' + (stats.evasionBonus >= 0 ? '+' : '') + stats.evasionBonus + ' · 力量 ' + stats.strength;
  }
  return '等级 +' + item.level;
}
function showForgeTarget(id: number): void {
  const pending = world?.state.pendingChoice, item = world?.item(id);
  if (!world || !pending || !item || !forgeEligible(pending.type, item, world.state.knownTypes)) { showUpgrade(); return; }
  selectedEquipmentId = id;
  let preview = '';
  if (pending.type === 'upgrade') {
    const upgraded = upgradeItem(item)!;
    preview = item.levelKnown
      ? '<div class="forge-before-after"><article><small>当前</small><h3>' + escapeHTML(itemName(world.state,item)) + '</h3><p>' + equipmentSummary(item) +
        '</p></article><article><small>升级后</small><h3>' + escapeHTML(itemName(world.state,upgraded)) + '</h3><p>' + equipmentSummary(upgraded) + '</p></article></div>'
      : '<p>装备提升一级并解除穿戴诅咒。真实等级仍需鉴定，当前不显示未知属性。</p>';
    if (item.sealLevel === 0) preview += '<p class="muted">这一级强化会记录在纹章上，以后可随纹章转移到另一件护甲。</p>';
  } else if (pending.type === 'identify') preview = '<p>揭示等级与诅咒状态，或辨认这一种药水 / 卷轴。不会改变其属性，也不会解除诅咒。</p>';
  else if (pending.type === 'remove-curse') preview = '<p>解除穿戴诅咒并确认诅咒状态。真实等级仍需鉴定；即使原本没有诅咒，也会消耗材料。</p>';
  else {
    preview = '<p>每件装备只能有一种增幅。选择新的取舍或恢复无增幅，每次消耗一块符石。</p><div class="augment-options">' +
      augmentChoices(item).map(augment => {
        const next = { ...item, augment };
        const rule = augment === 'speed' ? '基础伤害×0.7，攻击耗时×2/3' : augment === 'damage' ? '基础伤害×1.5，攻击耗时×5/3'
          : augment === 'evasion' ? '提高闪避，降低防护上限' : augment === 'defense' ? '提高防护上限，降低闪避' : '恢复原有伤害、速度与防护取舍';
        return '<article><h3>' + AUGMENT_NAMES[augment] + '</h3><p>' + rule + '</p><p class="muted">' + equipmentSummary(next) + '</p>' +
          button('forge-apply:' + id + ':' + augment, '确认 · ' + AUGMENT_NAMES[augment], 'primary') + '</article>';
      }).join('') + '</div>';
  }
  showDialog('forge-preview', forgeLabels[pending.type] + ' · ' + itemName(world.state,item), preview +
    '<p class="operation-cost">消耗：' + ITEMS[FORGE_MATERIALS[pending.type]].name + ' ×1 · 推进1回合，敌人也会行动' +
      (pending.consumed ? ' · 卷轴已在展开时扣除' : '') + '</p><div class="dialog-actions">' +
    (pending.type !== 'augment' ? button('forge-apply:' + id, '确认' + forgeLabels[pending.type], 'primary') : '') +
    button('forge-targets','返回选择目标','quiet') + '</div>');
}
async function beginForge(operation: ForgeOperation): Promise<void> {
  if (!world || mode !== 'game' || !(operation in FORGE_MATERIALS)) return;
  const item = selectedEquipmentId === null ? undefined : world.item(selectedEquipmentId);
  if (!item || !forgeEligible(operation,item,world.state.knownTypes)) { toast('先选择一件适合这项操作的物品。'); return; }
  const source = world.state.hero.inventory.find(value => value.kind === FORGE_MATERIALS[operation] &&
    (ITEMS[value.kind].category !== 'scroll' || world!.state.knownTypes.includes(value.kind)));
  if (!source) { toast('没有已辨认的对应材料。未知卷轴可先从行囊阅读或鉴定。'); return; }
  closeDialog(); await perform({ type:'use',itemId:source.id });
  if (world.state.pendingChoice && dialog.dataset.kind === 'upgrade') showForgeTarget(item.id);
}
function cancelUpgrade(): void {
  if (!world?.state.pendingChoice) { closeDialog(); return; }
  if (world.state.pendingChoice.consumed) {
    confirmAction('放弃已经展开的卷轴？', '卷轴不会返还，并推进一个回合。', '确认放弃', async () => {
      closeDialog(); await perform({ type:'cancel-upgrade' });
    }, showUpgrade);
  } else {
    closeDialog();
    void perform({ type:'cancel-upgrade' }).then(changed => { if (changed && !dialog.open) openInventory(); });
  }
}
async function useSupply(kind: 'spd:potion/healing' | 'spd:food/ration'): Promise<void> {
  if (!world || mode !== 'game') return;
  const item = world.state.hero.inventory.find(value => value.kind === kind &&
    (kind !== 'spd:potion/healing' || world!.state.knownTypes.includes(kind)));
  if (!item) { toast('没有可用的' + ITEMS[kind].name + '。'); return; }
  const risky = kind === 'spd:potion/healing' ? world.state.hero.hp === world.state.hero.maxHP || world.state.healing.left > 0
    : world.state.hunger.level < 300;
  const use = async (): Promise<void> => { closeDialog(); await perform({ type:'use',itemId:item.id }); };
  if (risky) confirmAction(kind === 'spd:food/ration' ? '现在食用口粮？' : '现在饮用治疗药？',
    kind === 'spd:food/ration' ? '当前尚未饥饿，部分饱腹效果可能浪费。食用需要3回合。'
      : '当前已满生命或仍在治疗中。再次喝药不会叠加剩余总治疗量。饮用需要1回合。',
    '确认使用',use);
  else await use();
}
async function equipSelected(id: number): Promise<void> {
  if (!world || mode !== 'game') return;
  const item = world.item(id);
  if (!item) return;
  const category = ITEMS[item.kind].category;
  if (!['weapon','armor'].includes(category)) return;
  const old = world.item(category === 'armor' ? world.state.hero.armorId : world.state.hero.weaponId)!;
  const stats = item.levelKnown ? (category === 'armor' ? armorStats(item) : weaponStats(item)) : null;
  const warning = !item.cursedKnown ? '诅咒状态未知，穿上后可能无法脱下。'
    : item.cursed ? '这件装备有诅咒，穿上后需要祛咒才能脱下。' : '';
  confirmAction('更换为' + itemName(world.state,item) + '？',
    equipmentSummary(item) + '。更换需要2回合。' + warning +
    (stats && stats.strength > world.state.hero.strength ? '当前力量不足，会受到负重惩罚。' : ''),
    '确认更换',async () => {
      closeDialog(); await perform({ type:'equip',itemId:id });
      if (world?.state.phase === 'playing' && !dialog.open) {
        equipmentTab = 'bag'; openInventory(id);
        if (category === 'armor' && world.state.hero.armorId === id && old.sealLevel !== null) toast('旧护甲上的纹章可在强化工作台拆下，再装到新护甲。');
      }
    }, () => openInventory(id));
}
function beginThrow(itemId?: number): void {
  if (!world || world.state.phase !== 'playing') return;
  const stone = itemId ? world.item(itemId) : world.state.hero.inventory.find(item => item.kind === 'spd:missile/throwing-stone');
  if (!stone || stone.kind !== 'spd:missile/throwing-stone') { toast('背包里没有投掷石。'); return; }
  throwingItem = stone.id; inspecting = false; touchAimCell = null; hoverCell = null;
  refreshTarget(); aimCell = selectedEnemy()?.pos ?? null; renderer.setTarget(aimCell);
  closeDialog(); syncHUD();
}
function showFeature(id: string): void {
  if (!world) return;
  const feature = world.state.level.features.find(value => value.id === id && value.seen);
  if (!feature) return;
  const definition = EXPLORATION[feature.kind];
  const nearby = world.nearbyFeatures().some(value => value.id === id);
  let actions = '', description = definition.description;
  if (feature.status === 'used') description = feature.kind.includes('well') ? '井水已经枯竭，这处地点不会再次提供效果。' : '这里的补给已经取出。';
  else if (!nearby) {
    description += world.mobAt(feature.cell) && world.visible[feature.cell] ? ' 地点被敌人占据，先处理附近的敌人。' : ' 靠近到相邻格即可互动。';
    actions = button('approach-feature:' + id, '走近查看', 'primary');
  } else if (feature.kind === 'supply-cache') {
    actions = feature.items.map((item, index) => button('explore:' + id + ':' + index,
      escapeHTML(itemName(world!.state, item)) + ' ×' + item.quantity + ' · 1回合', 'primary')).join('');
  } else actions = button('explore:' + id, feature.kind === 'chest' ? '打开宝箱 · 1回合' : '使用井水 · 1回合', 'primary');
  showDialog('exploration', definition.name, '<div class="encounter-emblem" aria-hidden="true">' + definition.mark + '</div>' +
    '<p class="encounter-description">' + escapeHTML(description) + '</p>' +
    (nearby && feature.status === 'ready' ? '<p class="operation-cost">确认后敌人也会行动。查看与离开不消耗回合。</p>' : '') +
    '<div class="dialog-actions">' + actions + button('close', '暂时离开', 'quiet') + '</div>');
}
async function approachFeature(id: string): Promise<void> {
  if (!world) return;
  const feature = world.state.level.features.find(value => value.id === id && value.seen);
  if (!feature || feature.status === 'used') return;
  if (world.nearbyFeatures().some(value => value.id === id)) { showFeature(id); return; }
  const routes: number[][] = [];
  const level = world.state.level;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = feature.cell % level.width + dx, y = Math.floor(feature.cell / level.width) + dy;
    if (x < 1 || y < 1 || x >= level.width - 1 || y >= level.height - 1) continue;
    const at = x + y * level.width;
    if (world.visible[at] && world.mobAt(at)) continue;
    const route = world.pathTo(at);
    if (route) routes.push(route);
  }
  const route = routes.sort((a, b) => a.length - b.length)[0];
  if (!route || !route.length) { toast('先探索一条通向这里的路，并清理占据地点的敌人。'); return; }
  closeDialog();
  if (await walkTo(route.at(-1)!) && world?.nearbyFeatures().some(value => value.id === id)) showFeature(id);
}
function interact(): void {
  if (!world || world.state.phase !== 'playing') return;
  const { state } = world;
  const heaps = state.level.heaps.filter(heap => heap.cell === state.hero.pos);
  if (heaps.length === 1) { void perform({ type: 'pickup', itemId: heaps[0]!.item.id }); return; }
  if (heaps.length > 1) {
    showDialog('ground', '脚下的物品', '<div class="load-list">' + heaps.map(heap => '<article class="slot"><div class="row">' +
      knownIcon(heap.item) + '<span>' + escapeHTML(itemName(state,heap.item)) + ' ×' + heap.item.quantity + '</span>' +
      button('pickup:' + heap.item.id, '拾取 · 1回合', 'small primary') + '</div></article>').join('') + '</div>'); return;
  }
  if (state.hero.pos === state.level.exit) {
    if (state.level.locked || (state.depth === 5 && !state.level.bossDefeated)) { toast('Goo还守着出口，击败它后才能完成第一章。'); return; }
    showDialog('exit', '向下的阶梯', '<p class="exit-note">' + (state.depth === 5 ? 'Goo已被击败。可以完成第一章，也可以继续探索或沿上行阶梯返回旧层。' :
      '前往第 ' + (state.depth + 1) + ' 层。本层的地图、敌人和物品会保留，可以沿阶梯返回。') + '</p><div class="dialog-actions">' +
      button(state.depth === 5 ? 'finish-floor' : 'stairs:down', state.depth === 5 ? '完成第一章' : '进入下一层', 'primary') + button('close', '继续探索本层', 'quiet') + '</div>'); return;
  }
  if (state.hero.pos === state.level.entrance) {
    if (state.level.locked) { toast('Goo封住了楼层，击败它后才能离开。'); return; }
    showDialog('entrance', state.depth === 1 ? '回到海风镇' : '向上的阶梯', '<p class="muted">' +
      (state.depth === 1 ? '回营地暂歇会保留这次远征。想重新开始时，也可以在菜单中结束本次远征。' : '返回第 ' + (state.depth - 1) + ' 层，继续探索已经走过的区域。') +
      '</p><div class="dialog-actions">' + button(state.depth === 1 ? 'camp' : 'stairs:up', state.depth === 1 ? '保留进度，返回营地' : '返回上一层', 'primary') + button('close', '留在本层', 'quiet') + '</div>'); return;
  }
  const nearby = world.nearbyFeatures();
  if (nearby.length === 1) { showFeature(nearby[0]!.id); return; }
  if (nearby.length > 1) {
    showDialog('exploration-list', '附近的探索地点', '<div class="menu-list">' + nearby.map(feature =>
      button('feature:' + feature.id, EXPLORATION[feature.kind].name)).join('') + '</div>'); return;
  }
  toast('附近没有物品、阶梯或可互动的地点。');
}
function showResult(): void {
  if (!world) return;
  const { state } = world, complete = state.phase === 'chapter-complete', legacy = state.phase === 'floor-complete';
  const lastPickup = pendingLoot?.runId === state.runId ? pendingLoot.item : null;
  pendingLoot = null;
  showDialog('result', complete ? '海岸下水道 · 第一章完成' : legacy ? '旧版第一层探索记录' : state.phase === 'dead' ? '远征暂告一段落' : '回到海风里',
    '<p class="muted">' + (complete ? '你击败了 Goo，完成五层海岸下水道。更深的区域仍待开放，这次记录将留在远征存档中。' : legacy ? '这份记录在旧版首层探索结束时保存，结算状态保持不变。可以从营地开始新的五层远征。' :
      state.phase === 'dead' ? '倒下的原因：' + escapeHTML(state.deathCause) + '。每次出发，都多一份经验。' : '收好行囊，下一次再见。') + '</p>' +
    (lastPickup ? '<p class="loot-warning">刚刚拾取了' + escapeHTML(itemName(state, lastPickup)) + ' ×' + lastPickup.quantity + '，已记入本次远征。远征结束后无法换装。</p>' : '') +
    '<div class="stat-grid"><div><strong>' + state.stats.kills + '</strong>击败敌人</div><div><strong>' + state.hero.gold +
    '</strong>收集金币</div><div><strong>' + state.stats.actions + '</strong>行动次数</div></div><p class="muted">种子 ' + escapeHTML(state.seed) +
    ' · 战士 ' + state.hero.level + ' 级 · 最深第 ' + state.deepestFloor + ' 层</p><div class="dialog-actions">' + button('camp', '返回海风镇', 'primary') +
    button('export', '导出这次记录') + button('new', '再次出发', 'quiet') + '</div>');
}
function openPause(): void {
  if (!world) return;
  if (world.state.pendingChoice) { showUpgrade(); return; }
  showDialog('pause', '潮声稍歇', '<p class="muted">游戏已暂停。菜单打开时，地牢中的时间静止。</p><div class="load-list">' +
    button('close', '继续远征', 'primary') + button('bag', '查看背包') + button('growth', '成长路线') + button('slots', '管理存档') +
    button('export', '导出当前远征') + (savePaused ? button('retry-save', '重试保存') : '') + button('inspect', '查看地图格子', 'quiet') + button('journal', '远征手记', 'quiet') + button('help', '操作与规则', 'quiet') +
    (world.state.phase === 'playing' ? button('retire', '结束这次远征…', 'danger') : button('result', '查看结算')) +
    button('camp', '保留进度，返回营地', 'quiet') + '</div>');
}
function showHelp(): void {
  showDialog('help', '每一步都是一个选择', '<ul class="help-list"><li>按住方向键 / WASD 连续走路，松开后完成当前一步停下；Q、E、Z、C 或同时按两个方向可斜走。屏幕八方向按钮也可按住。</li>' +
    '<li>海风镇可以自由行走，靠近建筑按 E 互动，也可以点击建筑或顶部目的地前往。进入地牢后才按行动推进回合。</li>' +
    '<li>点击已探索的地面连续行走；发现新敌人或受到攻击后停止。点击武器范围内敌人即攻击，范围外只选中。F攻击选中目标，一次按键一击；长矛两格、长鞭三格，不能穿墙或越过其他角色。Tab / 换目标按钮在可见敌人间切换。</li>' +
    '<li>按 T 选择投掷石，默认预览当前敌人的路线。F 或「投出」确认；鼠标可直接点击落点。触屏先点落点查看，再点同一处确认；再按 T 或「取消」退出瞄准。虚线显示视野内的路线，墙、门或前方敌人可能阻挡。无效落点保留瞄准，不消耗回合。落地的石头可以按 G 拾回。</li>' +
    '<li>I打开背包比较和换装，B打开强化台，L分配天赋；1治疗药，2口粮。G拾取后显示本次收获，装备可并排对比，选择立即穿戴或留在背包。未鉴定装备只显示注明的基础参考。查看窗口不耗回合，更换装备需要2回合；强化、鉴定、祛咒、增幅各用对应材料与1回合。纹章拆装不耗回合。G也可使用阶梯，空格等待，X查看格子。</li>' +
    '<li>普通移动、攻击和拾取通常消耗一回合，吃饭消耗三回合。生命会缓慢恢复；极度饥饿时停止恢复并持续受伤。</li>' +
    '<li>没有可见敌人时按 R 休息到生命恢复；每次仍等待一回合，敌人和饥饿正常推进。满血、药力用尽、遇敌、受攻击或极度饥饿时停止；再按 R、移动或打开菜单可取消。</li>' +
    '<li>门会在通过后关闭。对尚未察觉你的敌人发动偷袭，可避开其闪避。第五层 Goo 的蓄力范围会标在地面，水能洗去淤泥，也会让 Goo 恢复生命。</li>' +
    '<li>前四层搜索补给与成长道具。新层按房间面积增加并分散敌人，入口保留安全距离。第 2—4 层每隔约 32 点行动时间尝试补怪，敌人过多时暂停补充；第一层不补怪。回到旧层时保留离开时的状态。</li>' +
    '<li>点击宝箱或井水查看说明，靠近后按 G 互动；开启宝箱需要1回合，物品在原地，再走上去拾取。生命井、觉察井和旅人的补给每处只能使用一次，查看或离开不耗回合。</li>' +
    '<li>每个完整动作后保存到独立存档槽。浏览器存档依赖当前网址，换网址前请导出。</li></ul><p class="muted">Esc 暂停或取消选目标。打开菜单、切换标签页不会让地牢自行推进。</p>');
}
function inspectCell(cell: number): void {
  if (!world) return;
  const state = world.state;
  if (!state.level.visited[cell]) { toast('这里尚未探索。'); return; }
  const mob = world.visible[cell] ? world.mobAt(cell) : undefined;
  const feature = state.level.features.find(value => value.cell === cell && value.seen);
  if (!mob && feature) { showFeature(feature.id); return; }
  const tile = state.level.tiles[cell];
  const title = mob ? MOB_DEFINITIONS[mob.species].name : tile === Tile.Wall ? '石墙' : tile === Tile.Door ? '木门' :
    tile === Tile.Water ? '浅水' : tile === Tile.HighGrass ? '高草' : tile === Tile.Grass ? '草地' : tile === Tile.EmptySpecial ? '石板地面' :
    tile === Tile.Entrance ? '向上的阶梯' : tile === Tile.Exit ? '向下的阶梯' : '地面';
  let description = mob ? '生命 ' + mob.hp + ' / ' + mob.maxHP + '。' + MOB_DEFINITIONS[mob.species].description :
    tile === Tile.Door ? '会遮挡视线。踏入时打开，离开后关闭；门上留有物品时保持打开。' :
    tile === Tile.HighGrass ? '遮挡视线，经过时会被压平。' : tile === Tile.Water ? '可通行的浅水，能够洗去腐蚀淤泥；Goo会在水中回血。' :
    tile === Tile.EmptySpecial ? '铺设好的地面，在草地间与水面上形成通路。' :
    tile === Tile.Exit ? '本层的向下出口。走到阶梯上按 G。' : '已经探索的区域。';
  const heaps = state.level.heaps.filter(heap => heap.cell === cell && heap.seen);
  if (heaps.length) description += ' 这里有：' + heaps.map(heap => itemName(state,heap.item)).join('、') + '。';
  showDialog('inspect', title, '<p class="muted">' + escapeHTML(description) + '</p>' +
    (mob ? '<div class="dialog-actions">' + button('throw', '选择投掷石', 'primary') + '</div>' : ''));
}
async function walkTo(cell: number): Promise<boolean> {
  if (!world) return false;
  const path = world.pathTo(cell);
  if (!path) { toast('目前没有已探索的可通行路线。'); return false; }
  const token = ++pathToken;
  for (const step of path) {
    if (token !== pathToken || dialog.open || document.hidden || !world || world.state.phase !== 'playing') return false;
    const keepGoing = await perform({ type: 'move', cell: step }, true);
    if (!keepGoing || token !== pathToken || dialog.open || document.hidden || world.state.phase !== 'playing') return false;
  }
  return token === pathToken && !dialog.open && !document.hidden && world.state.phase === 'playing' && world.state.hero.pos === cell;
}
async function restUntilRecovered(): Promise<void> {
  if (!world || world.state.phase !== 'playing' || dialog.open) return;
  if (world.state.hero.hp >= world.state.hero.maxHP) { toast('生命已经恢复，无需休息。'); return; }
  if (world.visibleEnemies().length) { toast('附近有敌人，先摆脱它们再休息。'); return; }
  if (world.state.hunger.level >= 450) { toast('极度饥饿时无法自然恢复，先补充食物。'); return; }
  if (world.state.level.locked && world.state.level.lockedLeft < 1 && world.state.healing.left <= 0) { toast('首领封锁抑制了自然恢复，先继续战斗。'); return; }
  clearAim(); inspecting = false;
  const token = ++pathToken; resting = true; syncHUD();
  try {
    while (token === pathToken && !dialog.open && !document.hidden && world.state.phase === 'playing'
      && world.state.hero.hp < world.state.hero.maxHP && world.state.hunger.level < 450 && !world.visibleEnemies().length) {
      if (world.state.level.locked && world.state.level.lockedLeft < 1 && world.state.healing.left <= 0) break;
      const healingBefore = world.state.healing.left;
      if (!await perform({ type: 'wait' }, true)) break;
      if (healingBefore > 0 && world.state.healing.left <= 0) break;
    }
  } finally {
    if (token === pathToken) {
      resting = false; syncHUD();
      if (world.state.hero.hp >= world.state.hero.maxHP) toast('生命已恢复，继续远征。');
    }
  }
}
async function move(dx: number, dy: number): Promise<boolean> {
  if (!world) return false;
  if (dx === 0 && dy === 0) return perform({ type: 'wait' });
  const { level, hero } = world.state, x = hero.pos % level.width + dx, y = Math.floor(hero.pos / level.width) + dy;
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return false;
  return perform({ type: 'move', cell: x + y * level.width });
}
function reportError(error: unknown): void {
  const message = errorText(error);
  if (dialog.open && document.getElementById('dialog-error')) el('dialog-error').textContent = message;
  else toast(message);
}
async function handleAction(action: string): Promise<void> {
  if (busy) return;
  stopTravel();
  const [name, encoded, option] = action.split(':'), id = Number(encoded);
  switch (name) {
    case 'feature': if (encoded) showFeature(encoded); break;
    case 'approach-feature': if (encoded) await approachFeature(encoded); break;
    case 'explore':
      if (encoded) { closeDialog(); await perform({ type: 'explore', featureId: encoded, choice: option === undefined ? undefined : Number(option) }); }
      break;
    case 'new': await openNew(); break;
    case 'camp-gate': await visitCamp('gate'); break;
    case 'growth': showDialog('growth', '成长路线', growthContent()); break;
    case 'resume-growth': if (world) { showWorld(); if (!world.state.pendingChoice && world.state.phase === 'playing') showDialog('growth','成长与天赋',growthContent()); } break;
    case 'learn-talent': {
      if (!world || mode !== 'game' || !encoded || !(encoded in TALENTS)) break;
      const talent = encoded as TalentId, rank = world.state.hero.talents[talent];
      if (rank >= 2 || availableTalentPoints(world.state.hero) < 1) break;
      confirmAction('学习' + TALENTS[talent].name + ' · ' + (rank + 1) + '/2？',
        TALENTS[talent].ranks[rank]! + '。消耗1点天赋，不推进回合，本次远征不可重置。', '确认学习', async () => {
          closeDialog(); await perform({type:'learn-talent',talent});
          if (world?.state.phase === 'playing' && !dialog.open) showDialog('growth','成长与天赋',growthContent());
        }, () => showDialog('growth','成长与天赋',growthContent()));
      break;
    }
    case 'resume-current': if (world) showWorld(); break;
    case 'resume-bag': if (world) { showWorld(); if (!world.state.pendingChoice) openInventory(); } break;
    case 'slots': await openSlots(); break;
    case 'load': {
      if (hasUnstoredCurrent()) {
        confirmAction('读取已保存进度？', '本页未保存的行动不会写入已保存的记录。可先取消并导出。', '读取存档', () => loadSlot(id));
      } else await loadSlot(id);
      break;
    }
    case 'delete': {
      const record = slots.find(value => value.slot === id);
      if (record) confirmAction('删除存档 ' + id + '？', '请先导出需要保留的记录。删除后，这个槽位将变为空槽。', '确认删除', async () => {
        await storage!.remove(id, record.revision);
        if (activeSlot === id) { activeSlot = null; revision = null; savePaused = true; setSaveLabel('临时进度 · 请导出',true); }
        await openSlots();
      });
      break;
    }
    case 'export-slot': { const record = await storage?.load(id); if (record) downloadState(record.state); break; }
    case 'import': el<HTMLInputElement>('import-file').click(); break;
    case 'export': if (world) { downloadState(world.snapshot()); toast('已请求下载当前远征文件。'); } break;
    case 'reopen-storage':
      storage?.close(); storage = await openStorage(); storageProblem = ''; await openSlots(); break;
    case 'retry-save':
      if (!storage) storage = await openStorage();
      savePaused = false; busy = true;
      try {
        if (await persist()) {
          closeDialog();
          showActionOutcome();
        }
      } finally { busy = false; }
      break;
    case 'memory-play':
      closeDialog();
      showActionOutcome();
      break;
    case 'bag': equipmentTab = 'bag'; openInventory(); break;
    case 'forge': equipmentTab = 'forge'; openInventory(); break;
    case 'equipment-tab': if (encoded === 'bag' || encoded === 'forge') { equipmentTab = encoded; openInventory(); } break;
    case 'equipment-filter': if (['all','equipment','supplies','tools'].includes(encoded ?? '')) { bagFilter = encoded as BagFilter; openInventory(); } break;
    case 'equipment-item': {
      openInventory(id);
      if (matchMedia('(max-width:760px)').matches) {
        const detail = dialog.querySelector<HTMLElement>('.eq-detail');
        if (detail) { detail.tabIndex = -1; detail.focus({preventScroll:true}); detail.scrollIntoView({block:'start'}); }
      }
      break;
    }
    case 'resume-equipment': if (world) { showWorld(); if (!world.state.pendingChoice && world.state.phase === 'playing') openInventory(id); } break;
    case 'forge-op': if (encoded && encoded in FORGE_MATERIALS) await beginForge(encoded as ForgeOperation); break;
    case 'forge-target': showForgeTarget(id); break;
    case 'forge-targets': showUpgrade(); break;
    case 'forge-apply':
      closeDialog(); await perform({ type:'apply-forge',targetId:id,augment:option as Augment | undefined });
      if (world?.state.phase === 'playing' && !world.state.pendingChoice && !dialog.open) { equipmentTab = 'forge'; openInventory(id); }
      break;
    case 'detach-seal': {
      if (mode !== 'game' || !world) break;
      const armor = world.item(id);
      if (!armor || armor.sealLevel === null) break;
      const after = { ...armor, level: armor.level - armor.sealLevel, sealLevel: null };
      confirmAction('拆下破损纹章？', (armor.sealLevel === 1 ? '纹章带走一级强化。' : '纹章目前没有携带强化。') +
        '拆下后：' + equipmentSummary(after) + '。0回合；背包满时纹章放在脚下，当前护盾与冷却保留。', '确认拆下', async () => {
          closeDialog(); await perform({type:'detach-seal',armorId:id});
          if (world?.state.phase === 'playing' && !dialog.open) openInventory(id);
        }, () => openInventory(id));
      break;
    }
    case 'affix-seal': {
      if (mode !== 'game' || !world) break;
      const seal = world.state.hero.inventory.find(item => item.kind === 'spd:utility/broken-seal');
      if (!seal) { toast('背包里没有独立纹章。'); break; }
      const armor = world.item(id);
      if (!armor) break;
      const after = { ...armor, level: armor.level + seal.level, sealLevel: seal.level };
      confirmAction('装上破损纹章？', (seal.level === 1 ? '护甲获得纹章携带的一级强化。' : '护甲获得危急时的纹章保护。') +
        '贴附后：' + equipmentSummary(after) + '。0回合；不立即恢复生命或护盾。', '确认贴附', async () => {
          closeDialog(); await perform({type:'affix-seal',armorId:id,sealId:seal.id});
          if (world?.state.phase === 'playing' && !dialog.open) openInventory(id);
        }, () => openInventory(id));
      break;
    }
    case 'quick-heal': await useSupply('spd:potion/healing'); break;
    case 'quick-food': await useSupply('spd:food/ration'); break;
    case 'use': closeDialog(); await perform({ type:'use', itemId:id }); break;
    case 'equip': await equipSelected(id); break;
    case 'loot-keep': closeCurrentDialog(); break;
    case 'loot-equip': {
      if (dialog.dataset.kind !== 'loot' || mode !== 'game' || !world || world.state.phase !== 'playing') break;
      const item = world.item(id);
      if (!item || !['weapon', 'armor'].includes(ITEMS[item.kind].category)) break;
      closeDialog(); await perform({ type: 'equip', itemId: id });
      if (!dialog.open && world.state.phase === 'playing'
        && (id === world.state.hero.weaponId || id === world.state.hero.armorId)) {
        toast('已装备' + itemName(world.state, item) + '，原装备留在背包。');
      }
      break;
    }
    case 'drop': if (world) {
      const item = world.item(id);
      if (item) confirmAction('放下' + itemName(world.state,item) + '？','整叠物品放在脚下，消耗1回合，可再次拾取。','确认放下',async () => {
        closeDialog(); await perform({type:'drop',itemId:id});
      }, () => openInventory(id));
      break;
    } break;
    case 'throw': if (throwingItem !== null) { clearAim(); syncHUD(); } else beginThrow(); break;
    case 'aim': beginThrow(id); break;
    case 'attack': await attackSelected(); break;
    case 'cycle-target': cycleTarget(); break;
    case 'wait': clearAim(); inspecting = false; await perform({ type:'wait' }); break;
    case 'rest': await restUntilRecovered(); break;
    case 'pickup': clearAim(); inspecting = false; if (encoded) { closeDialog(); await perform({ type:'pickup', itemId:id }); } else interact(); syncHUD(); break;
    case 'finish-floor': closeDialog(); await perform({ type:'finish-floor' }); break;
    case 'stairs': if (encoded === 'up' || encoded === 'down') { closeDialog(); await perform({ type:'stairs', direction:encoded }); } break;
    case 'cancel-upgrade': cancelUpgrade(); break;
    case 'inspect': inspecting = !inspecting; clearAim(); closeDialog(); syncHUD(); break;
    case 'pause': openPause(); break;
    case 'result': showResult(); break;
    case 'retire': confirmAction('结束这次远征？', '当前局内进度将记为结束。新远征会重新开始。', '确认结束', async () => { closeDialog(); await perform({ type:'retire' }); }); break;
    case 'camp': showCamp(); break;
    case 'confirmed': { const callback = confirmation; confirmation = null; confirmationBack = null; if (callback) await callback(); break; }
    case 'cancel-confirm': closeCurrentDialog(); break;
    case 'close': closeCurrentDialog(); break;
    case 'zoom-in': zoom = Math.min(1.5,zoom + .25); renderer.setZoom(zoom); break;
    case 'zoom-out': zoom = Math.max(.75,zoom - .25); renderer.setZoom(zoom); break;
    case 'help': showHelp(); break;
    case 'journal': if (world) showDialog('journal', '远征手记', '<div class="journal-list">' + world.state.messages.map(message => '<p class="' + message.tone + '">' + escapeHTML(message.text) + '</p>').join('') + '</div>'); break;
    case 'about':
      showDialog('about', '关于这次远征', '<p class="muted">鹈鹕骑士 · 地牢远征 v' + escapeHTML(buildVersion) +
        '。这是按 Shattered Pixel Dungeon v4.0.2 逐系统移植的网页开发版，当前开放战士、五层海岸下水道与海风镇。</p>' +
        '<p class="muted">由 ScarfQian 创作鹈鹕题材与网页实现。原版规则与像素素材由 Evan Debenham 和 Oleg Dolya 开发；本项目不是官方版本。</p>' +
        '<p><a href="./credits.html" target="_blank" rel="noreferrer">来源、源码说明与许可 ↗</a></p>' +
        '<p class="muted">后续区域、其他职业、高阶天赋与车辆仍在制作中。</p>');
      break;
  }
}

document.addEventListener('click', event => {
  if (transitioning) return;
  const target = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!target) return;
  // 指针方向操作在按下时启动；合成 click 不再补走一格。键盘激活按钮仍可单步移动。
  if (target.dataset.dir && event.detail !== 0) return;
  if (target.dataset.action === 'rest' && resting) { stopTravel(); return; }
  stopTravel();
  if (busy) {
    if (target.dataset.action === 'pause' && mode === 'game') openPause();
    else if (mode === 'game' && !dialog.open && target.dataset.action) {
      const action = target.dataset.action;
      interactWhenReady(() => { void handleAction(action).catch(reportError); });
    }
    return;
  }
  if (target.dataset.action) void handleAction(target.dataset.action).catch(reportError);
  else if (target.dataset.item) openInventory(Number(target.dataset.item));
  else if (target.dataset.dir && !dialog.open) {
    const [dx,dy] = target.dataset.dir.split(',').map(Number);
    clearAim(); inspecting = false; void move(dx!,dy!).catch(reportError); syncHUD();
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(control => {
  control.addEventListener('pointerdown', event => {
    if (event.button !== 0 || dialog.open || mode !== 'game' || world?.state.phase !== 'playing') return;
    event.preventDefault(); control.setPointerCapture(event.pointerId);
    const [dx, dy] = control.dataset.dir!.split(',').map(Number);
    if (dx === 0 && dy === 0) {
      stopTravel(); interactWhenReady(() => { void move(0, 0).catch(reportError); });
    }
    else holdDirection('pointer:' + event.pointerId, [dx!, dy!]);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    control.addEventListener(name, event => releaseDirection('pointer:' + event.pointerId));
  }
});
dialog.addEventListener('cancel', event => {
  event.preventDefault();
  if (busy) return;
  closeCurrentDialog();
});
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  stopTravel();
  if (dialog.open || !world || mode !== 'game' || world.state.phase !== 'playing') return;
  canvas.focus({ preventScroll: true });
  const cell = renderer.cellAt(event.clientX,event.clientY,world);
  if (cell === null) return;
  // 保存被点击角色的身份，等待当前动画完成后再解析其逻辑位置。
  const actorId = renderer.actorAt(event.clientX, event.clientY, world, performance.now());
  interactWhenReady(() => activateCell(cell, actorId, event.pointerType !== 'mouse'));
});
function activateCell(cell: number, actorId: number | null = null, touch = false): void {
  if (!world || dialog.open || mode !== 'game' || world.state.phase !== 'playing') return;
  hoverCell = null;
  if (actorId !== null) {
    const actor = world.visibleEnemies().find(enemy => enemy.id === actorId);
    if (!actor) { toast('目标已离开视野或被击败。'); return; }
    cell = actor.pos;
  }
  if (throwingItem !== null) {
    aimCell = cell; renderer.setTarget(cell);
    const enemy = world.visible[cell] ? world.mobAt(cell) : undefined;
    if (enemy) selectedEnemyId = enemy.id;
    if (touch && touchAimCell !== cell) { touchAimCell = cell; syncHUD(); return; }
    void perform({ type:'throw',itemId:throwingItem,target:cell }); syncHUD(); return;
  }
  if (inspecting) { inspectCell(cell); return; }
  if (cell === world.state.hero.pos) { interact(); return; }
  if (world.visible[cell] && world.mobAt(cell)) {
    selectedEnemyId = world.mobAt(cell)!.id; renderer.setFocus(selectedEnemyId); syncHUD();
    if (world.canAttack(cell)) void perform({ type:'attack',target:cell });
  } else {
    const feature = world.state.level.features.find(value => value.cell === cell && value.seen && value.status === 'ready');
    if (feature) showFeature(feature.id);
    else void walkTo(cell);
  }
}
canvas.addEventListener('pointermove', event => {
  if (!world || event.pointerType !== 'mouse') return;
  hoverCell = renderer.cellAt(event.clientX,event.clientY,world);
  // 悬停只预览。离开地图去点「投出」时恢复已选落点，鼠标沿途经过的格子不会替换它。
  renderer.setTarget(hoverCell);
});
canvas.addEventListener('pointerleave', () => { hoverCell = null; renderer.setTarget(throwingItem !== null ? aimCell : null); });
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (transitioning || dialog.open || mode !== 'game' || !world || event.ctrlKey || event.metaKey || event.altKey) return;
  if (key === 'r' && resting) { event.preventDefault(); if (!event.repeat) stopTravel(); return; }
  if (key === 'escape') {
    event.preventDefault(); stopTravel();
    if (throwingItem !== null || inspecting) { clearAim(); inspecting = false; syncHUD(); }
    else openPause();
    return;
  }
  if (key === 'tab' && !event.shiftKey && document.activeElement === canvas) {
    event.preventDefault();
    if (!event.repeat) { stopTravel(); interactWhenReady(cycleTarget); }
    return;
  }
  if (key in moveKeys) {
    event.preventDefault();
    if (!event.repeat) holdDirection(key, moveKeys[key]!);
  }
  else {
    const actions: Record<string,string> = { i:'bag',b:'forge',l:'growth','1':'quick-heal','2':'quick-food',g:'pickup',t:'throw',f:'attack',' ':'wait','.':'wait',x:'inspect',r:'rest' };
    const action = actions[key];
    if (action) {
      event.preventDefault();
      if (!event.repeat) {
        stopTravel();
        if (key === 'f' && throwingItem !== null && hoverCell !== null) aimCell = hoverCell;
        interactWhenReady(() => { void handleAction(action).catch(reportError); });
      }
    }
  }
});
window.addEventListener('keyup', event => releaseDirection(event.key.toLowerCase()));
window.addEventListener('blur', stopTravel);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTravel();
    if (!transitioning && mode === 'game' && world?.state.phase === 'playing' && !dialog.open) openPause();
  }
});
window.addEventListener('pagehide', stopTravel);
el<HTMLInputElement>('import-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || busy) return;
  busy = true;
  try { await importFile(file); } catch (error) { reportError(error); } finally { busy = false; }
});
async function boot(): Promise<void> {
  const [sprites, campScene] = await Promise.all([loadSprites(), CampScene.create(el('camp-stage'), place => {
    void visitCamp(place).catch(reportError);
  })]);
  camp = campScene;
  renderer = new SceneRenderer(canvas,sprites);
  try { storage = await openStorage(); }
  catch (error) { storageProblem = errorText(error); }
  busy = false;
  showCamp();
  const frame = (now: number): void => {
    if (mode === 'camp' && !document.hidden) camp?.draw(now);
    if (mode === 'game' && world && !document.hidden) {
      if (!busy && !dialog.open && pendingInteraction) {
        const action = pendingInteraction; pendingInteraction = null; action();
      }
      driveMovement(now);
      renderer.draw(world,now,throwingItem !== null);
      syncCombat(now);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
void boot().catch(error => {
  busy = true;
  showDialog('boot-error','资源未能就绪','<p class="muted">' + escapeHTML(errorText(error)) +
    '</p><div class="dialog-actions"><button type="button" id="reload-page" class="primary">重新加载</button></div>');
  el<HTMLButtonElement>('reload-page').onclick = () => location.reload();
});
