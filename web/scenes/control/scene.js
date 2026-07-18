/* ============================================================
 * scenes/control/scene.js — Control · perform your life
 * 提线木偶 × 五线谱 × 飞鸟(p5.js 程序化动画,引擎场景实现)
 *
 * 场景逻辑:
 *   - 五线谱上音符错落排布(伪随机曲谱,符干方向/符杠按记谱法)
 *   - 每个音符都有一条红色提线连到指尖
 *   - 鼠标(或自动轨迹)在谱面上移动 → 局部扰动:谱线被拉扯,
 *     受惊的音符化作飞鸟,提线末端牵着鸟儿乱飞;
 *     鼠标静止/移开后,鸟儿归位变回音符,谱面平静
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;

  const W = 720, H = 960;
  const BG = [234, 228, 211];
  const INK = "#1a1712";

  // 五线谱布局
  const STAFF_X0 = 122, STAFF_X1 = 598;
  const STAFF_YS = [272, 347, 422, 497, 572];
  const LINE_GAP = 9;                 // 线间距,谱高 36
  const STAFF_MID = 18;               // 中线(= B4)相对谱顶的偏移
  const STEP_H = LINE_GAP / 2;        // 半线距 = 一个音级

  // 手 / 标题布局
  const HAND_X = 300, HAND_Y = 672, HAND_W = 186, HAND_H = 288;
  const TITLE_Y = 152, SUB_Y = 186;

  // 指尖锚点(hand.png 局部坐标 179×274):食指/中指/无名指/右侧伸出指,
  // 实测轮廓顶点并略下移,让提线拴在手指下方
  const FINGERS = [
    [41, 8], [61, 24], [73, 35], [99, 74],
  ];

  // 常驻飞鸟:固定在中间右侧,永远保持鸟的形态(扑翼动画)
  const FIXED_BIRD = { x: 585, y: 400, scale: 1.05, finger: 1, seed: 555 };

  // 扑翼姿态轮换表(birds.json 里 5 种燕子各是一种 wing pose)
  const FLAP_FLY = [1, 3, 4, 2];   // 飞行中:快速扇翅
  const FLAP_SIT = [4, 1, 4, 2];   // 常驻鸟:舒缓扇翅

  /* ------------------------------------------------------------
   * 曲谱:伪随机生成(固定种子,可复现),不模拟真实乐曲,只求视觉舒展
   * step: 相对中线的半线数(0=B4,+1=C5,-1=A4 …),决定纵坐标,范围 ±4 不出谱
   * semi: 相对 A4 的半音数(自然小调音级),决定频率(440·2^(semi/12))
   * beam: 相邻同号音符连一条符杠(0 = 不连)
   * ------------------------------------------------------------ */
  let SCORE = [];
  const SCALE_AEOLIAN = [0, 2, 3, 5, 7, 8, 10];   // A B C D E F G
  function diatonicSemi(step) {
    const idx = (((1 + step) % 7) + 7) % 7;       // step 0 = B(音级 1)
    return 12 * Math.floor((1 + step) / 7) + SCALE_AEOLIAN[idx];
  }
  function genScore() {
    const out = [];
    for (let s = 0; s < 5; s++) {
      const n = 11 + Math.floor(random(3));       // 每行 11-13 音
      const row = [];
      let step = Math.floor(random(-2, 3));
      let beam = 0, left = 0;
      for (let i = 0; i < n; i++) {
        if (left === 0 && random() < 0.6 && i + 2 < n) {
          beam++; left = 2 + Math.floor(random(3));   // 2-4 音一组符杠
        }
        const b = left > 0 ? beam : 0;
        if (left > 0) left--;
        row.push([step, diatonicSemi(step), b]);
        step += Math.floor(random(-2, 3));              // 音高随机游走
        step = Math.max(-4, Math.min(4, step));
      }
      row[n - 1][2] = 0;                          // 每行末音独立,有收束感
      out.push(row);
    }
    return out;
  }
  const INTRO_GAP = 0.08;             // 音符入场间隔(秒),同时是旋律节奏

  /* 自动演示轨迹:(t, x, y) 折线,段内 smoothstep 插值 */
  const WAYPOINTS = [
    [5.5, 700, 300], [6.6, 520, 300], [7.6, 330, 330], [8.6, 190, 410],
    [9.8, 330, 470], [11.0, 540, 450], [12.2, 560, 580], [13.4, 360, 590],
    [14.6, 190, 520], [15.6, 210, 300], [16.6, 420, 240], [17.6, 720, 180],
  ];

  /* ---------------- 场景状态 ---------------- */
  let paper;
  let notes = [];            // 音符(含提线与飞鸟状态)
  let birdVec = {};          // 矢量飞鸟轮廓
  let imgHand;
  let pluckEvents = [];      // 入场旋律(给配乐)
  let simNow = 0;
  let prevMx = null, prevMy = null, lastStrumT = 0, wasActive = false;

  /* ---------------- 场景构建(固定种子) ---------------- */
  function buildScene() {
    randomSeed(20240717);
    noiseSeed(7);
    SCORE = genScore();               // 在种子确定后生成,保证可复现
    notes = [];
    let k = 0;
    for (let s = 0; s < 5; s++) {
      const row = SCORE[s];
      const n = row.length;
      // 均匀铺满整行谱:组间留拍隙,其余等距
      let gaps = 0;
      for (let i = 1; i < n; i++) if (row[i][2] !== row[i - 1][2]) gaps++;
      const L = STAFF_X0 + 30, R = STAFF_X1 - 26;
      const stepX = ((R - L) - gaps * 12) / (n - 1);
      let x = L;
      for (let i = 0; i < n; i++) {
        const [step, semi, beam] = row[i];
        notes.push({
          staff: s, x, step, semi, beam,
          popT: 1.8 + k * INTRO_GAP,
          // 提线
          finger: k % FINGERS.length,
          sSeed: random(1000),
          // 状态机:'note' | 'scared' | 'return'
          state: "note",
          vis: 0,                 // 音符可见度(淡入/淡出演化)
          bx: 0, by: 0, bvx: 0, bvy: 0,
          bird: Math.floor(random(5)),
          bScale: 0.9 + random(0.5),
          bSeed: random(1000),
          calmT: 0, repopT: -1,
          threshold: 0.42 + random(0.2),   // 每只鸟的"胆量"
          stemDown: step >= 0,             // 默认:中线及以上符干朝下
        });
        k++;
        if (i + 1 < n) {
          x += stepX;
          if (row[i + 1][2] !== row[i][2]) x += 12;   // 符杠组之间多留一拍空隙
        }
      }
    }
    // 符杠组的符干方向统一:由组内离中线最远的音决定(记谱法规则)
    for (const n of notes) {
      if (!n.beam) continue;
      let extreme = n;
      for (const m of notes) {
        if (m.staff === n.staff && m.beam === n.beam && Math.abs(m.step) > Math.abs(extreme.step)) {
          extreme = m;
        }
      }
      n.stemDown = extreme.step > 0;
    }
    pluckEvents = notes.map((n) => ({ t: n.popT, semi: n.semi }));
  }

  /* ---------------- 纸纹 ---------------- */
  function buildPaper() {
    paper = createGraphics(W, H);
    paper.pixelDensity(1);
    paper.background(...BG);
    paper.noStroke();
    for (let i = 0; i < 16; i++) {
      const dark = random() < 0.5;
      paper.fill(dark ? 210 : 244, dark ? 203 : 240, dark ? 182 : 226, 9);
      paper.ellipse(random(W), random(H), random(180, 520), random(120, 380));
    }
    for (let i = 0; i < 14000; i++) {
      const d = random() < 0.55;
      paper.stroke(d ? 60 : 255, d ? 55 : 252, d ? 45 : 240, random(4, 15));
      paper.point(random(W), random(H));
    }
    const ctx = paper.drawingContext;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(60,50,35,0.10)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- 更新:状态机 ---------------- */
  function sceneUpdate(dt, t, input) {
    simNow = t;
    const D = input.D;

    for (const n of notes) {
      // 入场淡入
      const wantVis = u.ramp(n.popT, n.popT + 0.22, t);
      // 惊扰度:与鼠标距离相关
      const dy0 = n.homeY !== undefined ? n.homeY : staffBaseY(n);
      const d = Math.hypot(n.x - input.x, dy0 - input.y);
      const fear = D * u.gauss(d, 105);

      if (n.state === "note") {
        // 平滑趋近目标可见度(归位后淡入,而不是瞬跳)
        n.vis += (wantVis - n.vis) * Math.min(1, dt * 8);
        if (fear > n.threshold && wantVis > 0.9) {
          // 惊飞:音符化作飞鸟
          n.state = "scared";
          n.bx = n.x; n.by = dy0;
          const away = Math.atan2(dy0 - input.y, n.x - input.x);
          n.bvx = Math.cos(away) * 140 + (random() - 0.5) * 120;
          n.bvy = Math.sin(away) * 140 - 90 - random(60);
          n.calmT = 0;
          sfxTakeoff(n);
        }
      } else if (n.state === "scared") {
        n.vis = Math.max(0, n.vis - dt * 7);
        // 受惊扑腾:噪声转向 + 提线弹簧约束
        const a1 = (noise(n.bSeed, t * 1.1) - 0.5) * 1900;
        const a2 = (noise(n.bSeed + 40, t * 1.1) - 0.5) * 1900;
        n.bvx += a1 * dt;
        n.bvy += a2 * dt - 60 * dt;
        const hx = n.bx - n.x, hy = n.by - staffBaseY(n);
        const hd = Math.hypot(hx, hy);
        if (hd > 130) {                       // 提线绷紧:弹簧拉回
          const pull = (hd - 130) * 6;
          n.bvx -= (hx / hd) * pull * dt * 60 * 0.16;
          n.bvy -= (hy / hd) * pull * dt * 60 * 0.16;
        }
        n.bvx *= (1 - 1.6 * dt);
        n.bvy *= (1 - 1.6 * dt);
        const sp = Math.hypot(n.bvx, n.bvy);
        if (sp > 300) { n.bvx *= 300 / sp; n.bvy *= 300 / sp; }
        n.bx += n.bvx * dt;
        n.by += n.bvy * dt;
        // 平静下来:计时,准备归位(每只鸟耐心不同,三三两两散去)
        if (fear < 0.12) { n.calmT += dt; } else { n.calmT = 0; }
        if (n.calmT > 1.0 + (n.bSeed % 1.8)) n.state = "return";
      } else if (n.state === "return") {
        // 归位:飞向原处;场上只剩最后两只时,飞得格外缓慢
        const remaining = notes.reduce((c, m) => c + (m.state !== "note" ? 1 : 0), 0);
        const slow = remaining <= 2 ? 0.38 : 1;
        const hy = staffBaseY(n);
        const dx = n.x - n.bx, dy = hy - n.by;
        const dist = Math.hypot(dx, dy);
        const desire = Math.min(150, 45 + dist * 2.4) * slow;
        const steer = Math.min(1, 3 * dt);
        n.bvx += ((dx / (dist + 1e-3)) * desire - n.bvx) * steer;
        n.bvy += ((dy / (dist + 1e-3)) * desire - n.bvy) * steer;
        n.bx += n.bvx * dt;
        n.by += n.bvy * dt;
        if (dist < 9) {
          n.state = "note";
          n.repopT = t;
          sfxLand(n);
        }
      }
    }

    // 划谱如拨弦:鼠标划过谱线,逐根发出琴弦声
    if (D > 0.25 && input.active && wasActive && prevMy !== null
        && input.x > STAFF_X0 - 20 && input.x < STAFF_X1 + 20
        && simNow - lastStrumT > 0.05) {
      let done = false;
      for (let s = 0; s < 5 && !done; s++) {
        for (let kk = 0; kk < 5 && !done; kk++) {
          const ly = STAFF_YS[s] + kk * LINE_GAP;
          if ((prevMy - ly) * (input.y - ly) < 0) {
            sfxStrum(s * 5 + kk);
            done = true;
          }
        }
      }
    }
    wasActive = input.active;
    prevMx = input.x; prevMy = input.y;

    // 音频跟随:噪声微光随扰动与手速起伏
    Engine.audio.setShimmer(D * Math.min(1, input.speed / 500) * 0.06);
  }

  /* 音符基准纵坐标(含谱面扰动) */
  function staffBaseY(n) {
    return STAFF_YS[n.staff] + STAFF_MID - n.step * STEP_H + staffDy(n.x, noteStaffMidY(n), simNow);
  }
  function noteStaffMidY(n) { return STAFF_YS[n.staff] + STAFF_MID; }

  /* 谱面扰动位移:鼠标附近的谱线被拉扯、抖动 */
  function staffDy(x, y, t) {
    const input = Engine.input;
    if (input.D <= 0) return 0;
    const g = u.gauss(x - input.x, 105);
    const pull = Math.max(-64, Math.min(64, (input.y - y) * 0.5));
    const shake = 7 * Math.sin(t * 9 + y * 0.09 + x * 0.015);
    return input.D * g * (pull + shake);
  }

  /* ---------------- 音效触发(事件总线,音画同源) ---------------- */
  function sfxTakeoff(n) {
    Engine.audio.emit("takeoff", { freq: u.noteFreq(n.semi) });
  }
  function sfxLand(n) {
    Engine.audio.emit("land", { freq: u.noteFreq(n.semi) });
  }

  /* 划谱拨弦:鼠标穿过第 lineIdx 根谱线,弹对应音高(五声音阶,高音在上) */
  const PENTA_HI = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 784, 880, 1046.5, 1174.66, 1318.5];
  function sfxStrum(lineIdx) {
    lastStrumT = simNow;
    const idx = Math.round((24 - lineIdx) * (PENTA_HI.length - 1) / 24);
    const gain = 0.028 + Math.min(0.035, Engine.input.speed / 25000);
    Engine.audio.emit("strum", { freq: PENTA_HI[idx], gain });
  }

  /* ---------------- 渲染 ---------------- */
  function render(t) {
    image(paper, 0, 0);
    drawTitle(t);
    drawStaves(t);
    drawStrings(t);
    drawNotes(t);
    drawHand(t);
    drawBirds(t);
    drawCredit(t);
    drawHint(t);
  }

  /* 标题:打字机逐字敲入;扰动时轻微晃动 */
  function drawTitle(t) {
    const D = Engine.input.D;
    push();
    textAlign(LEFT, BASELINE);
    textStyle(BOLD);
    textSize(46);
    const word = "Control";
    const tracking = 6;
    let total = 0;
    for (const ch of word) total += textWidth(ch) + tracking;
    total -= tracking;
    let x = (W - total) / 2;
    for (let i = 0; i < word.length; i++) {
      const appear = u.ramp(0.12 + i * 0.07, 0.30 + i * 0.07, t);
      if (appear <= 0) { x += textWidth(word[i]) + tracking; continue; }
      const jy = D * 1.8 * Math.sin(t * 7 + i * 1.7);
      push();
      translate(x + textWidth(word[i]) / 2, TITLE_Y + jy);
      fill(26, 23, 18, 255 * appear);
      text(word[i], -textWidth(word[i]) / 2, 0);
      pop();
      x += textWidth(word[i]) + tracking;
    }
    const ap2 = u.ramp(0.75, 1.05, t);
    if (ap2 > 0) {
      textStyle(NORMAL);
      textSize(15);
      textAlign(CENTER, BASELINE);
      fill(26, 23, 18, 225 * ap2);
      text("perform your life", W / 2, SUB_Y);
    }
    pop();
  }

  /* 五线谱:入场自左向右绘入;随鼠标扰动起伏 */
  function drawStaves(t) {
    push();
    stroke(INK);
    noFill();
    for (let s = 0; s < 5; s++) {
      const reveal = u.ramp(0.08 + s * 0.07, 0.62 + s * 0.07, t);
      if (reveal <= 0) continue;
      const xEnd = u.mix(STAFF_X0, STAFF_X1, reveal);
      const y0 = STAFF_YS[s];
      strokeWeight(1.3);
      for (let k = 0; k < 5; k++) {
        beginShape();
        for (let x = STAFF_X0; x <= xEnd; x += 7) {
          vertex(x, y0 + k * LINE_GAP + staffDy(x, y0 + k * LINE_GAP, t));
        }
        vertex(xEnd, y0 + k * LINE_GAP + staffDy(xEnd, y0 + k * LINE_GAP, t));
        endShape();
      }
      strokeWeight(3);
      line(STAFF_X0, y0 - 1 + staffDy(STAFF_X0, y0, t),
           STAFF_X0, y0 + 4 * LINE_GAP + 1 + staffDy(STAFF_X0, y0 + 4 * LINE_GAP, t));
    }
    pop();
  }

  /* 提线:每个音符一条,连到指尖;惊飞时牵着鸟;开场自指尖逐根放出 */
  function drawStrings(t) {
    const D = Engine.input.D;
    const anchors = fingerAnchors(t);
    push();
    noFill();
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      // 开场:提线从指尖逐根放出,末端甩动着伸向音符
      const g0 = 0.25 + i * 0.035;
      const grow = u.ramp(g0, g0 + 0.5, t);
      if (grow <= 0) continue;
      const ease = u.easeOutCubic(grow);
      const [ax0, ay0] = anchors[n.finger];
      let bx, by, slack;
      if (n.state === "note") {
        bx = n.x; by = staffBaseY(n);
        slack = 4 + 2.4 * Math.sin(t * 0.85 + n.sSeed);
      } else {
        bx = n.bx; by = n.by;                       // 线末端牵着飞鸟
        slack = 22 + 14 * Math.sin(t * 3.3 + n.sSeed);
      }
      bx = u.mix(ax0, bx, ease);
      by = u.mix(ay0, by, ease);
      slack = u.mix(46, slack, ease);
      const sway = (2 + D * 9) * Math.sin(t * 1.25 + n.sSeed * 2.7)
                 + (1 - ease) * 14 * Math.sin(t * 9 + n.sSeed);
      const mx = (ax0 + bx) / 2 + sway;
      const my = (ay0 + by) / 2 + slack;
      const a = n.state === "note" ? 62 + 30 * D : 105;
      stroke(176, 52, 39, a * Math.min(1, grow * 1.6));
      strokeWeight(1);
      bezier(ax0, ay0, mx, my, mx, my, bx, by);
    }
    // 常驻飞鸟的提线(中间右侧那只)
    {
      const grow = u.ramp(1.2, 1.8, t);
      if (grow > 0) {
        const [ax0, ay0] = anchors[FIXED_BIRD.finger];
        const bx = FIXED_BIRD.x, by = FIXED_BIRD.y + Math.sin(t * 1.2) * 3.5;
        const sway = 2 * Math.sin(t * 1.1);
        const mx = (ax0 + bx) / 2 + sway;
        const my = (ay0 + by) / 2 + 8 + 3 * Math.sin(t * 0.9);
        stroke(176, 52, 39, 70 * grow);
        strokeWeight(1);
        bezier(ax0, ay0, mx, my, mx, my, bx, by);
      }
    }
    pop();
  }

  /* 音符:符干方向按记谱法(中线及以上朝下),符杠按拍相连 */
  function drawNotes(t) {
    push();
    for (const n of notes) {
      if (n.vis <= 0.01) continue;
      const repop = n.repopT > 0 ? u.ramp(n.repopT, n.repopT + 0.2, t) : 1;
      const popIn = u.ramp(n.popT, n.popT + 0.22, t);
      const sc = 0.6 + 0.4 * Math.min(popIn, repop);
      const x = n.x;
      const y = staffBaseY(n);
      const stemDown = n.stemDown;         // 符干方向(符杠组已在构建时统一)

      push();
      translate(x, y);
      scale(sc);
      drawingContext.globalAlpha = n.vis;

      stroke(INK); strokeWeight(1.4);
      noStroke(); fill(INK);
      push();
      rotate(-0.32);
      ellipse(0, 0, 9.5, 6.8);
      pop();

      // 符干
      stroke(INK); strokeWeight(1.4);
      const sx = stemDown ? -4.2 : 4.2;
      const sy2 = stemDown ? 26 : -26;
      line(sx, stemDown ? 2 : -2, sx, sy2);

      // 符杠 / 符尾
      let beamed = false;
      if (n.beam) {
        // 找同组右侧最近音符
        let best = null, bd = 1e9;
        for (const m of notes) {
          if (m === n || m.staff !== n.staff || m.beam !== n.beam || m.x <= n.x) continue;
          if (m.x - n.x < bd) { bd = m.x - n.x; best = m; }
        }
        if (best && best.vis > 0.5) {
          const byy = staffBaseY(best);
          const dy = Math.max(-14, Math.min(14, byy - y));
          noStroke(); fill(INK);
          // 符杠:连在两符干末端,厚度 4px
          if (stemDown) quad(sx, 22, bd + sx, dy + 22, bd + sx, dy + 26, sx, 26);
          else quad(sx, -26, bd + sx, dy - 26, bd + sx, dy - 22, sx, -22);
          beamed = true;
        }
      }
      if (!beamed && n.beam === 0) {
        // 四分音符:无符尾;单八分音符才画小旗——本曲全部为四分或连杠八分
      }
      drawingContext.globalAlpha = 1;
      pop();
    }
    pop();
  }

  /* 飞鸟(受惊/归位中的音符) */
  function drawBirds(t) {
    for (const n of notes) {
      if (n.state === "note") continue;
      // 扑翼:按各自相位快速轮换 wing pose
      const pose = FLAP_FLY[Math.floor(t * 8 + n.bSeed * 7) % FLAP_FLY.length];
      const spec = birdVec[`bird${pose}`];
      if (!spec) continue;
      const alpha = 1 - n.vis;
      if (alpha <= 0.01) continue;
      const heading = Math.atan2(n.bvy, n.bvx);
      push();
      translate(n.bx, n.by);
      rotate(heading * 0.3 + Math.sin(t * 10 + n.bSeed) * 0.18);
      if (n.bvx < 0) scale(-1, 1);
      scale(n.bScale * 1.1);
      translate(-spec.w / 2, -spec.h / 2);
      drawingContext.globalAlpha = alpha;
      noStroke();
      fill(INK);
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
    // 常驻飞鸟:固定在中间右侧,永远保持鸟的形态(扑翼 + 微微浮动)
    const fa = u.ramp(1.2, 1.8, t);
    if (fa > 0) {
      const pose = FLAP_SIT[Math.floor(t * 5) % FLAP_SIT.length];
      const spec = birdVec[`bird${pose}`];
      if (spec) {
        push();
        translate(FIXED_BIRD.x, FIXED_BIRD.y + Math.sin(t * 1.2) * 3.5);
        rotate(Math.sin(t * 0.9) * 0.06);
        scale(FIXED_BIRD.scale);
        translate(-spec.w / 2, -spec.h / 2);
        drawingContext.globalAlpha = fa;
        noStroke();
        fill(INK);
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
  }

  /* 手的微动 */
  function handBobY(t) {
    const D = Engine.input.D;
    const rise = (1 - u.easeOutCubic(t / 0.9)) * 120;
    return rise + Math.sin(t * 0.9) * 2.5 + D * Math.sin(t * 3.1) * 6;
  }
  function handRot(t) {
    const D = Engine.input.D;
    return Math.sin(t * 0.7) * 0.008 + D * Math.sin(t * 2.2) * 0.03;
  }
  function fingerAnchors(t) {
    const bobY = handBobY(t), rot = handRot(t);
    const px = HAND_X + 150, py = H;
    const sx = HAND_W / 179, sy = HAND_H / 274;
    return FINGERS.map(([lx, ly]) => {
      const x = HAND_X + lx * sx, y = HAND_Y + ly * sy + bobY;
      const dx = x - px, dy = y - py;
      const c = Math.cos(rot), s2 = Math.sin(rot);
      return [px + dx * c - dy * s2, py + dx * s2 + dy * c];
    });
  }
  function drawHand(t) {
    push();
    translate(HAND_X + 150, H);
    rotate(handRot(t));
    translate(-(HAND_X + 150), -H);
    drawingContext.globalAlpha = 0.85;      // 手整体半透明
    image(imgHand, HAND_X, HAND_Y + handBobY(t), HAND_W, HAND_H);
    drawingContext.globalAlpha = 1;
    pop();
  }

  /* 红色署名 */
  function drawCredit(t) {
    const ap = u.ramp(0.5, 0.9, t);
    if (ap <= 0) return;
    push();
    textAlign(LEFT, BASELINE);
    textStyle(BOLD);
    textSize(16);
    fill(176, 52, 39, 235 * ap);
    text("@GeekCatX", 316, 850);
    pop();
  }

  /* 手动模式下的操作提示(自动/录制模式不显示) */
  function drawHint(t) {
    if (Engine.auto() || Engine.staticT !== null || !Engine.started) return;
    const a = u.ramp(5.2, 6.2, t) * (1 - u.ramp(10, 11.5, t));
    if (a <= 0) return;
    push();
    textAlign(CENTER, BASELINE);
    textStyle(NORMAL);
    textSize(13);
    fill(26, 23, 18, 140 * a * (0.7 + 0.3 * Math.sin(t * 2)));
    text("移 动 鼠 标 · 扰 动 乐 谱", W / 2, 932);
    pop();
  }

  /* ---------------- 注册场景 ---------------- */
  Engine.start({
    id: "control",
    width: W, height: H, duration: 26,
    waypoints: WAYPOINTS,
    preload() {
      imgHand = loadImage("assets/hand.png");
      birdVec = loadJSON("assets/birds.json");
    },
    build() {
      textFont("Courier New");
      buildPaper();     // 先铺纸纹(不参与固定种子,颗粒每次不同)
      buildScene();     // 再定种子生成曲谱(random 调用顺序勿动)
    },
    reset() {
      for (const n of notes) {
        n.state = "note"; n.vis = 0; n.calmT = 0; n.repopT = -1;
      }
    },
    update: sceneUpdate,
    render,
    audio: {
      intro() {
        const events = pluckEvents.map((ev) => ({
          t: ev.t, type: "pluck", freq: u.noteFreq(ev.semi), gain: 0.10, decay: 1.1,
        }));
        const last = pluckEvents.length ? pluckEvents[pluckEvents.length - 1].t : 4;
        events.push({ t: last + 0.9, type: "pluck", freq: 880, gain: 0.05, decay: 2.4 });
        return events;
      },
    },
    ui: {
      narration: [
        { t: 1.3, text: "Control,提线控音,演奏你的人生。" },
        { t: 17.6, text: "曲终,万籁归位。" },
      ],
    },
  });
})();
