# play-video — 交互动画出片引擎 + 作品集

把「p5.js 交互动画 → hyperframes 确定性渲染 → 音画同源配乐 → ffmpeg 出片」
的工作流固化成引擎。新做一只同类视频 = 写一个场景文件 + 一条命令。

## 结构

```
web/engine/      引擎(渲染契约/虚拟输入/音画事件总线,见 ENGINE.md)
web/scenes/      场景(每只视频一个)
  control/       提线木偶 × 五线谱 × 飞鸟(26s)
  sparks/        星火星座(10s,引擎验证场景)
web/index.html   control 交互页(Vercel 部署入口)
tools/           出片管线:make_film.sh 一条命令全包
templates/scene/ 新场景骨架
ENGINE.md        引擎文档(接口/音画同源/种子纪律/坑位清单)
```

## 快速开始

```bash
cd web && python3 -m http.server 8123
# control 交互页: http://localhost:8123
# sparks 交互页: http://localhost:8123/scenes/sparks/

# 出片(以 control 为例):
tools/make_film.sh record.html demo/control.mp4
tools/make_film.sh scenes/sparks/record.html demo/sparks.mp4

# 新场景:
cp -r templates/scene web/scenes/<名>   # 然后改 scene.js,详见 ENGINE.md
```

## 部署

静态站点,Vercel 导入本仓库即可:Root Directory 设 `web`,无构建步骤。
