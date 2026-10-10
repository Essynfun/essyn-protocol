/* Live Solana movers. Shipped whenever the market source is stated; the contract slot never gates it.
   The api origin and image host come from the register json on the page; nothing is hard-coded here. */
(function () {
  'use strict';
  var registry = {};
  try { registry = JSON.parse(document.getElementById('registry').textContent); } catch (e) { return; }
  var mk = registry.market;
  if (!mk || !mk.url || !window.fetch) return;

  var DASH = '—';
  var base = mk.url.replace(/\/$/, ''), imgHost = mk.imageHost;
  var rows = Array.prototype.slice.call(document.querySelectorAll('#market-rows .mrow'));
  var track = document.getElementById('mq-track'), band = document.getElementById('marquee');
  var status = document.getElementById('market-status'), retry = document.getElementById('market-retry'), section = document.getElementById('market');
  var MAX_TRIES = 5, BASE_MS = 1000, CAP_MS = 30000, REFRESH_MS = 60000;
  var tries = 0, timer = 0, haveData = false, doneTimers = {};

  var write = function (text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(new Error('copy refused')); } catch (e) { rej(e); } finally { document.body.removeChild(ta); }
    });
  };
  var getJSON = function (path) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 10000);
    return fetch(base + path, { signal: ctl.signal, headers: { accept: 'application/json' } }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  };
  var num = function (v) { var n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; };
  var usd = function (n) {
    if (n === null) return DASH;
    var a = Math.abs(n), s = a >= 1e9 ? [a / 1e9, 'B'] : a >= 1e6 ? [a / 1e6, 'M'] : a >= 1e3 ? [a / 1e3, 'K'] : [a, ''];
    return '$' + (s[1] ? s[0].toFixed(s[0] >= 100 ? 0 : s[0] >= 10 ? 1 : 2) : a.toFixed(0)) + s[1];
  };
  var price = function (n) {
    if (n === null) return DASH;
    if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 0.01) return '$' + n.toFixed(4);
    if (n === 0) return '$0';
    return '$' + n.toFixed(Math.min(12, 2 - Math.floor(Math.log10(n))));
  };
  var change = function (n) { return n === null ? null : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 1) + '%'; };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  var imgOk = function (u) { try { var x = new URL(u); return x.protocol === 'https:' && x.hostname === imgHost; } catch (e) { return false; } };
  var logo = function (t, small) {
    var cls = 'tok-logo' + (small ? ' sm' : '');
    var tile = function () { var s = el('span', cls + ' tile', ((t.symbol || t.name || '?').trim().charAt(0) || '?').toUpperCase()); s.setAttribute('aria-hidden', 'true'); return s; };
    if (!t.img || !imgOk(t.img)) return tile();
    var i = el('img', cls); i.alt = ''; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.src = t.img;
    i.addEventListener('error', function () { if (i.parentNode) i.parentNode.replaceChild(tile(), i); });
    return i;
  };
  var fade = function (node) { node.classList.add('fade'); return node; };
  var changeNode = function (t) {
    var c = change(t.change); if (c === null) return fade(el('span', 'chg', DASH));
    var up = t.change >= 0, s = el('span', 'chg ' + (up ? 'up' : 'down'));
    s.appendChild(el('span', 'arr', up ? '▲' : '▼')); s.appendChild(document.createTextNode(' ' + c)); return fade(s);
  };

  /* one entry per token: the pair with the deepest liquidity */
  var pick = function (addrs, pairs) {
    var want = {}, best = {};
    addrs.forEach(function (a) { want[a] = 1; });
    pairs.forEach(function (p) {
      if (!p || p.chainId !== 'solana' || !p.baseToken || !want[p.baseToken.address]) return;
      var liq = p.liquidity ? num(p.liquidity.usd) || 0 : 0, cur = best[p.baseToken.address];
      if (!cur || liq > cur.liq) best[p.baseToken.address] = { liq: liq, p: p };
    });
    return Object.keys(best).map(function (a) {
      var p = best[a].p;
      return { address: a, symbol: p.baseToken.symbol || '', name: p.baseToken.name || '', price: num(p.priceUsd), change: p.priceChange ? num(p.priceChange.h24) : null,
        vol: p.volume ? num(p.volume.h24) : null, liq: best[a].liq, txns: p.txns && p.txns.h24 ? (num(p.txns.h24.buys) || 0) + (num(p.txns.h24.sells) || 0) : null, img: p.info && p.info.imageUrl };
    }).sort(function (x, y) { return (y.vol === null ? -1 : y.vol) - (x.vol === null ? -1 : x.vol); }).slice(0, 10);
  };

  var load = function () {
    return getJSON('/token-boosts/top/v1').then(function (list) {
      var seen = {}, addrs = [];
      (Array.isArray(list) ? list : []).forEach(function (e) {
        if (e && e.chainId === 'solana' && typeof e.tokenAddress === 'string' && !seen[e.tokenAddress]) { seen[e.tokenAddress] = 1; addrs.push(e.tokenAddress); }
      });
      if (!addrs.length) throw new Error('no solana entries');
      var chunks = []; for (var i = 0; i < addrs.length; i += 30) chunks.push(addrs.slice(i, i + 30));
      return Promise.all(chunks.map(function (c) { return getJSON('/tokens/v1/solana/' + c.map(encodeURIComponent).join(',')); })).then(function (parts) {
        var tokens = pick(addrs, [].concat.apply([], parts));
        if (!tokens.length) throw new Error('no pairs');
        return tokens;
      });
    });
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cell = function (tr, i, node) { var td = tr.children[i]; td.textContent = ''; td.appendChild(node); };
  var easeOut = function (k) { return 1 - Math.pow(1 - k, 3); };
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };

  /* count-up from the previous figure (or from a lower start on first sight); instant under reduced motion */
  var countTo = function (node, from, to, fmt, ms) {
    if (reduce || to === null || from === null || from === to) { node.textContent = fmt(to); return; }
    var t0 = null;
    var step = function (ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / ms);
      node.textContent = fmt(from + (to - from) * easeOut(k));
      if (k < 1) raf(step); else node.textContent = fmt(to);
    };
    raf(step);
  };
  var flash = function (node, dir) {
    if (reduce) return;
    node.classList.remove('flash-up', 'flash-down'); void node.offsetWidth; node.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
  };
  var FIELDS = [
    { k: 'price', col: 2, fmt: price, start: function (to) { return to === null ? null : to * 0.6; } },
    { k: 'vol', col: 4, fmt: usd, start: function () { return 0; } },
    { k: 'liq', col: 5, fmt: usd, start: function () { return 0; } },
  ];
  var prev = {};
  var chgFmt = function (final) { return function (v) { return v === null ? DASH : (final > 0 ? '+' : final < 0 ? '\u2212' : '') + Math.abs(v).toFixed(Math.abs(final) >= 100 ? 0 : 1) + '%'; }; };

  var buildRow = function (tr, t, i) {
    var tok = el('div', 'tok'), nm = el('div', 'tok-name');
    tok.appendChild(logo(t, false)); nm.appendChild(el('strong', '', t.symbol || DASH)); nm.appendChild(el('span', 'muted', t.name)); tok.appendChild(nm);
    cell(tr, 1, stagger(fade(tok), i, 1));
    FIELDS.forEach(function (f) { cell(tr, f.col, stagger(fade(el('span', 'val')), i, f.col)); });
    var c = el('span', 'chg val'); c.appendChild(el('span', 'arr', '')); c.appendChild(el('span', 'v', ''));
    cell(tr, 3, stagger(fade(c), i, 3));
    tr.setAttribute('data-token', t.address);
  };
  var stagger = function (node, row, col) { if (!reduce) node.style.animationDelay = (row * 60 + col * 30) + 'ms'; return node; };

  var showData = function (tokens) {
    rows.forEach(function (tr, i) {
      var t = tokens[i], b = tr.querySelector('.addr-btn');
      if (!t) { for (var c = 1; c <= 5; c++) cell(tr, c, fade(el('span', 'dash', DASH))); tr.setAttribute('data-state', 'empty'); tr.removeAttribute('data-token'); b.disabled = true; return; }
      var fresh = tr.getAttribute('data-token') !== t.address;
      if (fresh) buildRow(tr, t, i);
      var p = prev[t.address];
      FIELDS.forEach(function (f) {
        var node = tr.children[f.col].querySelector('.val'), to = t[f.k], from = p && p[f.k] !== undefined ? p[f.k] : f.start(to);
        countTo(node, from, to, f.fmt, 900);
        if (p && p[f.k] !== undefined && to !== null && p[f.k] !== null && to !== p[f.k]) flash(node, to - p[f.k]);
      });
      var cn = tr.children[3].querySelector('.chg'), up = t.change === null || t.change >= 0;
      cn.classList.remove('up', 'down'); cn.classList.add(up ? 'up' : 'down');
      cn.querySelector('.arr').textContent = t.change === null ? '' : up ? '\u25B2' : '\u25BC';
      var pc = p && p.change !== undefined && p.change !== null ? Math.abs(p.change) : 0, cur = t.change === null ? null : Math.abs(t.change);
      var vn = cn.querySelector('.v');
      if (cur === null) vn.textContent = DASH; else countTo(vn, pc, cur, chgFmt(t.change), 900);
      if (p && t.change !== null && p.change !== null && p.change !== undefined && p.change !== t.change) flash(cn, t.change - p.change);
      prev[t.address] = { price: t.price, vol: t.vol, liq: t.liq, change: t.change };
      b.disabled = false; b.setAttribute('data-address', t.address); b.setAttribute('aria-label', 'Send ' + (t.symbol || 'token') + ' mint to clipboard');
      tr.setAttribute('data-state', 'live');
    });
    if (track) {
      track.textContent = '';
      [false, true].forEach(function (clone) {
        tokens.forEach(function (t) {
          var it = el('span', 'mq-item' + (clone ? ' mq-clone' : '')); if (clone) it.setAttribute('aria-hidden', 'true');
          it.appendChild(logo(t, true)); it.appendChild(el('strong', '', t.symbol || DASH)); it.appendChild(el('span', 'muted', price(t.price))); it.appendChild(changeNode(t));
          track.appendChild(it);
        });
      });
      track.style.setProperty('--mq-dur', Math.max(24, tokens.length * 5) + 's');
    }
    if (band) band.setAttribute('data-state', 'live');
    section.classList.remove('is-loading', 'is-error');
    window.essynMarket = tokens;
    window.dispatchEvent(new CustomEvent('essyn:market', { detail: tokens }));
  };
  var showError = function () {
    rows.forEach(function (tr) {
      for (var c = 1; c <= 5; c++) cell(tr, c, fade(el('span', 'dash', DASH)));
      tr.setAttribute('data-state', 'error'); tr.querySelector('.addr-btn').disabled = true;
    });
    if (track) { track.textContent = ''; track.appendChild(el('span', 'mq-item mq-err', DASH + ' Pricing source unavailable')); track.style.setProperty('--mq-dur', '0s'); }
    if (band) band.setAttribute('data-state', 'error');
    section.classList.remove('is-loading'); section.classList.add('is-error');
    window.dispatchEvent(new CustomEvent('essyn:market-failed'));
  };
  var say = function (text, kind) { status.setAttribute('data-state', kind || 'loading'); status.querySelector('.txt').textContent = text; };

  /* exponential backoff: 1s, 2s, 4s, 8s between five attempts (capped at 30s) */
  var attempt = function () {
    clearTimeout(timer); tries++;
    load().then(function (tokens) {
      tries = 0; haveData = true; showData(tokens); retry.hidden = true;
      say('Streaming · refreshes every minute', 'live');
      timer = setTimeout(attempt, REFRESH_MS);
    }).catch(function () {
      if (tries >= MAX_TRIES) {
        if (!haveData) showError();
        say('Pricing source unavailable after ' + tries + ' attempts.' + (haveData ? ' Showing the last good figures.' : ' Figures shown as dashes.'), 'error');
        retry.hidden = false; return;
      }
      var wait = Math.min(CAP_MS, BASE_MS * Math.pow(2, tries - 1));
      say('Source not responding. Retrying in ' + Math.round(wait / 1000) + 's, attempt ' + (tries + 1) + ' of ' + MAX_TRIES, 'error');
      timer = setTimeout(attempt, wait);
    });
  };
  retry.addEventListener('click', function () { tries = 0; retry.hidden = true; say('Loading pricing feed', 'loading'); attempt(); });
  document.getElementById('market-rows').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.addr-btn') : null, a = b && b.getAttribute('data-address');
    if (!b || b.disabled || !a) return;
    write(a).then(function () {
      b.classList.add('is-done'); clearTimeout(doneTimers[a]);
      doneTimers[a] = setTimeout(function () { b.classList.remove('is-done'); }, 1800);
      say('Mint sent to clipboard', 'live');
    }, function () { say('Clipboard refused. Nothing was copied.', 'error'); });
  });
  section.classList.add('is-loading');
  attempt();
})();
