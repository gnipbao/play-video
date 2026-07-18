# Engine — 交互动画出片引擎

把「p5.js 交互动画 → hyperframes 确定性渲染 → 音画同源配乐 → ffmpeg 出片」
这套工作流固化成引擎。新做一只同类视频 = 写一个场景文件 + 一条命令。

## 目录

```
web/engine/      引擎(与场景无关,一般不用改)
  core.js        双模时钟、渲染契约、UI 装配、?t/?auto/?mute/?dump 参数
  input.js       虚拟鼠标(waypoints 自动轨迹 / 真实鼠标)+ 扰动强度 D
  recipes.js     Web Audio 合成原语 + 音效配方注册表
  audio-bus.js   音画同源事件总线 + 旁白
web/scenes/<名>/ 场景(每只视频一个)
  scene.js       场景全部逻辑
  index.html     交互页(点击开播,鼠标可玩)
  record.html    渲染页(hyperframes 用)
tools/
  make_film.sh   一条命令出片
  dump_events.sh 导出音轨事件(headless Chrome)
  synth.py       事件 JSON → WAV 离线合成
templates/scene/ 新场景骨架(复制它起步)
```

## 快速开始

```bash
cp -r templates/scene web/scenes/myscene
# 改 web/scenes/myscene/scene.js(见文件内 TODO)
cd web && python3 -m http.server 8123   # 本地开服
# 交互调试: http://localhost:8123/scenes/myscene/index.html
# 出片:
tools/make_film.sh scenes/myscene/record.html demo/myscene.mp4
```

## 场景接口

```js
Engine.start({
  id: "myscene",            // 与 record.html 的 data-composition-id 一致
  width: 720, height: 960,  // 画布(渲染分辨率 ×pixelDensity)
  duration: 10,             // 片长(秒),record.html 的 data-duration 同步改
  pixelDensity: 2,          // 可选,默认 2
  waypoints: [[t, x, y], …],// 自动演示轨迹;渲染模式和 ?auto=1 都走它
  input: { attack: 5.5, release: 1.1 },  // 可选,D 的起落速率
  preload() {},             // loadImage/loadJSON(p5 preload 桥接)
  build() {},               // 建场景(见"种子纪律")
  reset() {},               // 可选:重播时重置场景状态
  update(dt, t, input) {},  // 状态机;input = {x, y, active, speed, D}
  render(t) {},             // 绘制(p5 全局函数可用)
  audio: {
    intro() { return [{t, type, freq, gain, decay}, …]; },  // 入场旋律(默认 pluck)
    recipes: ["pluck", …],  // 可选:限定本场景用到的配方
  },
  ui: {
    tip: "点击开始播放", sub: "副标题",   // 可选:覆写遮罩文案
    narration: [{t, text}, …],          // 可选:中文旁白(默认关)
  },
});
```

## 音画同源(重要)

场景里所有音效只调 `Engine.audio.emit(type, ev)`:

- **现场**:按 `engine/recipes.js` 里 `type` 的配方立即播放
- **渲染/dump**:连同时间戳(模拟时钟)记入 `__audioEvents`,离线合成配乐

事件 type 与配方**双端对齐**:`web/engine/recipes.js` 与 `tools/synth.py`
各有一份实现。新增音效必须两处同步改,然后跑
`tools/dump_events.sh "http://localhost:8123/scenes/<名>/record.html?dump=1" /tmp/e.json`
确认事件类型/数量符合预期。

现有配方:`pluck`(拨弦,支持 schedule 定点播放)、`takeoff`(下滑音+风声,
自带 0.06s 限流)、`land`(轻柔归位)、`strum`(划奏,ev 带 gain)。

## 种子纪律(可复现的关键)

- `build()` 内自行 `randomSeed(固定值)` + `noiseSeed(固定值)`;
  **种子之后 `random()`/`noise()` 的调用顺序就是画面**,迁移/改动顺序即变样
- 不重要的纹理(如纸纹颗粒)可以在定种子之前画,每次渲染略有不同更自然
- 交互触发里的 `random()`(如惊飞初速)也在种子序列内——同一轨迹 → 同一画面

## 调试参数(两个页面通用)

- `?auto=1` 按 waypoints 自动演示(无人值守录制用)
- `?t=8` 静帧渲染第 8 秒(配合 `&auto=1` 截惊飞状态)
- `?mute=1` 静音
- `?dump=1` 渲染模式下快进全片,控制台输出 `__AUDIO__` 事件 JSON

## 出片管线(tools/make_film.sh 一条命令全包)

1. hyperframes 渲染无声视频(确定性 seek,30fps)
2. headless Chrome dump 音轨事件
3. tools/synth.py 离线合成 WAV
4. ffmpeg 混音成片

## 坑位清单(都踩过)

- **hyperframes 会把入口 HTML 扁平化为 /record.html**:嵌套场景的 record.html 里
  所有脚本必须写根绝对路径(`/scenes/<名>/scene.js`),相对路径会 404
  (症状:渲染出全空白视频,日志报 Sub-composition timelines not registered)
- **hyperframes 不在 PATH**:make_film.sh 自动探测,fallback 写死在脚本里,换机器要改
- **headless Chrome 不退出**:dump 必须"等 __AUDIO__ 出现 → 强杀",dump_events.sh 已处理
- **渲染必须走 p5 的 draw 管线**:seek 后调 `redraw()`,直接调场景 render 会丢 text/beginShape 图层
- **渲染模式判断要动态**:`window.__HF_RENDER === true || 页面有 [data-composition-id]`,
  渲染管线脚本执行顺序不可控,不能在脚本加载时只判一次
- **p5 保留名**:自定义函数避开 `smooth`/`lerp`/`scale` 等,场景代码建议包在 IIFE 里
- **Node 版本**:本机 Node 20 也能跑 hyperframes(npx 的 >=22 警告可无视,直接用项目二进制)
- **git push 到 github.com**:直连不稳,走本地代理 `git -c http.proxy=http://127.0.0.1:7897 push`
