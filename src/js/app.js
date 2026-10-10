(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var registry = {};
  try { registry = JSON.parse(document.getElementById('registry').textContent); } catch (e) { registry = {}; }

  /* ---- roving tablists (tabs and chips share the pattern) ---- */
  function rove(list, onSelect) {
    var items = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    function select(i, focus) {
      items.forEach(function (el, j) { el.setAttribute('aria-selected', String(i === j)); el.tabIndex = i === j ? 0 : -1; });
      if (focus) items[i].focus();
      if (onSelect) onSelect(i);
    }
    items.forEach(function (el, i) {
      el.addEventListener('click', function () { select(i, false); });
      el.addEventListener('keydown', function (e) {
        var n = items.length, k = e.key, next = -1;
        if (k === 'ArrowRight') next = (i + 1) % n;
        else if (k === 'ArrowLeft') next = (i - 1 + n) % n;
        else if (k === 'Home') next = 0;
        else if (k === 'End') next = n - 1;
        if (next > -1) { e.preventDefault(); select(next, true); }
      });
    });
  }

  var tablist = document.querySelector('.tablist');
  if (tablist) {
    var panels = document.querySelectorAll('.panel');
    rove(tablist, function (i) { panels.forEach(function (p, j) { p.hidden = i !== j; }); });
  }
  document.querySelectorAll('.chips').forEach(function (c) { rove(c); });

  /* ---- card flip ---- */
  var flip = document.getElementById('flip'), card = document.getElementById('card');
  if (flip && card) {
    var front = document.getElementById('card-front'), back = document.getElementById('card-back');
    flip.addEventListener('click', function () {
      var on = card.classList.toggle('is-flipped');
      flip.setAttribute('aria-pressed', String(on));
      front.setAttribute('aria-hidden', String(on));
      back.setAttribute('aria-hidden', String(!on));
      flip.querySelector('span').textContent = on ? 'Reveal front' : 'Reveal data';
    });
  }

  /* ---- contract slot: only wired when the register says the contract is stated ---- */
  var ca = registry.ca;
  if (ca && ca.state === 'stated' && ca.value) {
    var btn = document.getElementById('ca-copy'), row = document.getElementById('ca'),
        status = document.getElementById('ca-copy-status'), note = document.getElementById('ca-note'), timer = 0;
    var write = function (text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      return new Promise(function (res, rej) {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy') ? res() : rej(new Error('copy refused')); } catch (e) { rej(e); } finally { document.body.removeChild(ta); }
      });
    };
    var feedback = function (ok) {
      clearTimeout(timer);
      btn.classList.toggle('is-done', ok); row.classList.toggle('is-copied', ok);
      status.textContent = ok ? 'Contract sent to clipboard' : 'Clipboard refused. Select the text and copy it by hand.';
      timer = setTimeout(function () { btn.classList.remove('is-done'); row.classList.remove('is-copied'); status.textContent = ''; }, 1800);
    };
    var go = function () { write(ca.value).then(function () { feedback(true); }, function () { feedback(false); }); };
    btn.addEventListener('click', go);
    document.getElementById('ca-value').addEventListener('click', go);

    /* ask the stated Solana RPC whether the account exists */
    if (registry.rpc && window.fetch) {
      note.textContent = 'Asking Solana…';
      var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 6000);
      fetch(registry.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [ca.value, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }] }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { note.textContent = j && j.result ? (j.result.value ? 'Account found on Solana' : 'No account on Solana yet') : 'Solana check unavailable'; })
        .catch(function () { note.textContent = 'Solana check unavailable'; })
        .then(function () { clearTimeout(t); });
    }
  }
})();
