/* ============================================================
 * 提线木偶(puppet)— 可操纵的球关节木偶(p5.js 程序化动画,引擎场景实现)
 *
 * 创意(按 demo/提线木偶.png 设计图):
 *   - 上方大手(复用 assets/hand.png,垂直翻转)垂下 5 根红色提线,
 *     拴着一只球关节木偶:尖帽、拉夫领、舞裙、木质圆关节
 *   - 木偶 = verlet 质点骨骼:头/颈/胸/胯 + 双臂(肩肘腕)+ 双腿(胯膝足),
 *     骨骼定长约束 + 重力 + 提线绳约束(松弛垂坠、绷紧拖拽)
 *   - 鼠标 = 操纵者的手:移动手提木偶起舞;快速甩动 → 线松弛、四肢乱飞;
 *     静止 → 木偶垂回平衡姿态轻轻摇晃
 *
 * 音效(音画同源,全部 Engine.audio.emit):
 *   pluck   提线由松转绷(每根线一个音高)/ 开场逐根挂线
 *   knock   木关节:足尖触地、肘/膝打直瞬间
 *   takeoff 猛甩(下滑音 + 风声)
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;
  const INK = [26, 23, 18];
  const RED = [176, 52, 39];
  const WOOD = [221, 203, 168];      // 木质四肢
  const SKIN = [238, 230, 214];      // 脸 / 手套

  // 手布局(垂直翻转后的 hand.png,指尖朝下;中心参考点 + 偏移)
  const HAND_CX = 360, HAND_CY = 95, HAND_W = 125, HAND_H = 191;
  // 指尖锚点(hand.png 局部坐标 179×274):食指/中指/无名指/小指/拇指侧
  const FINGERS = [
    [41, 8], [61, 24], [73, 35], [99, 74], [24, 44],
  ];
  const FINGERS_SPREAD = 1.25;  // 锚点横向散开,提线呈扇形

  const FLOOR_Y = 845;               // 隐形地板(足尖可点地)
  const GRAV = 1500;
  const SUB = 1 / 60;                // 物理子步长

  /* 自动演示轨迹:(t, x, y) 折线;渲染模式与 ?auto=1 共用。
     节奏:提起 → 左右荡 → 下蹲点地 → 猛提甩飞 → 回落轻摆 → 收 */
  const WAYPOINTS = [
    [3.2, 360, 240], [4.2, 235, 205], [5.0, 520, 200], [5.8, 380, 400],
    [6.4, 360, 130], [7.1, 200, 300], [7.8, 530, 245], [8.5, 300, 160],
    [9.2, 500, 390], [9.9, 360, 200], [10.8, 325, 235], [11.8, 395, 215],
    [12.8, 360, 240],
  ];

  /* ---------------- 场景状态 ---------------- */
  let paper;
  let imgHand;
  let pts = {};            // verlet 质点 {x,y,px,py}
  let bones = [];          // 定长约束 [a, b, len]
  let strings = [];        // 提线 {finger, pt, rest, freq, growT, prevExt, attached}
  let joints = [];         // 关节打直检测 {a,b,c, cooldown, pitch}
  let handOx = 0, handOy = 0, handVx = 0, handVy = 0;
  let physAcc = 0;
  let whooshCool = 0;

  /* ---------------- 构建(固定种子) ---------------- */
  function mkPt(x, y) { return { x, y, px: x, py: y }; }

  function buildPuppet() {
    randomSeed(20240720);
    noiseSeed(23);
    bones = [];

    // 悬挂平衡姿态(hip 为中心)
    pts = {
      head: mkPt(360, 396),
      neck: mkPt(360, 428),
      chest: mkPt(360, 472),
      hip: mkPt(360, 538),
      shL: mkPt(331, 476), elL: mkPt(303, 528), wrL: mkPt(291, 582),
      shR: mkPt(389, 476), elR: mkPt(417, 528), wrR: mkPt(429, 582),
      kneeL: mkPt(344, 612), footL: mkPt(338, 684),
      kneeR: mkPt(376, 612), footR: mkPt(384, 680),
    };
    const B = (a, b) => bones.push([a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y)]);
    // 躯干(三角化保持刚性)
    B("neck", "chest"); B("chest", "hip"); B("neck", "hip");
    B("head", "neck");
    B("chest", "shL"); B("chest", "shR"); B("shL", "shR");
    B("shL", "elL"); B("elL", "wrL"); B("shR", "elR"); B("elR", "wrR");
    B("hip", "kneeL"); B("kneeL", "footL"); B("hip", "kneeR"); B("kneeR", "footR");
    B("kneeL", "kneeR");

    // 提线:指尖 → 头/双腕/双膝,音高按五声音阶
    const PENTA = [0, 3, 5, 7, 10];
    const DEFS = [
      [0, "head"], [1, "wrL"], [2, "wrR"], [3, "kneeL"], [4, "kneeR"],
    ];
    strings = DEFS.map(([f, p], i) => {
      const [ax, ay] = anchorHome(f);
      const rest = Math.hypot(pts[p].x - ax, pts[p].y - ay) + 18 + i * 6;
      return {
        finger: f, pt: p, rest,
        freq: u.noteFreq(PENTA[i] + 12),
        growT: 0.5 + i * 0.22,      // 开场逐根放出
        prevExt: 0, attached: false,
      };
    });

    // 关节打直检测(肘/膝):a-b-c 三点,b 为关节
    joints = [
      { a: "shL", b: "elL", c: "wrL", cool: 0, pitch: 1.25 },
      { a: "shR", b: "elR", c: "wrR", cool: 0, pitch: 1.25 },
      { a: "hip", b: "kneeL", c: "footL", cool: 0, pitch: 0.95 },
      { a: "hip", b: "kneeR", c: "footR", cool: 0, pitch: 0.95 },
    ];

    // 开场瘫坐:整体下移、四肢微收(random 在种子序列内,顺序勿动)
    for (const k of Object.keys(pts)) {
      pts[k].y += 128;
      pts[k].x += (random() - 0.5) * 10;
      pts[k].px = pts[k].x; pts[k].py = pts[k].y;
    }
    // 每根线的"放长"初始值:够到瘫坐姿态 + 余量;开场由它收紧到 rest,木偶被提起
    for (const s of strings) {
      const [ax, ay] = anchorHome(s.finger);
      s.slack0 = Math.hypot(pts[s.pt].x - ax, pts[s.pt].y - ay) + 26;
    }
    handOx = 0; handOy = 0; handVx = 0; handVy = 0;
    physAcc = 0; whooshCool = 0;
  }

  function buildPaper() {
    paper = createGraphics(W, H);
    paper.background(234, 228, 211);
    paper.noStroke();
    for (let i = 0; i < 2200; i++) {
      const g = 200 + Math.random() * 55;
      paper.fill(g, g - 8, g - 30, 14);
      paper.circle(Math.random() * W, Math.random() * H, 1 + Math.random() * 1.6);
    }
  }

  /* ---------------- 手 ---------------- */
  // 指尖在画布上的静止位置(手居中、无偏移/旋转时)
  function anchorHome(f) {
    const [lx, ly] = FINGERS[f];
    const sx = HAND_W / 179, sy = HAND_H / 274;
    // 垂直翻转:局部 y 越小(指尖)在画布上越靠下
    return [
      HAND_CX + (lx * sx - HAND_W / 2) * FINGERS_SPREAD,
      HAND_CY + (HAND_H / 2 - ly * sy),
    ];
  }

  function handTarget(input) {
    if (input.active) {
      return [
        Math.max(140, Math.min(580, input.x)) - HAND_CX,
        Math.max(50, Math.min(500, input.y)) - HAND_CY,
      ];
    }
    return [0, 0];
  }

  function fingerAnchor(f, t) {
    const [hx, hy] = anchorHome(f);
    const rot = handRot(t);
    const dx = hx - HAND_CX, dy = hy - HAND_CY;
    const c = Math.cos(rot), s = Math.sin(rot);
    return [
      HAND_CX + handOx + dx * c - dy * s,
      HAND_CY + handOy + dx * s + dy * c,
    ];
  }

  function handRot(t) {
    return Math.sin(t * 0.7) * 0.012 + handOx * 0.00025 + Engine.input.D * Math.sin(t * 2.1) * 0.02;
  }

  /* ---------------- 物理 ---------------- */
  function physStep(dt, t) {
    const damp = 0.994;
    // 手的跟随(弹簧,带惯性)
    const [tx, ty] = handTarget(Engine.input);
    handVx += ((tx - handOx) * 26 - handVx * 7) * dt;
    handVy += ((ty - handOy) * 26 - handVy * 7) * dt;
    handOx += handVx * dt; handOy += handVy * dt;

    // verlet 积分
    const D = Engine.input.D;
    for (const k of Object.keys(pts)) {
      const p = pts[k];
      const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
      p.px = p.x; p.py = p.y;
      // 待机呼吸:胸/头受微弱噪声力,木偶轻轻摇晃
      const breathe = (k === "chest" || k === "head") ? (1 - D) * 260 : 60;
      const nx = (noise(p.x * 0.01, t * 0.6) - 0.5) * breathe;
      p.x += vx + nx * dt * dt;
      p.y += vy + GRAV * dt * dt;
    }

    // 约束迭代
    for (let it = 0; it < 9; it++) {
      for (const [a, b, len] of bones) {
        const pa = pts[a], pb = pts[b];
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - len) / d * 0.5;
        pa.x += dx * diff; pa.y += dy * diff;
        pb.x -= dx * diff; pb.y -= dy * diff;
      }
      // 地板
      for (const k of ["footL", "footR", "kneeL", "kneeR", "hip", "wrL", "wrR"]) {
        const p = pts[k];
        if (p.y > FLOOR_Y) {
          p.y = FLOOR_Y;
          p.x += (p.px - p.x) * 0.4;       // 摩擦
        }
      }
    }
    // 提线:绳约束(只在绷紧时拉);开场从"放长"逐渐收紧到 rest,木偶被提起。
    // 每个子步限幅牵引(绞盘式),一次大纠偏会变成瞬时速度把木偶弹射上天
    for (const s of strings) {
      const grow = u.easeOutCubic(u.ramp(s.growT, s.growT + 1.1, t));
      if (grow <= 0) continue;
      const L = u.mix(s.slack0, s.rest, grow);
      const [ax, ay] = fingerAnchor(s.finger, t);
      const p = pts[s.pt];
      let dx = p.x - ax, dy = p.y - ay;
      const d = Math.hypot(dx, dy) || 1e-6;
      if (d > L) {
        const step = Math.min((d - L) * 0.9, 7);
        p.x -= dx / d * step; p.y -= dy / d * step;
      }
    }
  }

  /* ---------------- 状态机 / 音效触发 ---------------- */
  function sceneUpdate(dt, t, input) {
    physAcc = Math.min(physAcc + dt, SUB * 5);
    while (physAcc >= SUB) { physStep(SUB, t); physAcc -= SUB; }

    // 提线事件:由松转绷的拨弦(开场挂线声由 audio.intro 定点播放)
    for (const s of strings) {
      const grow = u.ramp(s.growT, s.growT + 1.1, t);
      if (!s.attached && grow >= 0.99) s.attached = true;
      if (s.attached) {
        const [ax, ay] = fingerAnchor(s.finger, t);
        const p = pts[s.pt];
        const d = Math.hypot(p.x - ax, p.y - ay);
        const ext = d / s.rest;
        const rv = Math.hypot(p.x - p.px, p.y - p.py) / SUB;   // 末端速度
        if (s.prevExt < 0.97 && ext >= 1.0 && rv > 200) {
          Engine.audio.emit("pluck", {
            freq: s.freq, gain: Math.min(0.12, rv / 5000), decay: 0.9,
          });
        }
        s.prevExt = ext;
      }
    }

    // 关节打直 knock(肘/膝接近伸直且角速度快)
    for (const j of joints) {
      j.cool -= dt;
      const pa = pts[j.a], pb = pts[j.b], pc = pts[j.c];
      const v1 = [pa.x - pb.x, pa.y - pb.y], v2 = [pc.x - pb.x, pc.y - pb.y];
      const d1 = Math.hypot(...v1) || 1e-6, d2 = Math.hypot(...v2) || 1e-6;
      const cosA = (v1[0] * v2[0] + v1[1] * v2[1]) / (d1 * d2);
      const spd = Math.hypot(pc.x - pc.px, pc.y - pc.py) / SUB;
      if (cosA > 0.994 && spd > 320 && j.cool <= 0) {
        j.cool = 0.28;
        Engine.audio.emit("knock", { gain: Math.min(0.11, spd / 6000), pitch: j.pitch });
      }
    }

    // 足尖点地 knock
    for (const k of ["footL", "footR"]) {
      const p = pts[k];
      const vy = (p.y - p.py) / SUB;
      if (p.y >= FLOOR_Y - 1 && p.py < FLOOR_Y - 3 && vy > 200) {
        Engine.audio.emit("knock", { gain: Math.min(0.12, vy / 5000), pitch: 0.8 });
      }
    }

    // 猛甩:风声
    whooshCool -= dt;
    if (input.active && input.speed > 480 && whooshCool <= 0) {
      whooshCool = 1.0;
      Engine.audio.emit("takeoff", { freq: u.noteFreq(7) });
    }

    Engine.audio.setShimmer(input.D * Math.min(1, input.speed / 600) * 0.05);
  }

  /* ---------------- 绘制 ---------------- */
  function drawHand(t) {
    const a = u.ramp(0.05, 0.8, t);
    if (a <= 0) return;
    push();
    translate(HAND_CX + handOx, HAND_CY + handOy);
    rotate(handRot(t));
    scale(1, -1);                       // 垂直翻转:指尖朝下
    drawingContext.globalAlpha = 0.85 * a;
    image(imgHand, -HAND_W / 2, -HAND_H / 2, HAND_W, HAND_H);
    drawingContext.globalAlpha = 1;
    pop();
  }

  function drawStrings(t) {
    push();
    noFill();
    for (const s of strings) {
      const grow = u.easeOutCubic(u.ramp(s.growT, s.growT + 1.1, t));
      if (grow <= 0) continue;
      const [ax, ay] = fingerAnchor(s.finger, t);
      const p = pts[s.pt];
      const d = Math.hypot(p.x - ax, p.y - ay);
      const L = u.mix(s.slack0, s.rest, grow);
      // 末端:开场时线头甩动着伸向挂点
      const bx = u.mix(ax, p.x, grow), by = u.mix(ay, p.y, grow);
      const taut = u.clamp01((d / Math.max(L, 1) - 0.82) / 0.18);   // 0=松弛 1=绷紧
      const sag = u.mix(42, 4, taut) + 3 * Math.sin(t * 1.1 + s.finger * 2.3);
      const sway = (2 + (1 - taut) * 10) * Math.sin(t * 1.3 + s.finger * 1.7)
                 + (1 - grow) * 16 * Math.sin(t * 9 + s.finger);
      const mx = (ax + bx) / 2 + sway;
      const my = (ay + by) / 2 + sag;
      stroke(RED[0], RED[1], RED[2], (58 + 52 * taut) * Math.min(1, grow * 1.8));
      strokeWeight(1);
      bezier(ax, ay, mx, my, mx, my, bx, by);
    }
    pop();
  }

  /* 两节肢体:圆柱段 + 关节木球 */
  function limb(a, b, wgt) {
    const pa = pts[a], pb = pts[b];
    stroke(INK[0], INK[1], INK[2], 210);
    strokeWeight(wgt);
    strokeCap(ROUND);
    line(pa.x, pa.y, pb.x, pb.y);
    strokeWeight(1.2);
    strokeCap(SQUARE);
  }
  function jointBall(k, r) {
    const p = pts[k];
    push();
    fill(WOOD[0], WOOD[1], WOOD[2]);
    stroke(INK[0], INK[1], INK[2], 220);
    strokeWeight(1.4);
    circle(p.x, p.y, r * 2);
    noStroke();
    fill(255, 250, 240, 90);
    circle(p.x - r * 0.3, p.y - r * 0.35, r * 0.7);
    pop();
  }

  function drawPuppet(t) {
    const a = u.ramp(0.15, 0.6, t);
    if (a <= 0) return;
    drawingContext.globalAlpha = a;
    const neck = pts.neck, chest = pts.chest, hip = pts.hip, head = pts.head;
    const bodyAng = Math.atan2(hip.y - neck.y, hip.x - neck.x) - Math.PI / 2;

    // ---- 舞裙(腰间芭蕾 tutu,横向喇叭,半透明) ----
    push();
    translate(u.mix(chest.x, hip.x, 0.72), u.mix(chest.y, hip.y, 0.72));
    rotate(bodyAng);
    fill(250, 246, 236, 150);
    stroke(INK[0], INK[1], INK[2], 160);
    strokeWeight(1.2);
    beginShape();
    vertex(-13, -4);
    bezierVertex(-46, 0, -62, 10, -60, 24);
    for (let i = 0; i < 6; i++) {      // 裙摆波浪
      const x0 = -60 + (i + 0.5) * (120 / 6), x1 = -60 + (i + 1) * (120 / 6);
      quadraticVertex(x0, 33 + 4 * Math.sin(t * 1.4 + i), x1, 24);
    }
    bezierVertex(62, 10, 46, 0, 13, -4);
    endShape(CLOSE);
    // 内层裙褶线
    noFill();
    stroke(INK[0], INK[1], INK[2], 70);
    for (const fx of [-30, 0, 30]) {
      line(fx * 0.4, 0, fx, 22);
    }
    pop();

    // ---- 腿(裙下) ----
    limb("hip", "kneeL", 13); limb("kneeL", "footL", 10);
    limb("hip", "kneeR", 13); limb("kneeR", "footR", 10);
    // 足尖(芭蕾舞鞋)
    for (const [f, k] of [["footL", "kneeL"], ["footR", "kneeR"]]) {
      const p = pts[f], kk = pts[k];
      const ang = Math.atan2(p.y - kk.y, p.x - kk.x);
      push();
      translate(p.x, p.y); rotate(ang);
      fill(INK[0], INK[1], INK[2], 220); noStroke();
      triangle(-4, -4, -4, 4, 12, 0);
      pop();
    }

    // ---- 躯干(束身背心 + 纽扣) ----
    push();
    translate((neck.x + hip.x) / 2, (neck.y + hip.y) / 2);
    rotate(bodyAng);
    fill(INK[0], INK[1], INK[2], 235);
    noStroke();
    beginShape();
    vertex(-17, -42); vertex(17, -42); vertex(13, 44); vertex(-13, 44);
    endShape(CLOSE);
    fill(238, 230, 214, 200);
    for (let i = 0; i < 3; i++) circle(0, -20 + i * 22, 4.5);
    pop();

    // ---- 手臂 ----
    limb("shL", "elL", 11); limb("elL", "wrL", 9);
    limb("shR", "elR", 11); limb("elR", "wrR", 9);
    // 手(小锥形手套)
    for (const [w, e] of [["wrL", "elL"], ["wrR", "elR"]]) {
      const p = pts[w], ee = pts[e];
      const ang = Math.atan2(p.y - ee.y, p.x - ee.x);
      push();
      translate(p.x, p.y); rotate(ang);
      fill(SKIN[0], SKIN[1], SKIN[2], 230);
      stroke(INK[0], INK[1], INK[2], 180); strokeWeight(1);
      triangle(-5, -5, -5, 5, 10, 0);
      pop();
    }

    // ---- 关节木球 ----
    jointBall("shL", 7); jointBall("shR", 7);
    jointBall("elL", 6); jointBall("elR", 6);
    jointBall("kneeL", 7); jointBall("kneeR", 7);

    // ---- 拉夫领(颈部整圈锯齿,白色小皱领) ----
    push();
    translate(neck.x, neck.y);
    rotate(bodyAng);
    fill(250, 246, 236, 235);
    stroke(INK[0], INK[1], INK[2], 170);
    strokeWeight(1);
    beginShape();
    const NR = 12;
    for (let i = 0; i <= NR; i++) {
      const ang = (i / NR) * Math.PI * 2;
      const r = i % 2 === 0 ? 17 : 12;
      vertex(Math.cos(ang) * r, Math.sin(ang) * r * 0.55 + 2);
    }
    endShape(CLOSE);
    pop();

    // ---- 头 + 尖帽 ----
    const headAng = Math.atan2(head.y - neck.y, head.x - neck.x) + Math.PI / 2;
    push();
    translate(head.x, head.y);
    rotate(headAng);
    // 脸
    fill(SKIN[0], SKIN[1], SKIN[2], 245);
    stroke(INK[0], INK[1], INK[2], 220);
    strokeWeight(1.4);
    circle(0, 0, 40);
    // 闭着的眼睛(安详) + 小嘴
    noFill(); stroke(INK[0], INK[1], INK[2], 200); strokeWeight(1.3);
    arc(-8, -2, 9, 6, 0.15 * Math.PI, 0.85 * Math.PI);
    arc(8, -2, 9, 6, 0.15 * Math.PI, 0.85 * Math.PI);
    fill(RED[0], RED[1], RED[2], 200); noStroke();
    arc(0, 8, 7, 5, 0, Math.PI);
    // 腮红
    fill(RED[0], RED[1], RED[2], 46);
    circle(-13, 5, 8); circle(13, 5, 8);
    // 尖帽(小丑锥帽,白色帽檐 + 红色绒球)
    fill(INK[0], INK[1], INK[2], 225);
    stroke(INK[0], INK[1], INK[2], 200);
    beginShape();
    vertex(-15, -12);
    quadraticVertex(-8, -44, 6, -62);
    quadraticVertex(13, -42, 15, -12);
    endShape(CLOSE);
    fill(250, 246, 236, 235); noStroke();
    rect(-16, -15, 32, 6, 3);
    fill(RED[0], RED[1], RED[2], 225);
    circle(7, -62, 11);
    pop();

    drawingContext.globalAlpha = 1;
  }

  function drawTitle(t) {
    const a = u.ramp(2.2, 3.0, t);
    if (a <= 0) return;
    push();
    textAlign(LEFT, BASELINE);
    textStyle(BOLD);
    textSize(34);
    fill(INK[0], INK[1], INK[2], 230 * a);
    text("提 线 木 偶", 56, 896);
    textStyle(NORMAL);
    textSize(12);
    fill(INK[0], INK[1], INK[2], 130 * a);
    text("THE MARIONETTE", 58, 918);
    textAlign(RIGHT, BASELINE);
    textStyle(BOLD);
    textSize(15);
    fill(RED[0], RED[1], RED[2], 235 * a);
    text("@GeekCatX", 664, 902);
    pop();
  }

  /* 手动模式下的操作提示(自动/录制模式不显示) */
  function drawHint(t) {
    if (Engine.auto() || Engine.staticT !== null || !Engine.started) return;
    const a = u.ramp(3.4, 4.4, t) * (1 - u.ramp(9, 10.5, t));
    if (a <= 0) return;
    push();
    textAlign(CENTER, BASELINE);
    textStyle(NORMAL);
    textSize(13);
    fill(INK[0], INK[1], INK[2], 140 * a * (0.7 + 0.3 * Math.sin(t * 2)));
    text("移 动 鼠 标 · 操 纵 木 偶", W / 2, 940);
    pop();
  }

  function render(t) {
    image(paper, 0, 0);
    drawStrings(t);       // 提线在手之后、木偶之前(线从指尖垂到关节)
    drawPuppet(t);
    drawHand(t);
    drawTitle(t);
    drawHint(t);
  }

  /* ---------------- 注册场景 ---------------- */
  Engine.start({
    id: "puppet",
    width: W, height: H, duration: 14,
    waypoints: WAYPOINTS,
    input: { attack: 4.5, release: 1.3 },
    preload() {
      imgHand = loadImage("/assets/hand.png");
    },
    build() {
      textFont("Courier New");
      buildPaper();       // 纸纹颗粒不参与固定种子,每次略有不同更自然
      buildPuppet();      // 定种子;之后 random 调用顺序即画面
    },
    reset() { buildPuppet(); },
    update: sceneUpdate,
    render,
    audio: {
      intro() {
        // 开场:五根提线逐根挂上的拨弦(与 growT 对齐),收尾一个长音
        const ev = strings.map((s, i) => ({
          t: s.growT + 1.1, type: "pluck", freq: s.freq, gain: 0.10, decay: 1.4,
        }));
        ev.push({ t: 2.9, type: "pluck", freq: u.noteFreq(0), gain: 0.06, decay: 2.6 });
        ev.push({ t: 3.15, type: "pluck", freq: u.noteFreq(7), gain: 0.05, decay: 2.2 });
        return ev;
      },
    },
    ui: {
      tip: "点击开始播放",
      sub: "提线木偶 · 移动鼠标操纵它起舞 · @GeekCatX",
      narration: [
        { t: 1.2, text: "嘘——线一紧,它就醒了。" },
        { t: 12.6, text: "曲终,线还牵着。" },
      ],
    },
  });
})();
