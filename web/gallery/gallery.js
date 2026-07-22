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
      <button type="button" class="frame" data-film="${w.film}" data-title="${w.title} · ${w.subtitle}"
              aria-label="播放 ${w.title} · ${w.subtitle} 有声正片">
        <video data-src="${w.film}" muted loop playsinline preload="none" aria-hidden="true"></video>
      </button>
      <h2>${w.title}<span class="sub">${w.subtitle}</span></h2>
      <p class="desc">${w.desc}</p>
      <div class="meta">
        <span>${w.duration}</span><span>${w.year}</span>
        <a class="go" href="${w.play}">交互试玩 ↗</a>
      </div>`;
    grid.appendChild(card);
  }

  /* 循环预览只播可视区域内的(省流) */
  const visiblePreviews = new Set();
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const playVisible = () => {
    if (document.hidden || document.getElementById("lightbox").classList.contains("on") || reducedMotion) return;
    for (const video of visiblePreviews) video.play().catch(() => {});
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target.querySelector("video");
      if (!v) continue;
      if (e.isIntersecting && e.intersectionRatio >= 0.15) {
        if (!v.hasAttribute("src")) v.src = v.dataset.src;
        visiblePreviews.add(v);
      } else {
        visiblePreviews.delete(v);
        v.pause();
      }
    }
    playVisible();
  }, { threshold: [0, 0.15], rootMargin: "180px 0px" });
  document.querySelectorAll(".card .frame").forEach((f) => io.observe(f));

  /* ---------------- 灯箱 ---------------- */
  const lb = document.getElementById("lightbox");
  const lbVideo = document.getElementById("lb-video");
  const lbCap = document.getElementById("lb-cap");
  const closeButton = document.getElementById("lb-close");
  const page = document.querySelector(".wrap");
  let returnFocus = null;

  function openLb(film, title) {
    returnFocus = document.activeElement;
    for (const video of visiblePreviews) video.pause();
    lbVideo.src = film;
    lbCap.textContent = title;
    lb.classList.add("on");
    lb.setAttribute("aria-hidden", "false");
    page.setAttribute("aria-hidden", "true");
    page.inert = true;
    lbVideo.play().catch(() => {});
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }
  function closeLb() {
    if (!lb.classList.contains("on")) return;
    lbVideo.pause();
    lbVideo.removeAttribute("src");
    lbVideo.load();
    lb.classList.remove("on");
    lb.setAttribute("aria-hidden", "true");
    page.removeAttribute("aria-hidden");
    page.inert = false;
    document.body.style.overflow = "";
    playVisible();
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  grid.addEventListener("click", (e) => {
    const frame = e.target.closest(".frame");
    if (frame) openLb(frame.dataset.film, frame.dataset.title);
  });
  closeButton.addEventListener("click", closeLb);
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLb(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      for (const video of visiblePreviews) video.pause();
      lbVideo.pause();
    } else if (lb.classList.contains("on")) lbVideo.play().catch(() => {});
    else playVisible();
  });
})();
