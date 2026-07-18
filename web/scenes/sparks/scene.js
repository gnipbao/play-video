/* ============================================================
 * scenes/sparks/scene.js — Sparks · 星火
 * 引擎验证场景(由 templates/scene 骨架改写):
 *   - 一簇星火星辰,鼠标(或自动轨迹)靠近时被惊散,安静后缓缓归位
 *   - 惊散/归位触发 takeoff/land 音效,入场有拨弦旋律
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;
  const INK = "#1a1712";

  /* 自动演示轨迹:(t, x, y) 折线,2s–8s 扫过星群 */
  const WAYPOINTS = [
    [2.0, 140, 700], [3.2, 480, 620], [4.4, 580, 420],
    [5.6, 380, 300], [6.8, 180, 380], [8.0, 660, 520],
  ];

  /* ---------------- 场景状态 ---------------- */
  let stars = [];

  function build() {
    randomSeed(88);
    noiseSeed(3);
    textFont("Courier New");
    stars = [];
    for (let i = 0; i < 90; i++) {
      // 星群:中心椭圆分布
      const a = random(Math.PI * 2), r = Math.sqrt(random());
      const x = 360 + Math.cos(a) * r * 220;
      const y = 470 + Math.sin(a) * r * 260;
      stars.push({
        x, y,
        r: 1.6 + random(2.6),
        popT: 0.5 + i * 0.025,
        tw: random(1000),             // 闪烁相位
        state: "home", vis: 0,
        bx: 0, by: 0, bvx: 0, bvy: 0,
        seed: random(1000),
        threshold: 0.38 + random(0.2),
        semi: [0, 2, 3, 5, 7, 10][i % 6] + 12 * Math.floor(random(2)),
      });
    }
  }

  function sceneUpdate(dt, t, input) {
    for (const p of stars) {
      const wantVis = u.ramp(p.popT, p.popT + 0.35, t);
      const px = p.state === "home" ? p.x : p.bx;
      const py = p.state === "home" ? p.y : p.by;
      const d = Math.hypot(px - input.x, py - input.y);
      const fear = input.D * u.gauss(d, 95);
      if (p.state === "home") {
        p.vis += (wantVis - p.vis) * Math.min(1, dt * 8);
        if (fear > p.threshold && wantVis > 0.9) {
          p.state = "scared";
          p.bx = p.x; p.by = p.y;
          const away = Math.atan2(p.y - input.y, p.x - input.x);
          p.bvx = Math.cos(away) * 170 + (random() - 0.5) * 80;
          p.bvy = Math.sin(away) * 170 - 50;
          Engine.audio.emit("takeoff", { freq: u.noteFreq(p.semi) });
        }
      } else {
        p.vis = Math.max(0.25, p.vis - dt * 2);
        p.bvx += (noise(p.seed, t * 1.2) - 0.5) * 1100 * dt;
        p.bvy += (noise(p.seed + 40, t * 1.2) - 0.5) * 1100 * dt;
        p.bvx *= (1 - 1.7 * dt); p.bvy *= (1 - 1.7 * dt);
        if (fear < 0.1) {
          // 安静后弹簧回家
          p.bvx += (p.x - p.bx) * 5 * dt;
          p.bvy += (p.y - p.by) * 5 * dt;
        }
        p.bx += p.bvx * dt; p.by += p.bvy * dt;
        if (fear < 0.1 && Math.hypot(p.x - p.bx, p.y - p.by) < 10) {
          p.state = "home";
          p.vis = 1;
          Engine.audio.emit("land", { freq: u.noteFreq(p.semi) });
        }
      }
    }
    Engine.audio.setShimmer(input.D * Math.min(1, input.speed / 500) * 0.06);
  }

  function render(t) {
    background(24, 22, 26);
    // 星间连线(星座感):只连 home 状态的近邻
    stroke(120, 110, 140, 26);
    strokeWeight(0.8);
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      if (a.state !== "home" || a.vis < 0.5) continue;
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        if (b.state !== "home" || b.vis < 0.5) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < 3600) line(a.x, a.y, b.x, b.y);
      }
    }
    // 星星(闪烁)
    noStroke();
    for (const p of stars) {
      if (p.vis <= 0.01) continue;
      const x = p.state === "home" ? p.x : p.bx;
      const y = p.state === "home" ? p.y : p.by;
      const tw = 0.65 + 0.35 * Math.sin(t * 2.2 + p.tw);
      fill(240, 235, 220, 230 * p.vis * tw);
      ellipse(x, y, p.r * 2, p.r * 2);
    }
    // 标题
    const ap = u.ramp(0.15, 0.7, t);
    if (ap > 0) {
      push();
      textAlign(CENTER, BASELINE);
      textStyle(BOLD);
      textSize(52);
      fill(240, 235, 220, 245 * ap);
      text("Sparks", W / 2, 160);
      textStyle(NORMAL);
      textSize(15);
      fill(240, 235, 220, 170 * ap);
      text("little fires, big calm", W / 2, 192);
      pop();
    }
    // 署名
    const ap2 = u.ramp(0.6, 1.0, t);
    if (ap2 > 0) {
      push();
      textAlign(LEFT, BASELINE);
      textStyle(BOLD);
      textSize(15);
      fill(200, 90, 70, 225 * ap2);
      text("@GeekCatX", 316, 880);
      pop();
    }
  }

  Engine.start({
    id: "sparks",
    width: W, height: H, duration: 10,
    waypoints: WAYPOINTS,
    build,
    update: sceneUpdate,
    render,
    audio: {
      intro() {
        return [0, 3, 7, 10, 14, 17].map((semi, i) => ({
          t: 0.35 + i * 0.13, type: "pluck", freq: u.noteFreq(semi), gain: 0.10, decay: 1.2,
        }));
      },
    },
  });
})();
