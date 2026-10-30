#!/usr/bin/env python3
"""同步资产源到离线游戏和静态图鉴。日期：2026-10-27；创建人：ScarfQian。

这是维护用的内容同步工具，不启动游戏、不访问浏览器存档。
python3 tools/sync_assets.py         更新入口生成区和图鉴
python3 tools/sync_assets.py --check 只检查来源、引用及生成区是否同步
"""
from __future__ import annotations

import argparse
import copy
import html
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
CATEGORIES = {
    "character": "人物", "monster": "怪物", "weapon": "武器",
    "apparel": "帽子与围巾", "mount": "车辆", "building": "建筑与设施",
    "prop": "辅助物件", "legacy": "旧版保留",
}


def esc(value):
    return html.escape(str(value), quote=True)


def read_sources():
    catalog = json.loads((ROOT / "assets/catalog.json").read_text(encoding="utf-8"))
    if catalog["schemaVersion"] != 1:
        raise ValueError("不支持此资产目录格式")
    source = (ROOT / "assets/sprites.svg").read_text(encoding="utf-8")
    defs = ET.fromstring(source).find(f"{{{SVG_NS}}}defs")
    if defs is None:
        raise ValueError("图形源缺少 defs")
    nodes = {}
    for el in defs.iter():
        key = el.get("id")
        if key:
            if key in nodes:
                raise ValueError(f"重复图形 ID：{key}")
            nodes[key] = el
    for el in defs.iter():
        ref = el.get("href", "")
        if ref.startswith("#") and ref[1:] not in nodes:
            raise ValueError(f"图形引用缺失：{ref}")
    entries = catalog["entries"]
    ids = [entry["id"] for entry in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("资产编号重复")
    runtime_keys = set()
    for entry in entries:
        if not isinstance(entry.get("definition"), dict) or not isinstance(entry.get("visual"), dict) or not isinstance(entry.get("identity"), list):
            raise ValueError(f"资产卡片字段类型错误：{entry['id']}")
        if entry.get("runtimeKey") is not None and not isinstance(entry["runtimeKey"], str):
            raise ValueError(f"runtimeKey 必须是字符串：{entry['id']}")
        if entry["kind"] not in CATEGORIES or entry["visual"]["id"] not in nodes:
            raise ValueError(f"分类或图形引用无效：{entry['id']}")
        if len(entry["visual"]["viewBox"]) != 4:
            raise ValueError(f"预览尺寸无效：{entry['id']}")
        for dependency in entry.get("dependencies", []):
            if dependency not in ids:
                raise ValueError(f"资产依赖缺失：{entry['id']} -> {dependency}")
        key = entry.get("runtimeKey")
        if key:
            pair = (entry["kind"], key)
            if pair in runtime_keys:
                raise ValueError(f"运行 ID 重复：{pair}")
            runtime_keys.add(pair)
        art = entry["definition"].get("art")
        if art and art not in nodes:
            raise ValueError(f"运行图形缺失：{entry['id']} -> {art}")
    hero = next(e for e in entries if e["id"] == "CHR-001")
    parts = {el.get("data-part") for el in nodes[hero["definition"]["rig"]].iter()}
    if not (set(hero["definition"]["rigParts"]) - {"root"}).issubset(parts):
        raise ValueError("鹈鹕骨架缺少约定挂点")
    for entry in entries:
        template = nodes[entry["visual"]["id"]]
        if entry["kind"] == "mount":
            wheels = [el for el in template.iter() if el.get("data-part") == "wheel"]
            if len(wheels) != 2 or any(el.get("data-x") is None or el.get("data-y") is None for el in wheels):
                raise ValueError(f"车辆缺少两轮动画挂点：{entry['id']}")
        if entry["kind"] == "apparel" and entry["definition"]["slot"] == "scarf":
            if not any(el.get("data-part") == "tail" for el in template.iter()):
                raise ValueError(f"围巾缺少飘带挂点：{entry['id']}")
    # 保留源 SVG 的原始路径文本，避免自动格式化改写形状数值。
    raw_defs = source.split("<defs>", 1)[1].split("</defs>", 1)[0].strip()
    return catalog, nodes, raw_defs


def hero_preview(entry, entries, nodes):
    """按游戏相同的骨架和装备槽组装静态站姿，不另画一个展示角色。"""
    rig = copy.deepcopy(nodes[entry["visual"]["id"]])
    rig.attrib.pop("id", None)
    rig.tail = None
    parts = {el.get("data-part"): el for el in rig.iter() if el.get("data-part")}
    selection = entry["visual"]["loadout"]
    for slot, kind, part in [("weapon", "weapon", "hand"), ("hat", "apparel", "hat"), ("scarf", "apparel", "scarf")]:
        selected = next(e for e in entries if e["kind"] == kind and e["runtimeKey"] == selection[slot])
        for child in nodes[selected["visual"]["id"]]:
            parts[part].append(copy.deepcopy(child))
    if entry["visual"].get("mounted"):
        mount = next(e for e in entries if e["kind"] == "mount" and e["runtimeKey"] == selection["mount"])
        for child in nodes[mount["visual"]["id"]]:
            parts["bike"].append(copy.deepcopy(child))
        # 与游戏骑乘周期起点一致；此处仅组装静态预览，不执行游戏。
        parts["legA"].set("d", "M-5-34 7-25 11 -13")
        parts["legB"].set("d", "M-8-34 -3-23 -7 -13")
    else:
        parts["bike"].set("display", "none")
    return ET.tostring(rig, encoding="unicode")


def preview(entry, entries, nodes):
    visual = entry["visual"]
    viewbox = " ".join(str(n) for n in visual["viewBox"])
    if visual.get("mode") == "hero":
        art = hero_preview(entry, entries, nodes)
    else:
        scale = visual.get("scale", 1)
        art = f'<g transform="scale({scale})"><use href="#{esc(visual["id"])}"/></g>'
    return f'<svg class="asset-preview" viewBox="{viewbox}" role="img" aria-label="{esc(entry["name"])}当前图形">{art}</svg>'


def bullet_list(values):
    return "<ul>" + "".join(f"<li>{esc(value)}</li>" for value in values) + "</ul>"


def build_gallery(catalog, nodes, raw_defs):
    entries = catalog["entries"]
    sections = []
    for kind, label in CATEGORIES.items():
        cards = []
        for entry in (e for e in entries if e["kind"] == kind):
            dependencies = " · ".join(f'<a href="#{esc(i)}">{esc(i)}</a>' for i in entry.get("dependencies", [])) or "—"
            technical = json.dumps({
                "runtimeKey": entry["runtimeKey"], "visual": entry["visual"],
                "anchors": entry.get("anchors", entry["definition"].get("anchors", {})),
                "definition": entry["definition"], "integration": entry.get("integration", []),
            }, ensure_ascii=False, indent=2)
            cards.append(f'''<article class="card" id="{esc(entry['id'])}">
<div class="picture">{preview(entry, entries, nodes)}</div>
<div class="card-content"><span class="serial">{esc(entry['id'])} · r{entry['revision']}</span>
<h3>{esc(entry['name'])}</h3><p class="status">{esc(entry['status'])}</p>
<h4>外形识别</h4>{bullet_list(entry['identity'])}
{('<p class="revision-note">'+esc(entry['revisionNote'])+'</p>') if entry.get('revisionNote') else ''}
<h4>已有动作与用途</h4>{bullet_list(entry.get('actions', []))}
<p class="reuse">{esc(entry.get('reuse', ''))}</p>
<p class="dependencies">关联资产：{dependencies}</p>
<details><summary>接入参数与代码位置</summary><pre>{esc(technical)}</pre></details>
</div></article>''')
        sections.append(f'<section id="{kind}"><h2>{label} <span>{len(cards):02d}</span></h2><div class="grid">'+"".join(cards)+"</div></section>")
    nav = "".join(f'<a href="#{kind}">{label}</a>' for kind, label in CATEGORIES.items())
    palette = "".join(f'<span><i style="background:{esc(color)}"></i>{esc(name)} <code>{esc(color)}</code></span>' for name, color in catalog["styleGuide"]["palette"].items())
    return '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>鹈鹕骑士 · 资产图鉴</title><style>
:root{color-scheme:light;--ink:#264b48;--muted:#728675;--paper:#faf7ea}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}body{margin:0;background:#eef1e6;color:var(--ink);font:14px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:#427e67;text-decoration-thickness:1px;text-underline-offset:3px}header{max-width:1250px;margin:auto;padding:50px 28px 24px}.eyebrow{font-size:11px;letter-spacing:3px;color:#859482}h1{font:500 clamp(30px,4vw,46px) "Songti SC",serif;margin:10px 0 14px;letter-spacing:3px}header p{max-width:820px;color:var(--muted)}.meta{font-size:11px}.nav-wrap{background:#eef1e6f5;border-block:1px solid #d6dfce;position:sticky;top:0;z-index:2}nav{max-width:1250px;margin:auto;padding:12px 28px;display:flex;gap:22px;flex-wrap:wrap}nav a{text-decoration:none;font-size:12px}main{max-width:1250px;margin:auto;padding:0 28px 70px}h2{font:500 27px "Songti SC",serif;margin:40px 0 20px}h2 span{font:12px sans-serif;color:#9aa58a;margin-left:9px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.card{background:#fffcf0;border:1px solid #d5ddc8;border-radius:15px;overflow:hidden;scroll-margin-top:100px}.picture{height:190px;background:linear-gradient(150deg,#e1e9d6,#f3edd7);padding:24px 35px;border-bottom:1px solid #dbe0cb;display:grid;place-items:center}.asset-preview{display:block;width:100%;height:100%;max-width:260px;overflow:visible}.card-content{padding:20px}.serial{font:11px ui-monospace,monospace;letter-spacing:1px;color:#829077}h3{font:600 22px "Songti SC",serif;margin:5px 0 3px}.status{font-size:10px;color:#9a906e;margin:0 0 17px}h4{font-size:11px;letter-spacing:1px;margin:15px 0 6px;color:#779179}ul{padding-left:17px;font-size:12px;margin:0}.reuse{border-top:1px solid #e2e5d4;padding-top:13px;font-size:12px;color:#768871}.dependencies{font-size:11px}details{font-size:11px;border-top:1px solid #e2e5d4;padding-top:10px}summary{cursor:pointer;color:#52806a}pre{font:10px/1.8 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#eff0df;padding:12px;border-radius:7px}.palette{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:11px;padding:17px 0}.palette span{display:flex;gap:6px;align-items:center}.palette i{width:16px;height:16px;border:1px solid #78927a44;border-radius:50%}.guide{font-size:12px;padding:18px 22px;background:#e6ecdb;border-radius:12px}.guide p{margin:6px 0}.guide code{font-size:11px}.bottom{font-size:11px;color:#83917d;margin-top:40px}@media(max-width:950px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}header{padding:30px 18px 15px}main{padding:0 18px 40px}nav{gap:10px 17px;padding:12px 18px}.picture{height:205px}}
</style></head><body>
<!-- 静态资产图鉴：无游戏脚本、无存档访问，全部来自同一资产源。 -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs>''' + raw_defs + '''</defs></svg>
<header><div class="eyebrow">PELICAN KNIGHT / ASSET LIBRARY</div><h1>海风镇 · 资产图鉴</h1>
<p>固定编号，统一造型。人物、怪物、装备、车辆与建筑从这里复用；图鉴与游戏取自同一份图形源。</p>
<p class="meta">日期：''' + esc(catalog["date"]) + " · 创建人：" + esc(catalog["creator"]) + " · 资产库 " + esc(catalog["libraryVersion"]) + " · " + str(len(entries)) + ''' 张卡片</p>
<div class="palette">''' + palette + '''</div>
<div class="guide"><p><b>当前造型修订：v''' + esc(catalog['visualRevision']['gameVersion']) + '''。</b>''' + esc(catalog['visualRevision']['summary']) + '''当前设计待用户确认，静态图形预览不替代游戏体验验证。</p>
<p>程序与美术来源：<a href="../assets/catalog.json">资产目录</a> · <a href="../assets/sprites.svg">图形源</a> · <a href="../assets/README.md">复用约定</a>。图库为自动生成，不直接修改。</p>
<p>复用现有编号；改变原造型时递增资产版本。新增姿态沿用身体比例和挂点；数值调整不自动重画图形。</p></div></header>
<div class="nav-wrap"><nav>''' + nav + '''</nav></div><main>''' + "".join(sections) + '''
<p class="bottom">卡片中的运行参数来自当前定义，不能代替游戏试玩或平衡验收。旧版保留素材不自动接入当前玩法。</p></main></body></html>
'''


def replace_region(text, name, content):
    pattern = rf"<!-- {name}:START -->[\s\S]*?<!-- {name}:END -->"
    replacement = f"<!-- {name}:START -->\n{content.rstrip()}\n<!-- {name}:END -->"
    if len(re.findall(pattern, text)) != 1:
        raise ValueError(f"入口需要且仅需要一个 {name} 生成区")
    return re.sub(pattern, lambda _: replacement, text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只检查生成区同步关系，不改文件")
    args = parser.parse_args()
    catalog, nodes, raw_defs = read_sources()
    entry_path = ROOT / "index.html"
    current = entry_path.read_text(encoding="utf-8")
    updated = replace_region(current, "ASSET-SPRITES", "<!-- 由 tools/sync_assets.py 同步；图形源：assets/sprites.svg -->\n" + raw_defs)
    # JSON 数据标签不能被文案中的 HTML 结束标签提前闭合。
    payload = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    updated = replace_region(updated, "ASSET-CATALOG", '<script type="application/json" id="asset-catalog">' + payload + '</script>')
    gallery = build_gallery(catalog, nodes, raw_defs)
    outputs = [(entry_path, updated), (ROOT / "docs/assets.html", gallery)]
    stale = [str(path.relative_to(ROOT)) for path, value in outputs if not path.exists() or path.read_text(encoding="utf-8") != value]
    if args.check:
        if stale:
            raise SystemExit("未同步：" + ", ".join(stale) + "；请运行 python3 tools/sync_assets.py")
        print(f"资产源、图形引用与生成区一致：{len(catalog['entries'])} 张卡片。未运行游戏。")
    else:
        for path, value in outputs:
            if str(path.relative_to(ROOT)) in stale:
                path.write_text(value, encoding="utf-8")
        print("已同步：" + (", ".join(stale) or "无变化") + f"；{len(catalog['entries'])} 张卡片。")


if __name__ == "__main__":
    main()
