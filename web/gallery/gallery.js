/* ============================================================
 * gallery/gallery.js — 画廊渲染 + 有声正片灯箱
 * 数据全部来自 works.js(window.WORKS),加作品不用改这里。
 * ============================================================ */
"use strict";
(function () {
  const grid = document.getElementById("grid");

  /* ---------------- 卡片 ---------------- */
  for (const w of window.WORKS) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="frame" data-film="${w.film}" data-title="${w.title} · ${w.subtitle}" title="播放有声正片">
        <video src="${w.film}" muted loop playsinline autoplay preload="metadata"></video>
      </div>
      <h2>${w.title}<span class="sub">${w.subtitle}</span></h2>
      <p class="desc">${w.desc}</p>
      <div class="meta">
        <span>${w.duration}</span><span>${w.year}</span>
        <a class="go" href="${w.play}">交互试玩 ↗</a>
      </div>`;
    grid.appendChild(card);
  }

  /* 循环预览只播可视区域内的(省流) */
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target.querySelector("video");
      if (!v) continue;
      if (e.isIntersecting) { v.play().catch(() => {}); }
      else v.pause();
    }
  }, { threshold: 0.15 });
  document.querySelectorAll(".card .frame").forEach((f) => io.observe(f));

  /* ---------------- 灯箱 ---------------- */
  const lb = document.getElementById("lightbox");
  const lbVideo = document.getElementById("lb-video");
  const lbCap = document.getElementById("lb-cap");

  function openLb(film, title) {
    lbVideo.src = film;
    lbCap.textContent = title;
    lb.classList.add("on");
    lbVideo.play().catch(() => {});
    document.body.style.overflow = "hidden";
  }
  function closeLb() {
    lbVideo.pause();
    lbVideo.removeAttribute("src");
    lbVideo.load();
    lb.classList.remove("on");
    document.body.style.overflow = "";
  }

  grid.addEventListener("click", (e) => {
    const frame = e.target.closest(".frame");
    if (frame) openLb(frame.dataset.film, frame.dataset.title);
  });
  document.getElementById("lb-close").addEventListener("click", closeLb);
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLb(); });
})();
