# Changelog

## [0.1.3](https://github.com/zigordev/trading-bot/compare/v0.1.2...v0.1.3) (2026-09-07)


### Features

* **docker:** run every service under compose watch for local development ([#78](https://github.com/zigordev/trading-bot/issues/78)) ([7d35393](https://github.com/zigordev/trading-bot/commit/7d3539317c135d0582e602be655be58b00318d14))

## [0.1.2](https://github.com/zigordev/trading-bot/compare/v0.1.1...v0.1.2) (2026-09-07)


### Bug Fixes

* **deps:** let overrides accept patches instead of pinning exact versions ([#73](https://github.com/zigordev/trading-bot/issues/73)) ([1825aee](https://github.com/zigordev/trading-bot/commit/1825aee7d4fb18e904bfefa5ef0743fd92b01c10)), closes [#30](https://github.com/zigordev/trading-bot/issues/30)

## [0.1.1](https://github.com/zigordev/trading-bot/compare/v0.1.0...v0.1.1) (2026-09-07)


### Features

* add dark mode + i18n foundation (nav chrome + Configuration) ([4135019](https://github.com/zigordev/trading-bot/commit/41350192396c2d95761f7e85583a2c07fe315ea2))
* add open bao local token scrip ([03fc596](https://github.com/zigordev/trading-bot/commit/03fc5967fa73318f18adf88e84f563941b99dd9d))
* add unified favicon with the circular Logo mark ([1da6aaf](https://github.com/zigordev/trading-bot/commit/1da6aaf1410b387be7a22b3bb072669583718492))
* adopt shared design-system navigation, fix empty topbar ([2a7bf3a](https://github.com/zigordev/trading-bot/commit/2a7bf3aab97462c4ba8e71f3440b5a5430315dfd))
* align backtesting with readiness-driven projections ([716e051](https://github.com/zigordev/trading-bot/commit/716e051d4c51789a6a9b1b9726f325edfaa5ab9f))
* backfill improvements and storage trim ([b93334e](https://github.com/zigordev/trading-bot/commit/b93334e3d1a5f27713cc1f67064f5a0bb1efcf23))
* **backtesting:** add legacy multi-strategy replay support ([fc15c0b](https://github.com/zigordev/trading-bot/commit/fc15c0b3946b8d7a8588b098f8337a638c1c417b))
* **backtesting:** add timeslot analysis heatmap ([667fa7d](https://github.com/zigordev/trading-bot/commit/667fa7dcfebbc8bb392a9da6cc758c56109ae58c))
* **backtesting:** add timeslot analysis heatmap ([71904a4](https://github.com/zigordev/trading-bot/commit/71904a400deee3445749f9224e18c3cadcf7c6e4))
* **backtesting:** make readiness strategy-aware ([c82daa5](https://github.com/zigordev/trading-bot/commit/c82daa576c057248379f3ecfa3c1ffe7ada03210))
* centralized logs generation ([32d5cf4](https://github.com/zigordev/trading-bot/commit/32d5cf4e8990f3fae73e185ffc7270ee908bab29))
* **ci:** add release-please ([#69](https://github.com/zigordev/trading-bot/issues/69)) ([e797c5d](https://github.com/zigordev/trading-bot/commit/e797c5dc500ce36809b26c4affc4851c4fa287c7))
* complete full-app i18n translation (Backtesting, Execution, shared/overview/ui) ([2355683](https://github.com/zigordev/trading-bot/commit/2355683d5758433b26c6a608cd3f49e14530673a))
* **control-plane:** enforce strategy promotion thresholds ([df36566](https://github.com/zigordev/trading-bot/commit/df365665f5dc6541ca1ca08d4a5b5c01d99a33ab))
* **data-table:** render through the shared Table ([3312a0e](https://github.com/zigordev/trading-bot/commit/3312a0e6b79dc2fc85d088757fe47513fca882a6))
* ds nav migration ([72e317f](https://github.com/zigordev/trading-bot/commit/72e317fd674ca5463ae8b9f42d11275d0cf51beb))
* **execution:** add runtime and promotion projections ([b42cf92](https://github.com/zigordev/trading-bot/commit/b42cf920ccf3402d1b5ab8b592d99b03b0373454))
* harden market-data backfill and backtest execution ([c2c10c7](https://github.com/zigordev/trading-bot/commit/c2c10c739140c626211c4f655b53dae709a9e3e7))
* improve backfill logging and trim trade schema ([c9d99a9](https://github.com/zigordev/trading-bot/commit/c9d99a9d07093fa0eab8d8afa9517d338ad7f0ed))
* improve market data backfill batching and backtest trade coverage tolerance ([edd3ed7](https://github.com/zigordev/trading-bot/commit/edd3ed7539018fa184512fd0a9b94c903c29efed))
* improve market-data ingestion and backtest validation ([a935e47](https://github.com/zigordev/trading-bot/commit/a935e47509bea1a6db57e603bde3a8c754718237))
* **observability:** converge on the shared standard across the estate ([ea7402d](https://github.com/zigordev/trading-bot/commit/ea7402da4b2de9c16ac7f1405f780290bb53dbd6))
* **operator-console:** add backtest pnl history charts ([a95b2f6](https://github.com/zigordev/trading-bot/commit/a95b2f6a3bb51d01e7b81112b666acf5f6b2f61d))
* **operator-console:** add execution and backtest insights ([f67e5f7](https://github.com/zigordev/trading-bot/commit/f67e5f73e6d479ab34131775cea7112d385679b6))
* **operator-console:** add operator console and kafka-backed ops projections ([fa0214d](https://github.com/zigordev/trading-bot/commit/fa0214d9605ae1e17602d0e72483bda24d3e7fd9))
* **operator-console:** add responsive ops tables ([7110981](https://github.com/zigordev/trading-bot/commit/7110981f9a4271b2e4b0e9d626cc1530d159133a))
* **operator-console:** consume design-system as a package ([#49](https://github.com/zigordev/trading-bot/issues/49)) ([850af32](https://github.com/zigordev/trading-bot/commit/850af32086da26033e4ed6dea6e7727189de16f1))
* redesign ([7bf76f8](https://github.com/zigordev/trading-bot/commit/7bf76f858b2838be8de780ef4f70a81ddec81272))
* refine operator console backtesting views ([2b23c2b](https://github.com/zigordev/trading-bot/commit/2b23c2be7daa8b0ea484fdc052c649302ad10e5f))
* **security:** set security headers on the control plane ([0015a27](https://github.com/zigordev/trading-bot/commit/0015a273c3bd1f12599159a3a85137dc62d94843))
* **security:** set security headers on the operator console ([0fb0889](https://github.com/zigordev/trading-bot/commit/0fb08897e593dbd8ed0b69eda8e1d260ea8cba24))
* target realtime updates and enrich operator console ([3963983](https://github.com/zigordev/trading-bot/commit/3963983896f43c548d1df403f4e3cd768baefb5c))
* tighten readiness metrics and backtest scheduling ([f0bf690](https://github.com/zigordev/trading-bot/commit/f0bf69002c5778e795aa067dab3c8fa0370462cb))
* **trading:** improve scoring-driven promotion and execution runtime ([041aa5c](https://github.com/zigordev/trading-bot/commit/041aa5c4f9d942682182e178b5a7d87b982639d1))
* translate Configuration (complete), and partial Backtesting/ ([6bab2da](https://github.com/zigordev/trading-bot/commit/6bab2daeb9d6af8eab31e6bc826562ec52d75883))
* **ui:** move the operator console accent from blue to purple ([187eda9](https://github.com/zigordev/trading-bot/commit/187eda94163c07f715dddb6fc583191114f820c5))
* unify nav/topbar icons through design-system Icon component ([4bd63d1](https://github.com/zigordev/trading-bot/commit/4bd63d11ad425809703d0c1ea806306942ac52e1))


### Bug Fixes

* **a11y:** raise fg-subtle/fg-faint contrast to WCAG AA ([385dd53](https://github.com/zigordev/trading-bot/commit/385dd53b61bdce407d47a3b2f5b93b1e41940012))
* backtesting bugs ([c815ead](https://github.com/zigordev/trading-bot/commit/c815eadec5dfa0d3f01e4d8e7cd0f7776b664771))
* **backtesting:** coalesce readiness replay batches ([4b592a3](https://github.com/zigordev/trading-bot/commit/4b592a31bee066a769781438b71892f0b396113d))
* **ci:** grant gitleaks the pull-requests:read it needs on Dependabot PRs ([58f374c](https://github.com/zigordev/trading-bot/commit/58f374cedf7f1f7f422c26070b4cd129d9402f1f))
* **ci:** install libcurl for the rust build, fix compose interpolation ([5cbeb91](https://github.com/zigordev/trading-bot/commit/5cbeb9169f88966a04ae67b762819498d3e3d727))
* **ci:** merge with a PAT so push-triggered workflows still run ([#50](https://github.com/zigordev/trading-bot/issues/50)) ([edc2ac6](https://github.com/zigordev/trading-bot/commit/edc2ac6e24182941a35026ef1618677e083c232e))
* **ci:** raise commitlint header-max-length to fit Dependabot titles ([76e582e](https://github.com/zigordev/trading-bot/commit/76e582e356aa06cccb02215b9c8849c2461830bd))
* **ci:** retry npm audit on transient registry failures ([a2f4060](https://github.com/zigordev/trading-bot/commit/a2f40604b8be06c34c2fa1d68ec8084e416e2448))
* **ci:** stop format:check failing on the generated CHANGELOG ([#72](https://github.com/zigordev/trading-bot/issues/72)) ([248e5f1](https://github.com/zigordev/trading-bot/commit/248e5f1cfd782392868ec0bfb854fff458b31303))
* clear kafka state during local reset ([303d568](https://github.com/zigordev/trading-bot/commit/303d5686ce284c1d8bc1f5f01d811eefa08ccf9c))
* **deps:** restore operator-console's nested postcss@8.5.24 ([ab1db7f](https://github.com/zigordev/trading-bot/commit/ab1db7f1387c5427e964b981ea150e3b930e2dfb))
* **docker:** bind ClickHouse to IPv4 so it listens at all ([6cc67e4](https://github.com/zigordev/trading-bot/commit/6cc67e4ff8c3a184e7b247116efaa220952be1c9))
* **docker:** restore local stack startup ([c8e454e](https://github.com/zigordev/trading-bot/commit/c8e454ec3eb4c76d4673b9230a7719c9f5c2caa2))
* **docker:** stop the husky prepare script breaking the image builds ([d51d37d](https://github.com/zigordev/trading-bot/commit/d51d37dc8bf346e137d9645a63e978f0ecbf316f))
* **execution:** import KeyInit for the RustCrypto 0.11/0.13 upgrade ([#64](https://github.com/zigordev/trading-bot/issues/64)) ([cbed7d3](https://github.com/zigordev/trading-bot/commit/cbed7d314f637a5008aed892d650d03e9c5dfb8d))
* full-height sidebar, remove nav duplication, nest Configuration ([df22c13](https://github.com/zigordev/trading-bot/commit/df22c137037980cf66b1018c3ead29177b67b5d5))
* increase the backtest trade limit ([fcd43df](https://github.com/zigordev/trading-bot/commit/fcd43df584999f7708baef76461a98f6ab2d3e97))
* **lint:** simplify a loop-with-let-else to while let ([35a907e](https://github.com/zigordev/trading-bot/commit/35a907e047bf2da07d592eb53fd11664af73bf45))
* **readiness:** align trade backfill and readiness reporting ([b690e38](https://github.com/zigordev/trading-bot/commit/b690e383a5fd1e15ebb93913499aa79f853a4196))
* replace forked next/link patch with upstream v0.1.5 generic fix ([9eeb4cc](https://github.com/zigordev/trading-bot/commit/9eeb4cc5b234302a5f70cfa860b504599339f9dd))
* **security:** strip the bundled npm CLI and patch Alpine at build time ([3330df0](https://github.com/zigordev/trading-bot/commit/3330df0c4f9b8f4b5f57726207dd87090fbe5c3a))
* **security:** strip the bundled npm/yarn CLI from operator-console's image ([e491b9b](https://github.com/zigordev/trading-bot/commit/e491b9be408cfdac0c6e1dcc7e521cf9e10b61c6))
* sync Topbar to design-system v0.1.14 (tabs merged into main row) ([3c8d56b](https://github.com/zigordev/trading-bot/commit/3c8d56b9ddf64f4fe3162a3334ec8cbaa044c0fc))
* sync Topbar to design-system v0.1.8 (divider alignment fix) ([1a9868d](https://github.com/zigordev/trading-bot/commit/1a9868d02bdf16ecfd6e926113bf3cd9bd4cb2a8))
* translate sr-only Close labels in dialog/sheet primitives ([d42f3cb](https://github.com/zigordev/trading-bot/commit/d42f3cb83bf4ac1d9ff27f00eb057ea745936b26))


### Performance Improvements

* speed up trade retrieval for backtests ([b05d5e0](https://github.com/zigordev/trading-bot/commit/b05d5e08440684e30ca52b7b058a382b9a54fe85))
