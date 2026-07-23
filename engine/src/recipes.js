/* ============================================================
 * engine/recipes.js — Web Audio 现场合成原语 + 音效配方注册表
 *
 * LiveAudio:纯 Web Audio 合成(无任何素材文件)
 *   pluck   三角波拨弦,快攻慢衰 + 起音噪声(gliss=true 音高急降)
 *   whoosh  白噪声 + 带通扫频(风声)
 *   type    打字机击键:金属 tick + 腔体 clack + 低频 thump(pitch 逐键微抖)
 *   carriage 打字机回车:擦键 zip + 铃 ding
 *   knock   木关节碰撞:短噪声过木质腔体带通 + 低频 thump(pitch 微抖)
 *   crack   纸面裂开:连续撕裂刮擦 + 细小高频碎屑
 *   brush   运笔:带通噪声柔和下扫(书写)
 *   flutter 扑翼:一串短噪声脉冲(鸟群扇翅)
 *   blip    水泡:正弦快速上滑(鱼/气泡)
 *   stream  水流:持续噪声过低通 + 增益起伏(ev 带 dur,只走 schedule 编排)
 *   chirp   燕鸣:两短一长啁啾(高频正弦快上快下)
 *   swish   拨水:短噪声带通慢扫(摆尾推进)
 *   shimmer 持续噪声微光,增益随扰动起伏
 *
 * Engine.recipes:事件 type → 现场播法。离线合成(engine/tools/synth.py)
 * 用同名同参配方——新增音效必须两处对齐(见 engine/DEVELOPMENT.md)。
 *   schedule:开场旋律等定点播放;playNow:交互触发的即时播放
 *   minInterval:同类事件最小间隔(限流,防密集触发)
 * ============================================================ */
"use strict";

Engine.LiveAudio = class {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.shimmerGain = null;
    this.shimmerSource = null;
    this.shimmerFilter = null;
    this.enabled = true;
    this._nodes = new Map();
    this._noiseCache = new Map();
    this._noiseSamples = 0;
    this._maxNoiseSeconds = 60;
    this._lastShimmer = 0;
    this._lastShimmerAt = -1;
    this._stateChange = Promise.resolve();
  }

  /* 必须在用户手势后调用 */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.enabled = false;
      console.warn("当前浏览器不支持 Web Audio,场景将以静音运行");
      return null;
    }
    try {
      this.ctx = new AC();
    } catch (error) {
      this.enabled = false;
      this.ctx = null;
      Engine.emit("audio:error", { reason: "context-create", error });
      console.warn("无法创建 AudioContext,场景将以静音运行", error);
      return null;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.compressor = comp;

    this._shimmer();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  /* 停掉所有已调度/在响的节点(重播时用);短音效 stop 未触发节点会报错,吞掉 */
  stopAll() {
    for (const [source, chain] of [...this._nodes]) {
      try { source.onended = null; source.stop(); } catch (e) { /* 已停过的忽略 */ }
      for (const node of chain) {
        try { node.disconnect(); } catch (e) { /* 已断开的忽略 */ }
      }
    }
    this._nodes.clear();
    if (this.shimmerGain && this.ctx) {
      this.shimmerGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.shimmerGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    this._lastShimmer = 0;
    this._lastShimmerAt = -1;
  }

  _noiseBuffer(dur) {
    const bucket = dur <= 0.5
      ? Math.ceil(dur * 100) / 100
      : Math.ceil(Math.min(dur, 30) * 10) / 10;
    const key = bucket.toFixed(2);
    if (this._noiseCache.has(key)) {
      const cached = this._noiseCache.get(key);
      // LRU:读取后移到末尾。
      this._noiseCache.delete(key);
      this._noiseCache.set(key, cached);
      return cached.buffer;
    }
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * bucket));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const budget = this.ctx.sampleRate * this._maxNoiseSeconds;
    while (this._noiseCache.size && this._noiseSamples + n > budget) {
      const oldestKey = this._noiseCache.keys().next().value;
      const oldest = this._noiseCache.get(oldestKey);
      this._noiseSamples -= oldest.samples;
      this._noiseCache.delete(oldestKey);
    }
    this._noiseCache.set(key, { buffer: buf, samples: n });
    this._noiseSamples += n;
    return buf;
  }

  _track(source, ...voiceNodes) {
    if (!source) return source;
    const chain = [source, ...voiceNodes];
    this._nodes.set(source, chain);
    source.onended = () => {
      this._nodes.delete(source);
      for (const node of chain) {
        try { node.disconnect(); } catch (e) { /* 已断开的忽略 */ }
      }
    };
    return source;
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
    this.shimmerSource = src;
    this.shimmerFilter = bp;
  }

  setShimmer(v) {
    if (!this.shimmerGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const numeric = Number(v);
    const value = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
    if (now - this._lastShimmerAt < 1 / 30) return;
    if (Math.abs(value - this._lastShimmer) < 0.001) return;
    this.shimmerGain.gain.cancelScheduledValues(now);
    this.shimmerGain.gain.setTargetAtTime(value, now, 0.12);
    this._lastShimmer = value;
    this._lastShimmerAt = now;
  }

  suspend() {
    return this._transition("suspended");
  }

  resume() {
    return this._transition("running");
  }

  _transition(target) {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    this._stateChange = this._stateChange.then(() => {
      if (this.ctx !== ctx || ctx.state === "closed") return;
      if (target === "suspended" && ctx.state === "running") return ctx.suspend();
      if (target === "running" && ctx.state === "suspended") return ctx.resume();
    }).catch((error) => {
      Engine.emit("audio:error", { reason: `context-${target}`, error });
    });
    return this._stateChange;
  }

  destroy() {
    this.stopAll();
    if (this.shimmerSource) {
      try { this.shimmerSource.stop(); } catch (e) { /* 已停止 */ }
      try { this.shimmerSource.disconnect(); } catch (e) { /* 已断开 */ }
    }
    if (this.shimmerFilter) { try { this.shimmerFilter.disconnect(); } catch (e) { /* 已断开 */ } }
    if (this.shimmerGain) { try { this.shimmerGain.disconnect(); } catch (e) { /* 已断开 */ } }
    if (this.master) { try { this.master.disconnect(); } catch (e) { /* 已断开 */ } }
    if (this.compressor) { try { this.compressor.disconnect(); } catch (e) { /* 已断开 */ } }
    this._noiseCache.clear();
    this._noiseSamples = 0;
    const closing = this.ctx && this.ctx.state !== "closed" ? this.ctx.close().catch(() => {}) : Promise.resolve();
    this.ctx = null; this.master = null; this.compressor = null;
    this.shimmerSource = null; this.shimmerFilter = null; this.shimmerGain = null;
    return closing;
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
    this._track(o, g, lp); this._track(nb, ng, hp);
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
    this._track(src, bp, g);
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
    this._track(nb, hp, g1); this._track(cb, bp, g2); this._track(o, og);
  }

  /* 运笔 brush:带通噪声柔和下扫(2500→700Hz),毛笔落纸的摩擦感 */
  brush(t, gain = 0.05, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.14);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(2500 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.linearRampToValueAtTime(0, t + 0.13);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.15);
    this._track(src, bp, g);
  }

  /* 扑翼 flutter:一串短噪声脉冲(~10Hz 三次),鸟群扇翅 */
  flutter(t, gain = 0.04, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const t0 = t + i * 0.1;
      const nb = ctx.createBufferSource();
      nb.buffer = this._noiseBuffer(0.04);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = (900 + i * 150) * pitch; bp.Q.value = 1.3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain * (1 - i * 0.22), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.05);
      nb.connect(bp); bp.connect(g); g.connect(this.master);
      nb.start(t0); nb.stop(t0 + 0.06);
      this._track(nb, bp, g);
    }
  }

  /* 燕鸣 chirp:两短一长的啁啾(高频正弦快上快下,尾音下坠) */
  chirp(t, gain = 0.05, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const seq = [
      [0.00, 4300, 5200, 0.05], [0.09, 4300, 5000, 0.05], [0.20, 3400, 2500, 0.12],
    ];
    for (const [dt0, f0, f1, d] of seq) {
      const t0 = t + dt0;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f0 * pitch, t0);
      o.frequency.exponentialRampToValueAtTime(f1 * pitch, t0 + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + d + 0.03);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + d + 0.05);
      this._track(o, g);
    }
  }

  /* 拨水 swish:短噪声过带通慢扫(鱼摆尾推进的水声) */
  swish(t, gain = 0.04, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.26);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(460 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(980 * pitch, t + 0.1);
    bp.frequency.exponentialRampToValueAtTime(520 * pitch, t + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.06);
    g.gain.linearRampToValueAtTime(0, t + 0.25);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.27);
    this._track(src, bp, g);
  }

  /* 燕鸣与拨水之上的水泡 blip:正弦快速上滑(气泡升水) */
  blip(t, freq = 320, gain = 0.06) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 2.2, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
    this._track(o, g);
  }

  /* 水流 stream:持续噪声过低通 + 缓慢增益起伏(汩汩声),dur 秒长 */
  stream(t, dur = 4, gain = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(Math.min(dur + 0.1, 30));
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 260; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.6);
    // 汩汩起伏:几个慢速增益摆动
    const nWob = Math.floor(dur / 0.7);
    for (let i = 0; i < nWob; i++) {
      g.gain.linearRampToValueAtTime(gain * (0.65 + ((i * 37) % 10) / 14), t + 0.6 + i * 0.7);
    }
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp); lp.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.1);
    this._track(src, lp, bp, g);
  }

  /* 木关节 knock:短噪声过木质腔体带通 + 低频 thump(木偶关节/足尖触地) */
  knock(t, gain = 0.10, pitch = 1) {    if (!this.ctx) return;
    const ctx = this.ctx;
    // 腔体:45ms 中低频噪声,带通 ~700Hz,听感像木块相碰
    const cb = ctx.createBufferSource();
    cb.buffer = this._noiseBuffer(0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 700 * pitch; bp.Q.value = 2.6;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(gain, t);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + 0.045);
    cb.connect(bp); bp.connect(g2); g2.connect(this.master);
    cb.start(t); cb.stop(t + 0.05);
    // thump:低频正弦 150→70Hz,木质共振
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain * 0.7, t);
    og.gain.exponentialRampToValueAtTime(0.0004, t + 0.07);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.08);
    this._track(cb, bp, g2); this._track(o, og);
  }

  /* 纸面 crack:持续刮擦/撕裂颗粒 + 细小脆响；不使用沉重低频冲击 */
  crack(t, gain = 0.07, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // snap:细薄纸面突然断开的高频脆响
    const snap = ctx.createBufferSource();
    snap.buffer = this._noiseBuffer(0.045);
    const snapBand = ctx.createBiquadFilter();
    snapBand.type = "bandpass";
    snapBand.frequency.value = 4100 * pitch;
    snapBand.Q.value = 0.72;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(gain * 0.82, t);
    snapGain.gain.exponentialRampToValueAtTime(0.0004, t + 0.042);
    snap.connect(snapBand); snapBand.connect(snapGain); snapGain.connect(this.master);
    snap.start(t); snap.stop(t + 0.05);

    // tear:较长、较宽的中高频刮擦，连续事件相互重叠后接近原片纹理。
    const tear = ctx.createBufferSource();
    tear.buffer = this._noiseBuffer(0.25);
    const tearBand = ctx.createBiquadFilter();
    tearBand.type = "bandpass";
    tearBand.frequency.value = 1750 * pitch;
    tearBand.Q.value = 0.58;
    const tearHigh = ctx.createBiquadFilter();
    tearHigh.type = "highpass";
    tearHigh.frequency.value = 520;
    const tearGain = ctx.createGain();
    tearGain.gain.setValueAtTime(0.0004, t);
    tearGain.gain.linearRampToValueAtTime(gain, t + 0.018);
    tearGain.gain.exponentialRampToValueAtTime(0.0004, t + 0.235);
    tear.connect(tearHigh); tearHigh.connect(tearBand); tearBand.connect(tearGain); tearGain.connect(this.master);
    tear.start(t); tear.stop(t + 0.26);

    // debris:四个轻微纸屑脆响，参数固定以保持可复现。
    const debrisPitch = [1.21, 0.88, 1.34, 1.03];
    for (let i = 0; i < debrisPitch.length; i++) {
      const t0 = t + 0.052 + i * 0.041;
      const chip = ctx.createBufferSource();
      chip.buffer = this._noiseBuffer(0.025);
      const chipBand = ctx.createBiquadFilter();
      chipBand.type = "bandpass";
      chipBand.frequency.value = 2600 * pitch * debrisPitch[i];
      chipBand.Q.value = 1.8;
      const chipGain = ctx.createGain();
      chipGain.gain.setValueAtTime(gain * (0.24 - i * 0.028), t0);
      chipGain.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.023);
      chip.connect(chipBand); chipBand.connect(chipGain); chipGain.connect(this.master);
      chip.start(t0); chip.stop(t0 + 0.03);
      this._track(chip, chipBand, chipGain);
    }
    this._track(snap, snapBand, snapGain);
    this._track(tear, tearHigh, tearBand, tearGain);
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
    this._track(src, bp, g); this._track(o, og); this._track(o2, og2);
  }
};

/* ---------------- 音效配方(与 engine/tools/synth.py 同名对齐) ---------------- */
Engine.recipes = Object.assign(Object.create(null), {
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
  knock: {
    minInterval: 0.05,   // 限流:连碰时不至于糊成一片
    playNow(a, ev) {
      a.knock(a.ctx.currentTime,
        ev.gain === undefined ? 0.10 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
  crack: {
    minInterval: 0.11,
    schedule(a, when, ev) {
      a.crack(when,
        ev.gain === undefined ? 0.07 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
    playNow(a, ev) {
      a.crack(a.ctx.currentTime,
        ev.gain === undefined ? 0.07 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
  brush: {
    minInterval: 0.04,   // 限流:连续书写时不至于糊成一片
    schedule(a, when, ev) {
      a.brush(when,
        ev.gain === undefined ? 0.05 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
    playNow(a, ev) {
      a.brush(a.ctx.currentTime,
        ev.gain === undefined ? 0.05 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
  flutter: {
    minInterval: 0.09,   // 限流:群体扑翼不至于糊成一片
    schedule(a, when, ev) {
      a.flutter(when,
        ev.gain === undefined ? 0.04 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
    playNow(a, ev) {
      a.flutter(a.ctx.currentTime,
        ev.gain === undefined ? 0.04 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
  blip: {
    minInterval: 0.05,   // 限流:群鱼化水不至于糊成一片
    playNow(a, ev) {
      a.blip(a.ctx.currentTime,
        ev.freq === undefined ? 320 : ev.freq,
        ev.gain === undefined ? 0.06 : ev.gain);
    },
  },
  stream: {
    schedule(a, when, ev) {   // 持续水流声只走定点(intro 编排)
      a.stream(when,
        ev.dur === undefined ? 4 : ev.dur,
        ev.gain === undefined ? 0.05 : ev.gain);
    },
    playNow(a, ev) {
      a.stream(a.ctx.currentTime,
        ev.dur === undefined ? 4 : ev.dur,
        ev.gain === undefined ? 0.05 : ev.gain);
    },
  },
  chirp: {
    minInterval: 0.25,   // 限流:燕鸣错落有致
    playNow(a, ev) {
      a.chirp(a.ctx.currentTime,
        ev.gain === undefined ? 0.05 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
  swish: {
    minInterval: 0.3,    // 限流:摆尾推进一声是一声
    playNow(a, ev) {
      a.swish(a.ctx.currentTime,
        ev.gain === undefined ? 0.04 : ev.gain,
        ev.pitch === undefined ? 1 : ev.pitch);
    },
  },
});

/* 自定义音效扩展点。建议同时为离线合成器提供同名实现。 */
Engine.registerRecipe = function (name, recipe) {
  if (typeof name !== "string" || !name.trim()) {
    throw new TypeError("Engine.registerRecipe(name, recipe) 需要非空名称");
  }
  const key = name.trim();
  if (!recipe || typeof recipe !== "object") {
    throw new TypeError(`音效配方 ${key} 必须是对象`);
  }
  if (typeof recipe.playNow !== "function" && typeof recipe.schedule !== "function") {
    throw new TypeError(`音效配方 ${key} 至少需要 playNow 或 schedule`);
  }
  Engine.recipes[key] = Object.assign({}, recipe);
  Engine.emit("audio:recipe", { name: key, recipe: Engine.recipes[key] });
  return Engine.recipes[key];
};

Engine.getRecipe = function (name) { return Engine.recipes[name] || null; };
