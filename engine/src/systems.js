/* ============================================================
 * engine/systems.js — 可选的创意编码 / 游戏开发基础系统
 *
 * 不依赖打包器,在 core.js 之后加载即可:
 *   Engine.CueTimeline  时间提示与区间轨道
 *   Engine.KeyframeTrack 数值/数组/对象关键帧采样
 *   Engine.Pool         粒子与短生命对象复用
 *   Engine.SpatialHash  大量对象的邻域查询
 *   Engine.Spring       稳定的标量弹簧
 * ============================================================ */
"use strict";

(function (Engine) {
  if (!Engine) throw new Error("systems.js 必须在 core.js 之后加载");

  class CueTimeline {
    constructor(options = {}) {
      this.duration = Number.isFinite(options.duration) && options.duration > 0
        ? options.duration : Infinity;
      this.loop = options.loop === true;
      this.maxLoopCatchUp = Math.max(1, Math.floor(options.maxLoopCatchUp || 8));
      this._cues = [];
      this._ranges = [];
      this.reset();
    }

    at(time, callback, id) {
      if (!Number.isFinite(time) || time < 0 || typeof callback !== "function") {
        throw new TypeError("timeline.at(time, callback) 参数无效");
      }
      this._cues.push({ time, callback, id: id || `cue-${this._cues.length}` });
      this._cues.sort((a, b) => a.time - b.time);
      return this;
    }

    during(start, end, callback, id) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
          || typeof callback !== "function") {
        throw new TypeError("timeline.during(start, end, callback) 参数无效");
      }
      this._ranges.push({ start, end, callback, id: id || `range-${this._ranges.length}` });
      return this;
    }

    remove(id) {
      const before = this._cues.length + this._ranges.length;
      this._cues = this._cues.filter((cue) => cue.id !== id);
      this._ranges = this._ranges.filter((range) => range.id !== id);
      return before !== this._cues.length + this._ranges.length;
    }

    reset(time = -Number.EPSILON) {
      this.time = time;
      this.cycle = 0;
      return this;
    }

    _fireWindow(from, to, cycle, context) {
      for (const cue of this._cues) {
        if (cue.time > from && cue.time <= to + 1e-12) {
          cue.callback({
            id: cue.id, time: cue.time, cycle,
            absoluteTime: Number.isFinite(this.duration)
              ? cycle * this.duration + cue.time : cue.time,
            context,
          });
        }
      }
    }

    update(rawTime, context) {
      const numericTime = Number(rawTime);
      if (!Number.isFinite(numericTime)) return this;
      const time = Math.max(0, numericTime);
      if (time < this.time) this.reset();

      if (this.loop && Number.isFinite(this.duration)) {
        const fromCycle = Math.max(0, Math.floor(Math.max(0, this.time) / this.duration));
        const toCycle = Math.floor(time / this.duration);
        const firstLocal = this.time < 0 ? -Number.EPSILON : this.time % this.duration;
        const loops = Math.min(toCycle - fromCycle, this.maxLoopCatchUp);
        if (toCycle === fromCycle) {
          this._fireWindow(firstLocal, time % this.duration, toCycle, context);
        } else {
          this._fireWindow(firstLocal, this.duration, fromCycle, context);
          for (let i = 1; i < loops; i++) this._fireWindow(-Number.EPSILON, this.duration, fromCycle + i, context);
          this._fireWindow(-Number.EPSILON, time % this.duration, toCycle, context);
        }
        this.cycle = toCycle;
      } else {
        this._fireWindow(this.time, time, 0, context);
      }

      const local = this.loop && Number.isFinite(this.duration) ? time % this.duration : time;
      for (const range of this._ranges) {
        if (local < range.start || local > range.end) continue;
        range.callback({
          id: range.id,
          time: local,
          progress: Engine.u.clamp01((local - range.start) / (range.end - range.start)),
          cycle: this.cycle,
          context,
        });
      }
      this.time = time;
      return this;
    }
  }

  function interpolateValue(a, b, p) {
    if (typeof a === "number" && typeof b === "number") return Engine.u.mix(a, b, p);
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.map((value, index) => interpolateValue(value, b[index], p));
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const out = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        out[key] = key in a && key in b ? interpolateValue(a[key], b[key], p) : (key in b ? b[key] : a[key]);
      }
      return out;
    }
    return p < 1 ? a : b;
  }

  class KeyframeTrack {
    constructor(frames, options = {}) {
      if (!Array.isArray(frames) || !frames.length) throw new TypeError("KeyframeTrack 需要关键帧数组");
      this.frames = frames.map((frame) => {
        if (!frame || !Number.isFinite(frame.t) || !("value" in frame)) {
          throw new TypeError("关键帧格式应为 {t, value, ease?}");
        }
        return Object.assign({}, frame);
      }).sort((a, b) => a.t - b.t);
      this.loop = options.loop === true;
      const defaultDuration = this.frames[this.frames.length - 1].t;
      this.duration = options.duration === undefined ? defaultDuration : Number(options.duration);
      if (!Number.isFinite(this.duration) || (this.loop && this.duration <= 0)) {
        throw new TypeError("循环 KeyframeTrack 的 duration 必须大于 0");
      }
      this.easings = Object.assign({
        linear: (p) => p,
        smooth: (p) => Engine.u.ramp(0, 1, p),
        smoother: (p) => Engine.u.smootherstep(0, 1, p),
        outCubic: Engine.u.easeOutCubic,
      }, options.easings || {});
    }

    sample(rawTime) {
      const numericTime = Number(rawTime);
      let time = Number.isFinite(numericTime) ? numericTime : 0;
      if (this.loop && this.duration > 0) time = Engine.u.wrap(time, 0, this.duration);
      if (time <= this.frames[0].t) return interpolateValue(this.frames[0].value, this.frames[0].value, 0);
      const last = this.frames[this.frames.length - 1];
      if (time >= last.t) return interpolateValue(last.value, last.value, 0);
      let lo = 0, hi = this.frames.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (this.frames[mid].t <= time) lo = mid;
        else hi = mid;
      }
      const a = this.frames[lo], b = this.frames[hi];
      const rawP = (time - a.t) / (b.t - a.t || 1);
      const ease = typeof a.ease === "function" ? a.ease : (this.easings[a.ease || "smooth"] || this.easings.smooth);
      return interpolateValue(a.value, b.value, Engine.u.clamp01(ease(rawP)));
    }
  }

  class Pool {
    constructor(factory, options = {}) {
      if (typeof factory !== "function") throw new TypeError("Pool 需要 factory 函数");
      this.factory = factory;
      this.resetItem = typeof options.reset === "function" ? options.reset : null;
      this.disposeItem = typeof options.dispose === "function" ? options.dispose : null;
      this.maxSize = Number.isFinite(options.maxSize)
        ? Math.max(0, Math.floor(options.maxSize)) : Infinity;
      this.available = [];
      this.active = new Set();
      this.prewarm(options.initial || 0);
    }

    prewarm(count) {
      const numericCount = Number(count);
      if (!Number.isFinite(numericCount) || numericCount <= 0) return this;
      const amount = Math.max(0, Math.min(Math.floor(numericCount), this.maxSize - this.available.length));
      for (let i = 0; i < amount; i++) this.available.push(this.factory());
      return this;
    }

    acquire(...args) {
      const item = this.available.pop() || this.factory(...args);
      if (this.resetItem) this.resetItem(item, ...args);
      this.active.add(item);
      return item;
    }

    release(item) {
      if (!this.active.delete(item)) return false;
      if (this.available.length < this.maxSize) this.available.push(item);
      else if (this.disposeItem) this.disposeItem(item);
      return true;
    }

    update(callback) {
      for (const item of [...this.active]) {
        if (callback(item) === false) this.release(item);
      }
    }

    clear() {
      if (this.disposeItem) {
        for (const item of this.active) this.disposeItem(item);
        for (const item of this.available) this.disposeItem(item);
      }
      this.active.clear();
      this.available.length = 0;
    }

    get size() { return this.active.size; }
    get capacity() { return this.active.size + this.available.length; }
  }

  class SpatialHash {
    constructor(cellSize = 64) {
      if (!Number.isFinite(cellSize) || cellSize <= 0) throw new TypeError("cellSize 必须大于 0");
      this.cellSize = cellSize;
      this.cells = new Map();
      this.entries = new Map();
    }

    _key(x, y) { return `${x},${y}`; }
    _range(x, y, radius) {
      return {
        minX: Math.floor((x - radius) / this.cellSize),
        maxX: Math.floor((x + radius) / this.cellSize),
        minY: Math.floor((y - radius) / this.cellSize),
        maxY: Math.floor((y + radius) / this.cellSize),
      };
    }

    insert(item, x, y, radius = 0) {
      if (![x, y, radius].every(Number.isFinite) || radius < 0) {
        throw new TypeError("SpatialHash.insert 的 x/y/radius 必须是有限数字且 radius 非负");
      }
      this.remove(item);
      const entry = { item, x, y, radius: Math.max(0, radius), keys: [] };
      const range = this._range(x, y, entry.radius);
      for (let cy = range.minY; cy <= range.maxY; cy++) {
        for (let cx = range.minX; cx <= range.maxX; cx++) {
          const key = this._key(cx, cy);
          const bucket = this.cells.get(key) || new Set();
          bucket.add(item);
          this.cells.set(key, bucket);
          entry.keys.push(key);
        }
      }
      this.entries.set(item, entry);
      return item;
    }

    update(item, x, y, radius = 0) { return this.insert(item, x, y, radius); }

    remove(item) {
      const entry = this.entries.get(item);
      if (!entry) return false;
      for (const key of entry.keys) {
        const bucket = this.cells.get(key);
        if (!bucket) continue;
        bucket.delete(item);
        if (!bucket.size) this.cells.delete(key);
      }
      this.entries.delete(item);
      return true;
    }

    queryRadius(x, y, radius, filter) {
      if (![x, y, radius].every(Number.isFinite) || radius < 0) {
        throw new TypeError("SpatialHash.queryRadius 的 x/y/radius 必须是有限数字且 radius 非负");
      }
      const range = this._range(x, y, radius);
      const found = new Set();
      for (let cy = range.minY; cy <= range.maxY; cy++) {
        for (let cx = range.minX; cx <= range.maxX; cx++) {
          const bucket = this.cells.get(this._key(cx, cy));
          if (!bucket) continue;
          for (const item of bucket) {
            if (found.has(item)) continue;
            const entry = this.entries.get(item);
            const reach = radius + entry.radius;
            const dx = entry.x - x, dy = entry.y - y;
            if (dx * dx + dy * dy <= reach * reach && (!filter || filter(item, entry))) found.add(item);
          }
        }
      }
      return [...found];
    }

    clear() { this.cells.clear(); this.entries.clear(); }
    get size() { return this.entries.size; }
  }

  class Spring {
    constructor(value = 0, options = {}) {
      const initial = Number(value);
      if (!Number.isFinite(initial)) throw new TypeError("Spring 初始值必须是有限数字");
      const frequency = options.frequency === undefined ? 5 : Number(options.frequency);
      const damping = options.damping === undefined ? 0.85 : Number(options.damping);
      if (!Number.isFinite(frequency) || frequency <= 0) {
        throw new TypeError("Spring frequency 必须大于 0");
      }
      if (!Number.isFinite(damping) || damping < 0) {
        throw new TypeError("Spring damping 必须是非负数字");
      }
      this.value = initial;
      this.target = initial;
      this.velocity = 0;
      this.frequency = frequency;
      this.damping = damping;
    }

    set(target) {
      const value = Number(target);
      if (!Number.isFinite(value)) throw new TypeError("Spring target 必须是有限数字");
      this.target = value;
      return this;
    }
    snap(value) {
      const next = Number(value);
      if (!Number.isFinite(next)) throw new TypeError("Spring value 必须是有限数字");
      this.value = next; this.target = next; this.velocity = 0;
      return this;
    }

    update(dt) {
      // 将长帧拆开,半隐式积分对交互弹簧足够稳定。
      let remaining = Math.max(0, Math.min(Number(dt) || 0, 0.25));
      const maxStep = 1 / 120;
      while (remaining > 1e-9) {
        const step = Math.min(maxStep, remaining);
        const omega = Math.PI * 2 * this.frequency;
        const acceleration = (this.target - this.value) * omega * omega
          - 2 * this.damping * omega * this.velocity;
        this.velocity += acceleration * step;
        this.value += this.velocity * step;
        remaining -= step;
      }
      return this.value;
    }
  }

  Engine.CueTimeline = CueTimeline;
  Engine.KeyframeTrack = KeyframeTrack;
  Engine.Pool = Pool;
  Engine.SpatialHash = SpatialHash;
  Engine.Spring = Spring;
})(window.Engine);
