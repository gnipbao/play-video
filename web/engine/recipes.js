/* ============================================================
 * engine/recipes.js — Web Audio 现场合成原语 + 音效配方注册表
 *
 * LiveAudio:纯 Web Audio 合成(无任何素材文件)
 *   pluck   三角波拨弦,快攻慢衰 + 起音噪声(gliss=true 音高急降)
 *   whoosh  白噪声 + 带通扫频(风声)
 *   type    打字机击键:金属 tick + 腔体 clack + 低频 thump(pitch 逐键微抖)
 *   carriage 打字机回车:擦键 zip + 铃 ding
 *   shimmer 持续噪声微光,增益随扰动起伏
 *
 * Engine.recipes:事件 type → 现场播法。离线合成(tools/synth.py)
 * 用同名同参配方——新增音效必须两处对齐(见 ENGINE.md)。
 *   schedule:开场旋律等定点播放;playNow:交互触发的即时播放
 *   minInterval:同类事件最小间隔(限流,防密集触发)
 * ============================================================ */
"use strict";

Engine.LiveAudio = class {
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

  /* 停掉所有已调度/在响的节点(重播时用);短音效 stop 未触发节点会报错,吞掉 */
  stopAll() {
    for (const n of this._nodes) { try { n.stop(); } catch (e) { /* 已停过的忽略 */ } }
    this._nodes = [];
  }

  _noiseBuffer(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* 噪声微光:扰动时的"空气感" */
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

  /* 拨弦:三角波快攻慢衰 + 起音噪声;gliss=true 时音高急速下滑 */
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

  /* 打字机击键:金属 tick + 木腔 clack + 字锤 thump;pitch 逐键微抖 */
  type(t, gain = 0.09, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // tick:极短高频噪声,击键金属锋
    const nb = ctx.createBufferSource();
    nb.buffer = this._noiseBuffer(0.025);
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass"; hp.frequency.value = 4200 * pitch; hp.Q.value = 0.9;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(gain * 0.9, t);
    g1.gain.exponentialRampToValueAtTime(0.0004, t + 0.025);
    nb.connect(hp); hp.connect(g1); g1.connect(this.master);
    nb.start(t); nb.stop(t + 0.03);
    // clack:中频腔体
    const cb = ctx.createBufferSource();
    cb.buffer = this._noiseBuffer(0.07);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1600 * pitch; bp.Q.value = 1.6;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(gain * 0.8, t);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + 0.07);
    cb.connect(bp); bp.connect(g2); g2.connect(this.master);
    cb.start(t); cb.stop(t + 0.08);
    // thump:字锤击辊低频(170→85Hz)
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(170 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(85 * pitch, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0004, t + 0.06);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.07);
    this._nodes.push(nb, cb, o);
  }

  /* 回车:擦键 zip(噪声上扫) + 铃 ding(C7 + 非谐泛音) */
  carriage(t, gain = 0.06) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * 0.8, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
    const t0 = t + 0.14;
    const o = ctx.createOscillator();
    o.type = "triangle"; o.frequency.value = 2093;
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain, t0);
    og.gain.exponentialRampToValueAtTime(0.0004, t0 + 1.2);
    o.connect(og); og.connect(this.master);
    o.start(t0); o.stop(t0 + 1.3);
    const o2 = ctx.createOscillator();
    o2.type = "sine"; o2.frequency.value = 2093 * 2.76;   // 非谐泛音,更像铃
    const og2 = ctx.createGain();
    og2.gain.setValueAtTime(gain * 0.35, t0);
    og2.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.5);
    o2.connect(og2); og2.connect(this.master);
    o2.start(t0); o2.stop(t0 + 0.6);
    this._nodes.push(src, o, o2);
  }
};

/* ---------------- 音效配方(与 tools/synth.py 同名对齐) ---------------- */
Engine.recipes = {
  pluck: {
    schedule(a, when, ev) {
      a.pluck(when, ev.freq,
        ev.gain === undefined ? 0.10 : ev.gain,
        ev.decay === undefined ? 1.1 : ev.decay);
    },
    playNow(a, ev) {
      a.pluck(a.ctx.currentTime, ev.freq,
        ev.gain === undefined ? 0.08 : ev.gain,
        ev.decay === undefined ? 0.8 : ev.decay);
    },
  },
  takeoff: {
    minInterval: 0.06,   // 限流:群体惊飞时不至于糊成一片
    playNow(a, ev) {
      a.pluck(a.ctx.currentTime, ev.freq, 0.07, 0.5, true);   // 下滑音
      a.whoosh(a.ctx.currentTime, 0.7 + Math.random() * 0.3, 0.035 + Math.random() * 0.02);
    },
  },
  land: {
    playNow(a, ev) { a.pluck(a.ctx.currentTime, ev.freq, 0.05, 1.0); },
  },
  strum: {
    playNow(a, ev) {
      a.pluck(a.ctx.currentTime, ev.freq,
        ev.gain === undefined ? 0.03 : ev.gain, 1.3);
    },
  },
  type: {
    minInterval: 0.03,   // 限流:连打时不至于糊成一片
    playNow(a, ev) {
      a.type(a.ctx.currentTime,
        ev.gain === undefined ? 0.09 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
  carriage: {
    playNow(a, ev) {
      a.carriage(a.ctx.currentTime, ev.gain === undefined ? 0.06 : ev.gain);
    },
  },
};
