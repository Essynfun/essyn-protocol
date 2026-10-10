# Essyn

One roof for everything you ship, on Solana.

[![Live site](https://img.shields.io/badge/live-essyn.fun-000000)](https://essyn.fun)

**Token chain:** Solana
**CA:** absent (placeholder only; nothing has been stated yet)

## Overview

Essyn gathers the keys a builder holds and the things they release onto a single page that reads at a glance. This repository is the static site served at essyn.fun.

## Features

- Contract slot pinned to the top of every page, full address, click to send to clipboard. Inert until a contract is stated.
- Sample badge, tabbed walkthrough, standings table, release alerts, statements and concepts. Every figure is an empty, dated slot until real data is stated.
- A register of external facts (`src/data/registry.json`): each fact is one record that is `stated`, `absent` or `unconfirmed`. Inert records carry no value and no url.
- Social icons (X, GitHub) always present, inert until a url is stated.
- Reduced-motion support, CSP headers, no third-party scripts.

## Links

- Site: https://essyn.fun
- X: absent
- GitHub: absent
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm install
npm run build     # writes dist/ (the folder you deploy)
npm run gates     # register, link, address, palette, hygiene and copy gates plus the mutation harness
npm run measure   # layout measurements at 360 / 390 / 430 / 1366 / 1440
```

## License

MIT, see [LICENSE](LICENSE).
