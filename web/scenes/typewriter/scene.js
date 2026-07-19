/* ============================================================
 * scenes/typewriter/scene.js — Typing bird · 打字机 × 飞鸟
 * 复刻 demo/打字机.mp4:水彩纸上一副圆键键盘,字母逐字敲出,
 * 每次击键惊起一只燕(黑/白),牵着红线飞散;敲完
 *   I CANNOT CHOOSE THE BEST. / THE BEST CHOOSES ME.
 * 群鸟满天。击键节奏取自原片音频的点击检测(38 次)。
 *
 * 交互(仅现场):移动鼠标可惊散鸟群;画面本身按剧本自动播放。
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;
  const PAPER = [182, 195, 186];
  const RED = [164, 47, 38];
  const INK = [44, 46, 42];
  const TRAIL = [150, 74, 58];

  /* 键盘:三排圆键(与参考一致,含 ? ! , . 装饰键) */
  const ROWS = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "?"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "!"],
    ["Z", "X", "C", "V", "B", "N", "M", ",", "."],
  ];
  const KEY_D = 30, KEY_PITCH = 40, ROW_GAP = 40, KB_Y = 597;

  /* 文案与击键时间表(从原片音频点击检测还原的节奏,38 键) */
  const LINES = ["I CANNOT CHOOSE THE BEST.", "THE BEST CHOOSES ME."];
  const LINE_Y = [263, 295];
  const TIMES = [
    0.56,                                     // I
    1.92, 2.03, 2.11, 2.24, 2.33, 2.47,       // CANNOT
    4.55, 4.71, 4.79, 4.92, 5.06, 5.20,       // CHOOSE
    6.95, 7.08, 7.22,                         // THE
    8.44, 8.61, 8.74, 8.87, 9.02,             // BEST.
    10.94, 11.10, 11.19,                      // THE
    12.61, 12.71, 12.81, 12.93,               // BEST
    14.39, 14.50, 14.59, 14.71, 14.81, 15.01, 15.13,  // CHOOSES
    16.27, 16.36, 16.48,                      // ME.
  ];
  const STAMP_DELAY = 0.6;            // 击键后字母落纸的延迟(鸟牵线送字到岗)

  /* 扑翼姿态轮换(birds.json 的 5 种燕子各是一种 wing pose) */
  const FLAP = [1, 3, 4, 2];

  /* 自动演示:剧本全自动,光标无需入场(waypoints 推到片外,D 恒为 0) */
  const WAYPOINTS = [[99, W / 2, H / 2], [100, W / 2, H / 2]];

  /* ---------------- 场景状态 ---------------- */
  let paper;
  let birdVec = {};
  let keys = {};            // ch -> {x, y, flash, used, pop}
  let keyList = [];
  let presses = [];         // {t, ch, kx, ky, lx, ly, fired, phase, dx, dy, rot, bird}
  let birds = [];
  let flickT = 0.8;         // 环境键闪计时

  /* ---------------- 水彩纸 ---------------- */
  function buildPaper() {
    paper = createGraphics(W, H);
    paper.pixelDensity(1);
    paper.background(...PAPER);
    // 水彩块:多次抖动叠出洇边,中心坐标 [cx, cy, w, h, rgb, alpha]
    const BLOBS = [
      [255, 422, 320, 245, [154, 168, 127], 30],   // 橄榄绿(键盘中上)
      [525, 315, 210, 140, [141, 161, 162], 30],   // 灰蓝(右上)
      [420, 490, 180, 220, [124, 154, 143], 30],   // 青绿(中)
      [200, 565, 160, 52, [163, 187, 191], 30],    // 浅蓝条(左下)
      [40, 130, 130, 300, [140, 155, 148], 12],    // 左上淡痕
    ];
    paper.rectMode(CENTER);
    for (const [cx, cy, w, h, rgb, a] of BLOBS) {
      paper.noStroke();
      for (let i = 0; i < 16; i++) {
        paper.fill(rgb[0], rgb[1], rgb[2], a * 0.28);
        paper.rect(cx + (random() - 0.5) * 10, cy + (random() - 0.5) * 10,
                   w * (0.97 + random() * 0.06), h * (0.97 + random() * 0.06), 24);
      }
      // 洇边:稍深描边,模拟水渍边缘
      paper.noFill();
      for (let i = 0; i < 5; i++) {
        paper.stroke(rgb[0] * 0.82, rgb[1] * 0.82, rgb[2] * 0.82, 14);
        paper.strokeWeight(1.2);
        paper.rect(cx + (random() - 0.5) * 7, cy + (random() - 0.5) * 7,
                   w * (0.985 + random() * 0.03), h * (0.985 + random() * 0.03), 24);
      }
    }
    // 纸面颗粒/飞白
    for (let i = 0; i < 13000; i++) {
      const d = random() < 0.6;
      paper.stroke(d ? 70 : 250, d ? 78 : 252, d ? 68 : 248, random(5, 16));
      paper.strokeWeight(1);
      paper.point(random(W), random(H));
    }
    // 暗角
    const ctx = paper.drawingContext;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(45,60,50,0.10)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- 场景构建(固定种子) ---------------- */
  function buildScene() {
    randomSeed(20240719);
    noiseSeed(19);

    // 键盘布局:三排居中,排内等距
    keys = {}; keyList = [];
    for (let r = 0; r < ROWS.length; r++) {
      const row = ROWS[r];
      const x0 = (W - (row.length - 1) * KEY_PITCH) / 2;
      for (let i = 0; i < row.length; i++) {
        const k = { ch: row[i], x: x0 + i * KEY_PITCH, y: KB_Y + r * ROW_GAP, flash: 0, used: 0, pop: 0 };
        keys[k.ch] = k;
        keyList.push(k);
      }
    }

    // 逐字位置(打字机字体,逐字符居中)
    textFont("Courier New");
    textStyle(BOLD);
    textSize(20);
    const tracking = 2;
    const charPos = LINES.map((line, li) => {
      const widths = [...line].map((c) => textWidth(c));
      const total = widths.reduce((s, w) => s + w, 0) + tracking * (line.length - 1);
      let x = (W - total) / 2;
      return widths.map((w) => {
        const cx = x + w / 2;
        x += w + tracking;
        return [cx, LINE_Y[li]];
      });
    });

    // 击键剧本:时间表按顺序贴到两行文字的非空格字符上
    const flat = [];
    LINES.forEach((line, li) => {
      [...line].forEach((c, ci) => { if (c !== " ") flat.push([li, ci, c]); });
    });
    presses = flat.map(([li, ci, c], i) => {
      const k = keys[c];
      const [lx, ly] = charPos[li][ci];
      return {
        t: TIMES[i], ch: c, kx: k.x, ky: k.y, lx, ly,
        fired: false, phase: random(1000),
        dx: (random() - 0.5) * 2.4, dy: (random() - 0.5) * 2.0, rot: (random() - 0.5) * 0.06,
        bird: null, rope: null,
      };
    });

    birds = [];
  }

  /* 回车:两行打完各来一下(zip + ding) */
  const EXTRAS = [
    { t: 9.40, fired: false },
    { t: 16.90, fired: false },
  ];

  /* ---------------- 更新 ---------------- */
  function sceneUpdate(dt, t, input) {
    // 击键触发:键闪、放鸟(送字)、拉线、发声
    for (const p of presses) {
      if (p.fired || t < p.t) continue;
      p.fired = true;
      const k = keys[p.ch];
      k.flash = 1; k.used = 1; k.pop = 1;
      const b = {
        x: p.kx, y: p.ky - KEY_D / 2,
        vx: (random() - 0.5) * 150, vy: -(430 + random() * 140),
        s: 0.72 + random() * 0.36, seed: random(1000), white: random() < 0.45,
        press: p,
      };
      birds.push(b);
      p.bird = b;
      // 红线:verlet 绳索,底端拴键顶,顶端由鸟一路牵到字母落纸
      const NPTS = 14;
      const dist = Math.hypot(p.lx + p.dx - p.kx, (p.ly + 8) - (p.ky - KEY_D / 2));
      p.rope = {
        pts: Array.from({ length: NPTS }, () => ({
          x: p.kx, y: p.ky - KEY_D / 2, px: p.kx, py: p.ky - KEY_D / 2,
        })),
        segLen: (dist * 1.04) / (NPTS - 1),
      };
      Engine.audio.emit("type", { gain: 0.08 + random() * 0.04, pitch: 0.92 + random() * 0.16 });
    }

    // 回车(zip + ding)
    for (const e of EXTRAS) {
      if (!e.fired && t >= e.t) {
        e.fired = true;
        Engine.audio.emit("carriage", { gain: 0.055 });
      }
    }

    // 键帽回弹:flash 缓慢落向"用过"的深色
    for (const k of keyList) {
      const base = k.used ? 0.8 : 0;
      k.flash += (base - k.flash) * Math.min(1, dt * 1.4);
      k.pop = Math.max(0, k.pop - dt * 4);
    }

    // 环境键闪:机器"活着"的感觉(低频、极浅)
    flickT -= dt;
    if (flickT <= 0) {
      flickT = 0.35 + random() * 0.6;
      if (random() < 0.5) {
        const k = keyList[Math.floor(random(keyList.length))];
        if (!k.used) k.flash = Math.max(k.flash, 0.26);
      }
    }

    // 鸟:送字期弹簧寻的;放线后噪声巡航 + 软边界 + 现场鼠标惊散
    for (const b of birds) {
      const delivering = b.press && t < b.press.t + STAMP_DELAY;
      if (delivering) {
        const txp = b.press.lx + b.press.dx, typ = b.press.ly + 8;
        b.vx += ((txp - b.x) * 200 - b.vx * 15) * dt;
        b.vy += ((typ - b.y) * 200 - b.vy * 15) * dt;
      } else {
        if (b.press) {
          // 字已落纸:放线,鸟带余速飞离
          b.press = null;
          b.vx += (random() - 0.5) * 120;
          b.vy -= 70 + random() * 80;
        }
        b.vx += (noise(b.seed, t * 0.9) - 0.5) * 900 * dt;
        b.vy += (noise(b.seed + 40, t * 0.9) - 0.5) * 900 * dt - 20 * dt;
        if (input.D > 0) {
          const dx = b.x - input.x, dy = b.y - input.y;
          const d = Math.hypot(dx, dy);
          const f = input.D * u.gauss(d, 90) * 1500;
          if (d > 1) { b.vx += (dx / d) * f * dt; b.vy += (dy / d) * f * dt; }
        }
      }
      b.vx *= (1 - 0.85 * dt); b.vy *= (1 - 0.85 * dt);
      const sp = Math.hypot(b.vx, b.vy);
      const maxSp = delivering ? 800 : 300;
      if (sp > maxSp) { b.vx *= maxSp / sp; b.vy *= maxSp / sp; }
      else if (!delivering && sp < 70 && sp > 1) { b.vx *= 70 / sp; b.vy *= 70 / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      const m = 46;
      if (b.x < m) b.vx += (m - b.x) * 5 * dt;
      if (b.x > W - m) b.vx -= (b.x - (W - m)) * 5 * dt;
      if (b.y < m) b.vy += (m - b.y) * 5 * dt;
      if (b.y > H - m) b.vy -= (b.y - (H - m)) * 5 * dt;
    }

    updateRopes(dt, t);
  }

  /* 红线物理:verlet 绳索(重力 + 微风 + 距离约束迭代) */
  function updateRopes(dt, t) {
    const g = 1400 * dt * dt;
    for (const p of presses) {
      if (!p.fired || !p.rope) continue;
      const r = p.rope;
      const last = r.pts.length - 1;
      const stamped = t >= p.t + STAMP_DELAY;
      const topX = stamped ? p.lx + p.dx : (p.bird ? p.bird.x : p.kx);
      const topY = stamped ? p.ly + 8 : (p.bird ? p.bird.y : p.ky - KEY_D / 2);
      const wind = (noise(p.phase + 500, t * 0.5) - 0.5) * 70 * dt * dt;
      for (let i = 1; i < last; i++) {
        const q = r.pts[i];
        const vx = (q.x - q.px) * 0.985, vy = (q.y - q.py) * 0.985;
        q.px = q.x; q.py = q.y;
        q.x += vx + wind;
        q.y += vy + g;
      }
      const top = r.pts[0], bot = r.pts[last];
      top.x = topX; top.y = topY; top.px = topX; top.py = topY;
      bot.x = p.kx; bot.y = p.ky - KEY_D / 2; bot.px = p.kx; bot.py = p.ky - KEY_D / 2;
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < last; i++) {
          const a = r.pts[i], c = r.pts[i + 1];
          const dx = c.x - a.x, dy = c.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const diff = (d - r.segLen) / d;
          if (i === 0) { c.x -= diff * dx; c.y -= diff * dy; }
          else if (i + 1 === last) { a.x += diff * dx; a.y += diff * dy; }
          else {
            a.x += diff * dx * 0.5; a.y += diff * dy * 0.5;
            c.x -= diff * dx * 0.5; c.y -= diff * dy * 0.5;
          }
        }
      }
    }
  }

  /* ---------------- 渲染 ---------------- */
  function render(t) {
    image(paper, 0, 0);
    const fade = u.ramp(0, 0.7, t);
    drawTrails(t, fade);
    drawText(t, fade);
    drawKeyboard(t, fade);
    drawBirds(t, fade);
    drawLabel(t);
    drawCredit(t);
  }

  /* 红线:verlet 绳索折线(送字期跟着鸟,落纸后垂荡摆动) */
  function drawTrails(t, fade) {
    push();
    noFill();
    stroke(TRAIL[0], TRAIL[1], TRAIL[2], 122 * fade);
    strokeWeight(1);
    for (const p of presses) {
      if (!p.fired || !p.rope) continue;
      beginShape();
      for (const q of p.rope.pts) vertex(q.x, q.y);
      endShape();
    }
    pop();
  }

  /* 打字机红字:落纸带轻微缩放与错位抖动 */
  function drawText(t, fade) {
    push();
    textFont("Courier New");
    textAlign(CENTER, BASELINE);
    textStyle(BOLD);
    textSize(20);
    for (const p of presses) {
      const ap = u.ramp(p.t + STAMP_DELAY, p.t + STAMP_DELAY + 0.16, t);
      if (ap <= 0) continue;
      push();
      translate(p.lx + p.dx, p.ly + p.dy);
      rotate(p.rot);
      scale(1.3 - 0.3 * ap);
      fill(RED[0], RED[1], RED[2], 255 * Math.min(1, ap * 1.5) * fade);
      text(p.ch, 0, 0);
      pop();
    }
    pop();
  }

  /* 圆键键盘:按下压暗回弹,用过的键留暗色 */
  function drawKeyboard(t, fade) {
    push();
    textFont("Courier New");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(13);
    for (const k of keyList) {
      const dk = u.clamp01(k.flash);
      const sc = 1 - 0.13 * k.pop;
      stroke(60, 58, 52, 165 * fade);
      strokeWeight(1);
      fill(u.mix(243, 46, dk), u.mix(241, 46, dk), u.mix(233, 42, dk), 255 * fade);
      ellipse(k.x, k.y, KEY_D * sc, KEY_D * sc);
      noStroke();
      fill(u.mix(52, 232, dk), u.mix(50, 230, dk), u.mix(46, 224, dk), 255 * fade);
      text(k.ch, k.x, k.y + 1);
    }
    pop();
  }

  /* 飞鸟(黑/白,扑翼姿态轮换) */
  function drawBirds(t, fade) {
    for (const b of birds) {
      const sp = Math.hypot(b.vx, b.vy);
      const pose = FLAP[Math.floor(t * (6 + sp / 60) + b.seed * 7) % FLAP.length];
      const spec = birdVec[`bird${pose}`];
      if (!spec) continue;
      const heading = Math.atan2(b.vy, b.vx);
      push();
      translate(b.x, b.y);
      rotate(heading * 0.35 + Math.sin(t * 9 + b.seed) * 0.15);
      if (b.vx < 0) scale(-1, 1);
      scale(b.s);
      translate(-spec.w / 2, -spec.h / 2);
      drawingContext.globalAlpha = fade;
      noStroke();
      if (b.white) fill(238, 240, 233);
      else fill(INK[0], INK[1], INK[2]);
      const pts = spec.pts;
      beginShape();
      curveVertex(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) curveVertex(px, py);
      curveVertex(pts[0][0], pts[0][1]);
      curveVertex(pts[1][0], pts[1][1]);
      endShape(CLOSE);
      drawingContext.globalAlpha = 1;
      pop();
    }
  }

  /* 右下角 Typing bird 标志(照参考排版) */
  function drawLabel(t) {
    const ap = u.ramp(0.8, 1.3, t);
    if (ap <= 0) return;
    push();
    textFont("Courier New");
    textAlign(RIGHT, BASELINE);
    textStyle(BOLD);
    fill(58, 63, 58, 225 * ap);
    textSize(15);
    text("Typing", 636, 790);
    fill(58, 63, 58, 200 * ap);
    textSize(11);
    text("A", 640, 812);
    fill(RED[0], RED[1], RED[2], 235 * ap);
    textSize(15);
    text("bird", 590, 820);
    pop();
  }

  /* 红色署名 */
  function drawCredit(t) {
    const ap = u.ramp(0.5, 0.9, t);
    if (ap <= 0) return;
    push();
    textFont("Courier New");
    textAlign(CENTER, BASELINE);
    textStyle(BOLD);
    textSize(16);
    fill(RED[0], RED[1], RED[2], 235 * ap);
    text("@CeekcatX", W / 2, 922);
    pop();
  }

  /* ---------------- 注册场景 ---------------- */
  Engine.start({
    id: "typewriter",
    width: W, height: H, duration: 22,
    waypoints: WAYPOINTS,
    preload() {
      birdVec = loadJSON("/assets/birds.json");
    },
    build() {
      buildPaper();     // 先铺水彩(不参与固定种子,颗粒每次不同)
      buildScene();     // 再定种子排剧本(random 调用顺序勿动)
    },
    reset() {
      for (const k of keyList) { k.flash = 0; k.used = 0; k.pop = 0; }
      for (const p of presses) { p.fired = false; p.bird = null; p.rope = null; }
      for (const e of EXTRAS) e.fired = false;
      birds = [];
      flickT = 0.8;
    },
    update: sceneUpdate,
    render,
    audio: {
      // 环境垫底:稀疏的五声音阶软拨弦(固定谱,不占种子序列)
      intro() {
        const BED = [
          [0.30, 0, 0.036], [1.60, 7, 0.030], [3.40, 3, 0.030], [5.20, 10, 0.028],
          [7.00, 5, 0.030], [8.80, 12, 0.026], [10.60, 7, 0.028], [12.40, 3, 0.028],
          [14.20, 10, 0.026], [16.00, 7, 0.026], [17.60, 12, 0.030], [19.20, 7, 0.024],
          [20.60, 5, 0.022],
        ];
        return BED.map(([t, semi, gain]) => ({
          t, type: "pluck", freq: u.noteFreq(semi), gain, decay: 2.8,
        }));
      },
    },
    ui: {
      tip: "点击开始播放",
      sub: "打字机 · 鸟鸣成句",
    },
  });
})();
