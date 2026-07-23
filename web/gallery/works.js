/* ============================================================
 * gallery/works.js — 作品登记处
 * 上架新作品 = 在这里加一条（并准备好 scenes/<id>/ 交互页 +
 * films/<id>.mp4 压缩成片；详见 engine/DEVELOPMENT.md）。数组顺序即展出顺序。
 * ============================================================ */
"use strict";

window.WORKS = [
  {
    id: "heart-butterfly",
    title: "Heart & Butterflies",
    subtitle: "裂心与蝴蝶",
    desc: "墙面沿裂纹剥落成一枚黑色心脏。黄色蝴蝶逐只飞出，先坠落的红线在重力与牵引之间慢慢张开。",
    film: "films/heart-butterfly.mp4",
    play: "scenes/heart-butterfly/",
    duration: "0:15",
    year: "2026.07",
  },
  {
    id: "yanfan",
    title: "Yanfan",
    subtitle: "燕返",
    desc: "一张横线稿纸浮在留白里,上半页写满手写信。红鲤游来,字迹化作墨燕随它盘旋出纸;燕群折返,又一只只归位,重聚成书。移动鼠标,惊起这一纸燕。",
    film: "films/yanfan.mp4",
    play: "scenes/yanfan/",
    duration: "0:10",
    year: "2026.07",
  },
  {
    id: "puppet",
    title: "Marionette",
    subtitle: "提线木偶",
    desc: "移动鼠标,你就是操纵者:提起、荡起、甩飞——线一紧,木偶就醒了;手一停,它又垂回线下沉沉睡去。",
    film: "films/puppet.mp4",
    play: "scenes/puppet/",
    duration: "0:14",
    year: "2026.07",
  },
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
