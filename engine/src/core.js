/* ============================================================
 * engine/core.js — Creative Runtime v2
 *
 * 保留 v1 契约:
 *   Engine.start({ build, reset, update, render, ... })
 *   p5 全局模式 / hyperframes __hfSeek / ?t ?auto ?mute ?dump
 *
 * v2 新增:
 *   - 完整生命周期:play / replay / pause / resume / destroy
 *   - 可选固定步长模拟,现场与离线渲染可使用同一物理步长
 *   - 插件与事件系统,场景能力不再全部堆进 core
 *   - contain/cover/none 响应式舞台 + resize 生命周期
 *   - 自适应 pixelDensity 与运行时性能指标
 *   - 容错 UI 契约、无 UI 自动播放场景、调试 HUD
 * ============================================================ */
"use strict";

window.Engine = (function () {
  const PARAMS = new URLSearchParams(location.search);
  const rawStaticT = PARAMS.has("t") ? Number(PARAMS.get("t")) : null;
  const STATIC_T = Number.isFinite(rawStaticT) ? Math.max(0, rawStaticT) : null;
  const MUTED = PARAMS.get("mute") === "1";
  const DUMP = PARAMS.get("dump") === "1";
  const DEBUG = PARAMS.get("debug") === "1";
  const RECORD_STEP = 1 / 30;

  const perfNow = () => (
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
  );

  /* ---------------- 数学与确定性工具 ---------------- */
  const u = {
    clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); },
    clamp01(v) { return u.clamp(v, 0, 1); },
    mix(a, b, p) { return a + (b - a) * p; },
    invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); },
    map(v, inA, inB, outA, outB, doClamp = false) {
      const p = doClamp ? u.clamp01(u.invLerp(inA, inB, v)) : u.invLerp(inA, inB, v);
      return u.mix(outA, outB, p);
    },
    ramp(a, b, t) {
      const x = u.clamp01(u.invLerp(a, b, t));
      return x * x * (3 - 2 * x);
    },
    smootherstep(a, b, t) {
      const x = u.clamp01(u.invLerp(a, b, t));
      return x * x * x * (x * (x * 6 - 15) + 10);
    },
    easeOutCubic(x) { return 1 - Math.pow(1 - u.clamp01(x), 3); },
    damp(current, target, lambda, dt) {
      return u.mix(current, target, 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
    },
    wrap(v, lo, hi) {
      const size = hi - lo;
      return size === 0 ? lo : ((v - lo) % size + size) % size + lo;
    },
    lerpAngle(a, b, p) {
      const delta = u.wrap(b - a + Math.PI, 0, Math.PI * 2) - Math.PI;
      return a + delta * p;
    },
    gauss(d, sigma) {
      return sigma <= 0 ? (d === 0 ? 1 : 0) : Math.exp(-(d * d) / (2 * sigma * sigma));
    },
    noteFreq(semi, a4 = 440) { return a4 * Math.pow(2, semi / 12); },
    hash(n) {
      const x = Math.sin(Number(n) * 12.9898) * 43758.5453123;
      return x - Math.floor(x);
    },
    rng(seed = 1) {
      let state = (Number(seed) >>> 0) || 1;
      return function () {
        state += 0x6D2B79F5;
        let x = state;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    },
  };

  /* ---------------- 轻量事件系统 ---------------- */
  class EventBus {
    constructor() { this._listeners = new Map(); }

    on(type, handler) {
      if (typeof handler !== "function") throw new TypeError("Engine.on 的 handler 必须是函数");
      const list = this._listeners.get(type) || new Set();
      list.add(handler);
      this._listeners.set(type, list);
      return () => this.off(type, handler);
    }

    once(type, handler) {
      const off = this.on(type, (...args) => { off(); handler(...args); });
      return off;
    }

    off(type, handler) {
      const list = this._listeners.get(type);
      if (!list) return;
      list.delete(handler);
      if (!list.size) this._listeners.delete(type);
    }

    has(type) {
      const list = this._listeners.get(type);
      return !!(list && list.size);
    }

    emit(type, detail) {
      const list = this._listeners.get(type);
      if (!list) return;
      for (const handler of [...list]) {
        try { handler(detail); }
        catch (error) { console.error(`[Engine event:${type}]`, error); }
      }
    }

    clear() { this._listeners.clear(); }
  }

  const events = new EventBus();
  const plugins = [];
  let pluginSerial = 0;
  const layerStore = new Map();
  const layerMeta = new WeakMap();

  /* ---------------- 时钟与运行时状态 ---------------- */
  let simNow = 0;
  let hfT = null;
  let startMs = -1;
  let lastLiveT = 0;
  let accumulator = 0;
  let hfCursor = 0;
  let pauseReason = null;
  let visibilityPaused = false;
  let pagePaused = false;
  let resizeRaf = 0;
  let lastFrameStamp = 0;
  let lastQualityCheck = 0;
  let lowFpsChecks = 0;
  let highFpsChecks = 0;
  let debugStamp = 0;
  let debugEl = null;
  let endedEmitted = false;
  let renderMode = null;
  let lastDeviceDensity = null;

  const runtimePerformance = {
    fps: 60,
    frameMs: 16.67,
    renderMs: 0,
    quality: 1,
    pixelDensity: 1,
    droppedSteps: 0,
    reducedMotion: !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ),
    saveData: !!(navigator.connection && navigator.connection.saveData),
  };

  const context = {
    get engine() { return E; },
    get time() { return simNow; },
    get input() { return E.input; },
    get canvas() { return E.canvas; },
    get viewport() { return E.viewport; },
    get performance() { return runtimePerformance; },
  };

  const E = {
    VERSION: "2.0.0",
    u,
    EventBus,
    events,
    context,
    performance: runtimePerformance,
    cfg: null,
    input: null,
    audio: null,
    narration: null,
    canvas: null,
    stage: null,
    viewport: null,
    started: false,
    paused: false,
    ready: false,
    seeking: false,
    destroyed: false,
    staticT: STATIC_T,
    muted: MUTED,

    now() { return simNow; },
    on(type, handler) { return events.on(type, handler); },
    once(type, handler) { return events.once(type, handler); },
    off(type, handler) { events.off(type, handler); },
    emit(type, detail) { events.emit(type, detail); },

    hf() {
      if (renderMode !== null) return renderMode;
      return window.__HF_RENDER === true
          || !!document.querySelector("[data-composition-id]");
    },
    auto() { return PARAMS.get("auto") === "1" || E.hf(); },

    start(rawCfg) {
      if (E.destroyed) throw new Error("当前全局 p5 runtime 已销毁;请刷新页面后注册新场景");
      if (E.cfg) throw new Error("Engine.start() 只能注册一个场景");
      E.cfg = normalizeConfig(rawCfg);
      if (typeof E.Input !== "function") {
        throw new Error("请在场景脚本前加载 engine/input.js");
      }
      E.input = new E.Input(E.cfg.waypoints || null, E.cfg.input);
      for (const entry of E.cfg.plugins) {
        if (Array.isArray(entry)) E.use(entry[0], entry[1]);
        else E.use(entry);
      }
      events.emit("engine:configured", { config: E.cfg, engine: E });
      return E;
    },

    use(plugin, options) { return installPlugin(plugin, options); },
    unuse(id) { return removePlugin(id); },
    getPlugin(id) {
      const record = plugins.find((p) => p.id === id || p.plugin === id || p.source === id);
      return record ? record.plugin : null;
    },

    play(options) { return play(options); },
    replay() { return play({ restart: true }); },
    pause(reason = "manual") { return pause(reason); },
    resume(reason = "manual") { return resume(reason); },
    destroy() { destroy(); },

    screenToCanvas(clientX, clientY) {
      const rect = E.canvas && E.canvas.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) {
        return { x: -1, y: -1, nx: -1, ny: -1, inside: false };
      }
      const x = (clientX - rect.left) * E.cfg.width / rect.width;
      const y = (clientY - rect.top) * E.cfg.height / rect.height;
      return {
        x, y,
        nx: x / E.cfg.width,
        ny: y / E.cfg.height,
        inside: x >= 0 && x <= E.cfg.width && y >= 0 && y <= E.cfg.height,
      };
    },

    capture(filename = `${Date.now()}.png`) {
      if (!E.canvas) return Promise.reject(new Error("画布尚未创建"));
      return new Promise((resolve, reject) => {
        E.canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("无法导出画布")); return; }
          if (filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = filename; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          resolve(blob);
        }, "image/png");
      });
    },

    layers: {
      create(name, options = {}) {
        options = options || {};
        if (!E.ready || typeof createGraphics !== "function") {
          throw new Error("Engine.layers.create() 只能在 setup/build 之后调用");
        }
        if (typeof name !== "string" || !name.trim()) {
          throw new TypeError("Engine.layers.create() 需要非空名称");
        }
        if (layerStore.has(name)) return layerStore.get(name);
        const width = finitePositive(options.width, E.cfg.width, "layers.width");
        const height = finitePositive(options.height, E.cfg.height, "layers.height");
        const graphics = options.renderer
          ? createGraphics(width, height, options.renderer)
          : createGraphics(width, height);
        const fixedDensity = options.pixelDensity !== undefined
          && options.pixelDensity !== null;
        const density = fixedDensity
          ? u.clamp(Math.round(finitePositive(options.pixelDensity, undefined, "layers.pixelDensity")), 1, 4)
          : (runtimePerformance.pixelDensity || 1);
        if (graphics.pixelDensity) {
          graphics.pixelDensity(density);
        }
        layerMeta.set(graphics, {
          // p5.Graphics.pixelDensity() 会重建并清空 backing canvas；仅显式选择时联动。
          adaptiveDensity: options.adaptiveDensity === true && !fixedDensity,
          pixelDensity: density,
        });
        layerStore.set(name, graphics);
        events.emit("layer:create", { name, graphics });
        return graphics;
      },
      get(name) { return layerStore.get(name); },
      has(name) { return layerStore.has(name); },
      remove(name) {
        const graphics = layerStore.get(name);
        if (!graphics) return false;
        if (graphics.remove) graphics.remove();
        layerStore.delete(name);
        events.emit("layer:remove", { name });
        return true;
      },
      clear() { for (const name of [...layerStore.keys()]) E.layers.remove(name); },
    },

    registerTimeline() {
      if (!E.cfg) throw new Error("请先调用 Engine.start()");
      if (typeof gsap === "undefined") throw new Error("Engine.registerTimeline() 需要先加载 GSAP");
      const duration = E.cfg.duration;
      const playhead = { seconds: 0 };
      const timeline = gsap.timeline({ paused: true });
      timeline.to(playhead, {
        seconds: duration, duration, ease: "none",
        onUpdate() { if (window.__hfSeek) window.__hfSeek(playhead.seconds); },
      });
      window.__timelines = window.__timelines || {};
      window.__timelines[E.cfg.id] = timeline;
      return timeline;
    },
  };

  function finitePositive(value, fallback, label) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    if (fallback !== undefined) return fallback;
    throw new TypeError(`${label} 必须是大于 0 的数字`);
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object") throw new TypeError("Engine.start() 需要场景配置对象");
    if (!raw.id) throw new TypeError("场景配置缺少 id");
    if (typeof raw.render !== "function") throw new TypeError("场景配置缺少 render(t) 函数");
    const callbacks = [
      "preload", "build", "setup", "reset", "play", "update", "resize",
      "qualityChanged", "pause", "resume", "end", "destroy",
    ];
    for (const name of callbacks) {
      if (raw[name] !== undefined && typeof raw[name] !== "function") {
        throw new TypeError(`场景配置 ${name} 必须是函数`);
      }
    }
    if (raw.audio && raw.audio.recipes !== undefined && !Array.isArray(raw.audio.recipes)) {
      throw new TypeError("audio.recipes 必须是名称数组");
    }
    if (raw.audio && raw.audio.intro !== undefined && typeof raw.audio.intro !== "function") {
      throw new TypeError("audio.intro 必须是函数");
    }

    const timingIn = raw.timing || {};
    let fixedStep = null;
    if (timingIn.fixedStep !== undefined && timingIn.fixedStep !== null) {
      fixedStep = finitePositive(timingIn.fixedStep, undefined, "timing.fixedStep");
    } else if (timingIn.fps || raw.simulationHz) {
      fixedStep = 1 / finitePositive(timingIn.fps || raw.simulationHz, undefined, "simulationHz");
    }
    const recordStep = timingIn.recordStep
      ? finitePositive(timingIn.recordStep, RECORD_STEP, "timing.recordStep")
      : fixedStep || RECORD_STEP;

    const layoutIn = raw.layout || {};
    const fit = ["contain", "cover", "none"].includes(layoutIn.fit) ? layoutIn.fit : "contain";
    const performanceIn = raw.performance === false ? { adaptive: false } : (raw.performance || {});
    const autoPixelDensity = raw.pixelDensity === "auto";
    const requestedDensity = autoPixelDensity
      ? (E.hf() ? 2 : Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1))))
      : finitePositive(raw.pixelDensity, 2, "pixelDensity");
    // 浏览器端超高 DPR 对生成艺术的观感收益很小,却会平方级放大显存与填充成本。
    const maxDensity = u.clamp(Math.round(requestedDensity), 1, 4);

    return Object.assign({}, raw, {
      id: String(raw.id),
      width: finitePositive(raw.width, undefined, "width"),
      height: finitePositive(raw.height, undefined, "height"),
      duration: finitePositive(raw.duration, 10, "duration"),
      frameRate: finitePositive(raw.frameRate, 60, "frameRate"),
      pixelDensity: maxDensity,
      autoPixelDensity,
      plugins: Array.isArray(raw.plugins) ? raw.plugins : [],
      autoplay: raw.autoplay === true || raw.ui === false,
      idleRender: raw.idleRender === true,
      pauseWhenHidden: raw.pauseWhenHidden !== false,
      loop: raw.loop === true,
      timing: {
        fixedStep,
        recordStep,
        maxDelta: finitePositive(timingIn.maxDelta, 0.05, "timing.maxDelta"),
        maxSubSteps: Math.max(1, Math.floor(finitePositive(timingIn.maxSubSteps, 8, "timing.maxSubSteps"))),
      },
      layout: {
        fit,
        margin: Math.max(0, Number(layoutIn.margin === undefined ? 24 : layoutIn.margin) || 0),
        maxScale: finitePositive(layoutIn.maxScale, Infinity, "layout.maxScale"),
      },
      performance: {
        adaptive: performanceIn.adaptive !== false,
        targetFps: finitePositive(performanceIn.targetFps, 50, "performance.targetFps"),
        minPixelDensity: u.clamp(Math.round(performanceIn.minPixelDensity || 1), 1, maxDensity),
        sampleSeconds: finitePositive(performanceIn.sampleSeconds, 2, "performance.sampleSeconds"),
      },
    });
  }

  function pluginId(plugin) {
    return plugin && (plugin.id || plugin.name) || `plugin-${++pluginSerial}`;
  }

  function installPlugin(source, options) {
    if (!source) throw new TypeError("Engine.use() 需要插件函数或对象");
    const sameRegistration = plugins.find((record) => (
      record.source === source && record.options === options
    ));
    if (sameRegistration) return sameRegistration.plugin;
    let plugin = source;
    let cleanup = null;
    if (typeof source === "function") plugin = source(E, options) || { id: source.name };
    if (!plugin || typeof plugin !== "object") throw new TypeError("插件必须返回对象");

    const id = pluginId(plugin);
    const duplicate = plugins.find((record) => record.id === id);
    if (duplicate) {
      // 工厂应把副作用放在 install 中；若它提前创建了资源，给临时实例一次清理机会。
      if (typeof source === "function" && plugin !== duplicate.plugin
          && typeof plugin.destroy === "function") {
        try { plugin.destroy(context); }
        catch (error) { reportError(error, `plugin:${id}:duplicate-destroy`); }
      }
      return duplicate.plugin;
    }
    if (typeof plugin.install === "function") cleanup = plugin.install(E, options) || null;
    const record = { id, plugin, cleanup, source, options };
    plugins.push(record);
    if (E.ready) callPlugin(record, "setup", context);
    events.emit("plugin:install", { id, plugin });
    return plugin;
  }

  function removePlugin(target) {
    const index = plugins.findIndex((record) => (
      record.id === target || record.plugin === target || record.source === target
    ));
    if (index < 0) return false;
    const [record] = plugins.splice(index, 1);
    callPlugin(record, "destroy", context);
    if (typeof record.cleanup === "function") {
      try { record.cleanup(); } catch (error) { reportError(error, `plugin:${record.id}:cleanup`); }
    }
    events.emit("plugin:remove", { id: record.id, plugin: record.plugin });
    return true;
  }

  function callPlugin(record, hook, ...args) {
    const fn = record.plugin && record.plugin[hook];
    if (typeof fn !== "function") return;
    try { fn.apply(record.plugin, args); }
    catch (error) { reportError(error, `plugin:${record.id}:${hook}`); }
  }

  function callPlugins(hook, ...args) {
    if (!plugins.length) return;
    for (const record of plugins.slice()) {
      if (E.destroyed || !E.cfg) break;
      callPlugin(record, hook, ...args);
    }
  }

  function reportError(error, source) {
    console.error(`[Engine ${source}]`, error);
    events.emit("engine:error", { error, source, engine: E });
  }

  function runtimeAlive() {
    return !!(E.cfg && E.input && E.ready && !E.destroyed);
  }

  function tick(dt, t) {
    if (!(dt >= 0) || !Number.isFinite(t) || !runtimeAlive()) return false;
    simNow = t;
    E.input.update(t, dt);
    if (!runtimeAlive()) return false;
    if (plugins.length) callPlugins("beforeUpdate", dt, t, E.input, context);
    if (!runtimeAlive()) return false;
    if (E.cfg.update) E.cfg.update(dt, t, E.input, context);
    if (!runtimeAlive()) return false;
    if (plugins.length) {
      callPlugins("update", dt, t, E.input, context);
      callPlugins("afterUpdate", dt, t, E.input, context);
    }
    if (!runtimeAlive()) return false;
    if (events.has("engine:update")) {
      events.emit("engine:update", { dt, time: t, input: E.input });
    }
    return runtimeAlive();
  }

  function resetClock() {
    simNow = 0;
    hfT = null;
    hfCursor = 0;
    lastLiveT = 0;
    accumulator = 0;
    endedEmitted = false;
  }

  function finishTimeline(time) {
    if (endedEmitted) return;
    endedEmitted = true;
    if (typeof E.cfg.end === "function") E.cfg.end(context);
    callPlugins("end", context);
    events.emit("engine:end", { time });
  }

  function advanceLive(targetT) {
    const timing = E.cfg.timing;
    const rawDelta = Math.max(0, targetT - lastLiveT);
    lastLiveT = targetT;

    if (!timing.fixedStep) {
      return tick(Math.min(rawDelta, timing.maxDelta), targetT);
    }

    accumulator += rawDelta;
    let steps = 0;
    while (accumulator + 1e-10 >= timing.fixedStep && steps < timing.maxSubSteps) {
      if (!tick(timing.fixedStep, simNow + timing.fixedStep)) return false;
      accumulator -= timing.fixedStep;
      steps++;
      if (E.paused) return runtimeAlive();
    }
    if (accumulator >= timing.fixedStep) {
      const dropped = Math.floor(accumulator / timing.fixedStep);
      runtimePerformance.droppedSteps += dropped;
      simNow += dropped * timing.fixedStep;
      accumulator -= dropped * timing.fixedStep;
      events.emit("performance:drop", { dropped, time: targetT });
    }
    return runtimeAlive();
  }

  function advanceDeterministic(target, step) {
    // 只在固定网格边界提交状态。这样 30/60fps seek、逐帧/跳帧 seek
    // 到同一时刻都会得到同一模拟状态,不会被外部 seek 分片改变积分结果。
    while (hfCursor + step <= target + 1e-9) {
      const next = hfCursor + step;
      if (!tick(step, next)) return false;
      hfCursor = next;
    }
    return runtimeAlive();
  }

  /* ---------------- 舞台与画质 ---------------- */
  function viewportSize() {
    const vv = window.visualViewport;
    return {
      width: vv ? vv.width : window.innerWidth,
      height: vv ? vv.height : window.innerHeight,
    };
  }

  function fitStage() {
    if (!E.stage || !E.cfg) return;
    if (E.hf()) { fillStage(); return; }
    if (E.cfg.autoPixelDensity) {
      const deviceDensity = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
      if (lastDeviceDensity !== null && deviceDensity !== lastDeviceDensity) {
        E.cfg.pixelDensity = deviceDensity;
        E.cfg.performance.minPixelDensity = Math.min(E.cfg.performance.minPixelDensity, deviceDensity);
        setRuntimeDensity(deviceDensity, "device-dpr");
      }
      lastDeviceDensity = deviceDensity;
    }
    const size = viewportSize();
    const { width, height, layout } = E.cfg;
    const availableW = Math.max(1, size.width - layout.margin * 2);
    const availableH = Math.max(1, size.height - layout.margin * 2);
    const sx = availableW / width;
    const sy = availableH / height;
    let scale = layout.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
    if (layout.fit === "none") scale = 1;
    scale = Math.min(scale, layout.maxScale);

    const cssWidth = width * scale;
    const cssHeight = height * scale;
    E.stage.style.width = `${cssWidth}px`;
    E.stage.style.height = `${cssHeight}px`;
    if (E.canvas) { E.canvas.style.width = "100%"; E.canvas.style.height = "100%"; }
    E.viewport = {
      width: cssWidth, height: cssHeight, scale,
      availableWidth: availableW, availableHeight: availableH,
      screenWidth: size.width, screenHeight: size.height,
      fit: layout.fit,
    };
    notifyResize();
  }

  function fillStage() {
    if (!E.stage) return;
    E.stage.style.width = `${E.cfg.width}px`;
    E.stage.style.height = `${E.cfg.height}px`;
    E.stage.style.boxShadow = "none";
    if (E.canvas) { E.canvas.style.width = "100%"; E.canvas.style.height = "100%"; }
    E.viewport = {
      width: E.cfg.width, height: E.cfg.height, scale: 1,
      availableWidth: E.cfg.width, availableHeight: E.cfg.height,
      screenWidth: E.cfg.width, screenHeight: E.cfg.height, fit: "none",
    };
    notifyResize();
  }

  function notifyResize() {
    if (!E.viewport) return;
    if (typeof E.cfg.resize === "function") E.cfg.resize(E.viewport, context);
    callPlugins("resize", E.viewport, context);
    events.emit("engine:resize", E.viewport);
  }

  function scheduleFit() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; fitStage(); });
  }

  function setRuntimeDensity(next, reason) {
    if (E.hf() || STATIC_T !== null || typeof pixelDensity !== "function") return;
    const min = E.cfg.performance.minPixelDensity;
    next = u.clamp(Math.round(next), min, E.cfg.pixelDensity);
    if (next === runtimePerformance.pixelDensity) return;
    pixelDensity(next);
    for (const graphics of layerStore.values()) {
      const meta = layerMeta.get(graphics);
      if (!meta || !meta.adaptiveDensity || typeof graphics.pixelDensity !== "function") continue;
      try {
        graphics.pixelDensity(next);
        meta.pixelDensity = next;
      } catch (error) {
        reportError(error, "layer:pixelDensity");
      }
    }
    runtimePerformance.pixelDensity = next;
    runtimePerformance.quality = next / E.cfg.pixelDensity;
    const detail = {
      pixelDensity: next,
      quality: runtimePerformance.quality,
      reason,
      fps: runtimePerformance.fps,
    };
    if (typeof E.cfg.qualityChanged === "function") E.cfg.qualityChanged(detail, context);
    callPlugins("qualityChanged", detail, context);
    events.emit("performance:quality", detail);
  }

  function samplePerformance(stamp) {
    if (!lastFrameStamp) { lastFrameStamp = stamp; return; }
    const elapsed = stamp - lastFrameStamp;
    lastFrameStamp = stamp;
    if (!(elapsed > 0) || elapsed > 1000) return;
    runtimePerformance.frameMs = u.mix(runtimePerformance.frameMs, elapsed, 0.08);
    runtimePerformance.fps = 1000 / runtimePerformance.frameMs;
    if (!E.started || E.paused || E.hf() || STATIC_T !== null || !E.cfg.performance.adaptive) return;
    if (stamp - lastQualityCheck < E.cfg.performance.sampleSeconds * 1000) return;
    lastQualityCheck = stamp;

    const target = E.cfg.performance.targetFps;
    if (runtimePerformance.fps < target - 8) {
      lowFpsChecks++;
      highFpsChecks = 0;
    } else if (runtimePerformance.fps > target + 5) {
      highFpsChecks++;
      lowFpsChecks = 0;
    } else {
      lowFpsChecks = Math.max(0, lowFpsChecks - 1);
      highFpsChecks = Math.max(0, highFpsChecks - 1);
    }
    if (lowFpsChecks >= 2) {
      setRuntimeDensity(runtimePerformance.pixelDensity - 1, "low-fps");
      lowFpsChecks = 0;
    } else if (highFpsChecks >= 4) {
      setRuntimeDensity(runtimePerformance.pixelDensity + 1, "recovered");
      highFpsChecks = 0;
    }
  }

  /* ---------------- UI 与生命周期 ---------------- */
  function hideUI() {
    const overlay = document.getElementById("overlay");
    const controls = document.getElementById("controls");
    if (overlay) overlay.style.display = "none";
    if (controls) controls.style.display = "none";
  }

  function syncToggle(button, on, onText, offText) {
    if (!button) return;
    button.classList.toggle("on", on);
    button.textContent = on ? onText : offText;
    button.setAttribute("aria-pressed", String(on));
  }

  function wireUI() {
    const overlay = document.getElementById("overlay");
    const btnReplay = document.getElementById("btn-replay");
    const btnSound = document.getElementById("btn-sound");
    const btnVoice = document.getElementById("btn-voice");
    const ui = E.cfg.ui === false ? {} : (E.cfg.ui || {});

    if (overlay) {
      const tipEl = overlay.querySelector(".tip");
      const subEl = overlay.querySelector(".sub");
      if (ui.tip && tipEl) tipEl.textContent = ui.tip;
      if (ui.sub && subEl) subEl.textContent = ui.sub;
      overlay.setAttribute("role", "button");
      overlay.setAttribute("tabindex", "0");
      overlay.setAttribute("aria-label", ui.tip || "开始播放");
      overlay.addEventListener("click", onOverlayStart);
      overlay.addEventListener("keydown", onOverlayKey);
    }
    if (btnReplay) btnReplay.addEventListener("click", onReplayClick);
    if (btnSound) btnSound.addEventListener("click", onSoundClick);
    if (btnVoice) btnVoice.addEventListener("click", onVoiceClick);
    syncToggle(btnSound, E.audio.enabled, "音效 开", "音效 关");
    syncToggle(btnVoice, E.narration.enabled, "旁白 开", "旁白 关");
  }

  function unwireUI() {
    const overlay = document.getElementById("overlay");
    const btnReplay = document.getElementById("btn-replay");
    const btnSound = document.getElementById("btn-sound");
    const btnVoice = document.getElementById("btn-voice");
    if (overlay) {
      overlay.removeEventListener("click", onOverlayStart);
      overlay.removeEventListener("keydown", onOverlayKey);
    }
    if (btnReplay) btnReplay.removeEventListener("click", onReplayClick);
    if (btnSound) btnSound.removeEventListener("click", onSoundClick);
    if (btnVoice) btnVoice.removeEventListener("click", onVoiceClick);
  }

  function onOverlayStart() { play(); }
  function onOverlayKey(event) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); play(); }
  }
  function onReplayClick(event) { event.stopPropagation(); E.replay(); }
  function onSoundClick(event) {
    event.stopPropagation();
    const ctx = E.audio.init();
    if (ctx) E.audio.setEnabled(!E.audio.enabled);
    else E.audio.setEnabled(false);
    syncToggle(event.currentTarget, E.audio.enabled, "音效 开", "音效 关");
  }
  function onVoiceClick(event) {
    event.stopPropagation();
    E.narration.setEnabled(!E.narration.enabled);
    syncToggle(event.currentTarget, E.narration.enabled, "旁白 开", "旁白 关");
    if (E.narration.enabled && E.started) {
      E.narration.speak((E.cfg.ui && E.cfg.ui.narration) || [], simNow);
    }
  }

  function play(options = {}) {
    if (!E.ready || E.hf() || STATIC_T !== null) return false;
    const restart = options.restart === true;
    const firstStart = !E.started;
    if (E.started && !E.paused && !restart) return false;
    if (E.started && E.paused && !restart) return resume("play");
    if (restart || firstStart) {
      E.input.reset();
      resetClock();
      E.audio.onReplay();
      if (restart && E.cfg.reset) E.cfg.reset(context);
      if (restart) callPlugins("reset", { reason: "replay" }, context);
    }

    const overlay = document.getElementById("overlay");
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.setAttribute("tabindex", "-1");
      overlay.setAttribute("aria-hidden", "true");
    }
    if (options.audio !== false) E.audio.init();
    if (E.audio && E.audio.resume) E.audio.resume();
    E.audio.setEnabled(E.audio.enabled);
    syncToggle(document.getElementById("btn-sound"), E.audio.enabled, "音效 开", "音效 关");
    startMs = millis() - simNow * 1000;
    lastLiveT = simNow;
    accumulator = 0;
    E.started = true;
    E.paused = false;
    pauseReason = null;

    if ((restart || firstStart) && E.audio.enabled && E.cfg.audio && E.cfg.audio.intro) {
      E.audio.schedule(E.cfg.audio.intro());
    }
    if (restart || firstStart) {
      E.narration.speak((E.cfg.ui && E.cfg.ui.narration) || [], 0);
    }
    if (typeof loop === "function") loop();
    if (typeof E.cfg.play === "function") E.cfg.play({ restart, firstStart }, context);
    callPlugins(restart ? "replay" : "play", context);
    events.emit(restart ? "engine:replay" : "engine:play", { restart, firstStart });
    return true;
  }

  function pause(reason) {
    if (!E.started || E.paused || E.hf()) return false;
    E.paused = true;
    pauseReason = reason;
    if (typeof noLoop === "function") noLoop();
    if (E.audio && E.audio.suspend) E.audio.suspend();
    if (E.narration) E.narration.pause();
    if (typeof E.cfg.pause === "function") E.cfg.pause(reason, context);
    callPlugins("pause", reason, context);
    events.emit("engine:pause", { reason, time: simNow });
    return true;
  }

  function resume(reason) {
    if (!E.started || !E.paused || E.hf()) return false;
    E.paused = false;
    pauseReason = null;
    startMs = millis() - simNow * 1000;
    lastLiveT = simNow;
    accumulator = 0;
    lastFrameStamp = 0;
    if (E.audio && E.audio.resume) E.audio.resume();
    if (E.narration) E.narration.resume(simNow);
    if (typeof loop === "function") loop();
    if (typeof E.cfg.resume === "function") E.cfg.resume(reason, context);
    callPlugins("resume", reason, context);
    events.emit("engine:resume", { reason, time: simNow });
    return true;
  }

  function onVisibilityChange() {
    if (!E.cfg || !E.cfg.pauseWhenHidden || E.hf()) return;
    if (document.hidden) {
      visibilityPaused = pause("visibility");
    } else if (visibilityPaused && pauseReason === "visibility") {
      visibilityPaused = false;
      resume("visibility");
    }
  }

  function onPageHide() {
    if (!E.cfg || !E.cfg.pauseWhenHidden || E.hf()) return;
    pagePaused = pause("pagehide");
  }

  function onPageShow() {
    if (pagePaused && pauseReason === "pagehide") {
      resume("pagehide");
    } else if (visibilityPaused && !document.hidden && pauseReason === "visibility") {
      visibilityPaused = false;
      resume("visibility");
    }
    pagePaused = false;
  }

  function destroy() {
    if (!E.cfg || E.destroyed) return;
    const cfg = E.cfg;
    window.removeEventListener("resize", scheduleFit);
    if (window.visualViewport) window.visualViewport.removeEventListener("resize", scheduleFit);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    unwireUI();
    if (E.input) E.input.detach();
    if (E.narration) E.narration.stop();
    if (E.audio && E.audio.destroy) E.audio.destroy();
    if (typeof cfg.destroy === "function") cfg.destroy(context);
    while (plugins.length) removePlugin(plugins[plugins.length - 1].id);
    E.layers.clear();
    if (typeof noLoop === "function") noLoop();
    E.started = false; E.paused = false; E.ready = false;
    events.emit("engine:destroy", { engine: E });
    events.clear();
    if (debugEl && debugEl.remove) debugEl.remove();
    debugEl = null;
    if (window.__timelines) delete window.__timelines[cfg.id];
    delete window.__hfSeek;
    delete window.__audioEvents;
    E.input = null; E.audio = null; E.narration = null;
    E.canvas = null; E.stage = null; E.viewport = null;
    E.cfg = null;
    E.destroyed = true;
  }

  function ensureDebugHUD() {
    if (!(DEBUG || E.cfg.debug) || E.hf() || !E.stage) return;
    debugEl = document.createElement("pre");
    debugEl.id = "engine-debug";
    debugEl.setAttribute("aria-hidden", "true");
    Object.assign(debugEl.style, {
      position: "absolute", left: "8px", bottom: "8px", zIndex: "9999",
      margin: "0", padding: "6px 8px", pointerEvents: "none",
      color: "#d8ffe1", background: "rgba(0,0,0,.68)", borderRadius: "4px",
      font: "10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
    });
    E.stage.appendChild(debugEl);
  }

  function updateDebugHUD(stamp, renderT) {
    if (!debugEl || stamp - debugStamp < 200) return;
    debugStamp = stamp;
    const i = E.input;
    debugEl.textContent = [
      `Engine ${E.VERSION}`,
      `time ${renderT.toFixed(2)}s · ${runtimePerformance.fps.toFixed(0)} fps`,
      `render ${runtimePerformance.renderMs.toFixed(1)}ms · dpr ${runtimePerformance.pixelDensity} · q ${runtimePerformance.quality.toFixed(2)}`,
      `pointer ${i.type || "none"} · ${i.x.toFixed(0)}, ${i.y.toFixed(0)} · D ${i.D.toFixed(2)}`,
      `pointers ${i.pointers ? i.pointers.length : 0} · dropped ${runtimePerformance.droppedSteps}`,
    ].join("\n");
  }

  /* ---------------- p5 桥接 ---------------- */
  window.preload = function () {
    if (E.cfg && E.cfg.preload) E.cfg.preload(context);
  };

  window.setup = function () {
    if (!E.cfg) throw new Error("未注册场景:请在页面最后调用 Engine.start({...})");
    const cfg = E.cfg;
    renderMode = window.__HF_RENDER === true
      || !!document.querySelector("[data-composition-id]");
    E.stage = document.getElementById("stage") || document.body;
    const renderer = cfg.renderer === "webgl" && typeof WEBGL !== "undefined" ? WEBGL : undefined;
    const canvasHandle = renderer
      ? createCanvas(cfg.width, cfg.height, renderer)
      : createCanvas(cfg.width, cfg.height);
    if (canvasHandle.parent && E.stage.id) canvasHandle.parent(E.stage.id);
    E.canvas = canvasHandle.elt || E.stage.querySelector("canvas");
    if (E.canvas) {
      const ui = cfg.ui === false ? {} : (cfg.ui || {});
      E.canvas.setAttribute("tabindex", "0");
      E.canvas.setAttribute("role", "application");
      E.canvas.setAttribute("aria-label", ui.canvasLabel || `${cfg.id} 交互画布`);
    }
    pixelDensity(cfg.pixelDensity);
    runtimePerformance.pixelDensity = cfg.pixelDensity;
    runtimePerformance.quality = 1;
    frameRate(cfg.frameRate || 60);

    E.audio = new E.AudioBus(cfg.audio || {});
    E.narration = new E.Narration();
    E.input.attach(E.canvas);
    E.ready = true;

    if (cfg.build) cfg.build(context);
    if (cfg.setup) cfg.setup(context);
    callPlugins("setup", context);
    wireUI();
    fitStage();
    ensureDebugHUD();

    window.addEventListener("resize", scheduleFit, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleFit, { passive: true });
    window.addEventListener("pagehide", onPageHide, { passive: true });
    window.addEventListener("pageshow", onPageShow, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    events.emit("engine:ready", { engine: E, config: cfg, context });

    if (E.hf()) {
      hideUI();
      fillStage();
      noLoop();
      window.__audioEvents = [];
      if (cfg.audio && cfg.audio.intro) E.audio.recordIntro(cfg.audio.intro());
      resetClock();
      window.__hfSeek = (target) => {
        const t = u.clamp(Number(target) || 0, 0, cfg.duration);
        if (t < hfCursor - 1e-9) {
          E.input.reset();
          E.audio.onReplay();
          resetClock();
          if (cfg.reset) cfg.reset(context);
          else if (cfg.build) cfg.build(context);
          callPlugins("reset", { reason: "seek", target: t }, context);
          window.__audioEvents = [];
          if (cfg.audio && cfg.audio.intro) E.audio.recordIntro(cfg.audio.intro());
        }
        E.seeking = true;
        try {
          if (!advanceDeterministic(t, cfg.timing.recordStep)) return;
        }
        finally { E.seeking = false; }
        if (!runtimeAlive()) return;
        hfT = t;
        redraw();
      };
      if (DUMP) {
        const end = cfg.duration;
        // dump 只推进 update transport,不调用 render;render 必须保持纯函数。
        // 这让音轨事件与输出视频帧率无关。
        E.seeking = true;
        try {
          if (!advanceDeterministic(end, cfg.timing.recordStep)) return;
        }
        finally { E.seeking = false; }
        if (!runtimeAlive()) return;
        hfT = end;
        console.log("__AUDIO__" + JSON.stringify(window.__audioEvents));
      }
      return;
    }

    if (STATIC_T !== null) {
      hideUI();
      resetClock();
      const target = Math.min(STATIC_T, cfg.duration);
      E.staticT = target;
      E.seeking = true;
      try {
        if (!advanceDeterministic(target, cfg.timing.recordStep)) return;
      }
      finally { E.seeking = false; }
      if (!runtimeAlive()) return;
      noLoop();
      redraw();
      return;
    }

    if (cfg.autoplay) play({ audio: false });
    else if (!cfg.idleRender) {
      // 遮罩等待点击时只画首帧,避免每个画廊详情页在后台空转 60fps。
      noLoop();
      redraw();
    }
  };

  window.draw = function () {
    if (!E.cfg || !E.ready) return;
    const stamp = perfNow();
    samplePerformance(stamp);
    let renderT = 0;

    if (E.hf()) {
      renderT = hfT === null ? 0 : hfT;
    } else if (STATIC_T !== null) {
      renderT = E.staticT;
    } else if (E.started) {
      renderT = E.paused ? simNow : Math.max(0, (millis() - startMs) / 1000);
      if (!E.paused) {
        if (E.cfg.loop && renderT >= E.cfg.duration) {
          const rawOverflow = renderT % E.cfg.duration;
          const carryWindow = u.clamp(E.cfg.timing.maxDelta, 1 / 60, 0.1);
          // 小幅跨界用于消除循环漂移；长帧直接从 0 恢复，避免画面快进而声音仍从头播放。
          const overflow = rawOverflow <= carryWindow + 1e-9 ? rawOverflow : 0;
          // 先提交上一轮的最后模拟网格和 end，再从确定性初态开启下一轮。
          if (!advanceLive(E.cfg.duration)) return;
          finishTimeline(E.cfg.duration);
          if (!runtimeAlive()) return;
          if (!E.paused) {
            E.replay();
            if (!runtimeAlive()) return;
            startMs = millis() - overflow * 1000;
            if (overflow > 0) {
              let advanced = false;
              E.seeking = true; // 快进过去的交互事件只更新状态，不在同一音频时刻扎堆播放。
              try { advanced = advanceLive(overflow); }
              finally { E.seeking = false; }
              if (!advanced) return;
            }
            renderT = overflow;
          } else {
            renderT = E.cfg.duration;
          }
        } else {
          if (!advanceLive(renderT)) return;
        }
      }
      if (renderT >= E.cfg.duration) finishTimeline(renderT);
      if (!runtimeAlive()) return;
    }

    if (plugins.length) callPlugins("beforeRender", renderT, context);
    if (!runtimeAlive()) return;
    E.cfg.render(renderT, context);
    if (!runtimeAlive()) return;
    if (plugins.length) {
      callPlugins("render", renderT, context);
      callPlugins("afterRender", renderT, context);
    }
    if (!runtimeAlive()) return;
    if (events.has("engine:render")) events.emit("engine:render", { time: renderT });
    if (!runtimeAlive()) return;
    runtimePerformance.renderMs = u.mix(runtimePerformance.renderMs, perfNow() - stamp, 0.1);
    updateDebugHUD(stamp, renderT);
  };

  return E;
})();
