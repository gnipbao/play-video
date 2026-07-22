# Creative Runtime v2 API

本文档对应 `engine/src/core.js`、`input.js`、`systems.js`、`recipes.js` 与
`audio-bus.js` 的当前实现。引擎使用浏览器原生脚本与 p5.js 全局模式，不需要打包器。

v2 保留了原来的 `Engine.start({...})` 场景写法，同时增加了完整生命周期、固定步长、
Pointer Events、多指手势、插件、离屏图层、常用游戏系统、响应式布局和运行时性能信息。

> 当前运行时仍是**单例、单场景、p5 全局模式**：一个页面只能调用一次
> `Engine.start()`，场景不要自行声明全局 `preload/setup/draw`。

## 导航

- 入门与配置：[最快开始](#1-最快开始) · [脚本顺序](#2-脚本加载顺序) ·
  [`Engine.start`](#3-enginestartconfig) · [生命周期](#4-场景生命周期) ·
  [常用 API](#5-engine-常用-api)
- 交互与扩展：[事件](#6-事件-api) · [输入](#7-输入-api) · [插件](#8-插件) ·
  [Layers](#9-layers) · [Systems](#10-systems) · [音频](#11-音频)
- 出片与维护：[查询参数/录制](#12-查询参数与录制模式) · [v1 迁移](#13-v1-兼容与迁移) ·
  [确定性](#14-确定性与出片注意事项) · [测试](#15-回归测试) · [当前边界](#16-当前边界)

## 1. 最快开始

下面示例假设两个文件直接放在 `web/` 下。

### `minimal.html`

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>最小 v2 场景</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; overflow: hidden; background: #151515; }
    body { display: grid; place-items: center; }
    #stage { position: relative; }
    #stage canvas { display: block; }
  </style>
</head>
<body>
  <div id="stage"></div>

  <!-- 顺序有要求；systems.js 是可选模块。 -->
  <script src="lib/p5.min.js"></script>
  <script src="engine/core.js"></script>
  <script src="engine/input.js"></script>
  <script src="engine/systems.js"></script>
  <script src="engine/recipes.js"></script>
  <script src="engine/audio-bus.js"></script>
  <script src="minimal-scene.js"></script>
</body>
</html>
```

### `minimal-scene.js`

```js
"use strict";

(function () {
  const W = 720;
  const H = 960;
  let orb;

  function build() {
    // build 与 reset 使用同样的种子，重播和离线 seek 才能回到同一初态。
    randomSeed(42);
    noiseSeed(42);
    orb = { x: W / 2, y: H / 2, r: 36 };
  }

  Engine.start({
    id: "minimal-v2",
    width: W,
    height: H,
    duration: 10,
    ui: false, // 无内置遮罩，setup 完成后自动播放；自动播放不会主动开启音频。
    timing: { fixedStep: 1 / 60, recordStep: 1 / 60 },
    build,
    reset: build,
    update(dt, t, input) {
      if (!input.active) return;
      orb.x = Engine.u.damp(orb.x, input.x, 10, dt);
      orb.y = Engine.u.damp(orb.y, input.y, 10, dt);
      orb.r = Engine.u.mix(36, 70, input.pressure || input.D);
    },
    render(t) {
      background(18, 20, 25);
      noStroke();
      fill(255, 110, 80);
      circle(orb.x, orb.y, orb.r * 2);
    },
  });
})();
```

从仓库根目录运行：

```bash
tools/serve.py 8123
```

然后访问 `http://localhost:8123/minimal.html`。

## 2. 脚本加载顺序

标准顺序如下：

1. `p5.min.js`
2. `engine/core.js`
3. `engine/input.js`
4. `engine/systems.js`，可选
5. `engine/recipes.js`
6. `engine/audio-bus.js`
7. 场景脚本

以上是应用公开的静态 URL；本仓库通过 `web/engine -> ../engine/src` 挂载独立引擎源码。
其他应用只需把 `engine/src` 挂载或复制到自己的公开目录，不需要复制展示站点。

`core.js` 会安装 p5 的全局 `preload/setup/draw` 桥接；场景脚本最后调用
`Engine.start()` 注册回调。`systems.js` 只依赖 `core.js`，不用其中的工具时可以不加载；
`recipes.js` 和 `audio-bus.js` 是当前 setup 流程的必需模块，即使场景没有声音也应保留。

## 3. `Engine.start(config)`

`Engine.start()` 校验并归一化配置，创建输入对象，安装 `config.plugins`，返回全局
`Engine`。同一页面第二次调用会抛错。

### 基础配置

| 字段 | 类型 / 默认值 | 说明 |
| --- | --- | --- |
| `id` | `string`，必填 | 场景 ID；录制页中要与 `data-composition-id` 一致。 |
| `width` | 正数，必填 | p5 逻辑画布宽度。 |
| `height` | 正数，必填 | p5 逻辑画布高度。 |
| `duration` | 正数，默认 `10` | 时间线长度，单位秒。到达结尾会触发 `end`，但非循环场景不会自动暂停。 |
| `render(t, context)` | 函数，必填 | 每次绘制画面。`t` 是当前渲染时刻。 |
| `pixelDensity` | 正数或 `"auto"`，默认 `2` | 主画布像素密度上限；数值会取整并限制在 1–4。`"auto"` 按设备 DPR 选择 1–2。运行时自适应可能临时降低它。 |
| `renderer` | `"webgl"` 或省略 | 省略时使用 p5 默认 2D renderer。 |
| `frameRate` | 正数，默认 `60` | p5 现场绘制帧率目标；它不等于物理模拟步长。 |
| `autoplay` | `boolean`，默认 `false` | setup 后自动播放。`ui: false` 也会开启 autoplay。 |
| `idleRender` | `boolean`，默认 `false` | 未开始播放时是否继续 draw；默认只画首帧后 `noLoop()`，避免后台空转。 |
| `loop` | `boolean`，默认 `false` | 到达 `duration` 时先提交末步并触发 end，再 replay；正常帧的小段 overflow 会保留到新周期。应提供可靠的 `reset`。 |
| `pauseWhenHidden` | `boolean`，默认 `true` | `visibilitychange/pagehide` 时暂停，页面恢复时继续。 |
| `debug` | `boolean`，默认 `false` | 显示 FPS、时间、输入与画质 HUD；`?debug=1` 也可开启。 |
| `ui` | 对象或 `false` | 内置遮罩配置；见下文。`false` 表示无 UI 并自动播放。 |
| `waypoints` | 数组或 `null` | `?auto=1` 与渲染模式使用的确定性指针轨迹。 |
| `input` | 对象 | 输入系统参数；见“输入 API”。 |
| `audio` | 对象 | 音频配方白名单与开场编排；见“音频”。 |
| `plugins` | 数组 | 插件或 `[插件, options]` 条目。 |

### 时间配置 `timing`

```js
timing: {
  fixedStep: 1 / 60,  // 现场 update 的固定物理步长；省略时使用可变 dt
  recordStep: 1 / 60, // 静帧、dump 和 hyperframes seek 的固定步长
  maxDelta: 0.05,     // 可变步长模式下单次 update 的最大 dt
  maxSubSteps: 8,     // 一个现场帧最多执行多少次固定步进
}
```

- `fixedStep` 默认为 `null`，现场模式每帧执行一次可变步长 `update`。
- `recordStep` 默认等于 `fixedStep`；若未设置固定步长，则默认 `1 / 30`。
- `timing.fps: 60` 可作为 `fixedStep: 1 / 60` 的简写。
- 旧字段 `simulationHz: 60` 仍受支持，等价于未显式设置 `fixedStep` 时使用
  `fixedStep: 1 / 60`。
- 若物理状态必须与出片严格一致，应显式把 `fixedStep` 和 `recordStep` 设为同一个值。
- `maxDelta` 只限制可变步长模式的单次 `update`；固定步长模式会累计真实帧间隔。
- 固定步长积压超过 `maxSubSteps` 时，引擎会跳过剩余完整模拟步骤、推进模拟时钟，并触发
  `performance:drop`。重物理场景可适当增大 `maxSubSteps`。

### 布局配置 `layout`

```js
layout: {
  fit: "contain", // "contain" | "cover" | "none"
  margin: 24,     // 视口边缘留白，CSS 像素
  maxScale: 1.5,  // 舞台最大 CSS 缩放倍数，默认 Infinity
}
```

- `contain`：完整显示画布。
- `cover`：铺满可用视口，允许裁切。
- `none`：CSS 尺寸等于逻辑画布尺寸。
- 渲染模式始终使用画布原始尺寸和 `fit: "none"`。

每次尺寸变化会更新 `Engine.viewport`，依次调用场景 `resize`、插件 `resize`，再触发
`engine:resize`。

### 性能配置 `performance`

```js
performance: {
  adaptive: true,
  targetFps: 50,
  minPixelDensity: 1,
  sampleSeconds: 2,
}
```

现场 FPS 持续偏低时，引擎会逐级降低 pixel density；恢复后会谨慎升回配置上限。
渲染模式和 `?t=` 静帧模式不会自适应。设置 `performance: false` 或
`performance: { adaptive: false }` 可关闭。

运行时指标位于 `Engine.performance` 和 `context.performance`：

```js
{
  fps, frameMs, renderMs, quality, pixelDensity, droppedSteps,
  reducedMotion, // prefers-reduced-motion
  saveData,      // navigator.connection.saveData
}
```

`qualityChanged(detail, context)`、插件同名 hook 和 `performance:quality` 事件会收到
`{pixelDensity, quality, reason, fps}`。

### UI 配置

若页面提供下列节点，引擎会自动绑定；全部都是可选的：

```html
<div id="stage">
  <div id="overlay">
    <div class="tip"></div>
    <div class="sub"></div>
  </div>
  <div id="controls">
    <button id="btn-replay"></button>
    <button id="btn-sound"></button>
    <button id="btn-voice"></button>
  </div>
</div>
```

```js
ui: {
  tip: "点击开始",
  sub: "移动、拖拽或双指缩放",
  canvasLabel: "粒子花园交互画布",
  narration: [
    { t: 1.2, text: "第一句旁白" },
    { t: 4.5, text: "第二句旁白" },
  ],
}
```

遮罩支持点击、Enter 和空格启动。浏览器要求 Web Audio 在用户手势后初始化，因此有声音的
场景推荐保留开始遮罩；`ui: false` 的自动播放会使用 `play({audio:false})`，不会绕过浏览器的
自动播放限制。

## 4. 场景生命周期

可用回调及签名：

```js
Engine.start({
  preload(context) {},
  build(context) {},
  setup(context) {},
  reset(context) {},
  play({ restart, firstStart }, context) {},
  update(dt, t, input, context) {},
  render(t, context) {},
  resize(viewport, context) {},
  qualityChanged(detail, context) {},
  pause(reason, context) {},
  resume(reason, context) {},
  end(context) {},
  destroy(context) {},
});
```

### 初始化顺序

1. 场景脚本调用 `Engine.start()`；配置插件执行 `install`。
2. p5 调用场景 `preload(context)`，这里加载图片、字体和 JSON。
3. 引擎创建 canvas、AudioBus、Narration、Input，并把 Input 绑定到 canvas。
4. 调用 `build(context)`。
5. 调用 `setup(context)`。
6. 调用插件 `setup(context)`。
7. 绑定可选 UI、计算布局并触发 `resize`。
8. 触发 `engine:ready`；若配置 autoplay，则开始现场时间线。

`build` 适合创建确定性场景状态和离屏层；`setup` 适合初始化依赖 build 结果的现场资源。
首次开始播放不会调用 `reset`，因为 build 已建立初态。

### 每次更新

顺序固定为：

1. `input.update(t, dt)`
2. 插件 `beforeUpdate`
3. 场景 `update`
4. 插件 `update`
5. 插件 `afterUpdate`
6. `engine:update`

把会改变未来状态、生成粒子或触发音效的逻辑放在 `update`，不要放进 `render`。

### 每次绘制

顺序固定为：

1. 插件 `beforeRender`
2. 场景 `render`
3. 插件 `render`
4. 插件 `afterRender`
5. `engine:render`

### 播放控制

```js
Engine.play();                  // 首次开始，或保持当前时间继续
Engine.play({ audio: false }); // 不在本次调用里初始化 AudioContext
Engine.replay();                // reset + 输入/时钟/音频限流归零
Engine.pause("menu");          // 返回是否真正暂停
Engine.resume("menu");         // 返回是否真正恢复
Engine.destroy();               // 解绑输入/UI/resize，销毁声音、插件和 layers
```

重播时会先归零输入、时钟和音频限流，再调用场景 `reset(context)`。要保证 loop、重播和
反向 seek 一致，`reset` 应恢复**全部可变场景状态**并重新设置随机种子。

非循环场景第一次达到 `duration` 时调用 `end(context)` 并触发 `engine:end`，但绘制与时间
不会自动停止；需要停住时可在 `end` 中调用 `Engine.pause("ended")`。循环场景会在每个周期先
提交上一轮的最后模拟网格并触发 end，再 reset/replay；正常帧内的小段 overflow 会静默推进到
新周期，避免漂移且不会把过去的交互音效扎堆播放。超过 `maxDelta` 安全窗口的长帧从周期 0
重新开始；若一次停顿跨越多个完整周期，中间周期也会折叠而不追帧，避免音画错位和恢复阻塞。

### `context`

所有 v2 回调共享一个轻量上下文：

```js
context.engine       // Engine
context.time         // 最近一次已提交的模拟时刻
context.input        // Engine.input
context.canvas       // HTMLCanvasElement
context.viewport     // 最近一次布局信息
context.performance  // Engine.performance
```

`viewport` 在首次 `resize` 后才可靠；不要在 preload 中读取 canvas 或 viewport。

## 5. Engine 常用 API

```js
Engine.VERSION;                  // "2.0.0"
Engine.now();                    // 最近提交的模拟时刻
Engine.auto();                   // ?auto=1 或渲染模式
Engine.hf();                     // 是否为 hyperframes/录制模式
Engine.ready;
Engine.started;
Engine.paused;
Engine.seeking;                  // 静帧或离线 seek 步进期间为 true
Engine.cfg;
Engine.canvas;
Engine.stage;
Engine.viewport;
```

其他实用方法：

```js
const p = Engine.screenToCanvas(event.clientX, event.clientY);
// => {x, y, nx, ny, inside}

const blob = await Engine.capture("frame.png"); // 导出并下载 PNG，同时返回 Blob
```

数学与确定性工具位于 `Engine.u`：

- `clamp`、`clamp01`、`mix`、`invLerp`、`map`
- `ramp`、`smootherstep`、`easeOutCubic`
- `damp`、`wrap`、`lerpAngle`、`gauss`
- `noteFreq(semi, a4)`、`hash(n)`、`rng(seed)`

`Engine.u.rng(seed)` 返回独立的 0–1 伪随机函数，适合避免不同子系统争用 p5 的全局
`random()` 序列。

## 6. 事件 API

```js
const off = Engine.on("pointer:down", ({ point }) => {
  console.log(point.x, point.y);
});

Engine.once("engine:ready", ({ engine }) => {});
Engine.off("自定义事件", handler);
Engine.emit("scene:burst", { count: 12 });
off();
```

监听器异常会被捕获并打印，不会中断其他监听器。`Engine.on()` 与 `Engine.once()` 都返回取消
函数。`engine:update` 和 `engine:render` 是高频事件，监听器应保持轻量。

核心事件：

| 事件 | detail |
| --- | --- |
| `engine:configured` | `{config, engine}` |
| `engine:ready` | `{engine, config, context}` |
| `engine:play` / `engine:replay` | `{restart, firstStart}` |
| `engine:pause` / `engine:resume` | `{reason, time}` |
| `engine:update` | `{dt, time, input}` |
| `engine:render` | `{time}` |
| `engine:resize` | `viewport` |
| `engine:end` | `{time}` |
| `engine:error` | `{error, source, engine}` |
| `engine:destroy` | `{engine}` |
| `performance:drop` | `{dropped, time}` |
| `performance:quality` | `{pixelDensity, quality, reason, fps}` |
| `plugin:install` / `plugin:remove` | `{id, plugin}` |
| `layer:create` / `layer:remove` | `{name, graphics}` / `{name}` |
| `audio:error` | `{reason, type?, event?, error?}`；覆盖未知/非法事件、播放/调度及 AudioContext 错误。 |
| `audio:unavailable` | `{bus}`；浏览器无法创建 Web Audio 时触发。 |
| `audio:recipe` | `{name, recipe}`；注册或覆盖自定义配方时触发。 |

## 7. 输入 API

场景的 `update(dt, t, input)` 参数就是 `Engine.input`。输入坐标已经按 canvas 的 CSS 缩放
换算为逻辑画布坐标。

### 每帧字段

| 字段 | 含义 |
| --- | --- |
| `x`, `y` | 主指针画布坐标。无有效位置时初值为 `-999`。 |
| `nx`, `ny` | 相对画布宽高的归一化坐标。 |
| `dx`, `dy` | 本次模拟更新的位置差。 |
| `vx`, `vy` | 平滑后的像素/秒速度。自动轨迹中为确定性速度。 |
| `speed` | `hypot(vx, vy)`；非 active 时为 0。 |
| `active` | 指针按下，或在画布内最近发生过移动。 |
| `pressed` | 任意当前指针是否按下。 |
| `justPressed`, `justReleased` | 当前模拟更新的按下/松开边沿。 |
| `D` | 0–1 活跃包络；按 `attack/release` 平滑跟随 `active`。v1 兼容字段。 |
| `type` | `"mouse"`、`"touch"`、`"pen"`、`"auto"` 或 `null`。 |
| `pressure` | 主指针压力。鼠标通常为 0 或浏览器给出的默认值。 |
| `tiltX`, `tiltY`, `twist` | 数位笔倾角与旋转。 |
| `pointers` | 当前真实指针快照数组；自动轨迹模式下为空。每项含 `id/x/y/nx/ny/inside/type/pressure/...`。 |
| `wheelX`, `wheelY` | 累积且自动衰减的滚轮像素量。 |
| `keys` | 当前按下的 `KeyboardEvent.code` 集合。 |
| `justKeysDown`, `justKeysUp` | 当前模拟更新新按下/松开的 code 集合。 |
| `gesture` | 双指累计与增量手势，见下文。 |
| `pinch`, `rotation` | 当前手势更新的缩放倍率和旋转增量快捷字段。 |

辅助方法：

```js
if (input.keyDown("ArrowLeft")) {}
if (input.keyPressed("Space")) {}   // 本次 update 的边沿
if (input.keyReleased("KeyR")) {}

const wheel = input.consumeWheel(); // {x, y}，读取后立即归零
```

双指 `gesture`：

```js
{
  active,
  centerX, centerY,
  scale,          // 本次手势开始以来的累计倍率
  deltaScale,     // 相对上次手势更新的倍率
  rotation,       // 累计弧度
  deltaRotation,  // 相对上次手势更新的弧度
}
```

### 输入配置

```js
input: {
  attack: 5.5,
  release: 1.1,
  idleTimeout: 0.7,
  velocitySmoothing: 18,
  wheelDecay: 12,
  preventDefault: true,
  captureWheel: false,
  captureKeys: false,
  touchAction: "none",
  jitter: { x: 60, y: 50, speed: 0.5 },
}
```

- `preventDefault` 默认开启，并把 canvas 的 `touch-action` 设置为 `none`；detach 时恢复原值。
- `input.detach()` 会解绑监听器，并清空指针、按键、手势和活跃包络；重新 attach 从干净状态开始。
- `captureWheel` 默认关闭，浏览器可继续滚动，但输入仍会记录 wheel。设为 `true` 才会阻止
  canvas 上的默认滚轮行为。
- `captureKeys: true` 会对绑定在 window 上的键盘事件调用 `preventDefault()`；只应在确实需要
  独占键盘的页面使用。

### 自动轨迹

数组格式保持 v1 兼容：

```js
waypoints: [
  [1.0, 100, 700, 0],
  [2.5, 520, 500, 1], // 从此点到下一点的线段保持 pressed
  [4.0, 300, 220, 0],
]
```

也可使用对象格式：

```js
waypoints: [
  { t: 1.0, x: 100, y: 700, pressed: false, ease: "linear" },
  { t: 2.5, x: 520, y: 500, pressed: true, ease: "smoother" },
  { t: 4.0, x: 300, y: 220, pressed: false }, // 默认 smooth
]
```

轨迹只在 `Engine.auto()` 为真时生效，即 `?auto=1` 或录制模式。默认会叠加 p5 noise
抖动；完全精确的轨迹可配置 `input.jitter: {x:0, y:0, speed:0}`。时间早于首点或晚于末点时，
自动输入为 inactive。

### 输入事件

```js
Engine.on("pointer:down", ({ event, point, samples, input }) => {});
Engine.on("pointer:move", ({ event, point, samples, input }) => {});
Engine.on("pointer:up", ({ event, point, samples, input }) => {});
```

可用事件：

- `pointer:down`、`pointer:move`、`pointer:up`、`pointer:cancel`
- `pointer:enter`、`pointer:leave`
- `input:wheel`、`input:blur`
- `key:down`、`key:up`
- `gesture:start`、`gesture:change`、`gesture:end`

`point` 包含：

```js
{
  id, x, y, nx, ny, inside, type, pressure,
  tiltX, tiltY, twist, buttons, down, timeStamp,
}
```

支持 `getCoalescedEvents()` 的浏览器会在 `samples` 中提供高频数位笔/指针样本。
键盘事件 detail 为 `{event, code, key, repeat?, input}`，手势事件为 `{gesture, input}`。

## 8. 插件

插件适合复用拖尾、后处理、相机、统计、碰撞或调试能力，而不必把逻辑放进 core。

### 插件工厂示例

```js
function PointerHaloPlugin(engine, options = {}) {
  const color = options.color || [255, 100, 70];
  let energy = 0;

  return {
    id: "pointer-halo",

    install() {
      const off = engine.on("pointer:down", () => { energy = 1; });
      return off; // unuse/destroy 时自动调用的 cleanup
    },

    update(dt, t, input) {
      energy = engine.u.damp(energy, input.pressed ? 1 : 0, 8, dt);
    },

    afterRender(t, context) {
      if (energy < 0.01 || !context.input.active) return;
      push();
      noFill();
      stroke(color[0], color[1], color[2], 180 * energy);
      strokeWeight(3);
      circle(context.input.x, context.input.y, 80 + energy * 50);
      pop();
    },

    reset() { energy = 0; },
    destroy() { energy = 0; },
  };
}

Engine.start({
  // ...场景配置
  plugins: [
    [PointerHaloPlugin, { color: [80, 190, 255] }],
  ],
});
```

也可以随时安装和移除：

```js
Engine.use(PointerHaloPlugin, { color: [255, 0, 80] });
Engine.getPlugin("pointer-halo");
Engine.unuse("pointer-halo");
```

插件可以是工厂函数，也可以直接是对象。插件 ID 取 `plugin.id`、`plugin.name`，都没有时
自动生成；重复安装同 ID 会返回已有插件。工厂应保持无副作用，把事件绑定、计时器等资源创建
放进 `install` 并返回 cleanup；这样重复注册在去重时不会泄漏临时资源。

### 插件 hooks

```js
{
  id,
  install(engine, options) {}, // 可返回 cleanup 函数
  setup(context) {},
  beforeUpdate(dt, t, input, context) {},
  update(dt, t, input, context) {},
  afterUpdate(dt, t, input, context) {},
  beforeRender(t, context) {},
  render(t, context) {},
  afterRender(t, context) {},
  play(context) {},
  reset(detail, context) {}, // replay 与反向 seek 的确定性状态复位
  replay(context) {},
  pause(reason, context) {},
  resume(reason, context) {},
  resize(viewport, context) {},
  qualityChanged(detail, context) {},
  end(context) {},
  destroy(context) {},
}
```

运行时已经 ready 后再 `Engine.use()`，其 `setup` 会立即执行。插件 hook 中抛出的异常会
转成 `engine:error`，其他插件仍会继续运行。

`Engine.replay()` 会先调用 `reset({reason:"replay"}, context)`，开始新一轮播放时再调用
`replay(context)`；反向 hyperframes seek 只调用
`reset({reason:"seek", target}, context)`。因此会影响确定性结果的插件状态必须在 `reset`
中恢复，`replay` 更适合新一轮现场播放的附加行为。

## 9. Layers

`Engine.layers` 管理命名的 p5.Graphics 离屏画布：

```js
let paper;

function build() {
  paper = Engine.layers.create("paper", {
    width: 720,
    height: 960,
    pixelDensity: 1,
    adaptiveDensity: true, // 可选：跟随主画布 DPR；变化时必须重绘内容
    // renderer: WEBGL, // 可选
  });
  paper.background(238, 232, 215);
  paper.stroke(30, 25);
  for (let y = 0; y < 960; y += 12) paper.line(0, y, 720, y);
}

function render() {
  image(paper, 0, 0);
}
```

API：

```js
Engine.layers.create(name, options); // 同名已存在时直接返回原 graphics
Engine.layers.get(name);
Engine.layers.has(name);
Engine.layers.remove(name);          // 调用 graphics.remove()，返回 boolean
Engine.layers.clear();               // destroy 时也会自动执行
```

只能在 `build/setup` 及其之后创建 layer，不能在 preload 或场景脚本顶层创建。layer 默认保持
创建时的像素密度；未显式固定 `pixelDensity` 时，可用 `adaptiveDensity:true` 选择跟随主画布。
注意：p5 改变 `p5.Graphics.pixelDensity()` 会清空其 backing canvas，因此自适应图层必须在场景
`qualityChanged` 或插件同名 hook 中重绘内容。持久纸纹、轨迹和累积画布应保留默认值或显式
设置 `adaptiveDensity:false`。重播时若需恢复离屏内容，应在 `reset` 中清理后重画，或 remove
后重新 create；`Engine.layers.clear()` 会删除全部命名图层。

## 10. Systems

使用下列工具前加载 `engine/systems.js`。它们都是普通类，可独立使用。

### `Engine.CueTimeline`

跨过指定时间点时触发 cue，并可在一个时间区间内持续报告 progress：

```js
const cues = new Engine.CueTimeline({ duration: 8, loop: true });

cues
  .at(1.2, ({ cycle }) => Engine.emit("scene:flash", { cycle }), "flash")
  .during(2, 4, ({ progress }) => { titleAlpha = progress; }, "title-in");

function update(dt, t, input, context) {
  cues.update(t, context);
}

function reset() {
  cues.reset();
}
```

构造参数为 `{duration=Infinity, loop=false, maxLoopCatchUp=8}`。方法有
`at(time, callback, id?)`、`during(start,end,callback,id?)`、`remove(id)`、
`reset(time?)`、`update(time, context?)`。当输入时间倒退时 timeline 会自动 reset；NaN 和
Infinity 会被忽略，不触发 cue。

### `Engine.KeyframeTrack`

在数字、数组或普通对象之间插值：

```js
const camera = new Engine.KeyframeTrack([
  { t: 0, value: { x: 0, zoom: 1 }, ease: "smooth" },
  { t: 3, value: { x: 180, zoom: 1.4 }, ease: "outCubic" },
  { t: 6, value: { x: 0, zoom: 1 } },
], { loop: true, duration: 6 });

const value = camera.sample(t);
```

内置 easing 名为 `linear`、`smooth`、`smoother`、`outCubic`；也可在 frame 的 `ease`
中直接传函数，或通过 `options.easings` 扩展。关键帧时间和 duration 必须是有限数字；循环轨道
还要求 duration 大于 0。`sample()` 收到非有限时间时按 0 采样。

### `Engine.Pool`

复用粒子和短生命周期对象：

```js
const particles = new Engine.Pool(
  () => ({ x: 0, y: 0, life: 0 }),
  {
    initial: 200,
    maxSize: 1000, // 最多保留 1000 个空闲对象，不限制同时活跃数
    reset(p, x, y) { p.x = x; p.y = y; p.life = 1; },
  },
);

const p = particles.acquire(input.x, input.y);
particles.update((item) => {
  item.life -= dt;
  return item.life > 0; // false 会自动 release
});
```

方法有 `prewarm`、`acquire`、`release`、`update`、`clear`；只读 getter 为 `size`（活跃数）
和 `capacity`（活跃 + 空闲）。`maxSize` 会向下取整，限制的是可保留的空闲对象数，不限制同时活跃数；
`options.dispose(item)` 会在空闲区已满时 release，或 clear 时调用。

### `Engine.SpatialHash`

为大量对象提供近邻查询：

```js
const space = new Engine.SpatialHash(80);
space.insert(bird, bird.x, bird.y, bird.radius);
space.update(bird, bird.x, bird.y, bird.radius);
const nearby = space.queryRadius(input.x, input.y, 120, (item) => item.active);
space.remove(bird);
space.clear();
```

构造参数是有限正数 cell size；`insert/update/queryRadius` 的坐标和 radius 必须为有限数字，
且 radius 非负。另有只读 `size`。

### `Engine.Spring`

稳定的标量弹簧：

```js
const zoom = new Engine.Spring(1, { frequency: 5, damping: 0.85 });
zoom.set(input.pressed ? 1.4 : 1);
const currentZoom = zoom.update(dt);
zoom.snap(1); // 同时重置 value、target、velocity
```

`update(dt)` 会把长帧拆成不超过 `1/120` 秒的小步，并把单次 dt 限制在 0.25 秒内。
初值、target、snap value 和 frequency 必须为有限数字，frequency 大于 0，damping 非负；
`dt` 会安全限制在 0–0.25 秒，不会把非有限状态带入积分。

## 11. 音频

### 场景配置

```js
audio: {
  recipes: ["pluck", "takeoff", "land"], // 省略表示启用全部注册配方
  intro() {
    return [
      { t: 0.2, type: "pluck", freq: 440, gain: 0.08, decay: 1.2 },
      { t: 0.5, type: "pluck", freq: 660, gain: 0.06, decay: 1.4 },
    ];
  },
}
```

`intro()` 的 `t` 是相对开播时刻。现场 intro 只会播放实现了 `schedule` 的配方；当前适合
intro 的内置类型是 `pluck`、`brush`、`stream`。未知、未启用或不支持 schedule 的类型会
发出一次警告。

内置类型为 `pluck`、`takeoff`、`land`、`strum`、`type`、`carriage`、`knock`、
`brush`、`flutter`、`blip`、`stream`、`chirp`、`swish`。`stream` 既可 schedule，
也可即时 emit。

### 交互音效

```js
Engine.audio.emit("takeoff", { freq: 440 });
Engine.audio.setShimmer(input.D * 0.04);
Engine.audio.setEnabled(false);
```

只在 `update`、`play` 或输入事件中发射声音，不要在 build/render 中发射。`emit()` 会执行
recipe 的 `minInterval` 限流；渲染模式把事件写入 `window.__audioEvents`，seek 时不现场发声。
返回值表示事件是否被接受。

事件时间和类型以引擎为准，传入对象里的 `t/type` 会被丢弃。`pluck/takeoff/land/strum`
必须携带正数 `freq`；显式提供的 `freq/gain/pitch/decay/dur` 必须为正数，并会经过安全范围限制。未知、
白名单外或非法的事件返回 `false`，也不会写入离线日志。

可用控制方法：

```js
Engine.audio.init();      // 应由用户手势触发；不支持 Web Audio 时静音降级
Engine.audio.setEnabled(on);
Engine.audio.setShimmer(value);
Engine.audio.suspend();
Engine.audio.resume();
Engine.audio.destroy();
```

### 自定义 recipe

```js
Engine.registerRecipe("ping", {
  minInterval: 0.08,
  playNow(audio, event) {
    audio.pluck(audio.ctx.currentTime, event.freq || 880, event.gain || 0.06, 0.5);
  },
  schedule(audio, when, event) {
    audio.pluck(when, event.freq || 880, event.gain || 0.06, 0.5);
  },
});

Engine.getRecipe("ping");
```

自定义配方可在 AudioBus 创建前或运行时注册；现有 AudioBus 会按名称动态读取最新配方。
若场景使用 `audio.recipes` 白名单，仍须把名称预先加入白名单。为了让正式出片有同样声音，
还需要在 `engine/tools/synth.py` 中提供同名离线实现。

## 12. 查询参数与录制模式

| 参数 | 作用 |
| --- | --- |
| `?auto=1` | 使用 waypoints 自动输入。 |
| `?t=4.5` | 将普通交互页确定性快进到 4.5 秒并绘制静帧；只接受有限数字，并限制在 0–duration。 |
| `?mute=1` | 初始关闭音频，之后仍可由按钮重新开启。 |
| `?debug=1` | 显示运行时 HUD；录制和静帧模式不显示。 |
| `?dump=1` | 在 hyperframes/record 页面跑完整段并输出 `__AUDIO__<JSON>`。 |

常见组合：

```text
/scenes/demo/?auto=1&debug=1
/scenes/demo/?t=5.25&auto=1
/scenes/demo/record.html?dump=1
```

### hyperframes 页面契约

页面设置 `window.__HF_RENDER = true` 或存在 `[data-composition-id]` 时，引擎进入录制模式。
录制页要同步配置 ID、时长和尺寸：

```html
<div id="stage"
     data-composition-id="my-scene"
     data-start="0"
     data-duration="10"
     data-track-index="0"
     data-width="720"
     data-height="960"></div>

<script>window.__HF_RENDER = true;</script>
<!-- p5、core、input、systems、recipes、audio-bus、scene.js -->
<script src="/lib/gsap.min.js"></script>
<script>Engine.registerTimeline();</script>
```

嵌套场景的 record 页面应使用根绝对脚本路径，因为 hyperframes 会扁平化入口 HTML。
渲染器通过 `window.__hfSeek(t)` 推进；向后 seek 时引擎会调用场景 `reset`，没有 reset 时退回
`build`，然后从 0 按 `recordStep` 重新模拟。

## 13. v1 兼容与迁移

原有平铺配置无需改写：

```js
Engine.start({
  id: "legacy-scene",
  width: 720,
  height: 960,
  duration: 10,
  waypoints: [[1, 100, 200], [3, 500, 600, 1]],
  input: { attack: 5.5, release: 1.1 },
  preload() {},
  build() {},
  reset() {},
  update(dt, t, input) {},
  render(t) {},
  audio: { intro() { return []; } },
  ui: { tip: "点击开始", sub: "旧场景" },
});
```

兼容规则：

- `id/width/height/duration/pixelDensity/waypoints/input/audio/ui` 保持原语义。
- `input.x/y/active/pressed/speed/D` 全部保留。
- 生命周期函数新增的 `context`、`input` 参数位于末尾，旧函数可以自然忽略。
- `simulationHz` 仍支持，但新场景推荐使用 `timing.fixedStep`。
- `#overlay/#controls` 现在是可选节点；旧 DOM 无需改变。
- 原 `record.html`、`Engine.registerTimeline()`、`__hfSeek`、`__audioEvents` 继续可用。
- `systems.js` 是新增可选脚本；使用 systems 时放在 `core.js` 之后、场景之前。

建议逐步迁移：

1. 为每个场景补全 `reset`，并让它恢复全部状态。
2. 显式设置相同的 `timing.fixedStep` 与 `timing.recordStep`。
3. 把触摸/鼠标逻辑改为读取统一 `input`，不要再直接依赖 p5 的 `mouseX/mouseIsPressed`。
4. 把跨场景能力移入 plugin，把大粒子集迁移到 Pool/SpatialHash。
5. 把缓存背景和纹理迁移到 `Engine.layers`。

## 14. 确定性与出片注意事项

若希望“同一轨迹、同一代码、每次渲染得到同一状态”，请同时遵守以下约束：

1. **固定模拟网格。** 对物理场景显式配置：

   ```js
   timing: { fixedStep: 1 / 60, recordStep: 1 / 60 }
   ```

   离线 seek 只在完整网格边界提交 update 状态；`render(t)` 会拿到精确渲染时刻，而
   `context.time` 是最近一个已提交的模拟网格时刻。

2. **build/reset 使用同一种子与同一构建顺序。**

   ```js
   function build() {
     randomSeed(20260722);
     noiseSeed(20260722);
     // 之后创建全部确定性状态
   }
   ```

   需要互不干扰的随机流时使用 `Engine.u.rng(seed)`。

3. **render 只读状态。** 不要在 render 中随机生成、推进粒子、触发 cue 或 emit 音效；不同
   输出 FPS 会导致 render 次数不同。

4. **录制交互使用 waypoints。** 真实鼠标、触摸、键盘、当前日期和网络响应都不是可复现
   输入。自动轨迹的 noise jitter 也要求固定 `noiseSeed`；不需要抖动时将 jitter 设为 0。

5. **反向 seek 能完整复位。** `reset` 要清理数组、计时器、cue、Pool、SpatialHash、Spring、
   layer 内容和场景自定义事件状态。带内部可变状态的插件应实现 `reset(detail, context)`；
   反向 seek 不会调用插件 `replay`。尽量让录制插件由 `t` 直接计算，而非累积不可恢复状态。

6. **事件在 update 中触发。** AudioBus 使用 `Engine.now()` 记录时间；同一个事件条件必须在
   相同固定步长上求值，音画事件 JSON 才会一致。

7. **严格像素复现时不要使用未固定的随机纹理。** 若只要求主体运动和事件一致，可以把纸纹
   等装饰视为 artistic randomness；若要做像素快照测试，所有随机源都必须固定。

8. **正式录制保持 record 元数据同步。** `id/duration/width/height` 与 record HTML 的
   `data-*` 属性不一致会导致时间线缺失、截断或错误分辨率。

## 15. 回归测试

从仓库根目录运行：

```bash
tools/test_engine.sh
```

`engine/test` 中的 21 项独立测试覆盖配置与工具函数、Pointer Events/多指/键盘焦点与主指针
无尖峰交接、自动轨迹、确定性及反向 seek、循环末步与 overflow、静帧截断、Systems、插件
去重清理、音频事件校验，以及浏览器/离线 recipe 名称一致性。仓库级脚本还会执行 1 项展示
应用 scene/record 元数据集成检查、全部 JavaScript 语法检查，并验证空事件及零增益事件都能
生成合法静音 WAV。

当前测试是 Node 中的逻辑与契约回归，不代替真实浏览器的 Web Audio、Web Speech、触控/数位笔
兼容性检查，也不包含逐像素视觉快照。

## 16. 当前边界

- 一个页面只能有一个 `Engine.start()` 场景。
- 引擎占用 p5 全局 `preload/setup/draw`；场景辅助函数建议放在 IIFE 内，并避开 p5 全局保留名。
- 自定义 Web Audio recipe 仍需在 `engine/tools/synth.py` 中维护对应的离线实现。
- `Engine.layers` 管理 p5.Graphics，但不会自动替场景重绘 layer 内容。
- 浏览器的 Web Audio 和语音合成能力可能不可用；引擎会尽量静音降级，场景不应把声音作为
  唯一反馈。
