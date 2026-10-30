/* ScarfQian · 2026-10-30 · 用户提供的像素图标原图引用，身份登记见 assets/catalog.json。
 * 只裁取显示区域，不重画或更改原图；独立于物品逻辑与鉴定状态。
 */
import atlasURL from '../../assets/user/fantasy-icons.png';

const FRAMES = {
  attack: [1, 6], armor: [7, 8], heart: [4, 5], gold: [0, 9],
  bag: [0, 13], chest: [2, 13], book: [12, 11], potion: [0, 11],
  rest: [7, 0], inspect: [13, 5],
} as const;
export type AdventureIcon = keyof typeof FRAMES;

export function adventureIcon(name: AdventureIcon): string {
  const [column, row] = FRAMES[name];
  return '<span class="adventure-icon" aria-hidden="true"><span class="ui-sprite" style="display:block;width:32px;height:32px;' +
    'background-image:url(' + atlasURL + ');background-size:512px 1152px;background-position:-' +
    column * 32 + 'px -' + row * 32 + 'px"></span></span>';
}
