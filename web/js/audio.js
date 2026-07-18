/* ============================================================
 * audio.js — Web Audio 合成的配乐与音效(交互版)
 *   - 入场:按曲谱音级依次"拨弦"奏出旋律
 *   - 事件音效:惊飞(下滑拨弦+风声)/ 归位(轻拨)/ 划谱拨弦
 *   - 鼠标扰动时的噪声微光(shimmer)
 *   - 无持续背景 pad(避免嗡嗡底噪),安静时只有动作触发的声音
 * ============================================================ */
"use strict";

class ScoreAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.shimmerGain = null;
    this.enabled = true;
    this._nodes = [];
  }

  /* 必须在用户手势后调用 */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this._shimmer();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  _noiseBuffer(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* 噪声微光:鼠标扰动时的"空气感" */
  _shimmer() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start();
    this.shimmerGain = g;
  }

  setShimmer(v) {
    if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
  }

  /* 拨弦:三角波快攻慢衰 + 起音噪声;gliss=true 时音高急速下滑(惊飞感) */
  pluck(t, freq, gain = 0.12, decay = 0.9, gliss = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + decay);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2400; lp.Q.value = 0.6;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    if (gliss) o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.22);
    o.connect(g); g.connect(lp); lp.connect(this.master);
    o.start(t); o.stop(t + decay + 0.1);
    const nb = ctx.createBufferSource();
    nb.buffer = this._noiseBuffer(0.03);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0004, t + 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1500;
    nb.connect(ng); ng.connect(hp); hp.connect(this.master);
    nb.start(t);
    this._nodes.push(o, nb);
  }

  pluckNow(freq, gain = 0.08, decay = 0.8, gliss = false) {
    if (!this.ctx || !this.enabled) return;
    this.pluck(this.ctx.currentTime, freq, gain, decay, gliss);
  }

  /* 风声 whoosh:白噪声 + 带通扫频 */
  whoosh(t, dur = 0.8, gain = 0.045) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(520, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
    this._nodes.push(src);
  }

  whooshNow(gain = 0.04) {
    if (!this.ctx || !this.enabled) return;
    this.whoosh(this.ctx.currentTime, 0.7 + Math.random() * 0.3, gain);
  }

  /* 入场配乐:按曲谱音高依次拨弦(t0 = ctx 起点时刻,events=[{t,semi}]) */
  scheduleIntro(t0, events) {
    for (const ev of events) {
      this.pluck(t0 + ev.t, 440 * Math.pow(2, ev.semi / 12), 0.10, 1.1);
    }
    // 入场完成后一个轻柔的收尾泛音
    const last = events.length ? events[events.length - 1].t : 4;
    this.pluck(t0 + last + 0.9, 880, 0.05, 2.4);
  }
}

/* ---------------- 可选:中文旁白(Web Speech) ---------------- */
class Narration {
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
}
