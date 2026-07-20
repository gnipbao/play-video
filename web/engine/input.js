/* ============================================================
 * engine/input.js — 虚拟鼠标 + 扰动强度
 *
 * 两种驱动(运行时按 Engine.auto() 动态判断):
 *   自动/渲染:waypoints [(t,x,y),...] 折线,段内 smoothstep 插值 + 噪声抖动
 *   手动:跟踪真实鼠标,静止 0.7s 后视为离开
 * 扰动强度 D:快起慢落的 0..1 包络,场景用它驱动一切"受惊"表现。
 *
 * 按压状态 pressed:waypoints 可带第 4 元素(0/1),表示该段按住拖动
 * (渲染/自动模式可编排拖拽);手动模式取 mouseIsPressed。
 * ============================================================ */
"use strict";

Engine.Input = class {
  constructor(waypoints, rates) {
    this.wp = waypoints || null;
    this.attack = (rates && rates.attack) || 5.5;    // D 上升速率
    this.release = (rates && rates.release) || 1.1;  // D 回落速率
    this.x = -999; this.y = -999;
    this.active = false;
    this.pressed = false;
    this.speed = 0;
    this.D = 0;                 // 扰动强度 0..1
    this._lastMoveT = -99;
  }

  reset() { this.D = 0; }

  update(t, dt) {
    if (Engine.auto() && this.wp) {
      const wp = this.wp;
      if (t < wp[0][0] || t > wp[wp.length - 1][0]) {
        this.active = false;
        this.pressed = false;
        this.speed = 0;
      } else {
        this.active = true;
        let i = 0;
        while (i < wp.length - 2 && t > wp[i + 1][0]) i++;
        const [t0, x0, y0] = wp[i], [t1, x1, y1] = wp[i + 1];
        const p = Engine.u.ramp(t0, t1, t);
        const nx = Engine.u.mix(x0, x1, p) + (noise(900, t * 0.5) - 0.5) * 60;
        const ny = Engine.u.mix(y0, y1, p) + (noise(950, t * 0.5) - 0.5) * 50;
        this.speed = Math.hypot(nx - this.x, ny - this.y) / Math.max(dt, 1e-3);
        this.x = nx; this.y = ny;
        this.pressed = wp[i].length > 3 && wp[i][3] === 1;   // 段首标记:该段按住
      }
    } else {
      const W = Engine.cfg.width, H = Engine.cfg.height;
      const inside = mouseX >= 0 && mouseX <= W && mouseY >= 0 && mouseY <= H;
      const moved = Math.hypot(mouseX - pmouseX, mouseY - pmouseY) > 2;
      if (inside && moved) {
        this._lastMoveT = t;
        this.x = mouseX; this.y = mouseY;
        this.speed = Math.hypot(mouseX - pmouseX, mouseY - pmouseY) / Math.max(dt, 1e-3);
      }
      this.active = inside && (t - this._lastMoveT) < 0.7;
      if (!this.active) this.speed = 0;
      this.pressed = inside && mouseIsPressed;
    }

    // 扰动强度:快起慢落
    const target = this.active ? 1 : 0;
    const k = this.active ? this.attack : this.release;
    this.D += (target - this.D) * (1 - Math.exp(-k * dt));
    if (this.D < 0.003) this.D = 0;
  }
};
