/* ============================================================
 * 燕返(yanfan)— 字化成鱼,随红鲤一程,终归成书
 * (p5.js 程序化动画,引擎场景实现;复刻 demo/燕返.mp4)
 *
 * 一池水:横格般的水波纹铺满水面(网的效果),一封手写信浮在水里。
 * 红鲤游来,字迹化作墨色小鱼随它而去;红鲤绕水一匝,
 * 小鱼又一只只游回原位,重聚成书——"燕返"。
 *
 * 交互:
 *   - 移动鼠标搅动水面:波纹被拨开,鼠标附近的字化鱼惊散
 *   - 静止后,小鱼陆续归位变回字
 *   - 红鲤按自己的轨迹巡游(主角,确定性编排)
 *
 * 音效(音画同源,全部 Engine.audio.emit):
 *   brush   落笔书写(入场逐字)
 *   blip    水泡:化鱼 / 归位
 *   stream  水流环境声(intro 编排,全程 + 鱼群经过时加强)
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;
  const INK = [26, 23, 18];
  const RED = [176, 52, 39];
  const BLUE = [110, 140, 175];      // 水波纹蓝

  // 水面布局(原片的"网":一块矩形水面,波纹铺满)
  const PAD_X = 128, PAD_Y = 178, PAD_W = 468, PAD_H = 676;
  const MARGIN_X = 158;              // 红色竖线(水中的红绳)
  const LINE_GAP = 30;               // 波纹间距
  const TEXT_X = 172;
  const CHAR_SIZE = 20;

  // 信正文(按行;每行 ≤ 20 字)
  const LINES = [
    "我已经不喜欢你了,你是早已经不喜欢",
    "我的了。这次的决心,我是经过一年",
    "半的长时间考虑的,彼时唯以小吉故,",
    "不欲增加你的困难。",
    "曾经,见了你,我变得很低很低,低",
    "到尘埃里,还妄想着能从尘埃里开出",
    "花来。我以为,你是懂我的,在婚书",
    "上写下「愿岁月静好,现世安稳」,",
    "以为就此握住了一生的幸福。",
    "可现实终究是残酷的。你的心事,我",
    "早已千疮百孔地领教过。挣扎倾于笔",
    "端,于是有了《红玫瑰与白玫瑰》。",
    "那一刻,我终于明白,我们之间再也",
    "回不去了。",
    "随信附上三十万法币,算是与你这段",
    "感情的终结。从此以后,你不要来寻",
    "我,即或写信来,我亦是不看的了。",
    "——张爱玲",
  ];

  // 红鲤巡游关键帧(t, x, y):从水下深处游来 → 穿信 → 绕水一匝 → 归隐
  const FISH_PATH = [
    [0.0, 100, 780], [1.6, 160, 700], [2.3, 300, 560], [2.9, 430, 470],
    [3.6, 510, 330], [4.5, 420, 240], [5.4, 250, 260], [6.3, 140, 420],
    [7.2, 160, 620], [8.2, 330, 700], [9.2, 500, 660], [10.2, 380, 760],
    [11.2, 220, 800], [12.0, 160, 820],
  ];

  /* 自动演示轨迹(鼠标 = 搅水):鱼群巡游时搅动两下,随后离场 */
  const WAYPOINTS = [
    [4.2, 300, 320], [5.2, 480, 430], [6.2, 260, 520], [7.2, 430, 360],
    [8.0, 690, 240],
  ];

  /* ---------------- 场景状态 ---------------- */
  let paper;
  let fontWrite;
  let chars = [];            // 字迹(含小鱼状态)
  let fishTrail = [];        // 红鲤尾迹(最近位置,画水痕)
  let ripples = [];          // 波纹网:每根线的位移/速度(弹簧 + 波动传播)
  let strokePh = 0;          // 红鲤摆尾冲程相位
  let prevStroke = 0;
  let prevIy = null;         // 鼠标上一帧 y(算触网速度)
  let chirpTimer = 2.0;
  let blipCool = 0;

  // 波纹网参数
  const RL_X0 = PAD_X + 8, RL_DX = 12;
  const RL_NX = Math.floor((PAD_W - 16) / RL_DX) + 1;
  const RL_NL = Math.floor((PAD_H - 24) / LINE_GAP) + 1;

  /* ---------------- 红鲤 ---------------- */
  function fishPos(t) {
    const P = FISH_PATH;
    if (t <= P[0][0]) return [P[0][1], P[0][2]];
    let i = 0;
    while (i < P.length - 2 && t > P[i + 1][0]) i++;
    const [t0, x0, y0] = P[i], [t1, x1, y1] = P[i + 1];
    const p = u.ramp(t0, t1, t);
    // 游动时的蛇形摆动
    return [
      u.mix(x0, x1, p) + (noise(300, t * 0.6) - 0.5) * 30,
      u.mix(y0, y1, p) + (noise(350, t * 0.6) - 0.5) * 24,
    ];
  }
  function fishVel(t) {
    const [x0, y0] = fishPos(Math.max(0, t - 0.05));
    const [x1, y1] = fishPos(t);
    return [(x1 - x0) / 0.05, (y1 - y0) / 0.05];
  }

  /* ---------------- 构建(固定种子) ---------------- */
  function buildScene() {
    randomSeed(20240721);
    noiseSeed(31);
    chars = [];
    let idx = 0;
    for (let li = 0; li < LINES.length; li++) {
      const line = LINES[li];
      const y = PAD_Y + 62 + li * LINE_GAP;
      const indent = line.startsWith("——") ? 220
        : (li === 0 || "曾可随".includes(line[0])) ? 24 : 0;
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        const x = TEXT_X + indent + ci * CHAR_SIZE + CHAR_SIZE / 2;
        chars.push({
          ch, x, y,
          rot: (random() - 0.5) * 0.06,
          writeT: 0.15 + idx * 0.0052,
          // 化鱼时间波:红鲤游过之后,自上而下化开(原片 1s 起 2.5s 化尽)
          waveT: 1.9 + (y - PAD_Y) / PAD_H * 1.4,
          state: "ink", vis: 0,
          fx: 0, fy: 0, fvx: 0, fvy: 0,
          seed: random(1000),
          ring: 70 + random(150),          // 跟随红鲤的环绕半径(散开,像鱼群而非球)
          ringA: random(Math.PI * 2),      // 环绕初相
          ringW: 0.7 + random(0.8),        // 环绕角速度
          threshold: 0.4 + random(0.25),
          retT: 6.8 + random(1.0),         // 归队时刻(燕返有先有后)
        });
        idx++;
      }
    }
    fishTrail = [];
    ripples = [];
    for (let k = 0; k < RL_NL; k++) {
      ripples.push({ o: new Array(RL_NX).fill(0), v: new Array(RL_NX).fill(0), cool: 0 });
    }
    strokePh = 0; prevStroke = 0; prevIy = null;
    chirpTimer = 2.0;
    blipCool = 0;
  }

  function buildPaper() {
    paper = createGraphics(W, H);
    paper.background(240, 236, 224);
    paper.noStroke();
    for (let i = 0; i < 2000; i++) {
      const g = 208 + Math.random() * 48;
      paper.fill(g, g - 8, g - 26, 12);
      paper.circle(Math.random() * W, Math.random() * H, 1 + Math.random() * 1.5);
    }
    // 水面(略亮,细边)——水的"容器"
    paper.fill(244, 243, 236, 200);
    paper.stroke(175, 178, 168, 80);
    paper.strokeWeight(1);
    paper.rect(PAD_X, PAD_Y, PAD_W, PAD_H, 3);
  }

  /* ---------------- 状态机 ---------------- */
  function toFish(c, t, strong) {
    c.state = "fish";
    c.fx = c.x; c.fy = c.y;
    const away = Math.atan2(c.y - fishPos(t)[1], c.x - fishPos(t)[0])
               + (noise(c.seed, 7) - 0.5) * 1.8;
    const v = strong ? 130 + noise(c.seed, 3) * 120 : 90;
    c.fvx = Math.cos(away) * v;
    c.fvy = Math.sin(away) * v - 30;
    Engine.audio.emit("blip", { freq: 300 + noise(c.seed, 9) * 260, gain: 0.045 });
  }

  /* 触网:位移脉冲打进最近的网线点,沿网传播;大速度附带一声网弦轻响 */
  function rippleTouch(x, y, vy) {
    const k = Math.round((y - (PAD_Y + 32)) / LINE_GAP);
    if (k < 0 || k >= ripples.length) return;
    const r = ripples[k];
    const i = Math.round((x - RL_X0) / RL_DX);
    if (i < 1 || i >= r.o.length - 1) return;
    r.v[i] += vy * 0.3;
    if (r.cool <= 0 && Math.abs(vy) > 130) {
      r.cool = 0.4;
      Engine.audio.emit("pluck", {
        freq: u.noteFreq([0, 3, 5, 7, 10][k % 5] - 12),
        gain: Math.min(0.05, Math.abs(vy) / 10000), decay: 0.8,
      });
    }
  }

  function rippleStep(dt) {
    for (const r of ripples) {
      r.cool -= dt;
      const { o, v } = r, n = o.length;
      for (let i = 1; i < n - 1; i++) {
        v[i] += (-26 * o[i] + 90 * (o[i - 1] + o[i + 1] - 2 * o[i])) * dt;
      }
      for (let i = 1; i < n - 1; i++) {
        v[i] *= (1 - 2.0 * dt);
        o[i] += v[i] * dt;
      }
    }
  }

  function sceneUpdate(dt, t, input) {
    const [fx, fy] = fishPos(t);
    const [fvx0, fvy0] = fishVel(t);
    const fishSpeed = Math.hypot(fvx0, fvy0);
    // 尾迹
    fishTrail.push([fx, fy]);
    if (fishTrail.length > 90) fishTrail.shift();

    // 摆尾冲程:频率随速度;冲程顶点一声拨水
    strokePh += dt * Math.PI * 2 * (0.7 + fishSpeed / 260);
    const strokeNow = Math.sin(strokePh);
    if (prevStroke < 0 && strokeNow >= 0 && fishSpeed > 60) {
      Engine.audio.emit("swish", {
        gain: Math.min(0.05, 0.02 + fishSpeed * 0.00006),
        pitch: 0.85 + fishSpeed / 1600,
      });
    }
    prevStroke = strokeNow;

    // 网:红鲤与鼠标碰触;波动传播
    rippleTouch(fx, fy, fvy0);
    if (input.active) {
      if (prevIy !== null) rippleTouch(input.x, input.y, (input.y - prevIy) / Math.max(dt, 1e-3) * 0.6);
      prevIy = input.y;
    } else prevIy = null;
    rippleStep(dt);

    for (const c of chars) {
      const wantVis = u.ramp(c.writeT, c.writeT + 0.35, t);
      if (c.state === "ink") {
        c.vis += (wantVis - c.vis) * Math.min(1, dt * 8);
        if (c.vis < 0.8) continue;
        const dFish = Math.hypot(c.x - fx, c.y - fy);
        const dMouse = Math.hypot(c.x - input.x, c.y - input.y);
        const fear = input.D * u.gauss(dMouse, 85);
        // 化鱼:鼠标搅动(随时) / 红鲤游到跟前、时间波抵达(仅前 7.2s,
        // 之后进入燕返阶段,归位的字不再被时间波反复化开)
        if (fear > c.threshold
            || (t < 7.2 && (dFish < 92 || t > c.waveT))) {
          toFish(c, t, dFish < 92);
        }
      } else {
        c.vis = Math.max(0, c.vis - dt * 4);
        if (t < c.retT) {
          // 跟随红鲤:缀在鱼身后,环绕半径呼吸般起伏 + 噪声游荡 + 水阻
          const ang = c.ringA + t * c.ringW;
          const rr = c.ring * (0.72 + 0.28 * Math.sin(t * 0.8 + c.seed));
          const gx = fx + Math.cos(ang) * rr - fvx0 * 0.35;
          const gy = fy + Math.sin(ang) * rr * 0.72 - fvy0 * 0.35;
          c.fvx += ((gx - c.fx) * 2.2 + (noise(c.seed, t * 1.1) - 0.5) * 700) * dt;
          c.fvy += ((gy - c.fy) * 2.2 + (noise(c.seed + 40, t * 1.1) - 0.5) * 700) * dt;
          c.fvx *= (1 - 2.0 * dt); c.fvy *= (1 - 2.0 * dt);
        } else {
          // 燕返:游回家(越晚归队越慢;近家强阻尼,到家即稳)
          const late = Math.min(1, (c.retT - 6.8) / 1.0);
          const k = 7.0 - late * 3.0;
          c.fvx += (c.x - c.fx) * k * dt;
          c.fvy += (c.y - c.fy) * k * dt;
          const dHome = Math.hypot(c.x - c.fx, c.y - c.fy);
          const damp = dHome < 70 ? 6.0 : 3.2;   // 近家强阻尼,防过冲振荡
          c.fvx *= (1 - damp * dt); c.fvy *= (1 - damp * dt);
          const near = dHome < 14 && Math.hypot(c.fvx, c.fvy) < 120;
          if (near || t > c.retT + 1.6) {   // 兜底:到点强制归位
            c.state = "ink";
            c.vis = 0.45;
            if (noise(c.seed, 13) < 0.3) {   // 归位水泡稀疏化
              Engine.audio.emit("blip", { freq: 500 + noise(c.seed, 11) * 300, gain: 0.035 });
            }
          }
        }
        const sp = Math.hypot(c.fvx, c.fvy);
        if (sp > 300) { c.fvx *= 300 / sp; c.fvy *= 300 / sp; }
        c.fx += c.fvx * dt; c.fy += c.fvy * dt;
      }
    }

    // 燕鸣:鱼群(墨燕)在外时啁啾错落
    const swimming0 = chars.reduce((n, c) => n + (c.state === "fish" ? 1 : 0), 0);
    if (swimming0 > 40) {
      chirpTimer -= dt;
      if (chirpTimer <= 0) {
        chirpTimer = 0.7 + noise(t * 7.3) * 1.1;
        Engine.audio.emit("chirp", { gain: 0.045, pitch: 0.92 + noise(t * 3.1) * 0.25 });
      }
    }

    // 鱼群经过的水泡声(限流)
    blipCool -= dt;
    if (blipCool <= 0) {
      blipCool = 0.5;
      let n = 0;
      for (const c of chars) if (c.state === "fish") n++;
      if (n > 30) {
        Engine.audio.emit("blip", { freq: 240 + noise(t * 3.7) * 160, gain: 0.03 });
      }
    }

    const swimming = chars.reduce((n, c) => n + (c.state === "fish" ? 1 : 0), 0);
    Engine.audio.setShimmer(Math.min(1, swimming / 90) * 0.035 + input.D * 0.015);
  }

  /* ---------------- 绘制 ---------------- */
  // 水波纹:手绘感横线,随时间漂移;带触网振动(位移沿网传播);
  // 红鲤与鼠标经过处被拨开(网的效果)
  function drawRipples(t) {
    const [fx, fy] = fishPos(t);
    const mx = Engine.input.x, my = Engine.input.y;
    const mOn = Engine.input.active;
    push();
    noFill();
    strokeWeight(1);
    for (let k = 0; k < ripples.length; k++) {
      const y0 = PAD_Y + 32 + k * LINE_GAP;
      const r = ripples[k];
      stroke(BLUE[0], BLUE[1], BLUE[2], 105);
      beginShape();
      for (let i = 0; i < r.o.length; i++) {
        const x = RL_X0 + i * RL_DX;
        let y = y0 + Math.sin(x * 0.045 + k * 2.1 + t * 0.9) * 1.8 + r.o[i];
        // 红鲤拨开波纹
        const dF = Math.hypot(x - fx, y0 - fy);
        y += (y0 > fy ? 1 : -1) * 16 * u.gauss(dF, 52);
        // 鼠标搅动
        if (mOn) {
          const dM = Math.hypot(x - mx, y0 - my);
          y += (y0 > my ? 1 : -1) * 14 * u.gauss(dM, 46) * Engine.input.D;
        }
        curveVertex(x, y);
      }
      endShape();
    }
    // 红色竖线(水中红绳,随波轻摆)
    stroke(RED[0], RED[1], RED[2], 130);
    beginShape();
    for (let y = PAD_Y + 8; y <= PAD_Y + PAD_H - 8; y += 14) {
      curveVertex(MARGIN_X + Math.sin(y * 0.05 + t * 0.7) * 2, y);
    }
    endShape();
    pop();
  }

  function drawChars(t) {
    push();
    textAlign(CENTER, CENTER);
    textFont(fontWrite);
    textSize(19);
    for (const c of chars) {
      if (c.vis <= 0.01 || c.state !== "ink") continue;
      push();
      translate(c.x, c.y + Math.sin(t * 0.8 + c.seed) * 0.7);
      rotate(c.rot + Math.sin(t * 0.5 + c.seed) * 0.01);   // 字里带着水意
      fill(INK[0], INK[1], INK[2], 235 * Math.min(1, c.vis));
      text(c.ch, 0, 0);
      pop();
    }
    pop();
  }

  /* 墨鱼:逗号形小蝌蚪,随泳向摆尾 */
  function drawInkFish(t) {
    push();
    noStroke();
    for (const c of chars) {
      if (c.state !== "fish") continue;
      const alpha = 1 - c.vis;
      if (alpha <= 0.02) continue;
      const ang = Math.atan2(c.fvy, c.fvx);
      const wob = Math.sin(t * 9 + c.seed * 8) * 0.35;
      push();
      translate(c.fx, c.fy);
      rotate(ang);
      fill(INK[0], INK[1], INK[2], 225 * alpha);
      // 头(椭圆) + 摆动的尾(三角)
      ellipse(0, 0, 10, 6);
      const tw = Math.sin(t * 11 + c.seed * 9) * 4;
      triangle(-4, 0, -14, tw * 0.4 - 3, -14, tw * 0.4 + 3);
      pop();
    }
    pop();
  }

  /* 红鲤:摆尾推进(冲程涌动 + 转弯侧倾) + 三缕飘逸尾鳍 + 身后水痕 */
  function drawRedFish(t) {
    const a = u.ramp(0.2, 0.9, t);
    if (a <= 0) return;
    const [fx, fy] = fishPos(t);
    const [vx, vy] = fishVel(t);
    const speed = Math.hypot(vx, vy);
    const ang = Math.atan2(vy, vx);
    // 转弯侧倾:朝向变化率 → 身体侧滚
    const [pvx, pvy] = fishVel(Math.max(0, t - 0.12));
    const turn = (Math.atan2(vy, vx) - Math.atan2(pvy, pvx)) / 0.12;
    const roll = Math.max(-0.35, Math.min(0.35, turn * 0.18));
    // 冲程涌动:摆尾推进时身体沿泳向一冲一滑
    const surge = Math.sin(strokePh) * Math.min(3, 0.8 + speed * 0.006);
    const sx = fx + Math.cos(ang) * surge, sy = fy + Math.sin(ang) * surge;
    // 尾摆幅度/频率随速度
    const wagAmp = 4 + Math.min(6, speed * 0.014);
    const wagPh = strokePh * 1.6;
    // 水痕(尾迹渐隐)
    push();
    noFill();
    strokeWeight(1.2);
    for (let i = 1; i < fishTrail.length; i++) {
      const [x0, y0] = fishTrail[i - 1], [x1, y1] = fishTrail[i];
      stroke(RED[0], RED[1], RED[2], 26 * (i / fishTrail.length) * a);
      line(x0, y0, x1, y1);
    }
    pop();

    push();
    translate(sx, sy);
    rotate(ang + roll + Math.sin(t * 3.2) * 0.06);
    drawingContext.globalAlpha = a;
    // 尾鳍三缕(向后飘,摆动与冲程同步)
    noFill();
    stroke(RED[0], RED[1], RED[2], 190);
    strokeWeight(2.2);
    for (let j = -1; j <= 1; j++) {
      const wig = Math.sin(wagPh + j * 1.8) * wagAmp;
      bezier(-12, j * 3,
             -24, j * 7 + wig,
             -34, j * 11 + wig * 1.4,
             -44, j * 13 + wig * 1.8);
    }
    // 身体(随冲程轻微伸缩)
    const stretch = 1 + Math.sin(strokePh) * 0.05;
    noStroke();
    fill(RED[0], RED[1], RED[2], 235);
    ellipse(0, 0, 30 * stretch, 15);
    // 头与眼
    fill(RED[0] - 20, RED[1] - 12, RED[2] - 8, 245);
    ellipse(9, 0, 18, 13);
    fill(20, 16, 12, 230);
    circle(13, -2.5, 3.2);
    // 背鳍
    fill(RED[0], RED[1], RED[2], 160);
    triangle(-6, -6, 4, -7, -2, -13 + Math.sin(t * 4) * 1.5);
    drawingContext.globalAlpha = 1;
    pop();
  }

  function drawTitle(t) {
    const a = u.ramp(2.4, 3.2, t);
    if (a <= 0) return;
    push();
    textAlign(LEFT, BASELINE);
    textFont(fontWrite);
    textSize(30);
    fill(INK[0], INK[1], INK[2], 225 * a);
    text("燕 返", PAD_X - 4, 916);
    textAlign(RIGHT, BASELINE);
    textFont("Courier New");   // 署名用系统字体(手写体子集不含 @ 与拉丁字母)
    textStyle(BOLD);
    textSize(15);
    fill(RED[0], RED[1], RED[2], 235 * a);
    text("@GeekCatX", 664, 912);
    pop();
  }

  /* 手动模式下的操作提示(自动/录制模式不显示) */
  function drawHint(t) {
    if (Engine.auto() || Engine.staticT !== null || !Engine.started) return;
    const a = u.ramp(3.2, 4.2, t) * (1 - u.ramp(9.5, 11, t));
    if (a <= 0) return;
    push();
    textAlign(CENTER, BASELINE);
    textFont("Courier New");   // 提示用系统字体(手写体子集不含这些字)
    textStyle(NORMAL);
    textSize(13);
    fill(INK[0], INK[1], INK[2], 140 * a * (0.7 + 0.3 * Math.sin(t * 2)));
    text("移 动 鼠 标 · 搅 动 一 池 水", W / 2, 940);
    pop();
  }

  function render(t) {
    image(paper, 0, 0);
    drawRipples(t);
    drawChars(t);
    drawInkFish(t);
    drawRedFish(t);
    drawTitle(t);
    drawHint(t);
  }

  /* ---------------- 注册场景 ---------------- */
  Engine.start({
    id: "yanfan",
    width: W, height: H, duration: 12,
    waypoints: WAYPOINTS,
    input: { attack: 5.0, release: 1.0 },
    preload() {
      fontWrite = loadFont("/assets/fonts/mashanzheng-sub.ttf");   // p5 loadFont 只认 ttf/otf
    },
    build() {
      buildPaper();       // 纸纹颗粒不参与固定种子,每次略有不同更自然
      buildScene();       // 定种子;之后 random 调用顺序即画面
    },
    reset() { buildScene(); },
    update: sceneUpdate,
    render,
    audio: {
      intro() {
        const ev = [];
        // 全程水流声 + 鱼群巡游时加强
        ev.push({ t: 0.1, type: "stream", dur: 12, gain: 0.045 });
        ev.push({ t: 2.2, type: "stream", dur: 6.2, gain: 0.05 });
        // 落笔声:每 5 字一记运笔,音高随笔势微变
        for (let i = 0; i < chars.length; i += 5) {
          ev.push({
            t: chars[i].writeT + 0.05, type: "brush",
            gain: 0.045, pitch: 0.9 + (i % 23) * 0.012,
          });
        }
        return ev;
      },
    },
    ui: {
      tip: "点击开始播放",
      sub: "燕返 · 字化成鱼,终归成书 · @GeekCatX",
      narration: [
        { t: 1.0, text: "一封写在水上的信。红鲤游过,字都化成了鱼。" },
        { t: 10.2, text: "鱼儿游回来,字还是那些字。" },
      ],
    },
  });
})();
