/* ============================================================
 * 燕返(yanfan)— 字化成燕,随红鲤一程,燕返成字
 * (p5.js 程序化动画,引擎场景实现;复刻 demo/燕返.mp4)
 *
 * 一张手绘横线稿纸浮在留白里,上半页写满手写信。
 * 红鲤游来,字迹化作墨色燕群随它盘旋出纸;红鲤绕场一匝,
 * 燕群又一只只归位,重聚成书——"燕返"。
 *
 * 核心机制(三者共用同一套流场,不是三个特效叠加):
 *   - 字迹 ⇄ 燕子:同一粒子,ink/break/bird 三态;化燕由
 *     红鲤临近 + 自上而下的时间波驱动,边缘不规则
 *   - 燕群:多股流(红鲤尾流 + 左右两个游移涡心),弧线/环形,
 *     不是随机噪点;造型为程序化平面挥翅(椭圆身 + 三角翼,翼尖垂直振荡)
 *   - 纸面液态位移:以红鲤为中心的位移场(径向推 + 切向旋),
 *     作用于横线/红线/纸边,鲤过回弹
 *
 * 交互:
 *   - 移动鼠标:附近字迹惊散化燕,横线被拨开
 *   - 静止后,燕子陆续归位变回字
 *
 * 时间轴(10s,首尾构图为无缝循环留口):
 *   0.0-0.5 安静建立(字迹完整,红鲤静于左上)
 *   0.5-3.0 燕群起,自上而下列字化燕
 *   3.0-5.0 文字接近化尽,燕群布满画面
 *   5.0-6.5 折返,上方先见零散笔画
 *   6.5-8.5 燕返成字,快速补全
 *   8.5-10.0 收尾,红鲤归隐左侧,呼应开头
 *
 * 音效(音画同源,全部 Engine.audio.emit):
 *   stream  水流环境声(intro 编排,全程 + 燕群经过时加强)
 *   flutter 扑翼:化燕 / 归位
 *   chirp   燕鸣:燕群在外时啁啾错落
 *   pluck   红鲤拨动横线如弦
 *   brush   燕落归位、墨迹重生
 *   swish   红鲤疾掠的拨水声
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;
  const BG = [242, 241, 238];
  const INK = [26, 23, 18];
  const RED = [176, 52, 39];
  const BLUE = [116, 150, 192];      // 稿纸横线蓝

  // 稿纸布局:上半页字,下半页空白横线
  const PAD_X = 128, PAD_Y = 178, PAD_W = 468, PAD_H = 676;
  const MARGIN_X = 158;              // 左侧红色竖线
  const LINE_GAP = 30;
  const TEXT_X = 172;
  const CHAR_SIZE = 20;

  // 信正文(上半页;节录张爱玲诀别信。字体子集只含这些字,勿增字)
  const LINES = [
    "我已经不喜欢你了,你是早已经不喜欢",
    "我的了。这次的决心,我是经过一年",
    "半的长时间考虑的,彼时唯以小吉故,",
    "不欲增加你的困难。",
    "曾经,见了你,我变得很低很低,低",
    "到尘埃里,还妄想着能从尘埃里开出",
    "花来。我以为,你是懂我的,在婚书",
    "上写下「愿岁月静好,现世安稳」,",
    "那一刻,我终于明白,我们之间再也",
    "回不去了。",
    "——张爱玲",
  ];

  // 红鲤巡游关键帧(t, x, y):静于左上 → 穿纸掠字 → 左侧盘绕
  // → 升起引导燕返 → 归隐左上(≈ 起点,留循环口)
  const BIRD_PATH = [
    [0.0, 152, 254], [0.5, 152, 254],
    [1.0, 290, 280], [1.6, 470, 350], [2.1, 520, 470],
    [2.6, 420, 580], [3.1, 250, 640], [3.6, 160, 580],
    [4.1, 230, 450], [4.6, 420, 380], [5.1, 520, 300],
    [5.6, 380, 250], [6.1, 210, 320], [6.7, 180, 480],
    [7.3, 260, 330], [8.0, 380, 280], [8.6, 260, 320],
    [9.2, 170, 290], [10.0, 152, 254],
  ];

  /* 自动演示轨迹(鼠标 = 惊燕):燕群巡游时搅动两下,随后离场 */
  const WAYPOINTS = [
    [3.2, 320, 330], [4.0, 480, 430], [4.9, 260, 520], [5.7, 430, 390],
    [6.6, 690, 220],
  ];

  /* 前景大燕(加强景深):少量大剪影掠过画面边缘,不落地 */
  const FORE_PATHS = [
    { s: 12.5, keys: [[1.2, -40, 300], [2.2, 300, 240], [3.4, 760, 420]] },
    { s: 10.5, keys: [[2.0, 760, 600], [3.2, 380, 520], [4.6, -40, 640]] },
    { s: 13.5, keys: [[5.6, -40, 700], [6.8, 340, 620], [8.2, 760, 540]] },
    { s: 11.0, keys: [[6.4, 760, 180], [7.4, 420, 260], [8.8, -40, 200]] },
  ];

  /* ---------------- 场景状态 ---------------- */
  let paper;
  let fontWrite;
  let koiImg = null;         // /assets/koi.png:红鲤贴图(透明底)
  let chars = [];            // 字迹(⇄ 燕子,同一粒子)
  let wilds = [];            // 野燕:片头飞入、片尾离场的散燕
  let ripples = [];          // 横线弦:每根线的位移/速度(弹簧 + 波动传播)
  let birdTrail = [];        // 红鲤尾迹(身后水痕)
  let strokePh = 0;          // 红鲤摆尾冲程相位
  let prevIy = null;         // 鼠标上一帧 y(算触线速度)
  let chirpTimer = 2.0;
  let swishCool = 0;
  let chirpA = false, chirpB = false;

  // 横线网格参数
  const RL_X0 = PAD_X + 8, RL_DX = 12;
  const RL_NX = Math.floor((PAD_W - 16) / RL_DX) + 1;
  const RL_NL = Math.floor((PAD_H - 24) / LINE_GAP) + 1;

  /* ---------------- 红鲤 ---------------- */
  function birdPos(t) {
    const P = BIRD_PATH;
    if (t <= P[0][0]) return [P[0][1], P[0][2]];
    let i = 0;
    while (i < P.length - 2 && t > P[i + 1][0]) i++;
    const [t0, x0, y0] = P[i], [t1, x1, y1] = P[i + 1];
    const p = u.ramp(t0, t1, t);
    // 飞行中的游移;栖息时近乎静止
    const rest = (t < 0.5 || t > 9.2) ? 0.15 : 1;
    return [
      u.mix(x0, x1, p) + (noise(300, t * 0.6) - 0.5) * 26 * rest,
      u.mix(y0, y1, p) + (noise(350, t * 0.6) - 0.5) * 20 * rest,
    ];
  }
  function birdVel(t) {
    const [x0, y0] = birdPos(Math.max(0, t - 0.05));
    const [x1, y1] = birdPos(t);
    return [(x1 - x0) / 0.05, (y1 - y0) / 0.05];
  }

  /* 任意关键帧路径插值(前景大燕用) */
  function pathPos(keys, t) {
    if (t <= keys[0][0] || t >= keys[keys.length - 1][0]) return null;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, x0, y0] = keys[i], [t1, x1, y1] = keys[i + 1];
    const p = u.ramp(t0, t1, t);
    return [u.mix(x0, x1, p), u.mix(y0, y1, p)];
  }

  /* ---------------- 构建(固定种子) ---------------- */
  function buildScene() {
    randomSeed(20240721);
    noiseSeed(31);
    chars = [];
    const lastLi = LINES.length - 1;
    for (let li = 0; li < LINES.length; li++) {
      const line = LINES[li];
      const y = PAD_Y + 62 + li * LINE_GAP;
      const row = li / lastLi;                 // 0=最上行 1=最下行
      const indent = line.startsWith("——") ? 220
        : (li === 0 || "曾那".includes(line[0])) ? 24 : 0;
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        const x = TEXT_X + indent + ci * CHAR_SIZE + CHAR_SIZE / 2;
        const stream = Math.floor(random(3));   // 隶属哪股燕流
        chars.push({
          ch, x, y,
          rot: (random() - 0.5) * 0.06,
          // 化燕时间波:自上而下漫过纸面(约 0.9s 起 4.3s 化尽)
          waveT: 0.9 + row * 3.2 + (random() - 0.5) * 0.5,
          // 归队时刻:自上而下先回(约 5.1s 起 7.5s 归尽)
          retT: 5.1 + row * 1.5 + random(0.9),
          state: "ink", vis: 1, pop: 1, bvis: 0,
          breakT: 0, breakStrong: false,
          fx: 0, fy: 0, fvx: 0, fvy: 0,
          seed: random(1000),
          stream,
          ring: 60 + random(170),               // 环绕半径(散开,像燕群而非球)
          // 相位量化到 4 团、转向同流一致:成群成带地飞(椋鸟群结构)
          ringA: Math.floor(random(4)) * (Math.PI / 2) + random(0.7),
          ringW: (0.7 + random(0.5)) * [1, -1, 1][stream],
          scl: pickScale(random()),
          threshold: 0.4 + random(0.25),
        });
      }
    }
    wilds = [];
    for (let i = 0; i < 42; i++) {
      const fromLeft = random() < 0.6;
      const stream = Math.floor(random(3));
      wilds.push({
        state: "out",
        enterT: 0.5 + random(1.1),
        exitT: 8.2 + random(1.3),
        sx: fromLeft ? -30 : 100 + random(400),   // 入场点(左上/上方画外)
        sy: fromLeft ? 120 + random(400) : -30,
        ex: W + 40, ey: 200 + random(500),        // 离场点(右侧画外)
        fx: 0, fy: 0, fvx: 0, fvy: 0,
        seed: random(1000),
        stream,
        ring: 60 + random(170),
        ringA: Math.floor(random(4)) * (Math.PI / 2) + random(0.7),
        ringW: (0.7 + random(0.5)) * [1, -1, 1][stream],
        scl: pickScale(random()),
        bvis: 0,
      });
    }
    ripples = [];
    for (let k = 0; k < RL_NL; k++) {
      ripples.push({ o: new Array(RL_NX).fill(0), v: new Array(RL_NX).fill(0), cool: 0 });
    }
    birdTrail = [];
    strokePh = 0;
    prevIy = null;
    chirpTimer = 2.0;
    swishCool = 0;
    chirpA = chirpB = false;
  }

  /* 燕子尺度:远处墨点、中景短弧、近处展翅 */
  function pickScale(r) {
    if (r < 0.30) return 1.2 + r * 3.3;          // 1.2–2.2 墨点
    if (r < 0.75) return 2.6 + (r - 0.30) * 4.0; // 2.6–4.4 短弧
    return 5.0 + (r - 0.75) * 10.0;              // 5.0–7.5 展翅
  }

  function buildPaper() {
    paper = createGraphics(W, H);
    paper.background(BG[0], BG[1], BG[2]);
    paper.noStroke();
    for (let i = 0; i < 1800; i++) {
      const g = 215 + Math.random() * 40;
      paper.fill(g, g, g - 4, 10);
      paper.circle(Math.random() * W, Math.random() * H, 1 + Math.random() * 1.5);
    }
    // 悬浮稿纸:柔和投影 + 纸面(边缘由 drawPaperEdge 活画,便于液态拉扯)
    const ctx = paper.drawingContext;
    ctx.shadowColor = "rgba(30,26,20,0.13)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    paper.fill(250, 249, 244);
    paper.rect(PAD_X, PAD_Y, PAD_W, PAD_H, 2);
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  /* ---------------- 状态机 ---------------- */
  /* 化燕第一步:笔画被"啄散"(短暂碎裂态,边缘因此不规则) */
  function startBreak(c, t, strong) {
    c.state = "break";
    c.breakT = t;
    c.breakStrong = strong;
  }

  function toBird(c, t, strong) {
    c.state = "bird";
    c.fx = c.x; c.fy = c.y;
    const away = Math.atan2(c.y - birdPos(t)[1], c.x - birdPos(t)[0])
               + (noise(c.seed, 7) - 0.5) * 1.8;
    const v = strong ? 140 + noise(c.seed, 3) * 130 : 100;
    c.fvx = Math.cos(away) * v;
    c.fvy = Math.sin(away) * v - 40;
    Engine.audio.emit("flutter", { gain: 0.05, pitch: 0.9 + noise(c.seed, 5) * 0.3 });
  }

  /* 触线:位移脉冲打进最近的横线点,沿弦传播;大速度附带一声弦响 */
  function rippleTouch(x, y, vy) {
    const k = Math.round((y - (PAD_Y + 32)) / LINE_GAP);
    if (k < 0 || k >= ripples.length) return;
    const r = ripples[k];
    const i = Math.round((x - RL_X0) / RL_DX);
    if (i < 1 || i >= r.o.length - 1) return;
    r.v[i] += vy * 0.3;
    if (r.cool <= 0 && Math.abs(vy) > 150) {
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

  /* 游移涡心:左一股、右一股(部分时间在画外,燕群得以进出画) */
  function streamCenter(s, t) {
    if (s === 1) return [105 + 95 * Math.cos(t * 0.5 + 2.0), 500 + 255 * Math.sin(t * 0.5 + 2.0)];
    return [615 + 125 * Math.cos(-t * 0.42 + 0.7), 330 + 215 * Math.sin(-t * 0.42 + 0.7)];
  }

  /* 燕群飞行:同流同相位的燕团绕涡心滑行(团+带结构),噪声收小,
     速度放开到 420 有穿梭感;鼠标搅动时燕群避让 */
  function flockFly(p, dt, t, input) {
    const c = p.stream === 0 ? birdPos(t) : streamCenter(p.stream, t);
    const ang = p.ringA + t * p.ringW;
    // 半径呼吸同流同相(整团一起胀缩,不散成晕)
    const rr = p.ring * (0.75 + 0.25 * Math.sin(t * 0.7 + p.stream * 2.1));
    const gx = c[0] + Math.cos(ang) * rr;
    const gy = c[1] + Math.sin(ang) * rr * 0.78;
    p.fvx += ((gx - p.fx) * 2.6 + (noise(p.seed, t * 1.1) - 0.5) * 320) * dt;
    p.fvy += ((gy - p.fy) * 2.6 + (noise(p.seed + 40, t * 1.1) - 0.5) * 320) * dt;
    if (input.active && input.D > 0.05) {   // 鼠标搅动:燕群避让
      const dm = Math.hypot(p.fx - input.x, p.fy - input.y);
      const g = u.gauss(dm, 90) * input.D;
      p.fvx += (p.fx - input.x) / (dm + 1e-3) * 900 * g * dt;
      p.fvy += (p.fy - input.y) / (dm + 1e-3) * 900 * g * dt;
    }
    p.fvx *= (1 - 2.0 * dt); p.fvy *= (1 - 2.0 * dt);
    capSpeed(p, 420);
    p.fx += p.fvx * dt; p.fy += p.fvy * dt;
    p.bvis = Math.min(1, p.bvis + dt * 5);
  }

  function flyTo(p, tx, ty, k, dampNear, dampFar, dt) {
    p.fvx += (tx - p.fx) * k * dt;
    p.fvy += (ty - p.fy) * k * dt;
    const d = Math.hypot(tx - p.fx, ty - p.fy);
    const damp = d < 70 ? dampNear : dampFar;
    p.fvx *= (1 - damp * dt); p.fvy *= (1 - damp * dt);
    capSpeed(p, 340);
    p.fx += p.fvx * dt; p.fy += p.fvy * dt;
    return d;
  }

  function capSpeed(p, max) {
    const sp = Math.hypot(p.fvx, p.fvy);
    if (sp > max) { p.fvx *= max / sp; p.fvy *= max / sp; }
  }

  function sceneUpdate(dt, t, input) {
    const [bx, by] = birdPos(t);
    const [bvx, bvy] = birdVel(t);
    const birdSpeed = Math.hypot(bvx, bvy);
    // 尾迹(运动模糊用)
    birdTrail.push([bx, by, Math.atan2(bvy, bvx)]);
    if (birdTrail.length > 14) birdTrail.shift();

    // 片头两声远远的燕鸣(现场/渲染双端一致,故走 update 而非 intro 调度)
    if (!chirpA && t > 0.8) { chirpA = true; Engine.audio.emit("chirp", { gain: 0.035, pitch: 1.06 }); }
    if (!chirpB && t > 1.5) { chirpB = true; Engine.audio.emit("chirp", { gain: 0.03, pitch: 0.94 }); }

    // 摆尾冲程:频率随速度;疾掠时一声拨水(限流)
    strokePh += dt * Math.PI * 2 * (0.7 + birdSpeed / 260);
    swishCool -= dt;
    if (swishCool <= 0 && birdSpeed > 200) {
      swishCool = 0.9;
      Engine.audio.emit("swish", {
        gain: Math.min(0.05, 0.02 + birdSpeed * 0.00006),
        pitch: 0.85 + birdSpeed / 1600,
      });
    }

    // 线:红鲤与鼠标碰触;鸟群抽样压线;波动传播
    rippleTouch(bx, by, bvy);
    if (input.active) {
      if (prevIy !== null) rippleTouch(input.x, input.y, (input.y - prevIy) / Math.max(dt, 1e-3) * 0.6);
      prevIy = input.y;
    } else prevIy = null;
    for (let i = 0; i < chars.length; i += 9) {
      const c = chars[i];
      if (c.state === "bird") rippleTouch(c.fx, c.fy, c.fvy * 0.4);
    }
    rippleStep(dt);

    /* --- 字迹粒子 --- */
    for (const c of chars) {
      if (c.state === "ink") {
        c.vis = Math.min(1, c.vis + dt * 3);
        c.pop = Math.min(1, c.pop + dt * 2.2);
        if (c.pop < 0.9) continue;             // 刚归位的字不再立刻惊散
        const dBird = Math.hypot(c.x - bx, c.y - by);
        const dMouse = Math.hypot(c.x - input.x, c.y - input.y);
        const fear = input.D * u.gauss(dMouse, 85);
        // 化燕:鼠标惊散(随时) / 红鲤临近或时间波抵达(仅前 5.2s,
        // 之后进入燕返阶段,归位的字不再被反复化开)
        if (fear > c.threshold
            || (t > 0.5 && t < 5.2 && (dBird < 115 || t > c.waveT))) {
          startBreak(c, t, dBird < 115);
        }
      } else if (c.state === "break") {
        if (t - c.breakT > 0.16 + noise(c.seed, 5) * 0.12) toBird(c, t, c.breakStrong);
      } else {   // bird
        c.vis = Math.max(0, c.vis - dt * 4.5);
        if (t < c.retT) {
          flockFly(c, dt, t, input);
        } else {
          // 燕返:飞回家(越晚归队越慢;近家强阻尼,到家即稳)
          const late = Math.min(1, (c.retT - 5.1) / 2.4);
          const dHome = flyTo(c, c.x, c.y, 7.5 - late * 3.0, 6.0, 3.2, dt);
          const near = dHome < 14 && Math.hypot(c.fvx, c.fvy) < 120;
          if (near || t > c.retT + 1.3) {   // 兜底:到点强制归位
            c.state = "ink";
            c.vis = 0.3; c.pop = 0;
            if (noise(c.seed, 13) < 0.3) {   // 落笔声稀疏化
              Engine.audio.emit("brush", { gain: 0.035, pitch: 0.85 + noise(c.seed, 11) * 0.4 });
            }
          }
        }
      }
    }

    /* --- 野燕:片头飞入,片尾离场 --- */
    for (const w of wilds) {
      if (w.state === "out") {
        if (t > w.enterT) {
          w.state = "bird";
          w.fx = w.sx; w.fy = w.sy;
          w.fvx = (W / 2 - w.sx) * 0.5; w.fvy = (H / 2 - w.sy) * 0.4;
        }
      } else if (w.state === "bird") {
        if (t < w.exitT) flockFly(w, dt, t, input);
        else w.state = "exit";
      } else if (w.state === "exit") {
        flyTo(w, w.ex, w.ey, 5.0, 1.2, 1.2, dt);
        if (w.fx > W + 30) w.state = "gone";
      }
    }

    // 燕鸣:燕群在外时啁啾错落
    let airborne = 0;
    for (const c of chars) if (c.state === "bird") airborne++;
    for (const w of wilds) if (w.state === "bird" || w.state === "exit") airborne++;
    if (airborne > 50) {
      chirpTimer -= dt;
      if (chirpTimer <= 0) {
        chirpTimer = 0.8 + noise(t * 7.3) * 1.2;
        Engine.audio.emit("chirp", { gain: 0.04, pitch: 0.92 + noise(t * 3.1) * 0.25 });
      }
    }

    Engine.audio.setShimmer(Math.min(1, airborne / 120) * 0.03 + input.D * 0.012);
  }

  /* ---------------- 液态位移场 ---------------- */
  /* 以红鲤为中心的位移:径向推开 + 切向旋卷,随速度增强,首尾安静;
     鼠标搅动也有局部推挤。横线/红线/纸边共用。 */
  function liquify(x, y, t) {
    const [bx, by] = birdPos(t);
    const [vx, vy] = birdVel(t);
    const sp = Math.hypot(vx, vy);
    const amp = u.ramp(0.6, 1.2, t) * (1 - u.ramp(9.0, 9.8, t)) * Math.min(1, sp / 200);
    const d = Math.hypot(x - bx, y - by);
    const g = u.gauss(d, 105) * amp;
    const rx = (x - bx) / (d + 1e-3), ry = (y - by) / (d + 1e-3);
    let dx = (rx * 26 - ry * 15) * g + vx * 0.035 * g;
    let dy = (ry * 26 + rx * 15) * g + vy * 0.035 * g;
    if (Engine.input.active && Engine.input.D > 0.05) {
      const m = Engine.input;
      const dm = Math.hypot(x - m.x, y - m.y);
      const gm = u.gauss(dm, 80) * m.D;
      dx += (x - m.x) / (dm + 1e-3) * 16 * gm;
      dy += (y - m.y) / (dm + 1e-3) * 16 * gm;
    }
    return [dx, dy];
  }

  /* ---------------- 绘制 ---------------- */
  // 横线稿:手绘感横线,带触弦振动 + 红鲤液态位移;左侧红色竖线同场
  function drawLines(t) {
    push();
    noFill();
    strokeWeight(1);
    for (let k = 0; k < ripples.length; k++) {
      const y0 = PAD_Y + 32 + k * LINE_GAP;
      const r = ripples[k];
      stroke(BLUE[0], BLUE[1], BLUE[2], 100);
      beginShape();
      for (let i = 0; i < r.o.length; i++) {
        const x = RL_X0 + i * RL_DX;
        const lq = liquify(x, y0, t);
        const y = y0 + Math.sin(x * 0.045 + k * 2.1 + t * 0.8) * 1.6 + r.o[i] + lq[1];
        curveVertex(x + lq[0] * 0.7, y);
      }
      endShape();
    }
    // 左侧红色竖线(同一位移场)
    stroke(RED[0], RED[1], RED[2], 120);
    beginShape();
    for (let y = PAD_Y + 10; y <= PAD_Y + PAD_H - 10; y += 14) {
      const lq = liquify(MARGIN_X, y, t);
      curveVertex(MARGIN_X + Math.sin(y * 0.05 + t * 0.6) * 2 + lq[0] * 0.8, y + lq[1] * 0.8);
    }
    endShape();
    pop();
  }

  /* 纸边:手绘抖动 + 呼吸起伏 + 红鲤附近的液态拉扯(活画,不烘焙) */
  function drawPaperEdge(t) {
    const cx = PAD_X + PAD_W / 2, cy = PAD_Y + PAD_H / 2;
    push();
    noFill();
    stroke(172, 174, 164, 130);
    strokeWeight(1);
    beginShape();
    const pts = [];
    const step = 22;
    for (let x = PAD_X; x <= PAD_X + PAD_W; x += step) pts.push([x, PAD_Y]);
    for (let y = PAD_Y + step; y <= PAD_Y + PAD_H; y += step) pts.push([PAD_X + PAD_W, y]);
    for (let x = PAD_X + PAD_W - step; x >= PAD_X; x -= step) pts.push([x, PAD_Y + PAD_H]);
    for (let y = PAD_Y + PAD_H - step; y >= PAD_Y + step; y -= step) pts.push([PAD_X, y]);
    for (const [px, py] of pts) {
      const dc = Math.hypot(px - cx, py - cy);
      const nx = (px - cx) / dc, ny = (py - cy) / dc;
      const wob = (noise(px * 0.02, py * 0.02, t * 0.25) - 0.5) * 3.4;
      const lq = liquify(px, py, t);
      curveVertex(px + nx * wob + lq[0] * 0.7, py + ny * wob + lq[1] * 0.7);
    }
    endShape(CLOSE);
    pop();
  }

  function drawChars(t) {
    push();
    textAlign(CENTER, CENTER);
    textFont(fontWrite);
    textSize(19);
    for (const c of chars) {
      if (c.state === "bird" || c.vis <= 0.01) continue;
      push();
      if (c.state === "break") {
        // 碎裂:笔画被啄散的一瞬间(抖动 + 闪烁)
        translate(c.x + (noise(c.seed, t * 36) - 0.5) * 5,
                  c.y + (noise(c.seed + 3, t * 36) - 0.5) * 5);
        rotate(c.rot + (noise(c.seed + 9, t * 30) - 0.5) * 0.1);
        fill(INK[0], INK[1], INK[2],
             235 * c.vis * (0.5 + 0.5 * noise(c.seed + 7, t * 30)));
      } else {
        translate(c.x, c.y);
        rotate(c.rot);
        const s = 0.55 + 0.45 * u.easeOutCubic(c.pop);   // 归位:燕影缩成笔画
        scale(s);
        fill(INK[0], INK[1], INK[2], 235 * Math.min(1, c.vis));
      }
      text(c.ch, 0, 0);
      pop();
    }
    pop();
  }

  /* 墨燕(俯视图):双翼左右对称展开的燕子剪影,两翼尖在平面内同步
     张合振荡(sketch 式挥翅);朝向平面内随航向;远处只是小墨点 */
  function drawBirdSprite(x, y, vx, vy, s, seed, t, alpha) {
    if (s < 2.4) {                              // 远:一个墨点
      noStroke();
      fill(INK[0], INK[1], INK[2], alpha);
      circle(x, y, s * 1.8);
      return;
    }
    const sp = Math.hypot(vx, vy);
    const wing = Math.sin(t * (8 + sp * 0.02) + seed * 9);   // 扇翅相位(随速度)
    const heading = Math.atan2(vy, vx);
    push();
    translate(x, y);
    rotate(heading);                            // 平面内整体转向
    noStroke();
    fill(INK[0], INK[1], INK[2], alpha);
    // 双翼(俯视对称):翼尖随扇翅张合(展 = 上挥,收 = 下挥)
    const tipX = -s * (0.45 + 0.2 * wing);
    const tipY = s * (1.25 + 0.75 * wing);
    for (const side of [-1, 1]) {
      beginShape();
      vertex(s * 0.3, side * s * 0.12);                            // 肩前
      quadraticVertex(tipX * 0.5 + s * 0.35, side * tipY * 0.55,
                      tipX, side * tipY);                          // 前缘到翼尖
      quadraticVertex(tipX * 0.55 - s * 0.3, side * tipY * 0.5,
                      -s * 0.15, side * s * 0.28);                 // 后缘回肩后
      endShape(CLOSE);
    }
    // 长叉尾(燕子招牌,压在身下)
    triangle(-s * 0.85, -s * 0.03, -s * 1.85, -s * 0.46, -s * 1.7, -s * 0.09);
    triangle(-s * 0.85, s * 0.03, -s * 1.85, s * 0.46, -s * 1.7, s * 0.11);
    // 身体:流线泪滴(头右尾左) + 尖喙
    beginShape();
    vertex(s * 1.1, -s * 0.05);                                    // 喙尖
    quadraticVertex(s * 0.95, -s * 0.32, s * 0.45, -s * 0.28);     // 头顶
    quadraticVertex(-s * 0.5, -s * 0.22, -s * 0.95, -s * 0.02);    // 背 → 尾根
    quadraticVertex(-s * 0.5, s * 0.24, s * 0.4, s * 0.2);         // 腹
    quadraticVertex(s * 0.92, s * 0.14, s * 1.1, -s * 0.05);       // 颌
    endShape(CLOSE);
    pop();
  }

  function drawInkBirds(t) {
    push();
    for (const c of chars) {
      if (c.state !== "bird" || c.bvis <= 0.02) continue;
      drawBirdSprite(c.fx, c.fy, c.fvx, c.fvy, c.scl, c.seed, t, 225 * c.bvis);
    }
    for (const w of wilds) {
      if ((w.state !== "bird" && w.state !== "exit") || w.bvis <= 0.02) continue;
      drawBirdSprite(w.fx, w.fy, w.fvx, w.fvy, w.scl, w.seed, t, 215 * w.bvis);
    }
    pop();
  }

  /* 前景大燕:越过画面边缘,加强景深(无摄影虚化) */
  function drawForeBirds(t) {
    push();
    for (const f of FORE_PATHS) {
      const p0 = pathPos(f.keys, Math.max(0, t - 0.06));
      const p1 = pathPos(f.keys, t);
      if (!p1) continue;
      drawBirdSprite(p1[0], p1[1],
                     p0 ? (p1[0] - p0[0]) / 0.06 : 60, p0 ? (p1[1] - p0[1]) / 0.06 : 0,
                     f.s, f.s * 3, t, 200);
    }
    pop();
  }

  /* 红鲤:koi.png 贴图 + 脊椎条带波浪(游戏式游动)——贴图切成竖条,
     每条按从头向尾传播的行波横向错动,身体如真鱼般扭动;
     叠加冲程涌动、转弯侧倾与身后水痕 */
  function drawRedCarp(t) {
    // 水痕(尾迹渐隐)
    push();
    noFill();
    strokeWeight(1.2);
    for (let i = 1; i < birdTrail.length; i++) {
      const [x0, y0] = birdTrail[i - 1], [x1, y1] = birdTrail[i];
      stroke(RED[0], RED[1], RED[2], 26 * (i / birdTrail.length));
      line(x0, y0, x1, y1);
    }
    pop();
    if (!koiImg) return;

    const [fx, fy] = birdPos(t);
    const [vx, vy] = birdVel(t);
    const speed = Math.hypot(vx, vy);
    const ang = Math.atan2(vy, vx);
    // 转弯侧倾:朝向变化率 → 身体侧滚
    const [pvx, pvy] = birdVel(Math.max(0, t - 0.12));
    const turn = (Math.atan2(vy, vx) - Math.atan2(pvy, pvx)) / 0.12;
    const roll = Math.max(-0.35, Math.min(0.35, turn * 0.18));
    // 冲程涌动:摆尾推进时身体沿泳向一冲一滑
    const surge = Math.sin(strokePh) * Math.min(3, 0.8 + speed * 0.006);
    const sx = fx + Math.cos(ang) * surge, sy = fy + Math.sin(ang) * surge;

    push();
    translate(sx, sy);
    rotate(speed > 8 ? ang + roll : Math.sin(t * 1.2) * 0.1);   // 静止时轻轻摇晃
    // 骨骼链波浪:先算脊椎曲线上每节的点位,再逐节按切线角摆放贴图条带
    // (条带随关节旋转而非上下错动,关节连续,游动丝滑);
    // 静止时小幅怠速摆动,游动时波幅随速度
    const amp = 1.6 + Math.min(6.5, speed * 0.022);
    const KW = 118, KH = KW * koiImg.height / koiImg.width;
    const N = 30, dw = KW / N, sw = koiImg.width / N;
    const spine = [];
    for (let i = 0; i < N; i++) {
      const f0 = (i + 0.5) / N;                          // 0=尾鳍端 1=头端
      const envelope = 0.15 + 0.85 * Math.pow(1 - f0, 1.2);   // 波幅向尾部递增
      spine.push([
        -KW / 2 + f0 * KW,
        Math.sin(strokePh * 1.6 - f0 * 3.0) * amp * envelope,
      ]);
    }
    imageMode(CENTER);
    for (let i = 0; i < N; i++) {
      const [x, y] = spine[i];
      const [xa, ya] = spine[Math.max(0, i - 1)];
      const [xb, yb] = spine[Math.min(N - 1, i + 1)];
      push();
      translate(x, y);
      rotate(Math.atan2(yb - ya, xb - xa));              // 局部切线角
      image(koiImg, 0, 0, dw + 0.8, KH,
            Math.floor(i * sw), 0, Math.ceil(sw), koiImg.height);
      pop();
    }
    pop();
  }

  function drawTitle(t) {
    const a = u.ramp(0.5, 0.9, t);   // 标题与署名随开场一起出现(各场景通用格式)
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
    const a = u.ramp(3.2, 4.2, t) * (1 - u.ramp(8.5, 9.5, t));
    if (a <= 0) return;
    push();
    textAlign(CENTER, BASELINE);
    textFont("Courier New");   // 提示用系统字体(手写体子集不含这些字)
    textStyle(NORMAL);
    textSize(13);
    fill(INK[0], INK[1], INK[2], 140 * a * (0.7 + 0.3 * Math.sin(t * 2)));
    text("移 动 鼠 标 · 惊 起 一 纸 燕", W / 2, 940);
    pop();
  }

  function render(t) {
    image(paper, 0, 0);
    drawLines(t);
    drawPaperEdge(t);
    drawChars(t);
    drawInkBirds(t);
    drawForeBirds(t);
    drawRedCarp(t);
    drawTitle(t);
    drawHint(t);
    // 开场整体淡入(稿纸居中出现)
    const fade = 1 - u.ramp(0, 0.45, t);
    if (fade > 0) {
      push();
      noStroke();
      fill(BG[0], BG[1], BG[2], 255 * fade);
      rect(0, 0, W, H);
      pop();
    }
  }

  /* ---------------- 注册场景 ---------------- */
  Engine.start({
    id: "yanfan",
    width: W, height: H, duration: 10,
    waypoints: WAYPOINTS,
    input: { attack: 5.0, release: 1.0 },
    preload() {
      fontWrite = loadFont("/assets/fonts/mashanzheng-sub.ttf");   // p5 loadFont 只认 ttf/otf
      koiImg = loadImage("/assets/koi.png");      // 红鲤贴图
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
        // 只用支持 schedule 的配方(stream/brush/pluck),现场与离线合成双端一致
        return [
          // 全程水流声 + 燕群巡游时加强
          { t: 0.1, type: "stream", dur: 10, gain: 0.042 },
          { t: 1.8, type: "stream", dur: 6.2, gain: 0.05 },
          { t: 0.35, type: "brush", gain: 0.03, pitch: 0.9 },       // 一笔落纸
          { t: 8.9, type: "pluck", freq: u.noteFreq(-5), gain: 0.03, decay: 1.4 },
          { t: 9.35, type: "pluck", freq: u.noteFreq(2), gain: 0.028, decay: 1.4 },
        ];
      },
    },
    ui: {
      tip: "点击开始播放",
      sub: "燕返 · 字化成燕,燕归成书 · @GeekCatX",
      narration: [
        { t: 0.9, text: "一纸手写信。红鲤游过,字迹化燕而去。" },
        { t: 8.6, text: "燕群归来,字还是那些字。" },
      ],
    },
  });
})();
