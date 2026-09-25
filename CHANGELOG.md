# Changelog

## [0.1.26](https://github.com/zigordev/trading-bot/compare/v0.1.25...v0.1.26) (2026-09-25)


### Bug Fixes

* **i18n:** report tolgee up when its export is unusable but served ([#180](https://github.com/zigordev/trading-bot/issues/180)) ([74d1b6d](https://github.com/zigordev/trading-bot/commit/74d1b6d0a1858390947b8aaf9293967e7e45b274))

## [0.1.25](https://github.com/zigordev/trading-bot/compare/v0.1.24...v0.1.25) (2026-09-25)


### Bug Fixes

* **i18n:** merge lists per index and count where the console's copy came from ([#178](https://github.com/zigordev/trading-bot/issues/178)) ([9d52a3f](https://github.com/zigordev/trading-bot/commit/9d52a3f0874fa5136bbfe80fde4679d4bb002647))

## [0.1.24](https://github.com/zigordev/trading-bot/compare/v0.1.23...v0.1.24) (2026-09-25)


### Bug Fixes

* **i18n:** ask Tolgee for the structured export, and make the capacity gate honest ([#176](https://github.com/zigordev/trading-bot/issues/176)) ([9c62fdf](https://github.com/zigordev/trading-bot/commit/9c62fdfac8ed7af3cf4975797f7073499ed541c8))

## [0.1.23](https://github.com/zigordev/trading-bot/compare/v0.1.22...v0.1.23) (2026-09-24)


### Features

* **metrics:** export realized p&l, label backtest runs and count promotions ([#174](https://github.com/zigordev/trading-bot/issues/174)) ([4968274](https://github.com/zigordev/trading-bot/commit/496827445a566af3178fedd4447f69bcc123acb5))

## [0.1.22](https://github.com/zigordev/trading-bot/compare/v0.1.21...v0.1.22) (2026-09-24)


### Features

* **deploy:** add a manual-only production delivery path ([#168](https://github.com/zigordev/trading-bot/issues/168)) ([13f5b26](https://github.com/zigordev/trading-bot/commit/13f5b260595fbfb7bfa1493037c7cce0138ec299))

## [0.1.21](https://github.com/zigordev/trading-bot/compare/v0.1.20...v0.1.21) (2026-09-24)


### Bug Fixes

* **observability:** re-vendor the kit's span fixes into both apps ([#169](https://github.com/zigordev/trading-bot/issues/169)) ([ee28097](https://github.com/zigordev/trading-bot/commit/ee28097f7ccb1fd55772cbc3a7e0383a0d9b8e2e))

## [0.1.20](https://github.com/zigordev/trading-bot/compare/v0.1.19...v0.1.20) (2026-09-23)


### Features

* **observability:** vendor the kit's remote flags and route naming into both apps ([#164](https://github.com/zigordev/trading-bot/issues/164)) ([fbe8256](https://github.com/zigordev/trading-bot/commit/fbe8256946da4b317f48f37c2d2badf040ab58c1))

## [0.1.19](https://github.com/zigordev/trading-bot/compare/v0.1.18...v0.1.19) (2026-09-23)


### Bug Fixes

* **observability:** make the stream and producer gauges tell the truth ([#162](https://github.com/zigordev/trading-bot/issues/162)) ([d50c4cc](https://github.com/zigordev/trading-bot/commit/d50c4ccb1265b0eb3d0eeb28dded1f25c9233327))

## [0.1.18](https://github.com/zigordev/trading-bot/compare/v0.1.17...v0.1.18) (2026-09-23)


### Bug Fixes

* **observability:** declare the console's RUM vocabulary when the process boots ([#160](https://github.com/zigordev/trading-bot/issues/160)) ([65e2dcf](https://github.com/zigordev/trading-bot/commit/65e2dcfac879280793303002644e5055645a90e2))

## [0.1.17](https://github.com/zigordev/trading-bot/compare/v0.1.16...v0.1.17) (2026-09-23)


### Features

* **observability:** events, lifecycle and domain metrics across trading-bot ([#158](https://github.com/zigordev/trading-bot/issues/158)) ([6de1264](https://github.com/zigordev/trading-bot/commit/6de1264460548d41bd39d2377a593da775005e56))

## [0.1.16](https://github.com/zigordev/trading-bot/compare/v0.1.15...v0.1.16) (2026-09-21)


### Features

* **observability:** export the release as service_build_info ([#142](https://github.com/zigordev/trading-bot/issues/142)) ([0e8ae7b](https://github.com/zigordev/trading-bot/commit/0e8ae7b2717a1cdb726bcb5a77baa834be5db3df))

## [0.1.15](https://github.com/zigordev/trading-bot/compare/v0.1.14...v0.1.15) (2026-09-21)


### Bug Fixes

* **observability:** name a trace only when it was sampled ([#140](https://github.com/zigordev/trading-bot/issues/140)) ([760d62a](https://github.com/zigordev/trading-bot/commit/760d62a2b93ccfa11da4ae57d3de12dc26cb3fc7))

## [0.1.14](https://github.com/zigordev/trading-bot/compare/v0.1.13...v0.1.14) (2026-09-20)


### Bug Fixes

* **rum:** record real visits again ([#138](https://github.com/zigordev/trading-bot/issues/138)) ([80623a9](https://github.com/zigordev/trading-bot/commit/80623a90fdf1ed4facd5a00fd1f8050bf68f13aa))

## [0.1.13](https://github.com/zigordev/trading-bot/compare/v0.1.12...v0.1.13) (2026-09-20)


### Bug Fixes

* **control-plane:** boot again and stop cleanly on SIGTERM ([#135](https://github.com/zigordev/trading-bot/issues/135)) ([b57fddf](https://github.com/zigordev/trading-bot/commit/b57fddf9a675e6757bca50775cf136989c7b5040))

## [0.1.12](https://github.com/zigordev/trading-bot/compare/v0.1.11...v0.1.12) (2026-09-16)


### Features

* **i18n:** read Tolgee at runtime over the committed bundle ([#126](https://github.com/zigordev/trading-bot/issues/126)) ([0554837](https://github.com/zigordev/trading-bot/commit/05548379649f0a3f4683ab4a75119eccb745cfa8))

## [0.1.11](https://github.com/zigordev/trading-bot/compare/v0.1.10...v0.1.11) (2026-09-12)


### Bug Fixes

* **docker:** upgrade packages in the runtime stage of the rust images ([#110](https://github.com/zigordev/trading-bot/issues/110)) ([c28d8e3](https://github.com/zigordev/trading-bot/commit/c28d8e398dc820ec96ae0484768aa6c7141fd9a9))

## [0.1.10](https://github.com/zigordev/trading-bot/compare/v0.1.9...v0.1.10) (2026-09-12)


### Bug Fixes

* **docker:** upgrade base packages in the rust images ([#108](https://github.com/zigordev/trading-bot/issues/108)) ([52eabd1](https://github.com/zigordev/trading-bot/commit/52eabd1bad5c60dd398fa88e59e273397259a57a))

## [0.1.9](https://github.com/zigordev/trading-bot/compare/v0.1.8...v0.1.9) (2026-09-12)


### Bug Fixes

* **docker:** build the control-plane and console images on node 24 ([#100](https://github.com/zigordev/trading-bot/issues/100)) ([e3199ac](https://github.com/zigordev/trading-bot/commit/e3199acf7a1253f5c42aa8b4c3f6c0736ebfe59a))

## [0.1.8](https://github.com/zigordev/trading-bot/compare/v0.1.7...v0.1.8) (2026-09-10)


### Bug Fixes

* **release:** keep the workspace crate versions in Cargo.lock in step ([#98](https://github.com/zigordev/trading-bot/issues/98)) ([ce5718d](https://github.com/zigordev/trading-bot/commit/ce5718db35401bc9ddbf101e019d4d594b979a11))

## [0.1.7](https://github.com/zigordev/trading-bot/compare/v0.1.6...v0.1.7) (2026-09-09)


### Features

* **control-plane:** send RFC 9457 problem details ([#94](https://github.com/zigordev/trading-bot/issues/94)) ([0788a30](https://github.com/zigordev/trading-bot/commit/0788a30b806aed63ab94876c7c71182563846397))

## [0.1.6](https://github.com/zigordev/trading-bot/compare/v0.1.5...v0.1.6) (2026-09-09)


### Bug Fixes

* **market-data,research-backtesting:** build request URLs from a parsed base ([#92](https://github.com/zigordev/trading-bot/issues/92)) ([6d26aec](https://github.com/zigordev/trading-bot/commit/6d26aec5ab30af3f282b5c877238bd403466aee9))

## [0.1.5](https://github.com/zigordev/trading-bot/compare/v0.1.4...v0.1.5) (2026-09-09)


### Bug Fixes

* **release:** keep workspace versions in package-lock.json in step ([#89](https://github.com/zigordev/trading-bot/issues/89)) ([f870666](https://github.com/zigordev/trading-bot/commit/f870666339e4b6c457332f58e8212d684688a592))

## [0.1.4](https://github.com/zigordev/trading-bot/compare/v0.1.3...v0.1.4) (2026-09-09)


### Bug Fixes

* **docker:** add a .dockerignore for every image build ([#87](https://github.com/zigordev/trading-bot/issues/87)) ([297a435](https://github.com/zigordev/trading-bot/commit/297a435b026f6ee730201022c75fcc6264e6b594))

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
