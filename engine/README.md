# Creative Runtime

独立于展示应用的 p5.js / Processing 风格创意交互运行时。它负责生命周期、确定性时间、统一输入、
插件、离屏图层、性能管理、音画事件和常用游戏系统，不包含任何具体作品或画廊 UI。

## 目录

```text
src/             浏览器运行时，按顺序以普通 script 加载
test/            不依赖浏览器和展示应用的运行时回归
tools/synth.py   与浏览器 recipe 对齐的离线音频合成器
API.md           完整 API
DEVELOPMENT.md   场景开发、确定性与出片指南
```

## 浏览器加载

```html
<script src="/engine/core.js"></script>
<script src="/engine/input.js"></script>
<script src="/engine/systems.js"></script><!-- 可选 -->
<script src="/engine/recipes.js"></script>
<script src="/engine/audio-bus.js"></script>
<script src="/scenes/my-scene/scene.js"></script>
```

这些文件使用浏览器全局 `window.Engine` 和 p5.js 全局模式，无需打包器。`web/engine` 是展示应用
对 `engine/src` 的静态挂载，不是第二份源码；其他应用可以把 `src` 挂载到自己的公开目录。

## 测试

```bash
node --test engine/test/engine.test.cjs
# 或运行仓库级测试（包含展示应用集成检查）
tools/test_engine.sh
```

当前包标记为 private，避免在名称和许可证确定前误发布；这不影响本地复用或作为仓库子包消费。
