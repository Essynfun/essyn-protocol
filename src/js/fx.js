/* Motion layer: scroll progress, spring stagger reveal, hero parallax, spotlight. All of it steps aside for reduced motion. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

  /* ---- scroll progress bar ---- */
  var bar = document.querySelector('#progress i');
  var ticking = false, sy = 0;
  var update = function () {
    ticking = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.setProperty('--p', max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : '0');
    sy = window.scrollY; applyParallax();
  };
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(update); } }, { passive: true });
  window.addEventListener('resize', update);

  /* ---- hero parallax: scroll depth + pointer depth ---- */
  var hero = document.querySelector('.hero');
  var layers = hero ? Array.prototype.slice.call(hero.querySelectorAll('[data-depth]')) : [];
  var mx = 0, my = 0, tx = 0, ty = 0, running = false;
  function applyParallax() {
    if (reduce || !layers.length) return;
    layers.forEach(function (l) {
      var d = parseFloat(l.getAttribute('data-depth')) || 0;
      l.style.transform = 'translate3d(' + (mx * d * -36).toFixed(2) + 'px,' + (my * d * -36 - sy * d * 0.35).toFixed(2) + 'px,0)';
    });
  }
  function ease() {
    mx += (tx - mx) * 0.08; my += (ty - my) * 0.08; applyParallax();
    if (Math.abs(tx - mx) > 0.001 || Math.abs(ty - my) > 0.001) raf(ease); else running = false;
  }
  if (hero && !reduce) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
      if (!running) { running = true; raf(ease); }
    });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; if (!running) { running = true; raf(ease); } });
  }

  /* ---- spring stagger reveal ---- */
  var groups = document.querySelectorAll('[data-reveal]');
  var KIDS = '.sec-head, .frame, .tablist, .stage-frame, .steps > li, .h2, .band-in > *, .tabs-wrap > *';
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var tall = en.intersectionRect.height >= window.innerHeight * 0.3;
        if (en.intersectionRatio >= 0.25 || tall) { en.target.classList.add('rv-go'); io.unobserve(en.target); }
      });
    }, { threshold: [0, 0.25] });
    groups.forEach(function (g) {
      var kids = Array.prototype.slice.call(g.querySelectorAll(KIDS));
      if (!kids.length) kids = [g];
      kids.forEach(function (k, i) { k.classList.add('rv'); k.style.setProperty('--i', String(i)); });
      if (g.getBoundingClientRect().top < window.innerHeight * 0.85) { raf(function () { raf(function () { g.classList.add('rv-go'); }); }); return; }
      io.observe(g);
    });
    // feed and market rows arrive with their own stagger when their container reveals
    document.querySelectorAll('.feed-row, .mrow').forEach(function (r, i) { r.style.setProperty('--i', String(i % 10)); });
  } else groups.forEach(function (g) { g.classList.add('rv-go'); });

  /* ---- spotlight: a soft light follows the pointer across cards and rows ---- */
  var SPOT = '.frame, .steps li, .post, .feed-row, .mkt tbody tr, .stage-frame, .mock';
  document.querySelectorAll(SPOT).forEach(function (n) { n.classList.add('spot'); });
  if (!reduce) {
    document.addEventListener('pointermove', function (e) {
      var t = e.target.closest ? e.target.closest('.spot') : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      t.style.setProperty('--sx', (e.clientX - r.left).toFixed(1) + 'px'); t.style.setProperty('--sy', (e.clientY - r.top).toFixed(1) + 'px');
    }, { passive: true });
  }
  update();
})();
