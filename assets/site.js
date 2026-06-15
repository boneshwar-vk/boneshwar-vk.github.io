/* Boneshwar V K — Academic Portfolio · shared behaviour */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Footer year */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* Theme switcher */
  var THEME_BG = { charcoal: "#1b1c1e", teal: "#0f3a37", ivory: "#f6f2ea" };
  var THEMES = ["charcoal", "teal", "ivory"];
  function applyTheme(t) {
    if (THEMES.indexOf(t) === -1) t = "teal";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (e) {}
    document.querySelectorAll("[data-set-theme]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-set-theme") === t ? "true" : "false");
    });
    var m = document.querySelector('meta[name="theme-color"]');
    if (m && THEME_BG[t]) m.setAttribute("content", THEME_BG[t]);
    /* Recolor embedded animations to match the theme */
    document.querySelectorAll("iframe[data-anim]").forEach(function (f) {
      var base = f.getAttribute("data-src");
      if (base) f.src = base + "?theme=" + t;
    });
  }
  var saved = "teal";
  try { saved = localStorage.getItem("theme") || "teal"; } catch (e) {}
  applyTheme(saved);
  document.querySelectorAll("[data-set-theme]").forEach(function (b) {
    b.addEventListener("click", function () { applyTheme(b.getAttribute("data-set-theme")); });
  });

  /* Sticky nav state + scroll progress */
  var nav = document.querySelector(".nav");
  var progress = document.querySelector(".scroll-progress");
  function onScroll() {
    var y = window.scrollY || 0;
    if (nav) nav.classList.toggle("scrolled", y > 8);
    if (progress) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = "scaleX(" + (h > 0 ? Math.min(y / h, 1) : 0) + ")";
    }
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* Mobile nav toggle */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
    });
  }

  /* Accordions */
  document.querySelectorAll(".acc-head").forEach(function (head) {
    head.addEventListener("click", function () {
      var item = head.closest(".acc-item");
      var open = item.classList.toggle("open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* Publication abstract toggles */
  document.querySelectorAll("[data-abstract-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var panel = document.getElementById(btn.getAttribute("aria-controls"));
      if (!panel) return;
      var open = panel.hasAttribute("hidden");
      if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      var label = btn.querySelector("[data-label]");
      if (label) label.textContent = open ? "Hide abstract" : "Read abstract";
    });
  });

  /* Portrait parallax (subtle) */
  var portrait = document.querySelector("[data-parallax]");
  if (portrait && !reduceMotion) {
    window.addEventListener("scroll", function () {
      var y = window.scrollY || 0;
      if (y < 700) portrait.style.transform = "translateY(" + (y * -0.04) + "px)";
    }, { passive: true });
  }

  /* Scroll reveal */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i % 5, 4) * 75 + "ms";
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }
})();
