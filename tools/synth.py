#!/usr/bin/env python3
"""离线合成配乐(与 web/engine/recipes.js 同一套配方)。

用法: python3 tools/synth.py <events.json> <out.wav>

输入:?dump=1 渲染模式确定性导出的音轨事件 JSON
输出:44.1kHz 立体声 16bit WAV

事件类型(配方与 JS 侧同名对齐,改配方必须两处同步):
  pluck   — 三角波拨弦,快攻慢衰 + 起音噪声(入场旋律)
  takeoff — 下滑音拨弦 + 风声 whoosh(惊飞)
  land    — 轻柔拨弦(归位)
  strum   — 划谱拨弦(五声音阶)
  type    — 打字机击键:金属 tick + 腔体 clack + 低频 thump(pitch 微抖)
  carriage — 打字机回车:擦键 zip + 铃 ding
"""
import json
import math
import sys
import wave

import numpy as np

SR = 44100
MASTER = 0.9

events = json.load(open(sys.argv[1]))
out_path = sys.argv[2]

tail = 3.0
dur = max(e["t"] for e in events) + tail
# 可选第三参数:成片时长上限(视频长度),音轨不超长,结尾 0.3s 淡出
maxdur = float(sys.argv[3]) if len(sys.argv) > 3 else None
if maxdur is not None and dur > maxdur:
    dur = maxdur
N = int(dur * SR)
mix = np.zeros(N, dtype=np.float64)


def add_pluck(t0, freq, gain, decay, gliss=False):
    """对应 LiveAudio.pluck():三角波 + 6ms 线性起音 + 指数衰减 + 30ms 起音噪声。"""
    n = int((decay + 0.1) * SR)
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    n = min(n, N - i0)
    t = np.arange(n) / SR
    if gliss:
        # freq(t) = freq * 0.55^(t/0.22),相位为其积分
        k = -math.log(0.55) / 0.22
        phase = 2 * math.pi * freq * (1 - np.exp(-k * t)) / k
    else:
        phase = 2 * math.pi * freq * t
    # 三角波:2/π · asin(sin(phase))
    sig = (2 / math.pi) * np.arcsin(np.sin(phase))
    env = np.minimum(t / 0.006, 1.0) * np.exp(np.log(0.0004 / gain) * t / decay)
    sig = sig * env * gain
    # 简单一阶低通(≈ Web Audio lowpass 2400Hz)软化高频
    a = 1 - math.exp(-2 * math.pi * 2400 / SR)
    out = np.empty(n)
    y = 0.0
    for i in range(n):
        y += a * (sig[i] - y)
        out[i] = y
    mix[i0:i0 + n] += out
    # 起音噪声(30ms,指数衰减)
    nn = min(int(0.03 * SR), N - i0)
    if nn > 0:
        rng = np.random.default_rng(int(t0 * 1000) + 7)
        nz = rng.uniform(-1, 1, nn)
        nenv = np.exp(np.log(0.0004 / (gain * 0.5)) * np.arange(nn) / (0.03 * SR))
        mix[i0:i0 + nn] += nz * nenv * gain * 0.5 * 0.6  # 高通效果近似:压低一点


def add_whoosh(t0, dur_s, gain):
    """对应 LiveAudio.whoosh():白噪声 + 带通扫频 380→1900→520。"""
    n = int(dur_s * SR)
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    n = min(n, N - i0)
    t = np.arange(n) / SR
    rng = np.random.default_rng(int(t0 * 977) + 3)
    nz = rng.uniform(-1, 1, n)
    # 简化方案:噪声 × 包络,再过固定宽带的共振带通(听感接近时变扫频)
    env = np.minimum(t / (dur_s * 0.35), 1.0) * np.clip((dur_s - t) / (dur_s * 0.65), 0, 1)
    # 两段二阶带通(中心取扫频中值 900Hz,Q≈1.4)
    w0 = 2 * math.pi * 900 / SR
    alpha = math.sin(w0) / (2 * 1.4)
    b0, b2 = alpha, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w0), 1 - alpha
    out = np.zeros(n)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        x = nz[i]
        y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1 = x1, x
        y2, y1 = y1, y
        out[i] = y
    mix[i0:i0 + n] += out * env * gain * 3.0  # 带通有衰减,补回响度


def _bandpass(sig, fc, q):
    """二阶带通 biquad(RBJ cookbook),与 Web Audio BiquadFilter 同构。"""
    w0 = 2 * math.pi * fc / SR
    alpha = math.sin(w0) / (2 * q)
    b0, b2 = alpha, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w0), 1 - alpha
    out = np.zeros(len(sig))
    x1 = x2 = y1 = y2 = 0.0
    for i in range(len(sig)):
        x = sig[i]
        y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1 = x1, x
        y2, y1 = y1, y
        out[i] = y
    return out


def add_type(t0, gain, pitch=1.0):
    """对应 LiveAudio.type():金属 tick(4200Hz)+ 腔体 clack(1600Hz)+ thump(170→85Hz)。"""
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    # tick:25ms 高频噪声
    n = min(int(0.025 * SR), N - i0)
    if n > 0:
        rng = np.random.default_rng(int(t0 * 1000) + 11)
        t = np.arange(n) / SR
        env = np.exp(np.log(0.0004 / (gain * 0.9)) * t / 0.025)
        mix[i0:i0 + n] += _bandpass(rng.uniform(-1, 1, n), 4200 * pitch, 0.9) * env * gain * 0.9 * 3.0
    # clack:70ms 中频腔体
    n = min(int(0.07 * SR), N - i0)
    if n > 0:
        rng = np.random.default_rng(int(t0 * 1000) + 23)
        t = np.arange(n) / SR
        env = np.exp(np.log(0.0004 / (gain * 0.8)) * t / 0.07)
        mix[i0:i0 + n] += _bandpass(rng.uniform(-1, 1, n), 1600 * pitch, 1.6) * env * gain * 0.8 * 3.0
    # thump:正弦 170→85Hz(50ms 滑音),60ms 指数衰减
    n = min(int(0.06 * SR), N - i0)
    if n > 0:
        t = np.arange(n) / SR
        k = -math.log(0.5) / 0.05
        phase = 2 * math.pi * 170 * pitch * (1 - np.exp(-k * t)) / k
        env = np.exp(np.log(0.0004 / (gain * 0.5)) * t / 0.06)
        mix[i0:i0 + n] += np.sin(phase) * env * gain * 0.5


def add_carriage(t0, gain):
    """对应 LiveAudio.carriage():擦键 zip(0.18s 上扫)+ 铃 ding(C7 2093Hz + 2.76 倍非谐泛音)。"""
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    # zip:噪声过带通(简化:固定 1800Hz 近似 900→3200 扫频)
    n = min(int(0.18 * SR), N - i0)
    if n > 0:
        rng = np.random.default_rng(int(t0 * 977) + 5)
        t = np.arange(n) / SR
        env = np.minimum(t / 0.05, 1.0) * np.clip((0.18 - t) / 0.13, 0, 1)
        mix[i0:i0 + n] += _bandpass(rng.uniform(-1, 1, n), 1800, 2.2) * env * gain * 0.8 * 3.0
    # ding:三角波 C7 长衰 + 非谐泛音短衰(延迟 0.14s 起)
    i1 = i0 + int(0.14 * SR)
    n = min(int(1.3 * SR), N - i1)
    if n > 0:
        t = np.arange(n) / SR
        sig = (2 / math.pi) * np.arcsin(np.sin(2 * math.pi * 2093 * t))
        env = np.exp(np.log(0.0004 / gain) * t / 1.2)
        mix[i1:i1 + n] += sig * env * gain
    n = min(int(0.6 * SR), N - i1)
    if n > 0:
        t = np.arange(n) / SR
        env = np.exp(np.log(0.0004 / (gain * 0.35)) * t / 0.5)
        mix[i1:i1 + n] += np.sin(2 * math.pi * 2093 * 2.76 * t) * env * gain * 0.35


rng = np.random.default_rng(555)
for e in events:
    ty = e["type"]
    if ty == "pluck":
        add_pluck(e["t"], e["freq"], e.get("gain", 0.10), e.get("decay", 1.1))
    elif ty == "land":
        add_pluck(e["t"], e["freq"], 0.05, 1.0)
    elif ty == "strum":
        add_pluck(e["t"], e["freq"], e.get("gain", 0.03), 1.3)
    elif ty == "type":
        add_type(e["t"], e.get("gain", 0.09), e.get("pitch", 1.0))
    elif ty == "carriage":
        add_carriage(e["t"], e.get("gain", 0.06))
    elif ty == "takeoff":
        add_pluck(e["t"], e["freq"], 0.07, 0.5, gliss=True)
        add_whoosh(e["t"], 0.7 + rng.uniform(0, 0.3), 0.040)
    else:
        print(f"warn: 未知事件类型 {ty!r},已跳过", file=sys.stderr)

# 压限近似:软压缩,然后整体归一到 peak 0.85
if maxdur is not None:
    # 被片长截断时结尾 0.3s 线性淡出,避免硬切
    nf = min(N, int(0.3 * SR))
    mix[-nf:] *= np.linspace(1.0, 0.0, nf)
mix = np.tanh(mix * 1.1) * MASTER
mix *= 0.85 / np.max(np.abs(mix))

stereo = np.stack([mix, mix], axis=1)
pcm = (stereo * 32767).astype(np.int16)
with wave.open(out_path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"OK {dur:.2f}s, peak {np.max(np.abs(mix)):.3f}, {len(events)} events → {out_path}")
