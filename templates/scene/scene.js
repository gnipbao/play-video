/* ============================================================
 * 场景模板 — 复制本目录到 web/scenes/<你的场景名>/ 后改名实现
 * 要点(详见 ENGINE.md):
 *   1. 种子里的事:build() 内先 randomSeed/noiseSeed,之后 random()
 *      的调用顺序就是画面,改动即变样
 *   2. 所有"受惊/归位"表现读 input.D / input.x / input.y
 *   3. 音效走 Engine.audio.emit(type, {...}),时间戳由引擎打,
 *      渲染模式自动进 __audioEvents,离线配乐与现场同源
 *   4. 自定义函数避开 p5 保留名(smooth/lerp/scale 等)
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;

  /* 自动演示轨迹:(t, x, y) 折线;渲染模式与 ?auto=1 共用 */
  const WAYPOINTS = [
    [1.5, 160, 700], [3.5, 560, 500], [5.5, 300, 260], [7.0, 680, 420],
  ];

  /* ---------------- 场景状态 ---------------- */
  let parts = [];

  function build() {
    randomSeed(42);      // TODO: 换你的种子
    noiseSeed(11);
    parts = [];
    for (let i = 0; i < 60; i++) {
      parts.push({
        x: 200 + random(320), y: 300 + random(360),
        r: 2 + random(3),
        popT: 0.5 + i * 0.03,
        state: "home", vis: 0,
        bx: 0, by: 0, bvx: 0, bvy: 0,
        seed: random(1000),
        threshold: 0.4 + random(0.2),
        semi: [0, 2, 3, 5, 7][i % 5] + 12 * Math.floor(random(2)),
      });
    }
  }

  function sceneUpdate(dt, t, input) {
    for (const p of parts) {
      const wantVis = u.ramp(p.popT, p.popT + 0.3, t);
      const d = Math.hypot(p.x - input.x, p.y - input.y);
      const fear = input.D * u.gauss(d, 90);
      if (p.state === "home") {
        p.vis += (wantVis - p.vis) * Math.min(1, dt * 8);
        if (fear > p.threshold && wantVis > 0.9) {
          p.state = "scared";
          p.bx = p.x; p.by = p.y;
          const away = Math.atan2(p.y - input.y, p.x - input.x);
          p.bvx = Math.cos(away) * 160;
          p.bvy = Math.sin(away) * 160 - 60;
          Engine.audio.emit("takeoff", { freq: u.noteFreq(p.semi) });
        }
      } else if (p.state === "scared") {
        p.vis = Math.max(0.15, p.vis - dt * 3);
        p.bvx += (noise(p.seed, t * 1.2) - 0.5) * 1200 * dt;
        p.bvy += (noise(p.seed + 40, t * 1.2) - 0.5) * 1200 * dt;
        p.bvx *= (1 - 1.8 * dt); p.bvy *= (1 - 1.8 * dt);
        p.bx += p.bvx * dt; p.by += p.bvy * dt;
        if (fear < 0.1) {
          const dist = Math.hypot(p.x - p.bx, p.y - p.by);
          if (dist < 12) {
            p.state = "home";
            Engine.audio.emit("land", { freq: u.noteFreq(p.semi) });
          } else {
            // 弹簧回家
            p.bvx += (p.x - p.bx) * 6 * dt;
            p.bvy += (p.y - p.by) * 6 * dt;
          }
        }
      }
    }
    Engine.audio.setShimmer(input.D * Math.min(1, input.speed / 500) * 0.06);
  }

  function render(t) {
    background(234, 228, 211);
    // 标题
    push();
    textAlign(CENTER, BASELINE);
    textStyle(BOLD);
    textSize(44);
    fill(26, 23, 18, 255 * u.ramp(0.1, 0.6, t));
    text("Scene Title", W / 2, 150);
    pop();
    // 粒子
    noStroke();
    for (const p of parts) {
      if (p.vis <= 0.01) continue;
      const x = p.state === "home" ? p.x : p.bx;
      const y = p.state === "home" ? p.y : p.by;
      fill(26, 23, 18, 220 * p.vis);
      ellipse(x, y, p.r * 2, p.r * 2);
    }
  }

  Engine.start({
    id: "my-scene",            // TODO: 与 record.html 的 data-composition-id 一致
    width: W, height: H, duration: 10,   // TODO: 片长(秒)
    waypoints: WAYPOINTS,
    build,
    update: sceneUpdate,
    render,
    audio: {
      intro() {
        return [0, 2, 3, 5, 7, 10].map((semi, i) => ({
          t: 0.4 + i * 0.12, type: "pluck", freq: u.noteFreq(semi), gain: 0.10, decay: 1.1,
        }));
      },
    },
  });
})();
