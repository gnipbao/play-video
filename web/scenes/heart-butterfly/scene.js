/* ============================================================
 * Heart & Butterflies — 纸上裂心与群蝶
 *
 * 参考片的视觉语法以程序化图形重写：
 *   冷白纸纹 → 裂隙显影 → 黑色心脏 → 红色血管/牵引线 → 黄色蝴蝶。
 *
 * 交互：
 *   移动指针牵引蝶群；按下/空格触发心跳与爆发；双指缩放蝶群半径。
 *   画面状态使用固定步长与固定种子，支持 ?auto=1 和 hyperframes seek。
 * ============================================================ */
"use strict";
(function () {
  const u = Engine.u;
  const W = 720;
  const H = 960;
  const PAPER = [238, 242, 241];
  const INK = [16, 20, 19];
  const GRAPHITE = [55, 61, 59];
  const BLUE = [244, 191, 28];
  const BLUE_DARK = [104, 67, 2];
  const RED = [211, 27, 58];
  const HEART_CENTER = { x: 360, y: 535 };
  const TETHER_NEXUS = { x: 360, y: 647 };
  const IMPACT_TIMES = [1.38, 1.54, 1.69, 1.84, 1.99, 2.12, 2.24, 2.36, 2.48];
  const HEART_POLYGON = [
    [307, 417], [329, 435], [342, 395], [357, 431], [374, 393],
    [394, 433], [448, 450], [442, 503], [419, 532], [430, 573],
    [407, 617], [382, 654], [360, 685], [335, 665], [298, 650],
    [282, 620], [279, 585], [256, 554], [269, 518], [246, 471],
    [288, 447],
  ];
  const HEART_PUNCTURES = [
    [[307, 417], [340, 392], [357, 432], [336, 466], [290, 446]],
    [[353, 431], [374, 392], [399, 430], [390, 471], [361, 465]],
    [[288, 447], [337, 462], [327, 522], [270, 516], [246, 471]],
    [[337, 457], [391, 452], [406, 514], [360, 548], [321, 517]],
    [[391, 441], [448, 450], [442, 503], [415, 539], [385, 501]],
    [[268, 510], [329, 516], [350, 572], [298, 603], [256, 554]],
    [[326, 510], [405, 507], [414, 578], [360, 612], [338, 568]],
    [[392, 514], [430, 573], [407, 617], [375, 650], [354, 600]],
    [[297, 582], [361, 601], [395, 645], [360, 685], [298, 650]],
  ];
  const WAYPOINTS = [
    [4.6, 320, 620, false],
    [6.7, 512, 520, false],
    [8.0, 382, 454, true],
    [8.25, 382, 454, false],
    [10.5, 174, 350, false],
    [12.7, 586, 290, false],
    [14.8, 360, 535, false],
  ];

  let paper;
  let cracks = [];
  let wallSlabs = [];
  let heartGrain = [];
  let vessels = [];
  let butterflies = [];
  let referenceAudio = null;
  let soundToggleHandler = null;
  let burst = 0;
  let pulse = 0;
  let swarmScale = 1;
  let lastFlutterNote = -99;

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      const crosses = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-8) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function buildPaper() {
    paper = createGraphics(W, H);
    paper.pixelDensity(1);
    paper.background(PAPER[0], PAPER[1], PAPER[2]);
    const rng = u.rng(190418);

    paper.noStroke();
    for (let y = 0; y < H; y += 3) {
      const wash = 2.8 * Math.sin(y * 0.019) + 1.8 * Math.sin(y * 0.071);
      paper.fill(205 + wash, 216 + wash, 216 + wash, 12);
      paper.rect(0, y, W, 1);
    }
    for (let i = 0; i < 4300; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const dark = rng() < 0.82;
      const size = 0.35 + rng() * (rng() < 0.04 ? 2.4 : 0.9);
      if (dark) paper.fill(31, 41, 39, 8 + rng() * 27);
      else paper.fill(255, 255, 255, 18 + rng() * 24);
      paper.ellipse(x, y, size, size * (0.55 + rng()));
    }
    paper.stroke(38, 47, 45, 8);
    paper.strokeWeight(0.45);
    for (let i = 0; i < 34; i++) {
      const y = rng() * H;
      paper.line(0, y, W, y + (rng() - 0.5) * 2);
    }
  }

  function crackPath(origin, angle, length, count, rng) {
    const points = [[origin[0], origin[1]]];
    let x = origin[0];
    let y = origin[1];
    let a = angle;
    for (let i = 1; i < count; i++) {
      const step = length / (count - 1) * (0.72 + rng() * 0.58);
      a += (rng() - 0.5) * 0.46;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      points.push([x, y]);
    }
    return points;
  }

  function buildCracks() {
    const rng = u.rng(71121);
    cracks = [];
    const origins = [
      [[285, 454], -2.72, 225], [[256, 505], 3.02, 180],
      [[274, 574], 2.66, 200], [[306, 646], 2.32, 165],
      [[360, 681], 1.58, 205], [[410, 614], 0.77, 175],
      [[431, 554], 0.17, 200], [[438, 490], -0.28, 180],
      [[402, 437], -0.72, 185], [[337, 414], -1.74, 170],
      [[311, 420], -2.05, 132],
    ];
    origins.forEach((item, i) => {
      const points = crackPath(item[0], item[1], item[2], 5 + Math.floor(rng() * 4), rng);
      cracks.push({
        points,
        t: 0.18 + i * 0.075 + rng() * 0.17,
        span: 0.95 + rng() * 0.75,
        weight: 0.7 + rng() * 0.75,
      });
      if (i % 2 === 0) {
        const splitAt = 2 + Math.floor(rng() * Math.max(1, points.length - 3));
        const split = points[Math.min(splitAt, points.length - 2)];
        const branch = crackPath(split, item[1] + (rng() < 0.5 ? -0.8 : 0.8), item[2] * 0.38, 4, rng);
        cracks.push({
          points: branch,
          t: 0.72 + i * 0.06,
          span: 0.62 + rng() * 0.4,
          weight: 0.52 + rng() * 0.45,
        });
      }
    });

    const topOrigins = [
      [[306, 264], -2.78, 100], [[306, 264], -1.25, 112],
      [[391, 270], -0.18, 132], [[391, 270], 1.34, 120],
    ];
    topOrigins.forEach((item, i) => {
      cracks.push({
        points: crackPath(item[0], item[1], item[2], 6, rng),
        t: 0.12 + i * 0.09,
        span: 0.95,
        weight: 0.7 + rng() * 0.7,
      });
    });
  }

  function polygonCenter(points) {
    let x = 0;
    let y = 0;
    for (const point of points) {
      x += point[0];
      y += point[1];
    }
    return [x / points.length, y / points.length];
  }

  function buildRuptureDebris() {
    wallSlabs = [
      {
        t: 1.58,
        x: 337,
        y: 502,
        vx: -8,
        vy: -16,
        gravity: 236,
        width: 36,
        height: 50,
        angle: -0.08,
        spin: -1.28,
        life: 2.45,
        points: [
          [-0.5, -0.48], [-0.02, -0.58], [0.5, -0.28],
          [0.34, 0.52], [-0.14, 0.58], [-0.56, 0.18],
        ],
      },
      {
        t: 1.76,
        x: 395,
        y: 520,
        vx: 13,
        vy: -7,
        gravity: 274,
        width: 18,
        height: 25,
        angle: 0.12,
        spin: 1.82,
        life: 2.05,
        points: [
          [-0.5, -0.42], [0.06, -0.58], [0.54, -0.08],
          [0.28, 0.55], [-0.4, 0.4],
        ],
      },
    ];
  }

  function buildHeartTexture() {
    const rng = u.rng(9099);
    heartGrain = [];
    for (let i = 0; i < 1450; i++) {
      const x = 246 + rng() * 204;
      const y = 392 + rng() * 295;
      if (!pointInPolygon(x, y, HEART_POLYGON)) continue;
      heartGrain.push({
        x,
        y,
        r: 0.4 + rng() * 1.7,
        a: 10 + rng() * 42,
        light: rng() > 0.82,
      });
    }
  }

  function bendPath(x0, y0, x1, y1, bend, count) {
    const points = [];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < count; i++) {
      const p = i / (count - 1);
      const bow = Math.sin(p * Math.PI) * bend;
      points.push([x0 + dx * p + nx * bow, y0 + dy * p + ny * bow]);
    }
    return points;
  }

  function buildVessels() {
    const rng = u.rng(12103);
    const ends = [
      [327, 430], [354, 423], [386, 424], [289, 484], [424, 478],
      [292, 561], [416, 553], [309, 620], [390, 626], [360, 671],
    ];
    vessels = ends.map((end, i) => ({
      points: bendPath(360, 646, end[0], end[1], (rng() - 0.5) * 42, 9),
      t: 2.15 + i * 0.095,
      weight: i % 3 === 0 ? 1.35 : 0.8,
    }));
  }

  function butterflyHome(i, count, rng) {
    const inner = i < 3;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const a = -Math.PI / 2 + i * goldenAngle + (rng() - 0.5) * 0.52;
    const r = inner ? 82 + rng() * 84 : 192 + rng() * 235;
    return [
      u.clamp(360 + Math.cos(a) * r * (0.9 + rng() * 0.22), 34, W - 34),
      u.clamp(535 + Math.sin(a) * r * 1.08, 52, H - 52),
    ];
  }

  function launchPoint(rng) {
    for (let i = 0; i < 20; i++) {
      const x = 284 + rng() * 150;
      const y = 432 + rng() * 205;
      if (pointInPolygon(x, y, HEART_POLYGON)) return [x, y];
    }
    return [HEART_CENTER.x, HEART_CENTER.y];
  }

  function cubicPoint(b, p) {
    const q = 1 - p;
    return [
      q * q * q * b.launchX + 3 * q * q * p * b.c1x + 3 * q * p * p * b.c2x + p * p * p * b.homeX,
      q * q * q * b.launchY + 3 * q * q * p * b.c1y + 3 * q * p * p * b.c2y + p * p * p * b.homeY,
    ];
  }

  function initRope(b) {
    const count = 16;
    const direct = Math.hypot(b.homeX - b.rootX, b.homeY - b.rootY);
    const launchDistance = Math.hypot(b.launchX - b.rootX, b.launchY - b.rootY);
    b.ropeStartLength = launchDistance + 6;
    b.ropeFullLength = u.clamp(Math.max(218, direct * 1.04 + 38), 218, 650);
    b.ropeLength = b.ropeStartLength;
    b.ropeSegment = b.ropeLength / (count - 1);
    b.rope = [];
    const side = Math.sin(b.phase * 1.7) * 3.5;
    for (let i = 0; i < count; i++) {
      const p = i / (count - 1);
      const droop = Math.sin(p * Math.PI);
      const x = u.mix(b.rootX, b.launchX, p) + droop * side;
      const y = u.mix(b.rootY, b.launchY, p) + droop * 2;
      b.rope.push({ x, y, px: x, py: y });
    }
    b.ropeSag = 0;
    b.ropeSagV = 0;
    b.ropeSide = side;
    b.ropeSideV = 0;
  }

  function buildButterflies() {
    const rng = u.rng(83027);
    const count = 20;
    butterflies = [];
    for (let i = 0; i < count; i++) {
      const home = butterflyHome(i, count, rng);
      const launch = launchPoint(rng);
      const rootX = TETHER_NEXUS.x;
      const rootY = TETHER_NEXUS.y;
      const dx = home[0] - launch[0];
      const dy = home[1] - launch[1];
      const distance = Math.hypot(dx, dy) || 1;
      const ux = dx / distance;
      const uy = dy / distance;
      const nx = -uy;
      const ny = ux;
      const curveSide = (rng() < 0.5 ? -1 : 1) * (28 + rng() * 54);
      const firstReach = 52 + rng() * 46;
      const secondReach = 62 + rng() * 82;
      const firstBend = curveSide * (0.28 + rng() * 0.2);
      const secondBend = curveSide * (0.3 + rng() * 0.24);
      const launchLift = 22 + rng() * 34;
      const flightDuration = 3.65 + distance / 225 + rng() * 0.82;
      const size = (i < 12 ? 18 : 15) + rng() * (i < 12 ? 17 : 25);
      const phase = rng() * Math.PI * 2;
      const launchT = 3.15 + i * 0.55 + rng() * 0.035;
      const butterfly = {
        homeX: home[0],
        homeY: home[1],
        launchX: launch[0],
        launchY: launch[1],
        rootX,
        rootY,
        c1x: launch[0] + ux * firstReach + nx * firstBend,
        c1y: launch[1] + uy * firstReach + ny * firstBend - launchLift,
        c2x: home[0] - ux * secondReach - nx * secondBend,
        c2y: home[1] - uy * secondReach - ny * secondBend,
        x: launch[0],
        y: launch[1],
        vx: 0,
        vy: 0,
        size,
        seed: rng() * 1000,
        angle: Math.atan2(dy, dx),
        heading: Math.atan2(dy, dx),
        launchT,
        ropeSpawnT: launchT - (0.76 + rng() * 0.12),
        flightDuration,
        flightSpeed: distance / flightDuration,
        ropeDropDelay: 0,
        wingHz: 3.7 + rng() * 1.7,
        drift: 7 + rng() * 13,
        phase,
        blueShift: rng(),
        ropeReleased: false,
        launched: false,
      };
      butterflies.push(butterfly);
    }
  }

  function resetScene() {
    burst = 0;
    pulse = 0;
    swarmScale = 1;
    lastFlutterNote = -99;
    buildButterflies();
  }

  function triggerBurst(input, t) {
    burst = 1;
    pulse = 1;
    const px = input.active ? input.x : HEART_CENTER.x;
    const py = input.active ? input.y : HEART_CENTER.y;
    for (const b of butterflies) {
      if (!b.launched) continue;
      let dx = b.x - px;
      let dy = b.y - py;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 24) {
        dx = Math.cos(b.angle);
        dy = Math.sin(b.angle);
      } else {
        dx /= d;
        dy /= d;
      }
      b.vx += dx * (125 + b.size * 3.2) + input.vx * 0.12;
      b.vy += dy * (125 + b.size * 3.2) + input.vy * 0.12;
    }
    if (t - lastFlutterNote > 0.18) {
      Engine.audio.emit("takeoff", { freq: u.noteFreq(12), gain: 0.11 });
      lastFlutterNote = t;
    }
  }

  function updateRope(b, dt, t) {
    if (!b.ropeReleased || !b.rope || b.rope.length < 2) return;
    const nodes = b.rope;
    const last = nodes.length - 1;
    const endX = b.x;
    const endY = b.y + b.size * 0.28;
    const direct = Math.hypot(endX - b.rootX, endY - b.rootY);
    const releaseAge = Math.max(0, t - b.ropeSpawnT);
    const releaseP = u.smootherstep(0, 0.82, releaseAge);
    const releasedLength = u.mix(b.ropeStartLength, b.ropeFullLength, releaseP);
    b.ropeLength = Math.max(releasedLength, direct * 1.012 + 2);
    b.ropeSegment = b.ropeLength / last;
    const fallP = u.smootherstep(0.04, 0.72, releaseAge);
    const sagTarget = Math.min(
      270,
      Math.sqrt(Math.max(0, b.ropeLength * b.ropeLength - direct * direct)) * 0.62,
    ) * fallP;
    const sagSpring = b.launched ? 10.5 : 15;
    const sagDamping = b.launched ? 3.7 : 4.6;
    b.ropeSagV += (sagTarget - b.ropeSag) * sagSpring * dt;
    b.ropeSagV *= Math.exp(-sagDamping * dt);
    b.ropeSag += b.ropeSagV * dt;

    const sideTarget = Math.sin(t * 0.92 + b.phase) * (5 + b.ropeSag * 0.035)
      - b.vx * 0.055;
    b.ropeSideV += (sideTarget - b.ropeSide) * 8.5 * dt;
    b.ropeSideV *= Math.exp(-4.2 * dt);
    b.ropeSide += b.ropeSideV * dt;

    for (let i = 0; i <= last; i++) {
      const node = nodes[i];
      const along = i / last;
      const arc = Math.sin(along * Math.PI);
      const softWhip = Math.sin(along * Math.PI * 2) * b.ropeSide * 0.14;
      node.px = node.x;
      node.py = node.y;
      node.x = u.mix(b.rootX, endX, along) + arc * b.ropeSide + softWhip;
      node.y = u.mix(b.rootY, endY, along) + arc * b.ropeSag;
    }
  }

  function sceneUpdate(dt, t, input) {
    if (input.justPressed || input.keyPressed("Space") || input.keyPressed("Enter")) {
      triggerBurst(input, t);
    }
    if (input.gesture.active) {
      swarmScale = u.clamp(swarmScale * input.gesture.deltaScale, 0.76, 1.34);
    } else {
      swarmScale = u.damp(swarmScale, 1, 1.6, dt);
    }
    burst = u.damp(burst, 0, 2.25, dt);
    pulse = u.damp(pulse, input.active ? 0.1 + input.D * 0.12 : 0, 3.1, dt);

    for (const b of butterflies) {
      const age = t - b.launchT;
      const ropeAge = t - b.ropeSpawnT;
      if (!b.ropeReleased && ropeAge >= 0) {
        b.ropeReleased = true;
        b.x = b.launchX;
        b.y = b.launchY;
        initRope(b);
      }
      if (!b.launched && age >= 0) {
        b.launched = true;
        b.x = b.launchX;
        b.y = b.launchY;
        b.vx = Math.cos(b.angle) * 9;
        b.vy = Math.sin(b.angle) * 9 - 6;
        b.heading = b.angle;
        Engine.audio.emit("flutter", {
          gain: 0.022 + Math.min(0.026, b.size / 1200),
          pitch: 0.78 + b.size / 70,
        });
      }
      if (!b.ropeReleased) continue;
      if (!b.launched) {
        updateRope(b, dt, t);
        continue;
      }

      const flightAge = Math.max(0, age - b.ropeDropDelay);
      const rawFlight = u.clamp01(flightAge / b.flightDuration);
      const flightP = u.smootherstep(0, 1, rawFlight);
      const orbitX = HEART_CENTER.x + (b.homeX - HEART_CENTER.x) * swarmScale;
      const orbitY = HEART_CENTER.y + (b.homeY - HEART_CENTER.y) * swarmScale;
      let tx;
      let ty;
      let desiredVx = 0;
      let desiredVy = 0;
      if (rawFlight < 1) {
        const point = cubicPoint(b, flightP);
        const behindP = u.smootherstep(0, 1, Math.max(0, rawFlight - 0.018));
        const aheadP = u.smootherstep(0, 1, Math.min(1, rawFlight + 0.018));
        const behind = cubicPoint(b, behindP);
        const ahead = cubicPoint(b, aheadP);
        const tangentX = ahead[0] - behind[0];
        const tangentY = ahead[1] - behind[1];
        const tangentLength = Math.hypot(tangentX, tangentY) || 1;
        const unitX = tangentX / tangentLength;
        const unitY = tangentY / tangentLength;
        const normalX = -unitY;
        const normalY = unitX;
        const flutter = Math.sin(age * 1.72 + b.phase)
          + Math.sin(age * 3.85 + b.phase * 1.41) * 0.34;
        const swayRadius = 4.4 + b.size * 0.055;
        const wingLift = Math.max(0, Math.sin(age * b.wingHz * Math.PI * 2 + b.phase));
        tx = point[0] + normalX * flutter * swayRadius;
        ty = point[1] + normalY * flutter * swayRadius - wingLift * 1.7;

        const speedPulse = 0.84
          + Math.sin(age * 1.46 + b.phase) * 0.11
          + Math.sin(age * 3.2 + b.phase * 0.73) * 0.05;
        const launchEase = u.smootherstep(0, 0.14, rawFlight);
        const arrivalEase = 1 - u.smootherstep(0.82, 1, rawFlight) * 0.42;
        const desiredSpeed = b.flightSpeed * speedPulse * launchEase * arrivalEase;
        desiredVx = unitX * desiredSpeed + normalX * Math.cos(age * 1.72 + b.phase) * 3.6;
        desiredVy = unitY * desiredSpeed + normalY * Math.cos(age * 1.72 + b.phase) * 3.6;
      } else {
        tx = orbitX + Math.sin(t * 0.73 + b.phase) * b.drift;
        ty = orbitY + Math.cos(t * 0.61 + b.phase * 1.37) * b.drift * 0.72;
        desiredVx = (tx - b.x) * 1.45;
        desiredVy = (ty - b.y) * 1.45;
      }

      if (input.active) {
        const d = Math.hypot(input.x - tx, input.y - ty);
        const near = 0.28 + 0.72 * u.gauss(d, 270);
        const pull = input.D * near * (input.pressed ? 0.31 : 0.13);
        tx = u.mix(tx, input.x, pull);
        ty = u.mix(ty, input.y, pull);
        tx += input.vx * 0.011 * near;
        ty += input.vy * 0.011 * near;
      }

      const outward = burst * (78 + b.size * 2.4);
      tx += Math.cos(b.angle) * outward;
      ty += Math.sin(b.angle) * outward;
      desiredVx += Math.cos(b.angle) * burst * 34;
      desiredVy += Math.sin(b.angle) * burst * 34;
      if (rawFlight < 1) {
        b.vx += ((tx - b.x) * 3.1 + (desiredVx - b.vx) * 3.8) * dt;
        b.vy += ((ty - b.y) * 3.1 + (desiredVy - b.vy) * 3.8) * dt;
      } else {
        b.vx += ((tx - b.x) * 2.7 + (desiredVx - b.vx) * 2.4) * dt;
        b.vy += ((ty - b.y) * 2.7 + (desiredVy - b.vy) * 2.4) * dt;
      }

      const ropeDx = b.x - b.rootX;
      const ropeDy = b.y - b.rootY;
      const ropeDistance = Math.hypot(ropeDx, ropeDy) || 1;
      const tensionStart = b.ropeLength * 1.01;
      if (ropeDistance > tensionStart) {
        const tension = (ropeDistance - tensionStart) * 2.4;
        b.vx -= ropeDx / ropeDistance * tension * dt;
        b.vy -= ropeDy / ropeDistance * tension * dt;
      }

      const air = Math.exp(-(rawFlight < 1 ? 0.62 : 2.35) * dt);
      b.vx *= air;
      b.vy *= air;
      const speed = Math.hypot(b.vx, b.vy);
      const maxSpeed = rawFlight < 1 ? 122 : 108;
      if (speed > maxSpeed) {
        b.vx = b.vx / speed * maxSpeed;
        b.vy = b.vy / speed * maxSpeed;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (speed > 3) {
        const desiredHeading = Math.atan2(b.vy, b.vx);
        const delta = u.wrap(desiredHeading - b.heading + Math.PI, 0, Math.PI * 2) - Math.PI;
        b.heading += delta * Math.min(1, dt * (rawFlight < 1 ? 5.5 : 3.4));
      }
      updateRope(b, dt, t);
    }

    const activity = Math.min(1, input.D * 0.65 + input.speed / 1100 + burst * 0.4);
    Engine.audio.setShimmer(activity * 0.055);
  }

  function drawPathProgress(points, progress, weight, color, alpha) {
    if (progress <= 0 || points.length < 2) return;
    const end = progress * (points.length - 1);
    const whole = Math.floor(end);
    stroke(color[0], color[1], color[2], alpha);
    strokeWeight(weight);
    noFill();
    beginShape();
    vertex(points[0][0], points[0][1]);
    for (let i = 1; i <= Math.min(whole, points.length - 1); i++) {
      vertex(points[i][0], points[i][1]);
    }
    if (whole < points.length - 1) {
      const p = end - whole;
      const a = points[whole];
      const b = points[whole + 1];
      vertex(u.mix(a[0], b[0], p), u.mix(a[1], b[1], p));
    }
    endShape();
  }

  function drawCracks(t) {
    strokeJoin(MITER);
    strokeCap(SQUARE);
    for (const crack of cracks) {
      const p = u.ramp(crack.t, crack.t + crack.span, t);
      drawPathProgress(crack.points, p, crack.weight, INK, 225);
      if (p > 0.68 && crack.weight > 1) {
        drawPathProgress(crack.points, p, crack.weight * 0.3, GRAPHITE, 120);
      }
    }

    const tear = u.smootherstep(0.62, 2.08, t);
    if (tear > 0) {
      push();
      translate(348, 269);
      scale(tear, 0.48 + tear * 0.52);
      noStroke();
      fill(INK[0], INK[1], INK[2], 250);
      beginShape();
      vertex(-49, -7);
      vertex(-25, -12);
      vertex(-7, -28);
      vertex(7, -11);
      vertex(37, -15);
      vertex(57, -1);
      vertex(31, 8);
      vertex(12, 25);
      vertex(-2, 9);
      vertex(-31, 12);
      endShape(CLOSE);
      pop();
    }
  }

  function drawRuptureDebris(t) {
    for (const slab of wallSlabs) {
      const age = t - slab.t;
      if (age < 0 || age > slab.life) continue;
      const alpha = u.clamp01((slab.life - age) / 0.46);
      const drag = Math.max(0.68, 1 - age * 0.08);
      const x = slab.x + slab.vx * age * drag;
      const y = slab.y + slab.vy * age + slab.gravity * age * age * 0.5;
      const rotation = slab.angle + slab.spin * age;
      push();
      translate(x + 3.2, y + 4.6);
      rotate(rotation);
      scale(slab.width, slab.height);
      noStroke();
      fill(INK[0], INK[1], INK[2], 62 * alpha);
      beginShape();
      for (const point of slab.points) vertex(point[0], point[1]);
      endShape(CLOSE);
      pop();

      push();
      translate(x, y);
      rotate(rotation);
      scale(slab.width, slab.height);
      stroke(INK[0], INK[1], INK[2], 168 * alpha);
      strokeWeight(0.035);
      fill(PAPER[0] - 8, PAPER[1] - 8, PAPER[2] - 7, 252 * alpha);
      beginShape();
      for (const point of slab.points) vertex(point[0], point[1]);
      endShape(CLOSE);
      stroke(GRAPHITE[0], GRAPHITE[1], GRAPHITE[2], 76 * alpha);
      strokeWeight(0.02);
      line(-0.44, -0.22, 0.34, 0.31);
      pop();
    }
  }

  function drawHeartShape(t) {
    if (t < IMPACT_TIMES[0]) return;
    const mergedReveal = u.smootherstep(2.24, 2.52, t);
    const beat = 1 + pulse * (0.035 + 0.018 * Math.sin(t * 13));
    push();
    translate(HEART_CENTER.x, HEART_CENTER.y);
    scale(beat);
    translate(-HEART_CENTER.x, -HEART_CENTER.y);

    for (let i = 0; i < HEART_PUNCTURES.length; i++) {
      const open = u.smootherstep(IMPACT_TIMES[i] - 0.035, IMPACT_TIMES[i] + 0.17, t);
      if (open <= 0) continue;
      const center = polygonCenter(HEART_PUNCTURES[i]);
      const openScale = 0.08 + open * 0.95;
      push();
      translate(center[0], center[1]);
      scale(openScale);
      translate(-center[0], -center[1]);
      noStroke();
      fill(INK[0], INK[1], INK[2], 252);
      beginShape();
      for (const point of HEART_PUNCTURES[i]) vertex(point[0], point[1]);
      endShape(CLOSE);
      pop();
    }

    if (mergedReveal > 0) {
      noStroke();
      fill(INK[0], INK[1], INK[2], 252 * mergedReveal);
      beginShape();
      for (const point of HEART_POLYGON) vertex(point[0], point[1]);
      endShape(CLOSE);
    }

    for (const grain of heartGrain) {
      noStroke();
      if (grain.light) fill(196, 207, 202, grain.a * mergedReveal);
      else fill(0, 0, 0, grain.a * 0.72 * mergedReveal);
      ellipse(grain.x, grain.y, grain.r, grain.r * 0.66);
    }

    fill(PAPER[0], PAPER[1], PAPER[2], 255 * mergedReveal);
    beginShape();
    vertex(327, 414);
    vertex(340, 383);
    vertex(348, 427);
    vertex(357, 444);
    vertex(350, 464);
    vertex(337, 447);
    endShape(CLOSE);
    beginShape();
    vertex(369, 427);
    vertex(381, 387);
    vertex(394, 432);
    vertex(386, 455);
    endShape(CLOSE);
    pop();
  }

  function ruptureShake(t) {
    let x = 0;
    let y = 0;
    IMPACT_TIMES.forEach((impact, index) => {
      const age = t - impact;
      if (age < 0 || age > 0.31) return;
      const envelope = 1 - age / 0.31;
      const amplitude = (2.2 + index * 0.18) * envelope * envelope;
      x += Math.sin(age * 104 + index * 1.71) * amplitude;
      y += Math.cos(age * 83 + index * 2.13) * amplitude * 0.72;
    });
    return [x, y];
  }

  function drawVessels(t) {
    strokeCap(ROUND);
    for (const vessel of vessels) {
      const p = u.smootherstep(vessel.t, vessel.t + 1.65, t);
      drawPathProgress(vessel.points, p, vessel.weight, RED, 155);
    }
    const nexus = u.ramp(2.45, 3.7, t);
    if (nexus > 0) {
      noStroke();
      fill(RED[0], RED[1], RED[2], 165 * nexus);
      ellipse(360, 647, 4.4 + pulse * 5.5, 4.4 + pulse * 5.5);
    }
  }

  function drawTether(b, alpha) {
    if (!b.rope || b.rope.length < 2) return;
    noFill();
    stroke(RED[0], RED[1], RED[2], alpha);
    strokeWeight(b.size > 25 ? 1.62 : 1.32);
    beginShape();
    curveVertex(b.rope[0].x, b.rope[0].y);
    for (const node of b.rope) curveVertex(node.x, node.y);
    const last = b.rope[b.rope.length - 1];
    curveVertex(last.x, last.y);
    endShape();
  }

  function drawWing(side, size, openness, blueShift) {
    const sx = side * openness;
    push();
    scale(sx, 1);
    stroke(BLUE_DARK[0], BLUE_DARK[1], BLUE_DARK[2], 235);
    strokeWeight(0.75);
    fill(
      BLUE[0] + blueShift * 14,
      BLUE[1] - blueShift * 9,
      BLUE[2] - blueShift * 26,
      248,
    );
    beginShape();
    vertex(0, -1);
    bezierVertex(size * 0.2, -size * 0.64, size * 0.88, -size * 0.7, size * 0.92, -size * 0.12);
    bezierVertex(size * 0.92, size * 0.12, size * 0.62, size * 0.27, size * 0.19, size * 0.09);
    endShape(CLOSE);
    beginShape();
    vertex(0, 0);
    bezierVertex(size * 0.23, size * 0.1, size * 0.7, size * 0.23, size * 0.66, size * 0.62);
    bezierVertex(size * 0.6, size * 0.94, size * 0.2, size * 0.67, size * 0.05, size * 0.19);
    endShape(CLOSE);

    stroke(88, 57, 5, 125);
    strokeWeight(0.45);
    line(0, 0, size * 0.73, -size * 0.43);
    line(size * 0.15, -size * 0.02, size * 0.78, -size * 0.06);
    line(size * 0.06, size * 0.08, size * 0.51, size * 0.62);
    pop();
  }

  function drawButterfly(b, appear, t) {
    if (appear <= 0.015) return;
    const age = Math.max(0, t - b.launchT);
    const rawFlight = u.clamp01(age / b.flightDuration);
    const flightEnergy = rawFlight < 1 ? 1 : 0.66;
    const flapPhase = age * b.wingHz * Math.PI * 2 * flightEnergy
      + Math.sin(age * 2.05 + b.phase) * 0.72
      + b.phase;
    const flap = Math.sin(flapPhase);
    const openness = 0.24 + 0.76 * (flap * 0.5 + 0.5);
    const bank = u.clamp((b.vx * Math.cos(b.heading) + b.vy * Math.sin(b.heading)) / 420, -0.14, 0.14);
    const s = b.size * (0.82 + appear * 0.18);
    push();
    translate(b.x, b.y);
    rotate(b.heading + Math.PI / 2 + bank);
    scale(appear);
    drawWing(-1, s, openness, b.blueShift);
    drawWing(1, s, openness, b.blueShift);

    stroke(9, 14, 18, 235);
    strokeWeight(Math.max(0.8, s * 0.055));
    line(0, -s * 0.22, 0, s * 0.42);
    strokeWeight(0.65);
    noFill();
    bezier(-0.5, -s * 0.2, -s * 0.08, -s * 0.55, -s * 0.22, -s * 0.64, -s * 0.29, -s * 0.72);
    bezier(0.5, -s * 0.2, s * 0.08, -s * 0.55, s * 0.22, -s * 0.64, s * 0.29, -s * 0.72);
    pop();
  }

  function drawButterflies(t) {
    for (const b of butterflies) {
      const ropeVis = u.smootherstep(b.ropeSpawnT, b.ropeSpawnT + 0.2, t);
      if (ropeVis > 0.01 && b.ropeReleased) {
        drawTether(b, 54 + ropeVis * 112);
      }
    }
    const ordered = butterflies.slice().sort((a, b) => a.y - b.y);
    for (const b of ordered) {
      const appear = u.smootherstep(b.launchT - 0.06, b.launchT + 0.2, t);
      drawButterfly(b, appear, t);
    }
  }

  function drawTypography(t) {
    const alpha = 255 * u.smootherstep(2.35, 3.7, t);
    if (alpha <= 0) return;
    push();
    textFont("Courier New");
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(12.5);
    textLeading(13.5);
    fill(GRAPHITE[0], GRAPHITE[1], GRAPHITE[2], alpha * 0.88);
    text("This swallow-tail, a-suited gentleman,\nLeaves the dark marble of the pool.\nDescending,", 48, 708);
    fill(35, 44, 42, alpha * 0.12);
    text("This swallow-tail, a-suited gentleman,\nLeaves the dark marble of the pool.\nDescending,", 49.2, 708.8);

    textSize(12);
    fill(BLUE[0], BLUE[1], BLUE[2], alpha * 0.9);
    text("after @Livo", 482, 236);
    pop();
  }

  function drawHint(t) {
    if (Engine.auto() || Engine.staticT !== null || !Engine.started) return;
    const alpha = u.ramp(4.2, 5.2, t) * (1 - u.ramp(11.2, 12.4, t));
    if (alpha <= 0) return;
    push();
    textAlign(CENTER, BASELINE);
    textFont("Courier New");
    textSize(10.5);
    fill(GRAPHITE[0], GRAPHITE[1], GRAPHITE[2], 120 * alpha);
    text("MOVE TO PULL · PRESS TO PULSE · SPACE TO RELEASE", W / 2, 927);
    pop();
  }

  function render(t) {
    image(paper, 0, 0);
    const shake = ruptureShake(t);
    push();
    translate(shake[0], shake[1]);
    drawCracks(t);
    drawHeartShape(t);
    drawRuptureDebris(t);
    drawVessels(t);
    drawButterflies(t);
    drawTypography(t);
    drawHint(t);
    pop();

    noStroke();
    for (let y = 3; y < H; y += 6) {
      fill(14, 20, 18, y % 12 === 3 ? 2 : 1);
      rect(0, y, W, 1);
    }
  }

  function setupReferenceAudio() {
    referenceAudio = document.getElementById("reference-track");
    const button = document.getElementById("btn-sound");
    if (!referenceAudio || !button) return;
    referenceAudio.volume = 1;
    soundToggleHandler = () => {
      setTimeout(() => {
        if (!referenceAudio || !Engine.audio) return;
        if (!Engine.audio.enabled || !Engine.started || Engine.paused) {
          referenceAudio.pause();
          return;
        }
        referenceAudio.currentTime = Math.min(Engine.now(), referenceAudio.duration || Engine.now());
        referenceAudio.play().catch(() => {});
      }, 0);
    };
    button.addEventListener("click", soundToggleHandler);
  }

  function playReferenceAudio({ restart, firstStart }) {
    if (!referenceAudio || !Engine.audio || !Engine.audio.enabled) return;
    if (restart || firstStart) referenceAudio.currentTime = 0;
    referenceAudio.play().catch(() => {});
  }

  function pauseReferenceAudio() {
    if (referenceAudio) referenceAudio.pause();
  }

  function destroyReferenceAudio() {
    const button = document.getElementById("btn-sound");
    if (button && soundToggleHandler) button.removeEventListener("click", soundToggleHandler);
    if (referenceAudio) {
      referenceAudio.pause();
      referenceAudio.currentTime = 0;
    }
    soundToggleHandler = null;
    referenceAudio = null;
  }

  Engine.start({
    id: "heart-butterfly",
    width: W,
    height: H,
    duration: 15.25,
    pixelDensity: "auto",
    waypoints: WAYPOINTS,
    input: {
      attack: 4.2,
      release: 1.5,
      idleTimeout: 1.0,
      jitter: { x: 18, y: 15, speed: 0.34 },
    },
    timing: { fixedStep: 1 / 60, recordStep: 1 / 60 },
    performance: { adaptive: true, targetFps: 50 },
    build() {
      textFont("Courier New");
      buildPaper();
      buildCracks();
      buildRuptureDebris();
      buildHeartTexture();
      buildVessels();
      resetScene();
    },
    setup: setupReferenceAudio,
    reset: resetScene,
    update: sceneUpdate,
    render,
    play: playReferenceAudio,
    pause: pauseReferenceAudio,
    resume: () => playReferenceAudio({ restart: false, firstStart: false }),
    destroy: destroyReferenceAudio,
    audio: {
      intro() {
        if (!Engine.hf()) return [];
        const hairlines = [0.18, 0.37, 0.56, 0.78, 1.02, 1.23].map((time, i) => ({
          t: time,
          type: "crack",
          gain: 0.028 + i * 0.002,
          pitch: 1.25 - i * 0.035,
        }));
        const impacts = IMPACT_TIMES.map((impact, i) => ({
          t: impact,
          type: "crack",
          gain: 0.04 + i * 0.003,
          pitch: 1.04 - i * 0.018,
        }));
        const notes = [0, 7, 12, 10, 15, 19, 22, 24].map((semi, i) => ({
          t: 2.75 + i * 0.64,
          type: "pluck",
          freq: u.noteFreq(semi),
          gain: 0.032 + i * 0.003,
          decay: 1.6 + i * 0.08,
        }));
        return hairlines.concat(impacts, notes).sort((a, b) => a.t - b.t);
      },
    },
    ui: {
      tip: "ENTER THE HEART",
      sub: "移动牵引蝶群 · 点击触发脉冲 · after @Livo",
      canvasLabel: "心脏与蝴蝶交互画布；移动指针牵引，点击触发群蝶爆发",
    },
  });
})();
