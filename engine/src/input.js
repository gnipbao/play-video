/* ============================================================
 * engine/input.js — 统一创意输入系统
 *
 * 向后兼容字段: x / y / active / pressed / speed / D
 * 新增:
 *   - Pointer Events:mouse/touch/pen 与压力、倾角、多指
 *   - dx/dy/vx/vy、归一化坐标 nx/ny、进入/离开/按下边沿
 *   - pinch/rotation 手势、wheel、键盘状态
 *   - 高分屏/CSS 缩放后的精确画布坐标
 *   - 自动轨迹仍保持确定性,并支持对象式 waypoint
 * ============================================================ */
"use strict";

Engine.Input = class {
  constructor(waypoints, options = {}) {
    options = options || {};
    this.options = options || {};
    this.wp = this._normalizeWaypoints(waypoints);
    this.attack = this._number(options.attack, 5.5);
    this.release = this._number(options.release, 1.1);
    this.idleTimeout = this._number(options.idleTimeout, 0.7);
    this.velocitySmoothing = this._number(options.velocitySmoothing, 18);
    this.wheelDecay = this._number(options.wheelDecay, 12);
    this.preventDefault = options.preventDefault !== false;
    this.captureKeys = options.captureKeys === true;
    this.jitter = Object.assign({ x: 60, y: 50, speed: 0.5 }, options.jitter || {});

    this._element = null;
    this._previousTouchAction = "";
    this._cleanup = [];
    this._pointerMap = new Map();
    this._primaryId = null;
    this._lastSampledPointerId = null;
    this._moved = false;
    this._lastMoveT = -99;
    this._hasPosition = false;
    this._pendingPressed = false;
    this._pendingReleased = false;
    this._pendingKeysDown = new Set();
    this._pendingKeysUp = new Set();
    this._gestureDistance = 0;
    this._gestureAngle = 0;
    this._gestureActive = false;
    this._gestureIds = "";

    this.keys = new Set();
    this.justKeysDown = new Set();
    this.justKeysUp = new Set();
    this.pointers = [];
    this.gesture = {
      active: false, centerX: 0, centerY: 0,
      scale: 1, deltaScale: 1, rotation: 0, deltaRotation: 0,
    };
    this.reset();
  }

  _number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  _normalizeWaypoints(points) {
    if (!Array.isArray(points) || !points.length) return null;
    const normalized = [];
    for (const point of points) {
      if (Array.isArray(point)) {
        const [t, x, y, pressed] = point;
        if ([t, x, y].every(Number.isFinite)) {
          normalized.push({ t, x, y, pressed: pressed === 1 || pressed === true, ease: "smooth" });
        }
      } else if (point && [point.t, point.x, point.y].every(Number.isFinite)) {
        normalized.push({
          t: point.t, x: point.x, y: point.y,
          pressed: point.pressed === true,
          ease: point.ease || "smooth",
        });
      }
    }
    normalized.sort((a, b) => a.t - b.t);
    return normalized.length ? normalized : null;
  }

  attach(element) {
    if (!element || this._element === element) return this;
    this.detach();
    this._element = element;
    this._previousTouchAction = element.style.touchAction;
    if (this.preventDefault) element.style.touchAction = this.options.touchAction || "none";

    this._listen(element, "pointerdown", this._onPointerDown, { passive: false });
    this._listen(element, "pointermove", this._onPointerMove, { passive: false });
    this._listen(element, "pointerup", this._onPointerUp, { passive: false });
    this._listen(element, "pointercancel", this._onPointerCancel, { passive: false });
    this._listen(element, "lostpointercapture", this._onLostPointerCapture, { passive: true });
    this._listen(element, "pointerenter", this._onPointerEnter, { passive: true });
    this._listen(element, "pointerleave", this._onPointerLeave, { passive: true });
    this._listen(element, "wheel", this._onWheel, { passive: false });
    this._listen(window, "keydown", this._onKeyDown, { passive: false });
    this._listen(window, "keyup", this._onKeyUp, { passive: false });
    this._listen(window, "blur", this._onBlur, { passive: true });
    return this;
  }

  detach() {
    for (const off of this._cleanup.splice(0)) off();
    if (this._element && this.preventDefault) this._element.style.touchAction = this._previousTouchAction;
    this._element = null;
    this.reset();
    return this;
  }

  _listen(target, type, method, options) {
    const handler = method.bind(this);
    target.addEventListener(type, handler, options);
    this._cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  _eventPoint(event) {
    const point = Engine.screenToCanvas(event.clientX, event.clientY);
    return {
      id: event.pointerId,
      x: point.x, y: point.y, nx: point.nx, ny: point.ny,
      inside: point.inside,
      type: event.pointerType || "mouse",
      pressure: Number.isFinite(event.pressure) ? event.pressure : 0,
      tiltX: event.tiltX || 0, tiltY: event.tiltY || 0,
      twist: event.twist || 0,
      buttons: event.buttons || 0,
      down: event.buttons !== 0 || event.type === "pointerdown",
      timeStamp: event.timeStamp,
    };
  }

  _samples(event) {
    const source = typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents() : [];
    const raw = source.length ? source : [event];
    return raw.map((sample) => this._eventPoint(sample));
  }

  _storePointer(event, down) {
    const samples = this._samples(event);
    const point = samples[samples.length - 1];
    point.down = down === undefined ? point.down : down;
    this._pointerMap.set(point.id, point);
    if (this._primaryId === null || event.isPrimary) this._primaryId = point.id;
    this._moved = true;
    return { point, samples };
  }

  _emit(type, event, point, samples) {
    Engine.emit(type, { event, point, samples: samples || [point], input: this });
  }

  _onPointerDown(event) {
    if (this.preventDefault) event.preventDefault();
    const wasPressed = [...this._pointerMap.values()].some((point) => point.down);
    const { point, samples } = this._storePointer(event, true);
    if (!wasPressed) this._pendingPressed = true;
    if (this._element.setPointerCapture) {
      try { this._element.setPointerCapture(event.pointerId); } catch (_) { /* Safari 旧版 */ }
    }
    this._emit("pointer:down", event, point, samples);
  }

  _onPointerMove(event) {
    if (this.preventDefault && event.pointerType !== "mouse") event.preventDefault();
    const previous = this._pointerMap.get(event.pointerId);
    const isDown = previous ? previous.down : event.buttons !== 0;
    const { point, samples } = this._storePointer(event, isDown);
    this._emit("pointer:move", event, point, samples);
  }

  _finishPointer(event, cancelled) {
    if (this.preventDefault) event.preventDefault();
    const wasPressed = [...this._pointerMap.values()].some((point) => point.down);
    const { point, samples } = this._storePointer(event, false);
    const keepHover = !cancelled && point.type === "mouse" && point.inside;
    if (keepHover) this._pointerMap.set(event.pointerId, point);
    else this._pointerMap.delete(event.pointerId);
    if (this._primaryId === event.pointerId) {
      const points = [...this._pointerMap.values()];
      const next = points.find((item) => item.down) || points[0];
      this._primaryId = next ? next.id : null;
      this._lastSampledPointerId = null;
    }
    if (wasPressed && ![...this._pointerMap.values()].some((item) => item.down)) {
      this._pendingReleased = true;
    }
    this._emit(cancelled ? "pointer:cancel" : "pointer:up", event, point, samples);
  }

  _onPointerUp(event) { this._finishPointer(event, false); }
  _onPointerCancel(event) { this._finishPointer(event, true); }
  _onLostPointerCapture(event) {
    const point = this._pointerMap.get(event.pointerId);
    if (!point || !point.down || (Number.isFinite(event.buttons) && event.buttons !== 0)) return;
    point.down = false;
    this._pointerMap.delete(event.pointerId);
    if (this._primaryId === event.pointerId) {
      const points = [...this._pointerMap.values()];
      const next = points.find((item) => item.down) || points[0];
      this._primaryId = next ? next.id : null;
      this._lastSampledPointerId = null;
    }
    if (![...this._pointerMap.values()].some((item) => item.down)) this._pendingReleased = true;
    this._emit("pointer:cancel", event, point);
  }

  _onPointerEnter(event) {
    const point = this._eventPoint(event);
    const previous = this._pointerMap.get(event.pointerId);
    point.down = previous ? previous.down : event.buttons !== 0;
    this._pointerMap.set(point.id, point);
    if (this._primaryId === null || event.isPrimary) this._primaryId = point.id;
    this._emit("pointer:enter", event, point);
  }

  _onPointerLeave(event) {
    const point = this._pointerMap.get(event.pointerId) || this._eventPoint(event);
    point.inside = false;
    if (point.down) this._pointerMap.set(point.id, point);
    else {
      this._pointerMap.delete(point.id);
      if (this._primaryId === point.id) {
        const points = [...this._pointerMap.values()];
        const next = points.find((item) => item.down) || points[0];
        this._primaryId = next ? next.id : null;
        this._lastSampledPointerId = null;
      }
    }
    this._emit("pointer:leave", event, point);
  }

  _onWheel(event) {
    if (this.preventDefault && this.options.captureWheel === true) event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? window.innerHeight : 1);
    this.wheelX += event.deltaX * scale;
    this.wheelY += event.deltaY * scale;
    this._emit("input:wheel", event, Engine.screenToCanvas(event.clientX, event.clientY));
  }

  _onKeyDown(event) {
    if (!this.captureKeys && this._isEditable(event.target)) return;
    if (!this.keys.has(event.code)) this._pendingKeysDown.add(event.code);
    this.keys.add(event.code);
    if (this.captureKeys) event.preventDefault();
    Engine.emit("key:down", { event, code: event.code, key: event.key, repeat: event.repeat, input: this });
  }

  _onKeyUp(event) {
    const tracked = this.keys.has(event.code);
    if (!this.captureKeys && !tracked && this._isEditable(event.target)) return;
    this.keys.delete(event.code);
    if (tracked) this._pendingKeysUp.add(event.code);
    if (this.captureKeys) event.preventDefault();
    Engine.emit("key:up", { event, code: event.code, key: event.key, input: this });
  }

  _isEditable(target) {
    if (!target) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
  }

  _onBlur() {
    const hadDown = [...this._pointerMap.values()].some((point) => point.down);
    for (const code of this.keys) this._pendingKeysUp.add(code);
    this.keys.clear();
    this._pointerMap.clear();
    this._primaryId = null;
    this._lastSampledPointerId = null;
    if (hadDown) this._pendingReleased = true;
    this._pendingPressed = false;
    this.pressed = false;
    Engine.emit("input:blur", { input: this });
  }

  reset() {
    this.x = -999; this.y = -999;
    this.nx = -1; this.ny = -1;
    this.dx = 0; this.dy = 0;
    this.vx = 0; this.vy = 0;
    this.speed = 0;
    this.active = false;
    this.pressed = false;
    this.justPressed = false;
    this.justReleased = false;
    this.pressure = 0;
    this.type = null;
    this.tiltX = 0; this.tiltY = 0; this.twist = 0;
    this.wheelX = 0; this.wheelY = 0;
    this.D = 0;
    this._lastMoveT = -99;
    this._hasPosition = false;
    this._moved = false;
    this._pendingPressed = false;
    this._pendingReleased = false;
    this._pointerMap.clear();
    this._primaryId = null;
    this._lastSampledPointerId = null;
    this.keys.clear();
    this._pendingKeysDown.clear();
    this._pendingKeysUp.clear();
    this.justKeysDown.clear();
    this.justKeysUp.clear();
    this.pointers = [];
    this._resetGesture();
  }

  _resetGesture() {
    this._gestureDistance = 0;
    this._gestureAngle = 0;
    this._gestureActive = false;
    this._gestureIds = "";
    this.pinch = 1;
    this.rotation = 0;
    Object.assign(this.gesture, {
      active: false, scale: 1, deltaScale: 1,
      rotation: 0, deltaRotation: 0, pointerIds: [],
    });
  }

  keyDown(code) { return this.keys.has(code); }
  keyPressed(code) { return this.justKeysDown.has(code); }
  keyReleased(code) { return this.justKeysUp.has(code); }

  consumeWheel() {
    const value = { x: this.wheelX, y: this.wheelY };
    this.wheelX = 0; this.wheelY = 0;
    return value;
  }

  _waypointEase(name, p) {
    if (name === "linear") return Engine.u.clamp01(p);
    if (name === "smoother") return Engine.u.smootherstep(0, 1, p);
    return Engine.u.ramp(0, 1, p);
  }

  _updateAuto(t, dt) {
    const wp = this.wp;
    if (!wp || !wp.length || t < wp[0].t || t > wp[wp.length - 1].t) {
      this.active = false;
      this.pressed = false;
      this.pressure = 0;
      this.dx = 0; this.dy = 0;
      this.speed = 0;
      this.vx = 0; this.vy = 0;
      return;
    }

    let nx, ny, pressed;
    if (wp.length === 1) {
      nx = wp[0].x; ny = wp[0].y; pressed = wp[0].pressed;
    } else {
      let i = 0;
      while (i < wp.length - 2 && t > wp[i + 1].t) i++;
      const a = wp[i], b = wp[i + 1];
      const p = this._waypointEase(a.ease, Engine.u.invLerp(a.t, b.t, t));
      nx = Engine.u.mix(a.x, b.x, p);
      ny = Engine.u.mix(a.y, b.y, p);
      pressed = a.pressed;
    }
    if (typeof noise === "function") {
      nx += (noise(900, t * this.jitter.speed) - 0.5) * this.jitter.x;
      ny += (noise(950, t * this.jitter.speed) - 0.5) * this.jitter.y;
    }

    const oldX = this.x, oldY = this.y;
    this.dx = this._hasPosition ? nx - oldX : 0;
    this.dy = this._hasPosition ? ny - oldY : 0;
    const targetVx = dt > 0 ? this.dx / dt : 0;
    const targetVy = dt > 0 ? this.dy / dt : 0;
    this.vx = targetVx; this.vy = targetVy;
    this.speed = Math.hypot(this.vx, this.vy);
    this.x = nx; this.y = ny;
    this.nx = nx / Engine.cfg.width; this.ny = ny / Engine.cfg.height;
    this.active = true;
    this.pressed = pressed;
    this.pressure = pressed ? 1 : 0;
    this.type = "auto";
    this._hasPosition = true;
  }

  _updateGesture() {
    const down = this.pointers.filter((point) => point.down);
    if (down.length < 2) {
      if (this._gestureActive) Engine.emit("gesture:end", { gesture: this.gesture, input: this });
      this._resetGesture();
      return;
    }
    const a = down[0], b = down[1];
    const gestureIds = `${a.id}:${b.id}`;
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.max(1e-6, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    let wasActive = this._gestureActive && this._gestureIds === gestureIds;
    if (this._gestureActive && !wasActive) {
      Engine.emit("gesture:end", { gesture: this.gesture, input: this });
    }
    if (!wasActive) {
      this._gestureDistance = distance;
      this._gestureAngle = angle;
      this.gesture.scale = 1;
      this.gesture.rotation = 0;
    }
    const deltaScale = wasActive ? distance / this._gestureDistance : 1;
    const deltaRotation = wasActive
      ? Engine.u.wrap(angle - this._gestureAngle + Math.PI, 0, Math.PI * 2) - Math.PI : 0;
    this._gestureDistance = distance;
    this._gestureAngle = angle;
    this._gestureActive = true;
    this._gestureIds = gestureIds;
    this.gesture.active = true;
    this.gesture.pointerIds = [a.id, b.id];
    this.gesture.centerX = (a.x + b.x) / 2;
    this.gesture.centerY = (a.y + b.y) / 2;
    this.gesture.deltaScale = deltaScale;
    this.gesture.deltaRotation = deltaRotation;
    this.gesture.scale *= deltaScale;
    this.gesture.rotation += deltaRotation;
    this.pinch = deltaScale;
    this.rotation = deltaRotation;
    if (!wasActive || Math.abs(deltaScale - 1) > 1e-5 || Math.abs(deltaRotation) > 1e-5) {
      Engine.emit(wasActive ? "gesture:change" : "gesture:start", { gesture: this.gesture, input: this });
    }
  }

  _updateManual(t, dt) {
    const currentPrimary = this._pointerMap.get(this._primaryId);
    let first = null;
    let firstDown = null;
    for (const point of this._pointerMap.values()) {
      if (!first) first = point;
      if (point.down) { firstDown = point; break; }
    }
    const primary = (currentPrimary && currentPrimary.down ? currentPrimary : null)
      || firstDown || currentPrimary || first;
    this.pointers = [...this._pointerMap.values()].map((point) => Object.assign({}, point));

    if (primary) {
      const oldX = this.x, oldY = this.y;
      const primaryChanged = this._lastSampledPointerId !== primary.id;
      const movedPosition = !this._hasPosition || primary.x !== oldX || primary.y !== oldY;
      this.dx = this._hasPosition && !primaryChanged ? primary.x - oldX : 0;
      this.dy = this._hasPosition && !primaryChanged ? primary.y - oldY : 0;
      this.x = primary.x; this.y = primary.y;
      this.nx = primary.nx; this.ny = primary.ny;
      this.pressure = primary.pressure;
      this.type = primary.type;
      this.tiltX = primary.tiltX; this.tiltY = primary.tiltY; this.twist = primary.twist;
      this._hasPosition = true;
      this._lastSampledPointerId = primary.id;
      if (movedPosition || this._moved) this._lastMoveT = t;
      const targetVx = dt > 0 ? this.dx / dt : 0;
      const targetVy = dt > 0 ? this.dy / dt : 0;
      const blend = 1 - Math.exp(-this.velocitySmoothing * Math.max(0, dt));
      if (primaryChanged) { this.vx = 0; this.vy = 0; }
      this.vx = Engine.u.mix(this.vx, targetVx, blend);
      this.vy = Engine.u.mix(this.vy, targetVy, blend);
    } else {
      this._lastSampledPointerId = null;
      this.dx = 0; this.dy = 0;
      const blend = 1 - Math.exp(-this.velocitySmoothing * Math.max(0, dt));
      this.vx = Engine.u.mix(this.vx, 0, blend);
      this.vy = Engine.u.mix(this.vy, 0, blend);
      this.pressure = 0;
    }

    this.pressed = this.pointers.some((point) => point.down);
    const inside = !!primary && primary.inside;
    this.active = this.pressed || (inside && (t - this._lastMoveT) < this.idleTimeout);
    this.speed = this.active ? Math.hypot(this.vx, this.vy) : 0;
    if (!this.active && !this.pressed) {
      this.vx = Engine.u.damp(this.vx, 0, this.velocitySmoothing, dt);
      this.vy = Engine.u.damp(this.vy, 0, this.velocitySmoothing, dt);
    }
    this._moved = false;
    this._updateGesture();
  }

  update(t, dt) {
    const wasPressed = this.pressed;
    const pendingPressed = this._pendingPressed;
    const pendingReleased = this._pendingReleased;
    this._pendingPressed = false;
    this._pendingReleased = false;
    this.justKeysDown.clear();
    this.justKeysUp.clear();
    for (const code of this._pendingKeysDown) this.justKeysDown.add(code);
    for (const code of this._pendingKeysUp) this.justKeysUp.add(code);
    this._pendingKeysDown.clear();
    this._pendingKeysUp.clear();

    if (Engine.auto() && this.wp) this._updateAuto(t, dt);
    else this._updateManual(t, dt);

    this.justPressed = pendingPressed || (!wasPressed && this.pressed);
    this.justReleased = pendingReleased || (wasPressed && !this.pressed);

    const target = this.active ? 1 : 0;
    const rate = this.active ? this.attack : this.release;
    this.D = Engine.u.damp(this.D, target, rate, dt);
    if (this.D < 0.003) this.D = 0;
    this.wheelX *= Math.exp(-this.wheelDecay * Math.max(0, dt));
    this.wheelY *= Math.exp(-this.wheelDecay * Math.max(0, dt));
  }
};
