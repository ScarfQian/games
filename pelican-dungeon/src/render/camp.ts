/* SPDX-License-Identifier: GPL-3.0-or-later
 * ScarfQian · 2026-10-30 · 海风镇初始营地，网页场景适配。
 * BLD-001…007、CHR-002…004及camp-tree直接复用固定SVG定义；不改母版路径。
 * 营地位置与动画仅存在于本场景，不读取远征World，不推进回合或给予资源。
 */
import '../camp.css';
import library from '../../assets/camp.svg?raw';
import forestURL from '../../assets/user/forest-atlas.png';
import { loadPelicanWalk } from './pelican';

export type CampPlace = 'forge' | 'school' | 'notice' | 'hall' | 'gate' | 'rack' | 'garage';
interface Point { x: number; y: number }
interface Place {
  id: CampPlace; name: string; host: string; symbol: string; viewBox: [number, number, number, number];
  x: number; y: number; width: number; height: number; door: Point;
  footprint: [number, number, number, number];
}

const CELL = 24, COLS = 50, ROWS = 34, WIDTH = CELL * COLS, HEIGHT = CELL * ROWS;
const PLACES: readonly Place[] = [
  { id: 'forge', name: '铁匠铺', host: '熊猫师傅', symbol: 'camp-smith-art', viewBox: [0,0,260,230],
    x: 250, y: 302, width: 260, height: 230, door: { x: 252, y: 348 }, footprint: [154,182,192,116] },
  { id: 'hall', name: '行政厅', host: '秦始皇', symbol: 'camp-hall-art', viewBox: [0,0,280,230],
    x: 600, y: 278, width: 280, height: 230, door: { x: 600, y: 324 }, footprint: [504,166,192,108] },
  { id: 'school', name: '学堂', host: '仙鹤先生', symbol: 'camp-school-art', viewBox: [0,0,260,230],
    x: 950, y: 302, width: 260, height: 230, door: { x: 948, y: 348 }, footprint: [854,182,192,116] },
  { id: 'rack', name: '武器架', host: '装备心得', symbol: 'camp-weapon-rack', viewBox: [-56,-58,112,110],
    x: 190, y: 526, width: 130, height: 128, door: { x: 180, y: 564 }, footprint: [140,460,100,64] },
  { id: 'garage', name: '停车点', host: '海风车行', symbol: 'camp-parking', viewBox: [-99,-72,198,94],
    x: 420, y: 650, width: 230, height: 109, door: { x: 420, y: 684 }, footprint: [316,586,208,60] },
  { id: 'notice', name: '公告栏', host: '镇上的新消息', symbol: 'camp-board-art', viewBox: [0,0,200,195],
    x: 700, y: 620, width: 155, height: 151, door: { x: 708, y: 660 }, footprint: [650,548,100,68] },
  { id: 'gate', name: '冒险入口', host: '通往海岸下水道', symbol: 'camp-gate-art', viewBox: [0,0,230,195],
    x: 1000, y: 640, width: 250, height: 212, door: { x: 996, y: 684 }, footprint: [914,500,172,132] },
];
const KEYS: Record<string, Point> = {
  w:{x:0,y:-1},arrowup:{x:0,y:-1},s:{x:0,y:1},arrowdown:{x:0,y:1},
  a:{x:-1,y:0},arrowleft:{x:-1,y:0},d:{x:1,y:0},arrowright:{x:1,y:0},
};
const CONTROLS = [[-1,-1,'↖'],[0,-1,'↑'],[1,-1,'↗'],[-1,0,'←'],[0,0,'E'],[1,0,'→'],[-1,1,'↙'],[0,1,'↓'],[1,1,'↘']] as const;
const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image(); image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('海风镇图形未能加载，请重新加载页面。')); image.src = url;
});

async function loadPlace(symbol: string, viewBox: readonly number[], defs: string): Promise<HTMLImageElement> {
  const [x,y,width,height] = viewBox;
  const symbolUse = x === 0 && y === 0 ? ` width="${width}" height="${height}"` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width! * 2}" height="${height! * 2}" viewBox="${viewBox.join(' ')}">${defs}<use href="#${symbol}"${symbolUse}/></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

export class CampScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly interactButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly clear = new Uint8Array(COLS * ROWS);
  private readonly held = new Map<string, Point>();
  private active = false;
  private player: Point = { x: 600, y: 420 };
  private path: Point[] = [];
  private visit: CampPlace | null = null;
  private closest: Place | undefined;
  private last = 0;
  private facing = 1;
  private stride = 0;
  private moving = false;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private width = 1;
  private height = 1;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private constructor(private readonly container: HTMLElement, private readonly onVisit: (id: CampPlace) => void,
    private readonly walk: HTMLImageElement[], private readonly art: Map<string, HTMLImageElement>) {
    container.classList.add('camp-stage');
    container.innerHTML = '<canvas class="camp-canvas" tabindex="0" aria-label="海风镇，WASD或方向键行走，E与附近建筑互动"></canvas>' +
      '<div class="camp-location"><span>海风镇</span><small>潮声尚近，远征将启</small></div>' +
      '<nav class="camp-nav" aria-label="营地目的地">' + PLACES.map(place =>
        `<button type="button" data-camp-place="${place.id}">${place.name}</button>`).join('') + '</nav>' +
      '<div class="camp-interaction"><p class="camp-walk-hint">WASD / 方向键行走 · 点击地面或建筑前往</p>' +
      '<button type="button" class="camp-interact primary" disabled>靠近建筑互动 <kbd>E</kbd></button></div>' +
      '<div class="camp-direction-pad" aria-label="营地八方向移动">' + CONTROLS.map(([dx,dy,label]) =>
        `<button type="button" data-camp-direction="${dx},${dy}" aria-label="${label === 'E' ? '与附近建筑互动' : '向' + label + '行走'}">${label}</button>`).join('') + '</div>';
    this.canvas = container.querySelector<HTMLCanvasElement>('.camp-canvas')!;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法绘制海风镇。');
    this.context = context;
    this.interactButton = container.querySelector<HTMLButtonElement>('.camp-interact')!;
    this.hint = container.querySelector<HTMLElement>('.camp-walk-hint')!;
    for (let row=0; row<ROWS; row++) for (let column=0; column<COLS; column++) {
      const x = (column + .5) * CELL, y = (row + .5) * CELL;
      const blocked = x < 70 || x > WIDTH - 70 || y < 116 || y > 708 || PLACES.some(place => {
        const [left,top,width,height] = place.footprint;
        return x + 13 > left && x - 13 < left + width && y + 13 > top && y - 13 < top + height;
      });
      this.clear[column + row * COLS] = blocked ? 0 : 1;
    }
    this.bindControls();
  }

  static async create(container: HTMLElement, onVisit: (id: CampPlace) => void): Promise<CampScene> {
    const document = new DOMParser().parseFromString(library, 'image/svg+xml');
    const defs = document.querySelector('defs');
    if (!defs) throw new Error('海风镇固定图形库缺少定义。');
    const source = new XMLSerializer().serializeToString(defs);
    const [walk, images] = await Promise.all([loadPelicanWalk(loadImage), Promise.all([
      ...PLACES.map(async place => [place.symbol, await loadPlace(place.symbol, place.viewBox, source)] as const),
      (async () => ['camp-tree', await loadPlace('camp-tree', [0,0,100,140], source)] as const)(),
      (async () => ['forest-atlas', await loadImage(forestURL)] as const)(),
    ])]);
    return new CampScene(container, onVisit, walk, new Map(images));
  }

  setActive(active: boolean): void {
    this.active = active; this.last = 0; this.stop();
    if (active) this.canvas.focus({ preventScroll: true });
  }
  private available(): boolean { return this.active && !document.hidden && !document.querySelector('dialog[open]'); }
  private stop(): void { this.held.clear(); this.path = []; this.visit = null; this.moving = false; }
  private cell(x: number, y: number): number { return Math.floor(x / CELL) + Math.floor(y / CELL) * COLS; }
  private canStand(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT && this.clear[this.cell(x, y)] === 1;
  }
  private interact(): void {
    if (!this.available() || !this.closest) return;
    const id = this.closest.id; this.stop(); this.onVisit(id);
  }
  private navigate(point: Point, visit: CampPlace | null = null): void {
    this.stop();
    const from = this.cell(this.player.x,this.player.y), to = this.cell(point.x,point.y);
    if (!this.canStand(point.x,point.y)) { this.hint.textContent = '那里有建筑或海岸，请沿镇上的道路行走。'; return; }
    const previous = new Int32Array(this.clear.length).fill(-1), queue = [from]; previous[from] = from;
    // 营地四向寻路避免绕建筑时切过墙角；绘制位置仍连续移动，键盘允许自由斜行。
    for (let index=0; index<queue.length && previous[to] === -1; index++) {
      const cell=queue[index]!;
      for (const [dx,dy] of [[0,-1],[-1,0],[1,0],[0,1]]) {
        const x=cell%COLS+dx!, y=Math.floor(cell/COLS)+dy!;
        if (x<0 || x>=COLS || y<0 || y>=ROWS) continue;
        const next=x+y*COLS;
        if (previous[next] !== -1 || !this.clear[next]) continue;
        previous[next]=cell; queue.push(next);
      }
    }
    if (previous[to] === -1) { this.hint.textContent = '这里暂时没有可通行路线。'; return; }
    const route: Point[] = [];
    for (let cell=to; cell!==from; cell=previous[cell]!) route.push({x:(cell%COLS+.5)*CELL,y:(Math.floor(cell/COLS)+.5)*CELL});
    this.path=route.reverse(); this.path.push(point); this.visit=visit;
    this.hint.textContent = visit ? '正在前往' + PLACES.find(place => place.id === visit)!.name + ' · 移动或 Esc 取消' : '正在行走 · 移动或 Esc 取消';
  }
  private goTo(id: CampPlace): void {
    if (!this.available()) return;
    const place = PLACES.find(entry => entry.id === id)!;
    if (Math.hypot(place.door.x-this.player.x,place.door.y-this.player.y) < 76) {
      this.stop(); this.onVisit(id); return;
    }
    this.navigate(place.door,id); this.canvas.focus({ preventScroll: true });
  }

  private bindControls(): void {
    this.container.querySelectorAll<HTMLButtonElement>('[data-camp-place]').forEach(button => {
      button.addEventListener('click', () => this.goTo(button.dataset.campPlace as CampPlace));
    });
    this.interactButton.addEventListener('click', () => this.interact());
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.available() || event.button !== 0) return;
      event.preventDefault(); this.canvas.focus({ preventScroll: true });
      const bounds=this.canvas.getBoundingClientRect();
      const x=(event.clientX-bounds.left-this.offsetX)/this.scale, y=(event.clientY-bounds.top-this.offsetY)/this.scale;
      const place = [...PLACES].reverse().find(place => x>place.x-place.width/2 && x<place.x+place.width/2 && y>place.y-place.height && y<place.y+24);
      if (place) this.goTo(place.id); else this.navigate({x,y});
    });
    this.container.querySelectorAll<HTMLButtonElement>('[data-camp-direction]').forEach(button => {
      button.addEventListener('pointerdown', event => {
        if (!this.available() || event.button !== 0) return;
        event.preventDefault(); button.setPointerCapture(event.pointerId);
        const [x,y]=button.dataset.campDirection!.split(',').map(Number);
        if (x===0 && y===0) { this.interact(); return; }
        this.path=[]; this.visit=null; this.held.set('pointer:'+event.pointerId,{x:x!,y:y!});
      });
      for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) {
        button.addEventListener(name, event => this.held.delete('pointer:'+event.pointerId));
      }
      button.addEventListener('click', event => { if (event.detail===0 && button.dataset.campDirection==='0,0') this.interact(); });
    });
    window.addEventListener('keydown', event => {
      if (!this.available() || event.ctrlKey || event.metaKey || event.altKey) return;
      const key=event.key.toLowerCase(), target=event.target as HTMLElement;
      if (target.matches('input,select,textarea') || target.isContentEditable) return;
      if (key in KEYS) {
        event.preventDefault();
        if (!event.repeat) { this.path=[]; this.visit=null; this.held.set(key,KEYS[key]!); }
      } else if (key==='e' || (key==='enter' && document.activeElement===this.canvas)) {
        event.preventDefault(); if (!event.repeat) this.interact();
      } else if (key==='escape') { event.preventDefault(); this.stop(); }
    });
    window.addEventListener('keyup', event => this.held.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.stop());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
  }

  private update(now: number): void {
    const dt=this.last ? Math.min(.05,Math.max(0,(now-this.last)/1000)) : 0; this.last=now;
    this.moving=false;
    if (!this.available()) { this.stop(); return; }
    let dx=0,dy=0;
    if (this.held.size) {
      for (const point of this.held.values()) { dx+=point.x; dy+=point.y; }
      const length=Math.hypot(dx,dy); if (length) { dx=dx/length*190*dt; dy=dy/length*190*dt; }
    } else if (this.path.length) {
      const point=this.path[0]!, x=point.x-this.player.x, y=point.y-this.player.y, distance=Math.hypot(x,y);
      if (distance<=190*dt+.1) { dx=x;dy=y;this.path.shift(); }
      else { dx=x/distance*190*dt;dy=y/distance*190*dt; }
    }
    const before={...this.player};
    if (this.canStand(this.player.x+dx,this.player.y)) this.player.x+=dx;
    if (this.canStand(this.player.x,this.player.y+dy)) this.player.y+=dy;
    const moved=Math.hypot(this.player.x-before.x,this.player.y-before.y);
    this.moving=moved>.01;
    if (this.moving) { this.stride+=moved/36*Math.PI; if (Math.abs(dx)>.01) this.facing=Math.sign(dx); }
    else if (this.path.length && dt>0 && (dx || dy)) { this.path=[];this.visit=null; }
    this.closest=PLACES.filter(place => Math.hypot(place.door.x-this.player.x,place.door.y-this.player.y)<76)
      .sort((a,b)=>Math.hypot(a.door.x-this.player.x,a.door.y-this.player.y)-Math.hypot(b.door.x-this.player.x,b.door.y-this.player.y))[0];
    if (!this.path.length && this.visit) {
      const id=this.visit;this.visit=null;
      if (this.closest?.id===id) { this.stop();this.onVisit(id); }
    }
    const title=this.closest ? '进入'+this.closest.name+' · '+this.closest.host+'  E' : '靠近建筑互动 · E';
    if (this.interactButton.textContent!==title) this.interactButton.textContent=title;
    this.interactButton.disabled=!this.closest;
    if (!this.path.length) this.hint.textContent=this.width<680 ? '点建筑前往 · 方向盘自由行走' : 'WASD / 方向键行走 · 点击地面或建筑前往';
  }

  draw(now: number): void {
    if (!this.active) return;
    this.update(now);
    const rect=this.canvas.getBoundingClientRect(), ratio=Math.min(devicePixelRatio||1,2);
    this.width=rect.width;this.height=rect.height;
    if (!this.width || !this.height) return;
    if (this.canvas.width!==Math.round(this.width*ratio) || this.canvas.height!==Math.round(this.height*ratio)) {
      this.canvas.width=Math.round(this.width*ratio);this.canvas.height=Math.round(this.height*ratio);
    }
    this.scale=this.width<680 ? .82 : Math.max(.66,Math.min(1.1,this.width/WIDTH,this.height/HEIGHT));
    this.offsetX=WIDTH*this.scale<this.width ? (this.width-WIDTH*this.scale)/2 : Math.max(this.width-WIDTH*this.scale,Math.min(0,this.width/2-this.player.x*this.scale));
    this.offsetY=HEIGHT*this.scale<this.height ? (this.height-HEIGHT*this.scale)/2 : Math.max(this.height-HEIGHT*this.scale,Math.min(0,this.height*.52-this.player.y*this.scale));
    const ctx=this.context;
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,this.width,this.height);
    ctx.fillStyle='#99b97a';ctx.fillRect(0,0,this.width,this.height);
    ctx.save();ctx.translate(this.offsetX,this.offsetY);ctx.scale(this.scale,this.scale);
    this.ground(now);
    for (const place of PLACES) {
      ctx.fillStyle=place.id===this.closest?.id ? '#e2be7560' : '#f9edcb60';
      ctx.strokeStyle=place.id===this.closest?.id ? '#8e9a66' : '#a9b58a88';ctx.lineWidth=2;
      ctx.beginPath();ctx.ellipse(place.door.x,place.door.y,30,12,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    }
    if (this.path.length) {
      const destination=this.path.at(-1)!;ctx.strokeStyle='#668c7899';ctx.lineWidth=2;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.arc(destination.x,destination.y,13,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    const objects: { y:number; draw:()=>void }[]=PLACES.map(place=>({ y:place.y,draw:()=>this.building(place) }));
    // 新林缘只放在营地北侧，保留固定树/建筑身份和可行走范围；原图白底用正片叠底显示。
    for (const [x,y,size] of [[42,111,.9],[123,116,.8],[409,106,.82],[484,109,.72],[766,104,.75],[836,112,.82],[1106,110,.8],[1184,117,.95]] as const) {
      objects.push({y,draw:()=>{
        ctx.save();ctx.imageSmoothingEnabled=false;ctx.globalCompositeOperation='multiply';
        ctx.drawImage(this.art.get('forest-atlas')!,254,32,124,158,x-62*size,y-158*size,124*size,158*size);
        ctx.restore();
      }});
    }
    for (const [x,y,size] of [[80,210,1],[1125,186,1.1],[72,440,.9],[1138,412,.82],[82,676,1],[1130,710,1.1],[390,120,.72],[804,122,.72]] as const) {
      objects.push({y,draw:()=>ctx.drawImage(this.art.get('camp-tree')!,x-50*size,y-140*size,100*size,140*size)});
    }
    objects.push({y:this.player.y,draw:()=>this.hero()});
    objects.sort((a,b)=>a.y-b.y).forEach(object=>object.draw());
    ctx.restore();
  }

  private ground(now: number): void {
    const ctx=this.context;
    ctx.fillStyle='#99b97a';ctx.fillRect(0,0,WIDTH,HEIGHT);
    // 地面点缀由坐标确定，不消耗远征随机数，不随每帧抖动。
    for (let y=132;y<714;y+=18) for (let x=78;x<WIDTH-70;x+=18) {
      const variation=(x*13+y*7)%17;
      if (variation<7) { ctx.fillStyle=variation<3 ? '#b5ce8a' : '#85a86b';ctx.fillRect(x,y,3,2); }
    }
    ctx.fillStyle='#e4d29a';ctx.strokeStyle='#7a9a60';ctx.lineWidth=3;
    for (const [x,y,w,h] of [[112,322,976,107],[120,540,975,144],[525,268,145,395]] as const) {
      ctx.beginPath();ctx.roundRect(x,y,w,h,8);ctx.fill();ctx.stroke();
    }
    for (const place of PLACES) { ctx.beginPath();ctx.roundRect(place.door.x-40,place.y-4,80,78,4);ctx.fill(); }
    ctx.strokeStyle='#b1a47470';ctx.lineWidth=1.4;
    for (let row=0;row<24;row++) for(let column=0;column<38;column++) {
      const x=144+column*24+(row%2)*12,y=288+row*16;
      if ((column*7+row*3)%11===0) { ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+7,y+1);ctx.stroke(); }
    }
    ctx.fillStyle='#c9bf8d';ctx.beginPath();ctx.ellipse(600,405,77,28,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#f4e8c4';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(600,405,69,22,0,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#668d5599';ctx.lineWidth=1.6;
    for (let i=0;i<28;i++) {
      const x=100+(i*167)%1000,y=145+(i*73)%548;
      if (this.canStand(x,y) && !(y>320&&y<430) && !(y>540&&y<690) && Math.abs(x-600)>100) {
        ctx.beginPath();ctx.moveTo(x-4,y-7);ctx.lineTo(x,y);ctx.lineTo(x+4,y-10);ctx.stroke();
        if (i%3===0) {
          ctx.fillStyle=i%2 ? '#efd178' : '#f2e9bb';ctx.fillRect(x+7,y-5,5,5);
          ctx.fillStyle='#bf784d';ctx.fillRect(x+9,y-3,2,2);
        }
      }
    }
    ctx.fillStyle='#dbc68c';ctx.beginPath();ctx.moveTo(0,716);ctx.bezierCurveTo(300,738,650,698,WIDTH,738);ctx.lineTo(WIDTH,HEIGHT);ctx.lineTo(0,HEIGHT);ctx.closePath();ctx.fill();
    ctx.fillStyle='#68b3b0';ctx.beginPath();ctx.moveTo(0,754);ctx.bezierCurveTo(420,785,760,736,WIDTH,774);ctx.lineTo(WIDTH,HEIGHT);ctx.lineTo(0,HEIGHT);ctx.closePath();ctx.fill();
    const tide=this.reduceMotion ? 0 : Math.sin(now/2100)*3;
    ctx.strokeStyle='#d6e2c588';ctx.lineWidth=2;
    for(let i=0;i<12;i++){const x=20+i*108;ctx.beginPath();ctx.moveTo(x,783+tide);ctx.quadraticCurveTo(x+16,787+tide,x+38,782+tide);ctx.stroke();}
  }
  private building(place: Place): void {
    const ctx=this.context;
    ctx.drawImage(this.art.get(place.symbol)!,place.x-place.width/2,place.y-place.height,place.width,place.height);
    const selected=place.id===this.closest?.id;
    ctx.font='600 15px "PingFang SC",system-ui,sans-serif';ctx.textAlign='center';
    const width=ctx.measureText(place.name).width+30;
    ctx.fillStyle=selected ? '#426954ed' : '#f6eccfef';ctx.strokeStyle=selected ? '#f4dd9d' : '#a3ad83';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.roundRect(place.x-width/2,place.y+5,width,27,7);ctx.fill();ctx.stroke();
    ctx.fillStyle=selected ? '#fff0c8' : '#48664f';ctx.fillText(place.name,place.x,place.y+24);ctx.textAlign='left';
  }
  private hero(): void {
    const ctx=this.context, height=68, width=height*120/126;
    ctx.save();ctx.translate(this.player.x,this.player.y);
    ctx.fillStyle='#6e80554d';ctx.beginPath();ctx.ellipse(0,1,17,6,0,0,Math.PI*2);ctx.fill();ctx.scale(this.facing,1);
    const frame=this.moving&&!this.reduceMotion ? this.walk[Math.floor(this.stride/(Math.PI*2)*this.walk.length)%this.walk.length]! : this.walk[0]!;
    ctx.imageSmoothingEnabled=true;ctx.drawImage(frame,-width*.45,-height*110/126,width,height);ctx.restore();
  }
}
