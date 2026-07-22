/* ============================================================
 * engine/audio-bus.js — 音画同源事件总线
 *
 * 同一触发点,两个去向:
 *   emit(type, ev)  → 渲染/dump 模式记入 window.__audioEvents(离线合成用);
 *                     现场模式按 Engine.recipes[type] 立即播放
 *   schedule(events) → 现场开播时定点播放入场旋律
 *   recordIntro(events) → 渲染模式把入场事件写入事件日志
 *
 * 事件时间戳一律取 Engine.now()(模拟时钟),保证音画严格同步、
 * 同一固定种子下每次渲染的事件文件完全一致。
 * ============================================================ */
"use strict";

const ENGINE_FREQ_RECIPES = new Set(["pluck", "takeoff", "land", "strum"]);

Engine.AudioBus = class {
  constructor(audioCfg) {
    this.live = new Engine.LiveAudio();
    const names = audioCfg && audioCfg.recipes ? audioCfg.recipes : null;
    this.allowedRecipes = names ? new Set(names) : null;
    this.recipes = Object.create(null);
    for (const k of Object.keys(Engine.recipes)) {
      if (!this.allowedRecipes || this.allowedRecipes.has(k)) this.recipes[k] = Engine.recipes[k];
    }
    this.enabled = !Engine.muted;
    this.live.enabled = this.enabled;
    this._last = {};      // 各 type 上次触发时刻(限流用)
    this._warned = new Set();
  }

  init() {
    const ctx = this.live.init();
    if (!ctx) {
      this.enabled = false;
      this.live.enabled = false;
      this._warn("unavailable", "Web Audio 不可用,已切换为静音");
      Engine.emit("audio:unavailable", { bus: this });
    }
    return ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    this.live.setEnabled(on);
  }

  setShimmer(v) { this.live.setShimmer(v); }
  suspend() { return this.live.suspend(); }
  resume() { return this.live.resume(); }
  destroy() { return this.live.destroy(); }

  /* 重播:清限流记录,停掉上一轮调度出去的音符(intro 等) */
  onReplay() {
    this._last = {};
    this.live.stopAll();
  }

  emit(type, ev) {
    const r = this._recipe(type);
    if (!r) {
      this._warn(`unknown:${type}`, `未注册或未启用音效配方: ${type}`);
      Engine.emit("audio:error", { reason: "unknown-recipe", type, event: ev });
      return false;
    }
    const event = this._normalize(type, ev);
    if (!event) return false;
    const now = Engine.now();
    if (r.minInterval) {
      const last = this._last[type] === undefined ? -99 : this._last[type];
      if (now - last < r.minInterval) return false;
      this._last[type] = now;
    }
    if (window.__audioEvents) {
      window.__audioEvents.push(Object.assign({}, event, { t: now, type }));
    }
    if (!this.live.ctx || !this.enabled || Engine.seeking || !r.playNow) return true;
    try { r.playNow(this.live, event); }
    catch (error) {
      Engine.emit("audio:error", { reason: "play", type, event, error });
      console.warn(`[Engine audio] 播放 ${type} 失败`, error);
      return false;
    }
    return true;
  }

  /* 现场开播:按事件 t 定点调度(默认 pluck) */
  schedule(events) {
    if (!this.live.ctx || !this.enabled || !Array.isArray(events)) return;
    const t0 = this.live.ctx.currentTime + 0.06;
    for (const ev of events) {
      if (!ev || typeof ev !== "object") {
        this._warn("schedule:event", "入场音效事件必须是对象");
        continue;
      }
      const type = ev.type || "pluck";
      const r = this._recipe(type);
      if (!r) {
        this._warn(`schedule:${type}`, `入场音效使用了未知配方: ${type}`);
      } else if (!r.schedule) {
        this._warn(`schedule:${type}`, `音效配方 ${type} 不支持定点 schedule`);
      } else if (Number.isFinite(ev.t) && ev.t >= 0) {
        const event = this._normalize(type, ev);
        if (!event) continue;
        try { r.schedule(this.live, t0 + ev.t, Object.assign(event, { t: ev.t, type })); }
        catch (error) { Engine.emit("audio:error", { reason: "schedule", type, event, error }); }
      } else {
        this._warn(`time:${type}`, `音效 ${type} 的 t 必须是非负数字`);
        Engine.emit("audio:error", { reason: "invalid-time", type, event: ev });
      }
    }
  }

  /* 渲染模式:入场事件写入日志 */
  recordIntro(events) {
    if (!window.__audioEvents || !Array.isArray(events)) return;
    for (const ev of events) {
      if (!ev || typeof ev !== "object") {
        this._warn("record:event", "离线音效事件必须是对象");
        continue;
      }
      const type = ev.type || "pluck";
      if (!this._recipe(type)) {
        this._warn(`record:${type}`, `离线音轨忽略未知配方: ${type}`);
        continue;
      }
      if (!Number.isFinite(ev.t) || ev.t < 0) {
        this._warn(`time:${type}`, `音效 ${type} 的 t 必须是非负数字`);
        continue;
      }
      const event = this._normalize(type, ev);
      if (event) window.__audioEvents.push(Object.assign(event, { t: ev.t, type }));
    }
  }

  _recipe(type) {
    if (this.allowedRecipes && !this.allowedRecipes.has(type)) return null;
    const recipe = Object.prototype.hasOwnProperty.call(Engine.recipes, type)
      ? Engine.recipes[type] : null;
    if (recipe) this.recipes[type] = recipe;
    return recipe;
  }

  _normalize(type, value) {
    const event = value && typeof value === "object" ? Object.assign({}, value) : {};
    delete event.t;
    delete event.type;
    if ((ENGINE_FREQ_RECIPES.has(type) && event.freq === undefined)
        || (event.freq !== undefined && !(Number.isFinite(event.freq) && event.freq > 0))) {
      this._warn(`freq:${type}`, `音效 ${type} 需要大于 0 的 freq`);
      Engine.emit("audio:error", { reason: "invalid-freq", type, event });
      return null;
    }
    if (event.freq !== undefined) event.freq = Math.max(10, Math.min(24000, event.freq));
    const positive = { pitch: [0.05, 8], decay: [0.01, 30], dur: [0.01, 30] };
    for (const [key, [min, max]] of Object.entries(positive)) {
      if (event[key] === undefined) continue;
      if (!Number.isFinite(event[key]) || event[key] <= 0) {
        this._warn(`${key}:${type}`, `音效 ${type} 的 ${key} 必须大于 0`);
        Engine.emit("audio:error", { reason: `invalid-${key}`, type, event });
        return null;
      }
      event[key] = Math.max(min, Math.min(max, event[key]));
    }
    if (event.gain !== undefined) {
      if (!Number.isFinite(event.gain) || event.gain <= 0) {
        this._warn(`gain:${type}`, `音效 ${type} 的 gain 必须大于 0`);
        Engine.emit("audio:error", { reason: "invalid-gain", type, event });
        return null;
      }
      event.gain = Math.max(0.0005, Math.min(2, event.gain));
    }
    return event;
  }

  _warn(key, message) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[Engine audio] ${message}`);
  }
};

/* ---------------- 可选:中文旁白(Web Speech,仅现场) ---------------- */
Engine.Narration = class {
  constructor() {
    this.enabled = false;
    this._timers = [];
    this._lines = [];
    this._paused = false;
  }
  setEnabled(on) {
    this.enabled = on;
    if (!on) { this._clear(); this._cancel(); }
  }
  _clear() { this._timers.forEach(clearTimeout); this._timers = []; }
  _cancel() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
  speak(lines, offset = 0) {
    this._clear();
    this._lines = Array.isArray(lines)
      ? lines.filter((line) => line && Number.isFinite(line.t) && typeof line.text === "string")
      : [];
    this._paused = false;
    if (!this.enabled || !("speechSynthesis" in window)) return;
    this._cancel();
    for (const { t, text } of this._lines) {
      if (t < offset) continue;
      this._timers.push(setTimeout(() => {
        if (!this.enabled) return;
        const Utterance = window.SpeechSynthesisUtterance;
        if (!Utterance) return;
        const u = new Utterance(text);
        u.lang = "zh-CN";
        u.rate = 0.92; u.pitch = 0.9; u.volume = 0.85;
        window.speechSynthesis.speak(u);
      }, Math.max(0, t - offset) * 1000));
    }
  }
  pause() { this._paused = true; this._clear(); this._cancel(); }
  resume(offset = 0) {
    if (!this._paused) return;
    const lines = this._lines;
    this.speak(lines, offset);
  }
  stop() { this._paused = false; this._lines = []; this._clear(); this._cancel(); }
};
