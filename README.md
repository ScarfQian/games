# ScarfQian · 游戏集

四个游戏项目放在同一仓库，各自独立维护源码、版本和存档。

[游戏大厅](https://scarfqian.github.io/games/) · [地牢远征](https://scarfqian.github.io/games/pelican-dungeon/)

| 项目 | 当前版本 | 内容 | 入口 |
| --- | --- | --- | --- |
| [地牢远征](pelican-dungeon/) | 0.2.0-dev.4 | 回合制地牢、五层首章、装备强化与海风镇 | [试玩](https://scarfqian.github.io/games/pelican-dungeon/) |
| [鹈鹕骑士](pelican-knight/) | 0.3.2 | 横版冒险与自由营地 | [试玩](https://scarfqian.github.io/games/pelican-knight/) |
| [波次远征](pelican-knight-waves/) | 0.4.0 | 俯视战斗、30 波、精英卡片与精粹强化 | [试玩](https://scarfqian.github.io/games/pelican-knight-waves/) |
| [科研大冒险](research-adventure/) | 0.0.1 | 从小学到科研生涯的肉鸽设计 | [项目介绍](https://scarfqian.github.io/games/research-adventure/)；尚无游戏实现 |

## 开发

两个旧版鹈鹕游戏均为无需依赖的单文件 HTML。地牢版采用 TypeScript + Canvas 2D：

```sh
cd pelican-dungeon
npm ci
npm run dev
```

Node.js 需 22.12 或更高版本；持续集成固定使用 24.12.0。各项目的版本、使用方式和来源见对应 README。

构建整个静态站：

```sh
npm --prefix pelican-dungeon ci
npm --prefix pelican-dungeon run build
node scripts/build-site.mjs
```

输出在 `_site/`，可由任意静态 HTTP 服务提供。地牢版不能直接双击源码 HTML。

## 维护与发布

维护使用 `codex/` 功能或修复分支，通过 Pull Request 审查。是否合并到 main 由项目所有者逐次决定。PR 运行构建，main 更新后 GitHub Actions 构建并部署游戏大厅与各项目；自动合并不启用。

本次整理采用三个原仓库的已公开 main 版本。原仓库、历史和网址保留，来源提交记在各子项目的 version.json；历史内容仍可在原仓库查看。游戏当前源码集中在这里，今后的修改按指定项目目录进行。

浏览器存档由各游戏自行管理，不上传到 GitHub。游戏页面在同一浏览器和站点中继续使用原有存档键；localhost 与 github.io 属于不同站点，地牢存档需要通过游戏里的导出／导入转移。

## 来源与许可

地牢版源自 Shattered Pixel Dungeon v4.0.2 的固定源码，保留上游版权与 GPLv3-or-later 许可，详情见 [地牢来源说明](pelican-dungeon/README.md#来源与许可)。资产逐项登记在各项目 catalog 中；不同来源的素材不因放入本仓库而自动获得同一种许可。旧项目的源码和历史归属保持原样。

三个可玩版本均仍在开发，构建与部署成功不代表全部玩法、存档迁移或移动端已经验收。

