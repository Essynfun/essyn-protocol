import { byId, fmtDate, handleFromUrl, marketLive } from './lib/registry.mjs';
import { svgX, svgGH, svgSol, svgCopy, svgCheck, svgFlip, svgBell, svgRefresh } from './lib/icons.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function render(reg) {
  const R = (id) => byId(reg, id);

  // An inert record renders a dash, carries no value and no url, and states its date.
  const slot = (id, cls = '') => {
    const r = R(id);
    return `<span class="slot ${cls}" data-record="${id}" data-state="${r.state}" data-asof="${r.asOf}"><span aria-hidden="true">&mdash;</span><span class="sr">${esc(r.label)}: ${r.state === 'unconfirmed' ? 'unconfirmed' : 'pending'}</span></span>`;
  };
  const bar = (id, w = 'w-70') => `<i class="bar ${w}" data-record="${id}" data-state="${R(id).state}" data-asof="${R(id).asOf}" aria-hidden="true"></i>`;
  const pill = (id, text) => `<span class="pill" data-record="${id}" data-state="${R(id).state}"${R(id).asOf ? ` data-asof="${R(id).asOf}"` : ''}>${esc(text)}</span>`;

  // ---- social: both icons at every breakpoint; inert (no href) until a url is stated
  const social = (id, svg, name) => {
    const r = R(id);
    if (r.state === 'stated') {
      const handle = handleFromUrl(r.url);
      return `<a class="icon-btn" data-record="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${name} @${esc(handle)}" title="${name} @${esc(handle)}">${svg}</a>`;
    }
    const label = `${name}: ${r.state === 'unconfirmed' ? 'unconfirmed' : 'pending'}`;
    return `<span class="icon-btn is-inert" role="img" aria-disabled="true" data-record="${id}" data-state="${r.state}" data-asof="${r.asOf}" aria-label="${label}" title="${label}">${svg}</span>`;
  };

  // ---- contract slot: top of page, always visible
  const ca = R('ca');
  const caSlot = ca.state === 'stated'
    ? `<div class="ca" id="ca" data-record="ca" data-state="stated" data-ca-exempt>
        <span class="ca-label">Contract</span>
        <code class="ca-value" id="ca-value" data-ca-exempt>${esc(ca.value)}</code>
        <span class="ca-note" id="ca-note" role="status" aria-live="polite"></span>
        <button class="ca-btn" id="ca-copy" type="button" aria-label="Send contract to clipboard">${svgCopy}${svgCheck}<span class="sr" id="ca-copy-status" role="status" aria-live="polite"></span></button>
      </div>`
    : `<div class="ca is-inert" id="ca" data-record="ca" data-state="${ca.state}" data-asof="${ca.asOf}">
        <span class="ca-label">Contract</span>
        <span class="ca-value">Pending</span>
        <span class="ca-note">Inert until a contract is stated</span>
        <button class="ca-btn" type="button" disabled aria-label="Contract pending, clipboard unavailable">${svgCopy}</button>
      </div>`;

  const topbar = `<div class="top" id="top">
    <header class="hdr"><div class="hdr-in">
      <a class="brand" href="#top" aria-label="Essyn, back to top"><img src="assets/img/logo-64.png" srcset="assets/img/logo-64.png 1x, assets/img/logo-128.png 2x" width="30" height="30" alt=""><span>Essyn</span></a>
      <nav class="nav" aria-label="Sections"><a href="#how">Overview</a><a href="#table">Standings</a><a href="#steps">Flow</a></nav>
      <div class="social" aria-label="Elsewhere">${social('x', svgX(), 'X')}${social('github', svgGH(), 'GitHub')}</div>
    </div></header>
    <div class="ca-row"><div class="ca-in">${caSlot}</div></div>
  </div>`;

  // ---- hero
  const hero = `<section class="hero"><div class="hero-in">
    <div class="mesh" aria-hidden="true"></div>
    <div class="blobs" aria-hidden="true"><i class="layer" data-depth="0.35"><i class="blob b1"></i></i><i class="layer" data-depth="0.6"><i class="blob b2"></i></i><i class="layer" data-depth="0.2"><i class="blob b3"></i></i></div>
    <div class="px hero-copy" data-depth="0.08">
      <p class="eyebrow rise d0">A developer layer made for Solana</p>
      <h1 class="display"><span class="word">Everything</span> <span class="word">you</span> <span class="word">ship.</span> <span class="word">One</span> <span class="word">roof.</span></h1>
      <p class="lead rise d1">Essyn gathers each key you hold, plus whatever you release, onto a single page that is instantly scannable across Solana.</p>
      <div class="cta-row rise d2"><a class="btn btn-solid" href="#how">Explore the flow</a><a class="btn btn-ghost" href="#ca">Go to the contract</a></div>
    </div>
    <div class="px hero-card-wrap" data-depth="0.16"><div class="hero-card rise d3">
      <article class="id-card" aria-label="Sample badge, slots empty">
        <div class="card-inner is-flipped" id="card">
          <div class="face front" id="card-front" aria-hidden="true">
            <div class="face-body">
              <div class="card-top"><span class="avatar" aria-hidden="true"></span><span class="card-no"><span class="muted">No.</span> ${slot('m.number')}</span></div>
              <div class="card-who"><div class="k">Issued to</div><div class="who-row"><span class="handle">@${slot('m.handle')}</span></div><div class="score-row">${slot('m.score')} <span class="pips" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div></div>
              <div class="card-result"><div><div class="k">30d result</div><div class="big">${slot('m.result')} <span class="unit">SOL</span></div></div><svg class="spark" viewBox="0 0 96 32" aria-hidden="true"><path class="draw" d="M2 26 C 14 24, 20 14, 32 16 S 52 22, 62 12 S 82 8, 94 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" pathLength="1"/></svg></div>
              <dl class="tiles"><div><dt>Releases</dt><dd>${slot('m.releases')}</dd></div><div><dt>Graduated</dt><dd>${slot('m.graduated')}</dd></div><div><dt>Top valuation</dt><dd>${slot('m.peak')}</dd></div></dl>
            </div>
            <footer class="face-foot"><span class="muted-2">${slot('m.keys')} keys linked &middot; ${slot('m.hidden')} hidden</span><span class="muted">#${slot('m.position')} by score</span></footer>
          </div>
          <div class="face back" id="card-back">
            <div class="face-body">
              <div class="k">Linked keys</div>
              <ul class="keys">${[1, 2, 3].map(() => `<li><i class="skel round sm" aria-hidden="true"></i><i class="skel w-45" aria-hidden="true"></i></li>`).join('')}</ul>
              <div class="k mt">Score breakdown</div>
              <dl class="meters">${['Delivery', 'Holder trust', 'Reliability', 'History'].map((n) => `<div><dt>${n}</dt><dd><i class="meter"><b></b></i><span class="mv"><i class="skel w-30" aria-hidden="true"></i></span></dd></div>`).join('')}</dl>
            </div>
            <footer class="face-foot"><span class="muted">Block height</span><span class="tenure is-pending" id="tenure"><i class="skel w-60" aria-hidden="true"></i></span></footer>
          </div>
        </div>
      </article>
      <button class="flip" id="flip" type="button" aria-controls="card-front card-back" aria-pressed="true">${svgFlip}<span>Reveal front</span></button>
      <p class="card-date">${pill('m.handle', 'Awaiting figures')}</p>
    </div></div>
  </div></section>`;

  // ---- tabbed stage (five panels, no media)
  const tabsDef = [
    ['Reserve a handle', 'Choose a handle worth recognising.', 'Brief, exclusive to you, and empty until you decide what belongs beneath it.', 'm.handle'],
    ['Bind your keys', 'Gather each key together.', 'Each key vouches for itself via one message. Hide whichever you prefer; reveal only what suits you.', 'm.keys'],
    ['Display releases', 'Releases, laid out plainly.', 'Whatever shipped from your linked keys lands in a single list, latest first, beside its highest valuation.', 'm.releases'],
    ['Enter the table', 'Standings drawn from the ledger.', 'Position shifts with outcomes, score and highest valuation. A typed-in form never moves it.', 'm.position'],
    ['Reach an audience', 'Be heard when something ships.', 'Readers subscribe to a handle; a notice reaches them as a release surfaces.', 'm.score'],
  ];
  const mock = (i, id) => [
    `<div class="mock"><div class="field"><span class="muted">@</span>${slot(id)}</div><div class="field soft"><span>Availability</span>${slot(id)}</div></div>`,
    `<div class="mock list"><div class="row"><span class="mono">${slot(id)}</span><em>Primary</em></div><div class="row"><span class="mono">${slot(id)}</span></div><div class="row"><span class="mono">${slot(id)}</span><em>Hidden</em></div></div>`,
    `<div class="mock list"><div class="row"><span>${bar('d.alerts', 'w-60')}</span><span>${slot('m.peak')}</span></div><div class="row"><span>${bar('d.alerts', 'w-45')}</span><span>${slot('m.peak')}</span></div><div class="row"><span>${bar('d.alerts', 'w-70')}</span><span>${slot('m.peak')}</span></div></div>`,
    `<div class="mock list"><div class="row"><b>1</b><span>${bar('d.table', 'w-45')}</span>${slot('m.score')}</div><div class="row"><b>2</b><span>${bar('d.table', 'w-60')}</span>${slot('m.score')}</div><div class="row"><b>3</b><span>${bar('d.table', 'w-30')}</span>${slot('m.score')}</div></div>`,
    `<div class="mock notice"><span class="bell">${svgBell}</span><div><div class="k">Fresh release</div>${bar('d.alerts', 'w-70')}${bar('d.alerts', 'w-45')}</div></div>`,
  ][i];
  const tabs = `<section class="shell sec" id="how"><div class="tabs-wrap">
    <div class="tablist" role="tablist" aria-label="How Essyn fits together">${tabsDef.map((t, i) => `<button class="tab" role="tab" id="tab-${i}" aria-controls="panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" type="button"><span class="tab-n">${i + 1}</span>${esc(t[0])}</button>`).join('')}</div>
    <div class="stage-frame">${tabsDef.map((t, i) => `<div class="panel" role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}" ${i === 0 ? '' : 'hidden'}><div class="stage"><div class="stage-copy"><h3>${esc(t[1])}</h3><p>${esc(t[2])}</p></div>${mock(i, t[3])}</div></div>`).join('')}</div>
  </div></section>`;

  // ---- sections
  const head = (h, p) => `<div class="sec-head"><h3>${h}</h3><p>${p}</p></div>`;
  const frame = (inner, idRec, label = 'Layout preview') => `<div class="frame">${pill(idRec, label)}${inner}</div>`;
  const chips = (label, items) => `<div class="chips" role="tablist" aria-label="${label}">${items.map((c, i) => `<button class="chip" type="button" role="tab" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${c}</button>`).join('')}</div>`;

  // ---- market: live only when the contract and the market source are both stated; otherwise inert and dated
  const live = marketLive(reg);
  const skel = (w) => `<i class="skel ${w}" aria-hidden="true"></i>`;
  const mrow = (n) => live
    ? `<tr class="mrow" data-row="${n}"><td class="rk">${n}</td><td><div class="tok"><i class="skel round" aria-hidden="true"></i>${skel('w-60')}</div></td><td class="num">${skel('w-45')}</td><td class="num">${skel('w-30')}</td><td class="num">${skel('w-45')}</td><td class="num">${skel('w-45')}</td><td class="act"><button class="addr-btn" type="button" disabled aria-label="Token mint loading">${svgCopy}${svgCheck}</button></td></tr>`
    : `<tr class="mrow"><td class="rk">${n}</td><td><div class="tok"><span class="tok-logo tile" aria-hidden="true"></span>${slot('d.market')}</div></td><td class="num">${slot('d.market')}</td><td class="num">${slot('d.market')}</td><td class="num">${slot('d.market')}</td><td class="num">${slot('d.market')}</td><td class="act"><button class="addr-btn" type="button" disabled aria-label="Token mint pending">${svgCopy}</button></td></tr>`;
  const mrows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(mrow).join('');
  const marquee = live
    ? `<div class="ticker-band" id="marquee" data-market="live" role="region" aria-label="Solana movers, scrolling"><div class="mq-viewport"><div class="mq-track" id="mq-track">${[1, 2, 3, 4, 5, 6].map(() => `<span class="mq-item">${skel('round sm')}${skel('w-60 mq-skel')}</span>`).join('')}</div></div></div>`
    : `<div class="ticker-band is-inert" id="marquee" data-market="inert"><div class="mq-inert">${pill('d.market', 'Movers strip idles until a contract exists')}</div></div>`;
  const market = `<div class="sec-block" id="market" data-reveal ${live ? 'data-market="live"' : 'data-market="inert"'}>${head('Solana movers, by turnover.', 'The ten tokens trading the most volume over the past 24h, read straight from DEX pairs. Tap the icon beside a row to send that token&rsquo;s mint to your clipboard.')}
    ${frame(`<div class="chips-row"><span class="live-pill" id="market-status" role="status" aria-live="polite" data-state="${live ? 'loading' : 'idle'}"><i class="dot"></i><span class="txt">${live ? 'Loading pricing feed' : 'Waiting for the pricing source'}</span></span>${live ? `<button class="chip retry" id="market-retry" type="button" hidden>${svgRefresh}Try again</button>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl mkt"><thead><tr><th scope="col">#</th><th scope="col">Token</th><th scope="col" class="num">Price</th><th scope="col" class="num">24h</th><th scope="col" class="num">Volume</th><th scope="col" class="num">Liquidity</th><th scope="col"><span class="sr">Send mint to clipboard</span></th></tr></thead><tbody id="market-rows">${mrows}</tbody></table></div>`, live ? 'market' : 'd.market', live ? 'Streaming feed' : 'Layout preview')}</div>`;

  const rows = [1, 2, 3, 4, 5].map((n) => `<tr><td class="rk">${n}</td><td>${slot('d.table')}</td><td>${slot('d.table')}</td><td>${slot('d.table')}</td><td>${slot('d.table')} <span class="unit">SOL</span></td><td class="trend"><svg viewBox="0 0 56 20" aria-hidden="true"><path d="M2 14 C 12 12, 16 6, 26 9 S 42 14, 54 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 4"/></svg></td></tr>`).join('');
  const table = `<div class="sec-block" id="table" data-reveal>${head('Ordered by what the ledger says.', 'Handles are sorted by outcome, score or highest valuation across the window you select. Each figure is read from the ledger; none is typed in.')}
    ${frame(`${chips('Window', ['Today', 'Sprint', 'Season', 'Lifetime'])}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">#</th><th scope="col">Handle</th><th scope="col">Score</th><th scope="col">Top</th><th scope="col">Result</th><th scope="col"><span class="sr">Shape</span></th></tr></thead><tbody>${rows}</tbody></table></div>`, 'd.table')}</div>`;

  const alertRow = () => `<li class="feed-row"><div class="fr-main"><div class="fr-t">${slot('d.alerts')}</div><div class="fr-s"><span>by @${slot('d.alerts')}</span> ${slot('d.alerts')}</div></div><div class="fr-m">${slot('d.alerts')} <span class="muted">notified</span></div><div class="fr-v">${slot('d.alerts')}<br><span class="muted">${slot('d.alerts')}</span></div></li>`;
  const alerts = `<div class="sec-block" id="alerts" data-reveal>${head('Releases surface here first.', 'Subscribe to a handle and an alert fires as soon as that builder ships; the contract is a tap away.')}
    ${frame(`<div class="chips-row">${chips('Audience', ['Everyone', 'Rated well', 'Rated highly'])}<span class="status"><i class="dot"></i>Awaiting the first entry</span></div>
    <ol class="feed">${alertRow()}${alertRow()}${alertRow()}${alertRow()}${alertRow()}</ol>`, 'd.alerts')}</div>`;

  const postCard = (kind, id, titled) => `<li class="post"><div class="post-h"><span class="avatar sm" aria-hidden="true"></span><span class="handle">@${slot(id)}</span>${kind ? `<span class="tag">${kind}</span>` : ''}<span class="muted">${slot(id)}</span></div><div class="post-b">${titled ? `<div class="post-title">${slot(id)}</div>` : ''}${bar(id, 'w-90')}${bar(id, titled ? 'w-45' : 'w-60')}</div><div class="post-f"><span class="ticker">$${slot(id)}</span><span class="muted">${slot(id)}</span><span class="react">${slot(id)}</span></div></li>`;

  const posts = `<div class="sec-block" id="posts" data-reveal>${head('Say it first, with receipts attached.', 'Builders publish a brief argument for something already released, or float a concept before it exists. Whatever they publish travels alongside the author&rsquo;s history.')}
    ${frame(`<ol class="stack">${postCard('Statement', 'd.posts', false)}${postCard('Preview', 'd.posts', true)}</ol>`, 'd.posts')}</div>`;

  const concepts = `<div class="sec-block" id="concepts" data-reveal>${head('Concepts from anybody, adopted by builders.', 'Anybody can float a concept, including those with no means to release it. The strongest float upward, builders flag those they would take on, while a finished release credits its originator.')}
    ${frame(`<ol class="stack">${postCard('', 'd.concepts', true)}${postCard('', 'd.concepts', true)}</ol>`, 'd.concepts')}</div>`;

  const shell2 = `<section class="shell sec-stack">${market}${table}${alerts}${posts}${concepts}</section>`;

  const steps = `<section class="shell sec" id="steps" data-reveal><h2 class="h2">Three moves, zero approvals.</h2>
    <ol class="steps"><li><span class="step-n">1</span><h4>Choose a handle</h4><p>Select a label and an avatar. A single message from your key is all it takes; it has no power over your balance.</p></li>
    <li><span class="step-n">2</span><h4>Connect each key</h4><p>Start from the primary, then bring in the rest. Each proves itself with one message; conceal whichever you prefer.</p></li>
    <li><span class="step-n">3</span><h4>Let the page fill in</h4><p>Essyn locates what you released, orders it by highest valuation and calculates your score.</p></li></ol></section>`;

  const cta = `<section class="band" data-reveal><div class="blobs" aria-hidden="true"><i class="blob b1"></i><i class="blob b3"></i></div><div class="band-in"><h2 class="h2 xl">You ship it.<br>Take the credit.</h2><div class="cta-row"><a class="btn btn-solid" href="#ca">Go to the contract</a><a class="btn btn-ghost" href="#top">Back to top</a></div></div></section>`;

  const net = R('network'); const site = R('site');
  const rpcHost = new URL(net.rpc).hostname;
  const footer = `<footer class="foot"><div class="foot-in">
    <div class="foot-brand"><img src="assets/img/logo-64.png" width="24" height="24" alt=""><span>Essyn</span><span class="muted">Developer layer for Solana</span></div>
    <p class="foot-note">Informational use only; no part of this page is a recommendation. Figures are drawn from transparent ledgers and may trail reality.</p>
    <p class="foot-meta" data-record="network" data-state="stated">${svgSol('sol')}<span>${esc(net.label)} ${esc(net.name)}</span><span class="sep">&middot;</span><span>RPC ${esc(rpcHost)}</span><span class="sep">&middot;</span><span>Source: ${esc(net.source)}</span></p>
    <p class="foot-meta"><a href="${esc(site.url)}" data-record="site" data-state="stated">essyn.fun</a></p>
  </div></footer>`;

  const mk = byId(reg, 'market');
  const registryJson = JSON.stringify({ schema: reg.schema, ca: ca.state === 'stated' ? { state: 'stated', value: ca.value } : { state: ca.state }, rpc: net.rpc, ...(live ? { market: { url: mk.url, imageHost: mk.imageHost } } : {}) });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Essyn · One roof for everything you ship</title>
<meta name="description" content="Essyn gathers each key you hold, plus whatever you release, onto a single page across Solana.">
<meta name="color-scheme" content="dark">
<link rel="icon" href="favicon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta property="og:title" content="Essyn · One roof for everything you ship">
<meta property="og:description" content="Essyn gathers each key you hold, plus whatever you release, onto a single page across Solana.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://essyn.fun/">
<meta property="og:image" content="https://essyn.fun/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="assets/fonts/montserrat.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/tokens.css">
<link rel="stylesheet" href="assets/css/site.css">
</head>
<body>
<div class="progress" id="progress" aria-hidden="true"><i></i></div>
<a class="skip" href="#how">Skip to content</a>
${topbar}
<main>
${hero}
${marquee}
${tabs}
${shell2}
${steps}
${cta}
</main>
${footer}
<script type="application/json" id="registry" data-ca-exempt>${registryJson}</script>
<script src="assets/js/app.js" defer></script>
<script src="assets/js/fx.js" defer></script>
<script src="assets/js/card.js" defer></script>
${live ? '<script src="assets/js/market.js" defer></script>' : ''}
</body>
</html>
`;
}
