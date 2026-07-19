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

Engine.AudioBus = class {
  constructor(audioCfg) {
    this.live = new Engine.LiveAudio();
    const names = audioCfg && audioCfg.recipes ? audioCfg.recipes : null;
    this.recipes = {};
    for (const k of Object.keys(Engine.recipes)) {
      if (!names || names.includes(k)) this.recipes[k] = Engine.recipes[k];
    }
    this.enabled = !Engine.muted;
    this.live.enabled = this.enabled;
    this._last = {};      // 各 type 上次触发时刻(限流用)
  }

  init() { this.live.init(); }

  setEnabled(on) {
    this.enabled = on;
    this.live.setEnabled(on);
  }

  setShimmer(v) { this.live.setShimmer(v); }

  /* 重播:清限流记录,停掉上一轮调度出去的音符(intro 等) */
  onReplay() {
    this._last = {};
    this.live.stopAll();
  }

  emit(type, ev) {
    const r = this.recipes[type];
    const now = Engine.now();
    if (r && r.minInterval) {
      const last = this._last[type] === undefined ? -99 : this._last[type];
      if (now - last < r.minInterval) return;
      this._last[type] = now;
    }
    if (window.__audioEvents) {
      window.__audioEvents.push(Object.assign({ t: now, type }, ev));
    }
    if (!this.live.ctx || !this.enabled || !r || !r.playNow) return;
    r.playNow(this.live, ev || {});
  }

  /* 现场开播:按事件 t 定点调度(默认 pluck) */
  schedule(events) {
    if (!this.live.ctx || !this.enabled) return;
    const t0 = this.live.ctx.currentTime + 0.06;
    for (const ev of events) {
      const r = this.recipes[ev.type || "pluck"];
      if (r && r.schedule) r.schedule(this.live, t0 + ev.t, ev);
    }
  }

  /* 渲染模式:入场事件写入日志 */
  recordIntro(events) {
    if (!window.__audioEvents) return;
    for (const ev of events) {
      window.__audioEvents.push(Object.assign({ type: "pluck" }, ev));
    }
  }
};

/* ---------------- 可选:中文旁白(Web Speech,仅现场) ---------------- */
Engine.Narration = class {
  constructor() { this.enabled = false; this._timers = []; }
  setEnabled(on) {
    this.enabled = on;
    if (!on) { this._clear(); speechSynthesis.cancel(); }
  }
  _clear() { this._timers.forEach(clearTimeout); this._timers = []; }
  speak(lines) {
    this._clear();
    if (!this.enabled || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    for (const { t, text } of lines) {
      this._timers.push(setTimeout(() => {
        if (!this.enabled) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN";
        u.rate = 0.92; u.pitch = 0.9; u.volume = 0.85;
        speechSynthesis.speak(u);
      }, t * 1000));
    }
  }
  stop() { this._clear(); if ("speechSynthesis" in window) speechSynthesis.cancel(); }
};
