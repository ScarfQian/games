# 鹈鹕骑士 · 地牢远征

当前版本 **0.2.0-dev.4**。这是使用 TypeScript + Canvas 2D 制作的回合制地牢游戏，逐步移植 Shattered Pixel Dungeon v4.0.2 的系统，并融入鹈鹕与海风镇。玩家端无需 Java。

[进入游戏](https://scarfqian.github.io/games/pelican-dungeon/) · [游戏大厅](https://scarfqian.github.io/games/)

## 已实现

- 五层首章、随机普通层、七类敌人及 Goo 首领，八方向移动、视野、行动时间与上下楼。
- 30 类物品，包括 15 种近战武器、5 阶护甲；升级、鉴定、祛咒、增幅和纹章拆装。
- 拾取提示、装备属性比较、立即装备或保留；有限材料强化和战士第一层天赋。
- 宝箱、生命井、觉察井、补给选择；连续行走显示、战斗效果和楼层过渡。
- 海风镇营地、三个独立存档槽、自动保存、导出与导入。

这是开发版本，尚未移植原版全部职业、物品、特殊房、任务、区域与结局。车辆、帽巾属性和卡片扩展尚未开放。地图密度、额外普通房、首领场地与部分补给分配为网页适配，不等同完整原版规则。

## 操作

| 操作 | 键位 |
| --- | --- |
| 行走 | WASD／方向键，或点击已探索地面 |
| 攻击／切换目标 | F／Tab |
| 投石瞄准 | T，再按 F 确认 |
| 拾取／探索互动 | G |
| 行囊／强化／天赋 | I／B／L |
| 治疗／口粮 | 1／2 |
| 休息 | R |
| 营地互动 | E |

触屏使用页面按钮。不同游戏独立存档。地牢使用 IndexedDB 命名空间 `pelican-dungeon-web`，格式版本 4，支持读取旧格式 1—3；读取时不覆盖旧记录。localhost 与线上站点的数据不会自动同步，可先导出 JSON，再到线上空槽导入。

## 本地开发与构建

使用 Node.js 22.12+；构建环境固定为 Node 24.12.0。

```sh
npm ci
npm run dev
```

```sh
npm run check
npm run build
npm run preview
```

`check` 进行 TypeScript 类型检查；`build` 先检查再生成 `dist/`。需要 HTTP 服务，不能直接双击源码入口。Vite 采用相对资源路径，支持部署到 GitHub Pages 的项目子目录。

## 来源与许可

规则与移植代码以 [Shattered Pixel Dungeon v4.0.2 固定提交](https://github.com/00-Evan/shattered-pixel-dungeon/tree/57a4e06a4caf162446d1c28caa7983f0493fecf0) 为参照。Shattered Pixel Dungeon © 2014–2026 Evan Debenham，基于 Pixel Dungeon © 2012–2015 Oleg Dolya（Watabou）。这不是原作者发布的官方版本。

TypeScript 移植保留原版权声明，按 [GPL v3 或更晚版本](LICENSE.txt) 维护。实际采用的上游像素资产、鹈鹕固定图形、裁图坐标与修订登记在 [assets/catalog.json](assets/catalog.json)，网页中也有[来源与许可](https://scarfqian.github.io/games/pelican-dungeon/credits.html)。

`assets/user` 的两张图集由 ScarfQian 提供，原作者与授权条款尚未提供；这些素材不归为 SPD 或项目原创的 GPL 资产。其来源声明与原像素保留。

当前版本完成类型检查、生产构建和资源检查；尚未进行完整浏览器、移动端、存档迁移与性能验收。

