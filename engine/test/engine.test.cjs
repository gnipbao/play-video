"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    const set = this.listeners.get(type) || new Set();
    set.add(handler); this.listeners.set(type, set);
  }
  removeEventListener(type, handler) {
    const set = this.listeners.get(type);
    if (set) set.delete(handler);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
}

class Element extends Target {
  constructor(id = "") {
    super();
    this.id = id;
    this.style = {};
    this.attributes = new Map();
    this.children = [];
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      toggle: (name, force) => {
        if (force === false) this.classList.values.delete(name);
        else if (force === true || !this.classList.values.has(name)) this.classList.values.add(name);
        else this.classList.values.delete(name);
      },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(selector) {
    if (selector === "canvas") return this.children.find((child) => child.tagName === "CANVAS") || null;
    return null;
  }
  getBoundingClientRect() { return { left: 10, top: 20, width: 360, height: 480 }; }
  setPointerCapture() {}
  toBlob(callback) { callback(Buffer.from("png")); }
}

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadRuntime({ search = "", hf = false } = {}) {
  const stage = new Element("stage");
  const overlay = new Element("overlay");
  const controls = new Element("controls");
  const replay = new Element("btn-replay");
  const sound = new Element("btn-sound");
  const voice = new Element("btn-voice");
  overlay.querySelector = () => null;
  const canvas = new Element();
  canvas.tagName = "CANVAS";
  stage.appendChild(canvas);
  const elements = { stage, overlay, controls, "btn-replay": replay, "btn-sound": sound, "btn-voice": voice };
  const documentTarget = new Target();
  const document = Object.assign(documentTarget, {
    hidden: false,
    body: new Element("body"),
    activeElement: null,
    getElementById: (id) => elements[id] || null,
    querySelector: (selector) => selector === "[data-composition-id]" && hf ? stage : null,
    createElement: () => new Element(),
  });
  const windowTarget = new Target();
  const visualViewport = Object.assign(new Target(), { width: 800, height: 1000 });
  let currentMillis = 0;
  let currentPerfNow = 0;
  let density = 1;
  let rafId = 0;
  const graphics = [];

  const context = {
    console,
    URLSearchParams,
    Map, Set, WeakMap, Promise, Math, Number, Object, Array, String, Boolean, Date,
    Error, TypeError, Infinity, NaN, JSON,
    setTimeout, clearTimeout,
    performance: { now: () => currentPerfNow },
    navigator: { connection: { saveData: false } },
    location: { search, href: `http://test/${search}`, pathname: "/" },
    document,
    SpeechSynthesisUtterance: class {},
    requestAnimationFrame: (callback) => { rafId += 1; callback(); return rafId; },
    cancelAnimationFrame: () => {},
    createCanvas: () => ({ elt: canvas, parent: () => {} }),
    createGraphics: (w, h) => {
      let graphicsDensity = 1;
      const layer = {
        width: w, height: h, densityHistory: [],
        pixelDensity(value) {
          if (value !== undefined) {
            graphicsDensity = value;
            this.densityHistory.push(value);
          }
          return graphicsDensity;
        },
        remove() {},
      };
      graphics.push(layer);
      return layer;
    },
    pixelDensity: (value) => { if (value !== undefined) density = value; return density; },
    frameRate: () => {},
    millis: () => currentMillis,
    noLoop: () => {},
    loop: () => {},
    redraw: () => {},
    noise: (x, y = 0) => ((Math.sin(x * 17 + y * 13) + 1) / 2),
    WEBGL: "webgl",
  };
  Object.assign(context, windowTarget, {
    window: context,
    self: context,
    innerWidth: 800,
    innerHeight: 1000,
    devicePixelRatio: 2,
    visualViewport,
    matchMedia: () => ({ matches: false }),
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    dispatch: windowTarget.dispatch.bind(windowTarget),
    navigator: context.navigator,
    location: context.location,
    document,
  });
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source("src/core.js"), context, { filename: "core.js" });
  vm.runInContext(source("src/input.js"), context, { filename: "input.js" });

  class AudioBusStub {
    constructor() { this.enabled = true; this.events = []; }
    init() {}
    setEnabled(value) { this.enabled = value; }
    onReplay() { this.events = []; }
    schedule() {}
    recordIntro() {}
    suspend() {}
    resume() {}
    destroy() {}
  }
  class NarrationStub {
    constructor() { this.enabled = false; }
    speak() {}
    setEnabled(value) { this.enabled = value; }
    pause() {}
    resume() {}
    stop() {}
  }
  context.Engine.AudioBus = AudioBusStub;
  context.Engine.Narration = NarrationStub;

  return {
    context,
    Engine: context.Engine,
    canvas,
    graphics,
    getDensity() { return density; },
    setMillis(value) { currentMillis = value; },
    setPerfNow(value) { currentPerfNow = value; },
  };
}

test("配置校验、工具函数与事件系统", () => {
  const { Engine } = loadRuntime();
  const packageMeta = JSON.parse(source("package.json"));
  assert.equal(Engine.VERSION, "2.0.0");
  assert.equal(packageMeta.version, Engine.VERSION);
  assert.throws(() => Engine.start({ id: "bad", width: 10, height: 10 }), /render/);
  assert.equal(Engine.u.wrap(-1, 0, 10), 9);
  assert.equal(Engine.u.map(5, 0, 10, 0, 100), 50);
  const rngA = Engine.u.rng(42), rngB = Engine.u.rng(42);
  assert.deepEqual([rngA(), rngA(), rngA()], [rngB(), rngB(), rngB()]);
  let total = 0;
  const off = Engine.on("score", (value) => { total += value; });
  Engine.emit("score", 2); off(); Engine.emit("score", 3);
  assert.equal(total, 2);
});

test("输入 reset 完整清理状态且单点自动轨迹不会产生异常速度", () => {
  const { Engine } = loadRuntime({ search: "?auto=1" });
  assert.doesNotThrow(() => new Engine.Input(null, null));
  Engine.start({
    id: "input", width: 720, height: 960, duration: 1, render() {},
    waypoints: [[0.5, 100, 200, 1]],
  });
  Engine.input.update(0.5, 1 / 60);
  assert.equal(Engine.input.active, true);
  assert.equal(Engine.input.pressed, true);
  assert.equal(Engine.input.speed, 0);
  assert.ok(Number.isFinite(Engine.input.x));
  Engine.input.D = 1;
  Engine.input.reset();
  assert.equal(Engine.input.active, false);
  assert.equal(Engine.input.pressed, false);
  assert.equal(Engine.input.speed, 0);
  assert.equal(Engine.input.D, 0);
  assert.equal(Engine.input.x, -999);
});

test("Pointer Events 按 CSS 缩放映射坐标并提供按下/释放边沿", () => {
  const { Engine, canvas } = loadRuntime();
  Engine.start({ id: "pointer", width: 720, height: 960, duration: 1, render() {} });
  Engine.canvas = canvas;
  Engine.input.attach(canvas);
  const event = (type, buttons) => ({
    type, pointerId: 1, isPrimary: true, pointerType: "pen", buttons,
    pressure: buttons ? 0.7 : 0, tiltX: 12, tiltY: -4,
    clientX: 190, clientY: 260, timeStamp: 1,
    preventDefault() {},
  });
  Engine.input._onPointerDown(event("pointerdown", 1));
  Engine.input.update(0.1, 0.1);
  assert.equal(Engine.input.x, 360);
  assert.equal(Engine.input.y, 480);
  assert.equal(Engine.input.pressure, 0.7);
  assert.equal(Engine.input.justPressed, true);
  Engine.input._onPointerUp(event("pointerup", 0));
  Engine.input.update(0.2, 0.1);
  assert.equal(Engine.input.pressed, false);
  assert.equal(Engine.input.justReleased, true);
});

test("多指输入只在整体按压状态切换时产生 aggregate 边沿", () => {
  const { Engine, canvas } = loadRuntime();
  Engine.start({ id: "multi-pointer", width: 720, height: 960, duration: 1, render() {} });
  Engine.canvas = canvas;
  Engine.input.attach(canvas);
  const pointer = (type, pointerId, buttons, isPrimary, clientX) => ({
    type, pointerId, buttons, isPrimary, pointerType: "touch",
    pressure: buttons ? 0.5 : 0,
    clientX, clientY: 260, timeStamp: pointerId,
    preventDefault() {},
  });

  Engine.input._onPointerDown(pointer("pointerdown", 1, 1, true, 100));
  Engine.input.update(0.1, 0.1);
  assert.equal(Engine.input.pressed, true);
  assert.equal(Engine.input.justPressed, true);
  assert.equal(Engine.input.justReleased, false);

  Engine.input._onPointerDown(pointer("pointerdown", 2, 1, false, 280));
  Engine.input.update(0.2, 0.1);
  assert.equal(Engine.input.pressed, true);
  assert.equal(Engine.input.pointers.length, 2);
  assert.equal(Engine.input.justPressed, false);
  assert.equal(Engine.input.justReleased, false);

  Engine.input._onPointerUp(pointer("pointerup", 2, 0, false, 280));
  Engine.input.update(0.3, 0.1);
  assert.equal(Engine.input.pressed, true);
  assert.equal(Engine.input.pointers.length, 1);
  assert.equal(Engine.input.justPressed, false);
  assert.equal(Engine.input.justReleased, false);

  Engine.input._onPointerUp(pointer("pointerup", 1, 0, true, 100));
  Engine.input.update(0.4, 0.1);
  assert.equal(Engine.input.pressed, false);
  assert.equal(Engine.input.pointers.length, 0);
  assert.equal(Engine.input.justPressed, false);
  assert.equal(Engine.input.justReleased, true);
});

test("主触点切换不会把两指间距计算成位移或速度尖峰", () => {
  const { Engine, canvas } = loadRuntime();
  Engine.start({ id: "pointer-handoff", width: 720, height: 960, duration: 1, render() {} });
  Engine.canvas = canvas;
  Engine.input.attach(canvas);
  const pointer = (type, pointerId, buttons, isPrimary, clientX, clientY) => ({
    type, pointerId, buttons, isPrimary, pointerType: "touch",
    pressure: buttons ? 0.5 : 0,
    clientX, clientY, timeStamp: pointerId,
    preventDefault() {},
  });

  Engine.input._onPointerDown(pointer("pointerdown", 1, 1, true, 50, 60));
  Engine.input.update(0.1, 0.1);
  Engine.input._onPointerMove(pointer("pointermove", 1, 1, true, 70, 80));
  Engine.input.update(0.2, 0.1);
  assert.ok(Engine.input.speed > 0);

  Engine.input._onPointerDown(pointer("pointerdown", 2, 1, false, 330, 450));
  Engine.input.update(0.3, 0.1);
  Engine.input._onPointerUp(pointer("pointerup", 1, 0, true, 70, 80));
  Engine.input.update(0.4, 0.1);

  assert.equal(Engine.input.pressed, true);
  assert.equal(Engine.input.justReleased, false);
  assert.equal(Engine.input.x, 640);
  assert.equal(Engine.input.y, 860);
  assert.equal(Engine.input.dx, 0);
  assert.equal(Engine.input.dy, 0);
  assert.equal(Engine.input.vx, 0);
  assert.equal(Engine.input.vy, 0);
  assert.equal(Engine.input.speed, 0);
});

test("鼠标 pointerup 后保留 hover 指针与活动坐标", () => {
  const { Engine, canvas } = loadRuntime();
  Engine.start({ id: "mouse-hover", width: 720, height: 960, duration: 1, render() {} });
  Engine.canvas = canvas;
  Engine.input.attach(canvas);
  const pointer = (type, buttons) => ({
    type, pointerId: 7, buttons, isPrimary: true, pointerType: "mouse",
    pressure: buttons ? 0.5 : 0,
    clientX: 190, clientY: 260, timeStamp: 1,
    preventDefault() {},
  });

  Engine.input._onPointerDown(pointer("pointerdown", 1));
  Engine.input.update(0.1, 0.1);
  Engine.input._onPointerUp(pointer("pointerup", 0));
  Engine.input.update(0.2, 0.1);

  assert.equal(Engine.input.pressed, false);
  assert.equal(Engine.input.justReleased, true);
  assert.equal(Engine.input.active, true);
  assert.equal(Engine.input.pointers.length, 1);
  assert.equal(Engine.input.pointers[0].id, 7);
  assert.equal(Engine.input.pointers[0].down, false);
  assert.equal(Engine.input.x, 360);
  assert.equal(Engine.input.y, 480);
});

test("键盘焦点转入 editable 后仍释放已跟踪按键,忽略未跟踪 keyup", () => {
  const { Engine, canvas } = loadRuntime();
  Engine.start({ id: "keyboard-focus", width: 720, height: 960, duration: 1, render() {} });
  Engine.canvas = canvas;
  Engine.input.attach(canvas);
  const editable = { tagName: "INPUT" };
  const keyEvent = (code, target) => ({
    code, key: code, repeat: false, target,
    preventDefault() {},
  });
  const emittedKeyUps = [];
  Engine.on("key:up", ({ code }) => emittedKeyUps.push(code));

  Engine.input._onKeyDown(keyEvent("KeyA", canvas));
  Engine.input.update(0.1, 0.1);
  assert.equal(Engine.input.keyDown("KeyA"), true);
  assert.equal(Engine.input.keyPressed("KeyA"), true);

  Engine.input._onKeyUp(keyEvent("KeyA", editable));
  Engine.input.update(0.2, 0.1);
  assert.equal(Engine.input.keyDown("KeyA"), false);
  assert.equal(Engine.input.keyReleased("KeyA"), true);
  assert.deepEqual(emittedKeyUps, ["KeyA"]);

  Engine.input._onKeyUp(keyEvent("KeyB", editable));
  Engine.input.update(0.3, 0.1);
  assert.equal(Engine.input.keyReleased("KeyB"), false);
  assert.deepEqual(emittedKeyUps, ["KeyA"]);
});

test("Input.detach 完整清除键盘、指针与按压状态", () => {
  const { Engine, canvas } = loadRuntime();
  Engine.start({ id: "input-detach", width: 720, height: 960, duration: 1, render() {} });
  Engine.canvas = canvas;
  Engine.input.attach(canvas);
  const pointer = {
    type: "pointerdown", pointerId: 1, buttons: 1, isPrimary: true,
    pointerType: "touch", pressure: 0.5,
    clientX: 100, clientY: 100, timeStamp: 1,
    preventDefault() {},
  };
  Engine.input._onPointerDown(pointer);
  Engine.input._onKeyDown({
    code: "Space", key: " ", repeat: false, target: canvas,
    preventDefault() {},
  });
  Engine.input.update(0.1, 0.1);
  assert.equal(Engine.input.pressed, true);
  assert.equal(Engine.input.pointers.length, 1);
  assert.equal(Engine.input.keys.has("Space"), true);

  assert.equal(Engine.input.detach(), Engine.input);
  assert.equal(Engine.input.pressed, false);
  assert.equal(Engine.input.pointers.length, 0);
  assert.equal(Engine.input.keys.size, 0);
  assert.equal(Engine.input._pointerMap.size, 0);
});

test("确定性 seek 与调用分片无关,反向 seek 会重建状态", () => {
  function run(seeks) {
    const runtime = loadRuntime({ hf: true });
    let state = 0;
    let resets = 0;
    runtime.Engine.start({
      id: "seek", width: 10, height: 10, duration: 2,
      timing: { recordStep: 0.1 },
      build() { state = 0; },
      reset() { state = 0; resets++; },
      update(dt, t) { state = state * 1.7 + t + dt; },
      render() {},
    });
    runtime.context.setup();
    for (const value of seeks) runtime.context.__hfSeek(value);
    return { state, resets, time: runtime.Engine.now() };
  }

  const direct = run([0.5]);
  const sliced = run([0.05, 0.1, 0.17, 0.31, 0.5]);
  assert.equal(direct.state, sliced.state);
  assert.equal(direct.time, 0.5);
  const backwards = run([0.5, 0.2, 0.5]);
  assert.equal(backwards.state, direct.state);
  assert.equal(backwards.resets, 1);
});

test("固定步长循环提交末步与 end,并把跨界 overflow 保留到新周期", () => {
  const runtime = loadRuntime();
  const { context, Engine } = runtime;
  let cycle = 0;
  let resets = 0;
  let ends = 0;
  const updates = [];
  const renders = [];
  Engine.start({
    id: "fixed-loop", width: 10, height: 10, duration: 0.3,
    ui: false,
    loop: true,
    timing: { fixedStep: 0.1, recordStep: 0.1 },
    update(dt, t) { updates.push({ cycle, dt, t }); },
    reset() { cycle++; resets++; },
    end() { ends++; },
    render(t) { renders.push(t); },
  });
  context.setup();

  runtime.setMillis(200); context.draw();
  runtime.setMillis(310); context.draw();

  assert.deepEqual(
    updates.filter((entry) => entry.cycle === 0).map((entry) => Number(entry.t.toFixed(6))),
    [0.1, 0.2, 0.3],
  );
  assert.equal(ends, 1);
  assert.equal(resets, 1);
  assert.ok(Math.abs(renders.at(-1) - 0.01) < 1e-9);

  runtime.setMillis(390); context.draw();
  assert.equal(updates.length, 3);
  runtime.setMillis(400); context.draw();
  assert.deepEqual(
    updates.filter((entry) => entry.cycle === 1).map((entry) => Number(entry.t.toFixed(6))),
    [0.1],
  );
  assert.equal(ends, 1);
  assert.equal(resets, 1);
});

test("循环的小幅 overflow 快进会标记 seeking", () => {
  const runtime = loadRuntime();
  const { context, Engine } = runtime;
  let cycle = 0;
  const updates = [];
  const renders = [];
  Engine.start({
    id: "loop-small-overflow", width: 10, height: 10, duration: 0.3,
    ui: false, loop: true,
    timing: { recordStep: 0.1, maxDelta: 0.05 },
    update(dt, t) { updates.push({ cycle, dt, t, seeking: Engine.seeking }); },
    reset() { cycle++; },
    render(t) { renders.push(t); },
  });
  context.setup();

  runtime.setMillis(200); context.draw();
  runtime.setMillis(310); context.draw();

  const carried = updates.filter((entry) => entry.cycle === 1);
  assert.equal(carried.length, 1);
  assert.ok(Math.abs(carried[0].dt - 0.01) < 1e-9);
  assert.ok(Math.abs(carried[0].t - 0.01) < 1e-9);
  assert.equal(carried[0].seeking, true);
  assert.ok(Math.abs(renders.at(-1) - 0.01) < 1e-9);
  assert.equal(Engine.seeking, false);
});

test("循环的长 overflow 从新周期 0 恢复且不执行快进 update", () => {
  const runtime = loadRuntime();
  const { context, Engine } = runtime;
  let cycle = 0;
  let ends = 0;
  const updates = [];
  const renders = [];
  Engine.start({
    id: "loop-long-overflow", width: 10, height: 10, duration: 0.3,
    ui: false, loop: true,
    timing: { fixedStep: 0.1, recordStep: 0.1, maxDelta: 0.05 },
    update(dt, t) { updates.push({ cycle, dt, t, seeking: Engine.seeking }); },
    reset() { cycle++; },
    end() { ends++; },
    render(t) { renders.push(t); },
  });
  context.setup();

  runtime.setMillis(200); context.draw();
  runtime.setMillis(460); context.draw();

  assert.deepEqual(
    updates.filter((entry) => entry.cycle === 0).map((entry) => Number(entry.t.toFixed(6))),
    [0.1, 0.2, 0.3],
  );
  assert.equal(updates.some((entry) => entry.cycle === 1), false);
  assert.equal(cycle, 1);
  assert.equal(ends, 1);
  assert.equal(renders.at(-1), 0);
  assert.equal(Engine.now(), 0);
  assert.equal(Engine.seeking, false);
});

test("静帧时间会被片长截断,非法 Infinity 不进入快进", () => {
  const finite = loadRuntime({ search: "?t=999" });
  let ticks = 0;
  finite.Engine.start({
    id: "static", width: 10, height: 10, duration: 1,
    timing: { recordStep: 0.1 }, update() { ticks++; }, render() {},
  });
  finite.context.setup();
  assert.equal(finite.Engine.staticT, 1);
  assert.equal(ticks, 10);

  const invalid = loadRuntime({ search: "?t=Infinity" });
  assert.equal(invalid.Engine.staticT, null);
});

test("可选 systems:关键帧、对象池、空间哈希与弹簧", () => {
  const { context, Engine } = loadRuntime();
  vm.runInContext(source("src/systems.js"), context, { filename: "systems.js" });
  const track = new Engine.KeyframeTrack([
    { t: 0, value: { x: 0, color: [0, 10] }, ease: "linear" },
    { t: 1, value: { x: 10, color: [10, 20] } },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(track.sample(0.5))), { x: 5, color: [5, 15] });

  const cues = [];
  new Engine.CueTimeline()
    .at(0, (cue) => cues.push([cue.time, cue.absoluteTime]))
    .at(0.5, (cue) => cues.push([cue.time, cue.absoluteTime]))
    .update(0.5);
  assert.deepEqual(JSON.parse(JSON.stringify(cues)), [[0, 0], [0.5, 0.5]]);

  const pool = new Engine.Pool(() => ({ alive: false }), {
    initial: 2, reset: (item) => { item.alive = true; },
  });
  const particle = pool.acquire();
  assert.equal(pool.size, 1);
  pool.release(particle);
  assert.equal(pool.size, 0);

  let disposed = 0;
  const zeroCapacityPool = new Engine.Pool(() => ({}), {
    maxSize: 0.5,
    dispose: () => { disposed++; },
  });
  const transient = zeroCapacityPool.acquire();
  assert.equal(zeroCapacityPool.maxSize, 0);
  assert.equal(zeroCapacityPool.release(transient), true);
  assert.equal(zeroCapacityPool.capacity, 0);
  assert.equal(zeroCapacityPool.available.length, 0);
  assert.equal(disposed, 1);

  const hash = new Engine.SpatialHash(20);
  const a = {}, b = {};
  hash.insert(a, 5, 5); hash.insert(b, 100, 100);
  assert.equal(hash.queryRadius(0, 0, 10)[0], a);

  const spring = new Engine.Spring(0, { frequency: 4, damping: 1 });
  spring.set(10);
  for (let i = 0; i < 120; i++) spring.update(1 / 120);
  assert.ok(Math.abs(spring.value - 10) < 0.01);

  assert.equal(track.sample(Infinity).x, 0);
  const guardedTimeline = new Engine.CueTimeline().at(1, () => {
    throw new Error("Infinity 不应触发 cue");
  });
  assert.equal(guardedTimeline.update(Infinity), guardedTimeline);
  assert.equal(guardedTimeline.time, -Number.EPSILON);

  for (const invalidSize of [0, -1, Infinity, NaN]) {
    assert.throws(() => new Engine.SpatialHash(invalidSize), /cellSize/);
  }
  assert.throws(() => hash.insert({}, Infinity, 0), /有限数字/);
  assert.throws(() => hash.insert({}, 0, 0, -1), /radius 非负/);
  assert.throws(() => hash.queryRadius(0, NaN, 10), /有限数字/);
  assert.throws(() => hash.queryRadius(0, 0, -1), /radius 非负/);

  assert.throws(() => new Engine.Spring(Infinity), /初始值/);
  assert.throws(() => new Engine.Spring(0, { frequency: 0 }), /frequency/);
  assert.throws(() => new Engine.Spring(0, { frequency: Infinity }), /frequency/);
  assert.throws(() => new Engine.Spring(0, { damping: -1 }), /damping/);
  assert.throws(() => new Engine.Spring(0, { damping: Infinity }), /damping/);
  assert.throws(() => spring.set(Infinity), /target/);
  assert.throws(() => spring.snap(NaN), /value/);
  assert.ok(Number.isFinite(spring.update(Infinity)));
});

test("numeric pixelDensity 上限为 4,仅显式自适应图层跟随运行时降级", () => {
  const runtime = loadRuntime();
  const { context, Engine, graphics } = runtime;
  let defaultLayer, adaptiveLayer, fixedAdaptiveLayer;
  Engine.start({
    id: "density", width: 320, height: 240, duration: 10,
    pixelDensity: 99,
    ui: false,
    performance: {
      adaptive: true, targetFps: 100, minPixelDensity: 1, sampleSeconds: 0.001,
    },
    build() {
      defaultLayer = Engine.layers.create("default");
      adaptiveLayer = Engine.layers.create("adaptive", { adaptiveDensity: true });
      fixedAdaptiveLayer = Engine.layers.create("fixed-adaptive", {
        pixelDensity: 2, adaptiveDensity: true,
      });
    },
    render() {},
  });

  assert.equal(Engine.cfg.pixelDensity, 4);
  context.setup();
  assert.equal(runtime.getDensity(), 4);
  assert.equal(graphics.length, 3);
  assert.equal(defaultLayer.pixelDensity(), 4);
  assert.equal(adaptiveLayer.pixelDensity(), 4);
  assert.equal(fixedAdaptiveLayer.pixelDensity(), 2);

  runtime.setPerfNow(10); context.draw();
  runtime.setPerfNow(110); context.draw();
  runtime.setPerfNow(210); context.draw();

  assert.equal(runtime.getDensity(), 3);
  assert.equal(Engine.performance.pixelDensity, 3);
  assert.equal(defaultLayer.pixelDensity(), 4);
  assert.deepEqual(defaultLayer.densityHistory, [4]);
  assert.equal(adaptiveLayer.pixelDensity(), 3);
  assert.deepEqual(adaptiveLayer.densityHistory, [4, 3]);
  assert.equal(fixedAdaptiveLayer.pixelDensity(), 2);
  assert.deepEqual(fixedAdaptiveLayer.densityHistory, [2]);
});

test("音频事件保留引擎权威的 t/type,未知配方不会进入离线日志", () => {
  const { context, Engine } = loadRuntime();
  vm.runInContext(source("src/recipes.js"), context, { filename: "recipes.js" });
  vm.runInContext(source("src/audio-bus.js"), context, { filename: "audio-bus.js" });
  const bus = new Engine.AudioBus({});
  context.__audioEvents = [];
  assert.equal(bus.emit("pluck", { t: 999, type: "fake", freq: 440 }), true);
  assert.equal(context.__audioEvents[0].t, 0);
  assert.equal(context.__audioEvents[0].type, "pluck");
  assert.equal(bus.emit("missing", { t: 1 }), false);
  assert.equal(context.__audioEvents.length, 1);

  const invalidStart = context.__audioEvents.length;
  assert.equal(bus.emit("pluck", { freq: 0 }), false);
  assert.equal(bus.emit("pluck", { freq: -440 }), false);
  assert.equal(bus.emit("pluck", { freq: Infinity }), false);
  assert.equal(bus.emit("pluck", {}), false);
  assert.equal(bus.emit("pluck", { freq: 440, gain: 0 }), false);
  assert.equal(context.__audioEvents.length, invalidStart);

  const runtimeBus = new Engine.AudioBus({ recipes: ["runtime-tone"] });
  let played = 0;
  Engine.registerRecipe("runtime-tone", {
    playNow(_audio, event) {
      played++;
      assert.equal(event.gain, 0.25);
    },
  });
  runtimeBus.live.ctx = { currentTime: 0 };
  context.__audioEvents = [];
  assert.equal(runtimeBus.emit("runtime-tone", { gain: 0.25 }), true);
  assert.equal(played, 1);
  assert.equal(context.__audioEvents.length, 1);
  assert.equal(context.__audioEvents[0].type, "runtime-tone");

  const audio = new Engine.LiveAudio();
  let disconnected = false;
  const node = { disconnect() { disconnected = true; }, onended: null };
  audio._track(node);
  assert.equal(audio._nodes.size, 1);
  node.onended();
  assert.equal(audio._nodes.size, 0);
  assert.equal(disconnected, true);
});

test("LiveAudio.setShimmer 将非有限值降为 0 并限制到 0–1", () => {
  const { context, Engine } = loadRuntime();
  vm.runInContext(source("src/recipes.js"), context, { filename: "recipes.js" });
  const audio = new Engine.LiveAudio();
  const targets = [];
  audio.ctx = { currentTime: 1 };
  audio.shimmerGain = {
    gain: {
      cancelScheduledValues() {},
      setTargetAtTime(value, now, constant) { targets.push({ value, now, constant }); },
    },
  };
  audio._lastShimmer = 0.5;

  audio.setShimmer(Infinity);
  audio.ctx.currentTime = 2;
  audio.setShimmer(9);

  assert.deepEqual(targets.map(({ value }) => value), [0, 1]);
  assert.ok(targets.every(({ value }) => Number.isFinite(value)));
  assert.deepEqual(targets.map(({ now }) => now), [1, 2]);
  assert.deepEqual(targets.map(({ constant }) => constant), [0.12, 0.12]);
});

test("插件工厂按注册参数去重,并可通过 factory 完整清理", () => {
  for (const options of [undefined, { mode: "shared-options" }]) {
    const { Engine } = loadRuntime();
    let factoryCalls = 0;
    let installCalls = 0;
    const cleanupOrder = [];
    function factory(_engine, receivedOptions) {
      factoryCalls++;
      assert.equal(receivedOptions, options);
      return {
        id: options ? "options-plugin" : "plain-plugin",
        install() {
          installCalls++;
          return () => cleanupOrder.push("cleanup");
        },
        destroy() { cleanupOrder.push("destroy"); },
      };
    }

    const first = options === undefined
      ? Engine.use(factory)
      : Engine.use(factory, options);
    const duplicate = options === undefined
      ? Engine.use(factory)
      : Engine.use(factory, options);

    assert.equal(duplicate, first);
    assert.equal(factoryCalls, 1);
    assert.equal(installCalls, 1);
    assert.equal(Engine.unuse(factory), true);
    assert.deepEqual(cleanupOrder, ["destroy", "cleanup"]);
    assert.equal(Engine.unuse(factory), false);
  }
});

test("不同插件工厂返回同一 ID 时仅销毁临时实例", () => {
  const { Engine } = loadRuntime();
  let firstInstall = 0;
  let firstDestroy = 0;
  let duplicateInstall = 0;
  let duplicateDestroy = 0;
  const firstFactory = () => ({
    id: "shared-plugin-id",
    install() { firstInstall++; },
    destroy() { firstDestroy++; },
  });
  const duplicateFactory = () => ({
    id: "shared-plugin-id",
    install() { duplicateInstall++; },
    destroy() { duplicateDestroy++; },
  });

  const installed = Engine.use(firstFactory);
  const duplicateResult = Engine.use(duplicateFactory);
  assert.equal(duplicateResult, installed);
  assert.equal(firstInstall, 1);
  assert.equal(firstDestroy, 0);
  assert.equal(duplicateInstall, 0);
  assert.equal(duplicateDestroy, 1);
  assert.equal(Engine.unuse(firstFactory), true);
  assert.equal(firstDestroy, 1);
});

test("直接插件对象同 ID 去重时不会销毁未安装的第二对象", () => {
  const { Engine } = loadRuntime();
  let firstInstall = 0;
  let firstDestroy = 0;
  let duplicateInstall = 0;
  let duplicateDestroy = 0;
  const first = {
    id: "direct-shared-id",
    install() { firstInstall++; },
    destroy() { firstDestroy++; },
  };
  const duplicate = {
    id: "direct-shared-id",
    install() { duplicateInstall++; },
    destroy() { duplicateDestroy++; },
  };

  assert.equal(Engine.use(first), first);
  assert.equal(Engine.use(duplicate), first);
  assert.equal(firstInstall, 1);
  assert.equal(firstDestroy, 0);
  assert.equal(duplicateInstall, 0);
  assert.equal(duplicateDestroy, 0);
  assert.equal(Engine.unuse(first), true);
  assert.equal(firstDestroy, 1);
  assert.equal(duplicateDestroy, 0);
});

test("浏览器与离线合成器的内置 recipe 名称保持一致", () => {
  const { context, Engine } = loadRuntime();
  vm.runInContext(source("src/recipes.js"), context, { filename: "recipes.js" });
  const browserRecipes = [...Object.keys(Engine.recipes)].sort();
  const synth = source("tools/synth.py");
  const offlineRecipes = [...synth.matchAll(/\b(?:if|elif) ty == "([^"]+)"/g)]
    .map((match) => match[1]).sort();
  assert.deepEqual(browserRecipes, offlineRecipes);
});
