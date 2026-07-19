/* ============================================================
 * gallery/works.js — 作品登记处
 * 上架新作品 = 在这里加一条(并准备好:scenes/<id>/ 交互页 +
 * films/<id>.mp4 压缩成片,见 ENGINE.md)。数组顺序即展出顺序。
 * ============================================================ */
"use strict";

window.WORKS = [
  {
    id: "typewriter",
    title: "Typing Bird",
    subtitle: "打字机 × 飞鸟",
    desc: "38 次击键,38 只燕。键落鸟起,牵起红线把字母一个一个送上纸面。",
    film: "films/typewriter.mp4",
    play: "scenes/typewriter/",
    duration: "0:22",
    year: "2026.07",
  },
  {
    id: "control",
    title: "Control",
    subtitle: "提线木偶 × 五线谱 × 飞鸟",
    desc: "移动鼠标扰动乐谱:受惊的音符化作飞鸟,提线牵着乱飞;静止后,鸟儿三三两两归位变回音符。",
    film: "films/control.mp4",
    play: "scenes/control/",
    duration: "0:26",
    year: "2026.07",
  },
  {
    id: "sparks",
    title: "Sparks",
    subtitle: "星火星座",
    desc: "引擎验证场景:指尖星火,聚散成座。",
    film: "films/sparks.mp4",
    play: "scenes/sparks/",
    duration: "0:10",
    year: "2026.07",
  },
];
