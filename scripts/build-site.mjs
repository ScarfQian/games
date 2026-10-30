// ScarfQian · 2026-10-30 · 将各游戏的公开入口装配为一个静态站。
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '_site');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function copy(source, destination = source) {
  const target = join(output, destination);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, source), target, { recursive: true, dereference: true });
}

await copy('index.html');
await copy('portal');
for (const name of ['pelican-knight', 'pelican-knight-waves']) {
  await copy(name + '/index.html');
  await copy(name + '/version.json');
  await copy(name + '/assets');
  await copy(name + '/docs/assets.html');
}
await copy('research-adventure/index.html');
await copy('research-adventure/version.json');
await copy('pelican-dungeon/dist', 'pelican-dungeon');
await copy('pelican-dungeon/version.json');
await writeFile(join(output, '.nojekyll'), '');

// 源入口不能替代浏览器构建产物；检查不执行游戏或读取存档。
const dungeon = await readFile(join(output, 'pelican-dungeon/index.html'), 'utf8');
if (dungeon.includes('/src/main.ts') || !dungeon.includes('./assets/')) {
  throw new Error('地牢入口尚未构建，或没有使用相对资源路径。');
}
console.log('Static site ready: _site/ (3 games + 1 design project)');

