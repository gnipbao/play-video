/* ============================================================
 * engine/core.js — 确定性交互动画引擎:核心
 *
 * 职责(与场景无关):
 *   - 双模时钟:现场 rAF 驱动 / hyperframes 确定性 seek(__hfSeek 固定 1/30 步进)
 *   - 渲染契约:页面置 window.__HF_RENDER 或带 [data-composition-id] 即渲染模式
 *   - 调试参数:?t=N 静帧快进 / ?auto=1 自动演示 / ?mute=1 静音 / ?dump=1 导出音轨事件
 *   - UI 装配:#overlay 点击开播、控制条(重播/音效/旁白)、fitStage
 *
 * 页面 DOM 契约(两个页面都满足):
 *   #stage > #overlay(.tip/.sub) + #controls(#btn-replay/#btn-sound/#btn-voice)
 *
 * 场景通过 Engine.start({...}) 注册,接口见 ENGINE.md。
 * 注意:引擎全部挂在 window.Engine 命名空间下,避开 p5 全局模式保留名。
 * ============================================================ */
"use strict";

window.Engine = (function () {
  const PARAMS = new URLSearchParams(location.search);
  const STATIC_T = PARAMS.has("t") ? parseFloat(PARAMS.get("t")) : null;
  const MUTED = PARAMS.get("mute") === "1";
  const DUMP = PARAMS.get("dump") === "1";

  /* ---------------- 小工具(命名空间内,避开 p5 保留名) ---------------- */
  const u = {
    clamp01(v) { return Math.max(0, Math.min(1, v)); },
    ramp(a, b, t) { const x = u.clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); },
    mix(a, b, p) { return a + (b - a) * p; },
    easeOutCubic(x) { return 1 - Math.pow(1 - u.clamp01(x), 3); },
    gauss(d, sigma) { return Math.exp(-(d * d) / (2 * sigma * sigma)); },
    noteFreq(semi) { return 440 * Math.pow(2, semi / 12); },
  };

  /* ---------------- 时钟状态 ---------------- */
  let simNow = 0;            // 当前时间线秒数(供音轨事件打时间戳)
  let hfT = null;            // 渲染模式:seek 到的目标时刻
  let startMs = -1;

  const E = {
    u,
    cfg: null,
    input: null,             // Engine.Input(input.js)
    audio: null,             // Engine.AudioBus(audio-bus.js)
    narration: null,         // Engine.Narration(audio-bus.js)
    started: false,
    staticT: STATIC_T,
    muted: MUTED,
    now() { return simNow; },
    /* 渲染模式必须动态判断:渲染管线可能打乱脚本执行顺序 */
    hf() {
      return (typeof window !== "undefined" && window.__HF_RENDER === true)
          || (typeof document !== "undefined" && !!document.querySelector("[data-composition-id]"));
    },
    auto() { return PARAMS.get("auto") === "1" || E.hf(); },

    /* 场景注册入口(场景脚本文件末尾调用) */
    start(cfg) {
      E.cfg = cfg;
      E.input = new E.Input(cfg.waypoints || null, cfg.input);
    },

    /* record.html 契约:注册一条 paused GSAP 时间线,渲染器逐帧 seek */
    registerTimeline() {
      const DUR = E.cfg.duration;
      const playhead = { seconds: 0 };
      const timeline = gsap.timeline({ paused: true });
      timeline.to(playhead, {
        seconds: DUR, duration: DUR, ease: "none",
        onUpdate() { if (window.__hfSeek) window.__hfSeek(playhead.seconds); },
      });
      window.__timelines = window.__timelines || {};
      window.__timelines[E.cfg.id] = timeline;
    },
  };

  /* ---------------- 模拟步进:输入 → 场景状态机 ---------------- */
  function tick(dt, t) {
    simNow = t;
    E.input.update(t, dt);
    if (E.cfg.update) E.cfg.update(dt, t, E.input);
  }

  /* ---------------- 舞台尺寸 ---------------- */
  function fitStage() {
    const stage = document.getElementById("stage");
    const m = 24;
    let h = window.innerHeight - m * 2;
    let w = h * (E.cfg.width / E.cfg.height);
    if (w > window.innerWidth - m * 2) {
      w = window.innerWidth - m * 2;
      h = w * (E.cfg.height / E.cfg.width);
    }
    stage.style.width = w + "px";
    stage.style.height = h + "px";
    const cv = stage.querySelector("canvas");
    if (cv) { cv.style.width = "100%"; cv.style.height = "100%"; }
  }

  /* 渲染模式:画布铺满视口,不留边距 */
  function fillStage() {
    const stage = document.getElementById("stage");
    stage.style.width = E.cfg.width + "px";
    stage.style.height = E.cfg.height + "px";
    stage.style.boxShadow = "none";
    const cv = stage.querySelector("canvas");
    if (cv) { cv.style.width = "100%"; cv.style.height = "100%"; }
  }

  function hideUI() {
    document.getElementById("overlay").style.display = "none";
    document.getElementById("controls").style.display = "none";
  }

  /* ---------------- UI 装配 ---------------- */
  function wireUI() {
    const overlay = document.getElementById("overlay");
    const btnReplay = document.getElementById("btn-replay");
    const btnSound = document.getElementById("btn-sound");
    const btnVoice = document.getElementById("btn-voice");
    const ui = E.cfg.ui || {};
    if (ui.tip) overlay.querySelector(".tip").textContent = ui.tip;
    if (ui.sub) overlay.querySelector(".sub").textContent = ui.sub;

    const startLive = () => {
      if (STATIC_T !== null) return;
      overlay.classList.add("hidden");
      E.audio.init();
      E.audio.setEnabled(E.audio.enabled);
      startMs = millis();
      E.started = true;
      if (E.audio.enabled && E.cfg.audio && E.cfg.audio.intro) {
        E.audio.schedule(E.cfg.audio.intro());
      }
      E.narration.speak(ui.narration || []);
      if (document.activeElement) document.activeElement.blur();
    };
    overlay.addEventListener("click", startLive);
    btnReplay.addEventListener("click", (e) => {
      e.stopPropagation();
      if (E.cfg.reset) E.cfg.reset();   // 场景重置自己的状态
      E.input.reset();
      startLive();
    });

    btnSound.classList.toggle("on", E.audio.enabled);
    btnSound.textContent = E.audio.enabled ? "音效 开" : "音效 关";
    btnSound.addEventListener("click", (e) => {
      e.stopPropagation();
      E.audio.init();
      E.audio.setEnabled(!E.audio.enabled);
      btnSound.classList.toggle("on", E.audio.enabled);
      btnSound.textContent = E.audio.enabled ? "音效 开" : "音效 关";
    });
    btnVoice.addEventListener("click", (e) => {
      e.stopPropagation();
      E.narration.setEnabled(!E.narration.enabled);
      btnVoice.classList.toggle("on", E.narration.enabled);
      btnVoice.textContent = E.narration.enabled ? "旁白 开" : "旁白 关";
    });
  }

  /* ---------------- p5 桥接 ---------------- */
  window.preload = function () { if (E.cfg && E.cfg.preload) E.cfg.preload(); };

  window.setup = function () {
    const cfg = E.cfg;
    const c = createCanvas(cfg.width, cfg.height);
    c.parent("stage");
    pixelDensity(cfg.pixelDensity === undefined ? 2 : cfg.pixelDensity);
    frameRate(60);
    // 建场景(种子由场景自己在 build 内固定:random 调用顺序即画面)
    if (cfg.build) cfg.build();
    fitStage();
    window.addEventListener("resize", fitStage);

    E.audio = new E.AudioBus(cfg.audio || {});
    E.narration = new E.Narration();
    wireUI();

    if (STATIC_T !== null) {
      // 快进模拟到目标时刻(含交互状态),再静帧渲染
      hideUI();
      const dt = 1 / 30;
      for (let tt = 0; tt < STATIC_T; tt += dt) tick(dt, tt);
      simNow = STATIC_T;
      noLoop();
      redraw();
    }

    if (E.hf()) {
      hideUI();
      fillStage();
      noLoop();
      // 音轨事件日志(供离线合成配乐);入场旋律与现场调度一致
      window.__audioEvents = [];
      if (cfg.audio && cfg.audio.intro) E.audio.recordIntro(cfg.audio.intro());
      // 确定性 seek:hyperframes 逐帧调用,时间单调递增;
      // 渲染必须走 p5 的 draw 管线(redraw),直接调 render 会丢 text/beginShape 图层
      let cursor = 0;
      window.__hfSeek = (t) => {
        const dt = 1 / 30;
        while (cursor < t - 1e-9) {
          const nt = Math.min(t, cursor + dt);
          tick(nt - cursor, nt);
          cursor = nt;
        }
        hfT = t;
        redraw();
      };
      // ?dump=1:整段跑完,把音轨事件 JSON 打到控制台
      if (DUMP) {
        const END = cfg.duration;
        for (let tt = 0; tt <= END + 1e-9; tt += 1 / 30) window.__hfSeek(tt);
        console.log("__AUDIO__" + JSON.stringify(window.__audioEvents));
      }
    }
  };

  window.draw = function () {
    const cfg = E.cfg;
    if (E.hf()) {
      cfg.render(hfT === null ? 0 : hfT);   // 渲染模式:只按 seek 时刻出帧
      return;
    }
    let t;
    if (STATIC_T !== null) {
      t = STATIC_T;
    } else {
      t = E.started ? (millis() - startMs) / 1000 : 0;
      const dt = Math.min(0.05, t - simNow);
      if (E.started) tick(dt, t);
      simNow = t;
    }
    cfg.render(t);
  };

  return E;
})();
