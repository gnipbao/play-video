# Engine — 场景开发与出片指南

Creative Runtime v2 把 p5.js 交互动画、确定性 seek、音画事件和离线出片放进同一套契约。
本文用于日常开发；全部字段与类请查 [API.md](API.md)。

## 目录与加载顺序

```text
engine/src/
  core.js        配置、时钟、生命周期、插件、图层、布局、性能与 hyperframes 契约
  input.js       Pointer Events、键盘、滚轮、双指手势和自动轨迹
  systems.js     CueTimeline、KeyframeTrack、Pool、SpatialHash、Spring（可选）
  recipes.js     Web Audio 现场合成与音效配方
  audio-bus.js   音画事件、离线日志和 Web Speech 旁白
engine/test/     独立运行时回归
engine/tools/    离线音频工具
web/             展示应用；engine/ 是指向 ../engine/src 的静态挂载
web/scenes/<id>/ scene.js + index.html + record.html
templates/scene/ 可直接复制的 v2 场景骨架
web/test/        展示应用集成检查与调试页
tools/           本地服务、事件导出和出片编排
```

页面脚本顺序为：p5 → `core.js` → `input.js` → 可选 `systems.js` → `recipes.js` →
`audio-bus.js` → `scene.js`。当前 core 在 setup 时会创建 AudioBus 和 Narration，因此即使场景
暂时无声，也应加载后两份音频脚本。

## 快速开始

```bash
cp -r templates/scene web/scenes/my-scene
# 同步修改 scene.js、index.html、record.html 中的 id、路径、duration、width、height
tools/serve.py 8123
```

访问 `http://localhost:8123/scenes/my-scene/`。开发服务器带 `Cache-Control: no-store`，适合
频繁改引擎；不要用 `file://` 直接打开场景。

场景完成后先运行：

```bash
tools/test_engine.sh
```

该脚本会运行 Node 回归、检查引擎/场景/模板 JavaScript 语法，并验证空事件音轨可正常生成。

## 场景契约

```js
Engine.start({
  id: "my-scene",
  width: 720,
  height: 960,
  duration: 10,
  pixelDensity: "auto", // 现场按 DPR 取 1–2；数值模式会限制在 1–4
  timing: { fixedStep: 1 / 60, recordStep: 1 / 60 },
  layout: { fit: "contain", margin: 24 },
  performance: { adaptive: true, targetFps: 50 },
  waypoints: [[1, 100, 700], [3, 520, 420, 1], [6, 300, 220]],

  preload(context) {},
  build(context) {},
  setup(context) {},
  reset(context) {},
  update(dt, t, input, context) {},
  render(t, context) {},
  resize(viewport, context) {},
  end(context) {},

  audio: {
    recipes: ["pluck", "takeoff", "land"], // 可选白名单；省略即允许全部
    intro() {
      return [{ t: 0.3, type: "pluck", freq: 440, gain: 0.08, decay: 1.1 }];
    },
  },
  ui: {
    tip: "点击开始",
    sub: "移动、拖拽或双指缩放",
    narration: [{ t: 1.2, text: "第一句旁白" }],
  },
});
```

核心原则：

- `build` 创建确定性初态，`setup` 初始化依赖 build 的现场资源。
- 首次播放沿用 build 的状态，不调用场景 `reset`。
- `replay` 先清输入、时钟和音频限流，再调用场景 `reset`；反向 seek 同样依赖完整 reset。
- 改变未来状态、生成粒子、触发 Cue 或音效的逻辑放进 `update`；`render` 只读状态。
- `destroy` 会解绑输入和页面事件，销毁音频、插件与命名图层；全局 p5 runtime 销毁后需刷新页面
  才能注册新场景。

## 时间与确定性

现场有两种更新方式：

- 未设置 `timing.fixedStep`：每个绘制帧更新一次，`dt` 最多为 `timing.maxDelta`。
- 设置 `fixedStep`：按固定网格执行 update；每个绘制帧最多执行 `maxSubSteps` 次，剩余完整步骤
  会跳过并累计到 `Engine.performance.droppedSteps`。`maxDelta` 不参与固定步长积压处理。
- `loop:true` 跨过片尾时会先提交上一周期的最后模拟网格并触发 end，再 reset/replay；正常帧间
  的少量 overflow 会静默推进到新周期，超过 `maxDelta` 安全窗口的长帧从 0 重启，中间完整
  周期也会折叠而不追帧，避免恢复时音效扎堆或画面阻塞。

静帧、事件 dump 和 hyperframes seek 始终按 `recordStep` 网格向前推进；目标时间倒退时会先
恢复初态。需要现场与出片使用同一物理网格时，显式设置：

```js
timing: { fixedStep: 1 / 60, recordStep: 1 / 60 }
```

可复现纪律：

1. `build/reset` 使用同一组 `randomSeed/noiseSeed` 和同一构建顺序。
2. `reset` 恢复全部数组、计时器、Cue、Pool、SpatialHash、Spring、图层与派生变量。
3. 带状态插件实现 `reset(detail, context)`；`detail.reason` 为 `"replay"` 或 `"seek"`。
4. `render` 中不调用随机、状态推进或 `Engine.audio.emit`。
5. 录制交互使用 waypoints，不依赖真实输入、当前日期或网络响应。
6. 正式录制前核对 scene 配置与 record HTML 的 `data-*` 元数据。

`Engine.u.rng(seed)` 可创建互不干扰的独立随机流，避免多个子系统争用 p5 全局随机序列。

## 输入、布局与性能

`update(dt, t, input)` 统一提供鼠标、触控和数位笔状态：

```js
input.x; input.y; input.nx; input.ny;
input.dx; input.dy; input.vx; input.vy; input.speed;
input.active; input.pressed; input.justPressed; input.justReleased;
input.pressure; input.tiltX; input.tiltY; input.twist;
input.pointers; input.gesture; input.wheelX; input.wheelY;
input.keys; input.D; // D 是 v1 兼容的 0–1 活跃包络
```

自动轨迹在录制模式或 `?auto=1` 时生效，坐标与真实 Pointer Events 一样使用逻辑画布空间。
完整输入字段、事件与 waypoint 对象格式见 [API.md](API.md#7-输入-api)。

`layout.fit` 支持 `contain`、`cover`、`none`。现场低帧率时可自适应降低主画布 DPR；
`Engine.layers` 默认保持创建时密度，只有显式设置 `adaptiveDensity:true` 的图层才会一起调整。
p5 改变 Graphics DPR 会清空其内容，因此联动图层必须在 `qualityChanged` 中重绘。录制与
`?t=` 静帧不会自适应。

## 插件、图层与 Systems

- 插件：`Engine.use()` / `Engine.unuse()`，适合拖尾、相机、后处理、统计和碰撞等跨场景能力。
- 图层：`Engine.layers.create/get/remove/clear` 管理命名 `p5.Graphics`。
- Systems：`CueTimeline` 做时间提示，`KeyframeTrack` 采样动画参数，`Pool` 复用粒子，
  `SpatialHash` 做近邻查询，`Spring` 做稳定标量弹簧。

这些 API 的签名和示例见 [API.md](API.md#8-插件)。

## 音画同源

交互音效统一从状态更新处发射：

```js
Engine.audio.emit("takeoff", { freq: 440, gain: 0.07 });
```

- 现场：调用 `engine/src/recipes.js` 中的 `playNow`。
- 渲染/dump：使用 `Engine.now()` 写入带权威 `t/type` 的 `window.__audioEvents`。
- `audio.intro()`：现场只调度带 `schedule` 的配方；离线模式记录所有已启用的合法配方。
- `audio.recipes` 是白名单；省略时允许全部已注册配方。

内置配方：`pluck`、`takeoff`、`land`、`strum`、`type`、`carriage`、`knock`、`brush`、
`flutter`、`blip`、`stream`、`chirp`、`swish`。其中 `pluck/brush/stream` 支持定点
`schedule`；`stream` 也支持即时 `emit`。

`pluck/takeoff/land/strum` 必须携带正数 `freq`。事件会剥离调用方传入的 `t/type`，并对
`freq/gain/pitch/decay/dur` 做正数合法性检查和安全范围限制。未知、未启用或非法事件不会进入
离线日志。

自定义配方使用 `Engine.registerRecipe(name, recipe)`；AudioBus 创建后注册也能被识别，但若场景
设置了白名单，名称必须预先包含其中。正式出片还要在 `engine/tools/synth.py` 增加同名离线实现。

## 出片管线

```bash
tools/make_film.sh record.html demo/control.mp4
tools/make_film.sh scenes/my-scene/record.html demo/my-scene.mp4
```

脚本依次执行：

1. hyperframes 确定性渲染无声视频；
2. headless Chrome 以 `?dump=1` 导出音效事件；
3. `engine/tools/synth.py` 合成 WAV；
4. ffmpeg 混音输出 MP4。

常用查询参数：

- `?auto=1`：使用 waypoints 自动输入。
- `?t=8`：确定性渲染第 8 秒静帧，目标会限制在片长内。
- `?mute=1`：初始静音。
- `?debug=1`：显示 FPS、渲染耗时、DPR、输入和丢步 HUD。
- `?dump=1`：在 record 页面快进全片并输出 `__AUDIO__<JSON>`。

## v1 兼容

原有平铺 `Engine.start({...})`、`input.x/y/active/pressed/speed/D`、`simulationHz`、
`Engine.registerTimeline()`、`window.__hfSeek` 和 `window.__audioEvents` 均保留。生命周期新增的
参数放在旧参数之后，旧回调可以自然忽略。

当前运行时仍是单例、单场景、p5 全局模式；一个页面只能调用一次 `Engine.start()`，场景不要
自行覆盖全局 `preload/setup/draw`。`systems.js` 是可选模块，但模板默认加载。

## 常见坑位

- hyperframes 会把入口 HTML 扁平化为 `/record.html`；嵌套场景的 record 脚本必须用根绝对路径。
- 录制必须走 p5 `draw` 管线；seek 后由引擎调用 `redraw()`，不要自行绕过 render bridge。
- p5 全局模式存在保留名；场景代码放进 IIFE，并避开 `smooth/lerp/scale` 等名字。
- p5 `loadFont` 只接受 ttf/otf，直接加载 woff2 会卡在 Loading。
- Web Audio 必须由用户手势初始化；无 UI 自动播放不会绕过浏览器策略。
- Web Audio 或 Web Speech 不可用时引擎会静音降级，声音不能作为唯一交互反馈。
- 上架画廊时先把成片压到 `web/films/<id>.mp4`，再在 `web/gallery/works.js` 添加条目。
