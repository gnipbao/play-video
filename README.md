# play-video — Creative Runtime v2

面向 p5.js / Processing 风格创意网页的交互动画引擎：同一份场景逻辑既能响应鼠标、触控、
数位笔和键盘，也能通过 hyperframes 确定性 seek，配合离线音频合成与 ffmpeg 输出成片。

v2 新增了固定步长生命周期、Pointer Events 与双指手势、插件、命名离屏图层、响应式舞台、
自适应画质，以及粒子池、空间哈希、关键帧、Cue 时间线和弹簧等常用创意编码系统。

## 快速开始

```bash
# 从仓库根目录启动禁缓存开发服务器
tools/serve.py 8123

# 另开终端运行零依赖回归测试
tools/test_engine.sh
```

浏览器访问：

- 作品集：`http://localhost:8123/`
- 交互场景：`/scenes/heart-butterfly/`、`/scenes/yanfan/`、`/scenes/puppet/`、
  `/scenes/typewriter/`、`/scenes/control/`、`/scenes/sparks/`
- 自动演示与调试：在场景 URL 后添加 `?auto=1&debug=1`

新建场景：

```bash
cp -r templates/scene web/scenes/my-scene
# 修改 scene.js、index.html、record.html 中的 id、路径、时长和尺寸
```

出片示例（输出目录不存在时会自动创建）：

```bash
tools/make_film.sh record.html demo/control.mp4
tools/make_film.sh scenes/sparks/record.html demo/sparks.mp4
```

出片需要本机可用的 hyperframes、Chromium/Chrome 与 ffmpeg；只做网页交互开发时不需要它们。

## 项目导航

```text
engine/            独立 Creative Runtime v2 包
  src/             生命周期、输入、Systems、音频与插件运行时
  test/            不依赖展示应用的引擎回归
  tools/synth.py   与浏览器 recipe 对齐的离线音频合成
web/               作品集展示应用
  engine -> ../engine/src  静态挂载，不是第二份源码
  scenes/          每个作品一份独立场景
  gallery/         画廊；works.js 是作品登记处
  films/           画廊使用的压缩成片
templates/scene/  v2 新场景骨架
web/test/         展示应用集成检查与调试页面
tools/            本地服务、仓库级测试、事件导出与出片编排
```

文档分工：

- [engine/README.md](engine/README.md)：独立引擎包入口与消费方式
- [engine/DEVELOPMENT.md](engine/DEVELOPMENT.md)：场景开发、确定性出片与常见坑位
- [engine/API.md](engine/API.md)：完整配置、生命周期、输入、插件、图层和 Systems API

## 分层约定

- `engine` 是唯一运行时源码；引擎能力、测试和离线 recipe 都在这里维护。
- `web` 只负责作品、画廊、素材和成片，不在应用目录复制引擎代码。
- `web/engine` 是兼容静态服务器与 hyperframes 的符号链接，不要直接在该路径编辑。
- 新展示应用可以独立挂载 `engine/src`，无需复制当前画廊或场景代码。

## 兼容与部署

v2 保留原有 `Engine.start({...})`、p5 全局模式、`__hfSeek`、`__audioEvents` 和
`Engine.registerTimeline()` 契约；旧场景可继续运行，再按需补充固定步长、统一输入和插件能力。
当前运行时仍是单例、单场景，一个页面只能注册一次 `Engine.start()`。

项目保持零构建：Vercel 使用仓库根目录，把 `/engine/*` 直接映射到 `engine/src`，其余请求交给
`web` 展示应用；`web/engine` 挂载用于本地静态服务器和 hyperframes，不保存第二份源码。
