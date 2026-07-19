# play-video — 交互动画出片引擎 + 作品集

把「p5.js 交互动画 → hyperframes 确定性渲染 → 音画同源配乐 → ffmpeg 出片」
的工作流固化成引擎。新做一只同类视频 = 写一个场景文件 + 一条命令。

## 结构

```
web/index.html   画廊首页(作品集,Vercel 部署入口)
web/gallery/     画廊(works.js 作品登记处:上架新作品 = 加一条,见 ENGINE.md)
web/films/       压缩成片(demo/ 原片的 720p 版,画廊预览/灯箱用)
web/engine/      引擎(渲染契约/虚拟输入/音画事件总线,见 ENGINE.md)
web/scenes/      场景(每只视频一个,交互页在 scenes/<名>/)
  control/       提线木偶 × 五线谱 × 飞鸟(26s)
  typewriter/    打字机 × 飞鸟:敲键成句、键落鸟起(22s)
  sparks/        星火星座(10s,引擎验证场景)
tools/           出片管线:make_film.sh 一条命令全包;serve.py 禁缓存本地服
templates/scene/ 新场景骨架
ENGINE.md        引擎文档(接口/音画同源/种子纪律/坑位清单)
```

## 快速开始

```bash
tools/serve.py 8123     # 本地开服(禁缓存,改代码后刷新即生效)
# 画廊首页: http://localhost:8123
# 交互页:   /scenes/control/  /scenes/typewriter/  /scenes/sparks/

# 出片(以 control 为例):
tools/make_film.sh record.html demo/control.mp4
tools/make_film.sh scenes/sparks/record.html demo/sparks.mp4

# 新场景:
cp -r templates/scene web/scenes/<名>   # 然后改 scene.js,详见 ENGINE.md
# 做完上架画廊:works.js 加一条 + 成片转压到 web/films/,见 ENGINE.md
```

## 部署

静态站点,Vercel 导入本仓库即可:Root Directory 设 `web`,无构建步骤。
推送到 `main` 自动触发 Production 部署,线上地址:
<https://play-video-gnipxs-projects.vercel.app>
(项目开了 Vercel 登录保护:想公开访问,到 Project Settings →
Deployment Protection 把 Vercel Authentication 关掉或仅保留 Preview)
