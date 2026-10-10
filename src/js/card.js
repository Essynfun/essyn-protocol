/* Hero badge, live and ungated: top-3 movers, score bars from market totals, and the Solana block height.
   Tokens arrive from market.js (one shared feed, no second fetch); the rpc url comes from the register json. */
(function () {
  'use strict';
  var registry = {};
  try { registry = JSON.parse(document.getElementById('registry').textContent); } catch (e) { return; }
  var back = document.getElementById('card-back');
  if (!back) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var DASH = '—';
  var keys = back.querySelector('.keys'), meters = Array.prototype.slice.call(back.querySelectorAll('.meters > div')), tenure = document.getElementById('tenure');
  var imgHost = registry.market && registry.market.imageHost;

  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  var clamp = function (v) { return Math.max(0, Math.min(1, v)); };
  var price = function (n) {
    if (typeof n !== 'number' || !isFinite(n)) return DASH;
    if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 0.01) return '$' + n.toFixed(4);
    if (n === 0) return '$0';
    return '$' + n.toFixed(Math.min(12, 2 - Math.floor(Math.log10(n))));
  };
  var imgOk = function (u) { try { var x = new URL(u); return x.protocol === 'https:' && x.hostname === imgHost; } catch (e) { return false; } };
  var logo = function (t) {
    var tile = function () { var s = el('span', 'tok-logo sm tile', ((t.symbol || t.name || '?').trim().charAt(0) || '?').toUpperCase()); s.setAttribute('aria-hidden', 'true'); return s; };
    if (!t.img || !imgHost || !imgOk(t.img)) return tile();
    var i = el('img', 'tok-logo sm'); i.alt = ''; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.src = t.img;
    i.addEventListener('error', function () { if (i.parentNode) i.parentNode.replaceChild(tile(), i); });
    return i;
  };
  var count = function (node, to, fmt, ms) {
    if (reduce) { node.textContent = fmt(to); return; }
    var t0 = null;
    var step = function (ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(to * e);
      if (k < 1) raf(step); else node.textContent = fmt(to);
    };
    raf(step);
  };

  /* ---- top three movers ---- */
  var showKeys = function (tokens) {
    var rows = keys.querySelectorAll('li');
    Array.prototype.forEach.call(rows, function (li, i) {
      var t = tokens[i]; li.textContent = '';
      if (!t) { li.appendChild(el('span', 'k-name', DASH)); li.setAttribute('data-state', 'empty'); return; }
      li.appendChild(logo(t)); li.appendChild(el('span', 'k-name', t.symbol || t.name || DASH)); li.appendChild(el('span', 'k-price', price(t.price)));
      li.classList.add('fade'); if (!reduce) li.style.animationDelay = (i * 90) + 'ms';
      li.setAttribute('data-state', 'live');
    });
  };

  /* ---- score bars from market totals (top ten) ---- */
  var showScores = function (tokens) {
    var vol = 0, liq = 0, tx = 0, abs = 0, n = 0;
    tokens.forEach(function (t) { vol += t.vol || 0; liq += t.liq || 0; tx += t.txns || 0; if (typeof t.change === 'number') { abs += Math.abs(t.change); n++; } });
    var vals = [
      clamp(Math.log10(vol + 1) / 10),            // volume -> Delivery
      clamp(Math.log10(liq + 1) / 10),            // liquidity -> Holder trust
      n ? clamp(1 - (abs / n) / 150) : 0,         // 24h price change (calmer = steadier) -> Reliability
      clamp(Math.log10(tx + 1) / 7),              // transactions -> History
    ];
    meters.forEach(function (row, i) {
      var b = row.querySelector('.meter b'), out = row.querySelector('.mv');
      out.textContent = ''; var v = el('span', 'fade'); if (!reduce) v.style.animationDelay = (i * 110) + 'ms'; out.appendChild(v);
      count(v, Math.round(vals[i] * 100), function (x) { return String(Math.round(x)); }, 1100);
      b.style.setProperty('--w', vals[i].toFixed(3));
      row.setAttribute('data-state', 'live');
    });
  };

  var dashAll = function () {
    keys.querySelectorAll('li').forEach(function (li) { li.textContent = ''; li.appendChild(el('span', 'k-name', DASH)); });
    meters.forEach(function (row) { row.querySelector('.mv').textContent = DASH; });
  };
  var apply = function (tokens) { if (!tokens || !tokens.length) return; showKeys(tokens.slice(0, 3)); showScores(tokens); };
  window.addEventListener('essyn:market', function (e) { apply(e.detail); });
  if (window.essynMarket) apply(window.essynMarket);
  if (!registry.market) dashAll();
  window.addEventListener('essyn:market-failed', function () { if (!keys.querySelector('li[data-state="live"]')) dashAll(); });

  /* ---- Solana block height: polled, eased between polls ---- */
  if (!tenure || !registry.rpc || !window.fetch) { if (tenure) tenure.textContent = DASH; return; }
  var base = 0, t0 = 0, rate = 2.5, cur = 0, have = false, tries = 0, timer = 0, loop = false;
  var fmt = function (n) { return Math.floor(n).toLocaleString('en-US'); };
  var frame = function () {
    var target = base + rate * (performance.now() - t0) / 1000;
    cur += (target - cur) * 0.12; tenure.textContent = fmt(cur); raf(frame);
  };
  var poll = function () {
    var ctl = new AbortController(), guard = setTimeout(function () { ctl.abort(); }, 8000);
    fetch(registry.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(guard);
        if (!j || typeof j.result !== 'number') throw new Error('bad result');
        var now = performance.now();
        if (have) { var dt = (now - t0) / 1000, r = (j.result - base) / dt; if (dt > 1 && r > 0 && r < 10) rate = r; }
        base = j.result; t0 = now; tries = 0;
        tenure.classList.remove('is-pending');
        if (!have) { have = true; cur = reduce ? base : base - 3000; tenure.classList.add('fade'); tenure.textContent = fmt(cur); }
        if (reduce) tenure.textContent = fmt(base); else if (!loop) { loop = true; raf(frame); }
        timer = setTimeout(poll, 10000);
      })
      .catch(function () {
        clearTimeout(guard); tries++;
        if (!have) tenure.textContent = DASH;
        timer = setTimeout(poll, Math.min(30000, 2000 * Math.pow(2, tries - 1)));
      });
  };
  poll();
})();
