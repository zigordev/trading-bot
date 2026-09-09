# Changelog

## [0.1.5](https://github.com/zigordev/trading-bot/compare/v0.1.4...v0.1.5) (2026-09-09)


### Bug Fixes

* **release:** keep workspace versions in package-lock.json in step ([#89](https://github.com/zigordev/trading-bot/issues/89)) ([845e131](https://github.com/zigordev/trading-bot/commit/845e13134483cd49ef0e6eaeb3956fa921602e8f))

## [0.1.4](https://github.com/zigordev/trading-bot/compare/v0.1.3...v0.1.4) (2026-09-09)


### Bug Fixes

* **docker:** add a .dockerignore for every image build ([#87](https://github.com/zigordev/trading-bot/issues/87)) ([530683a](https://github.com/zigordev/trading-bot/commit/530683a86ee15177a474285bdf05de45082500bd))

## [0.1.3](https://github.com/zigordev/trading-bot/compare/v0.1.2...v0.1.3) (2026-09-07)


### Features

* **docker:** run every service under compose watch for local development ([#78](https://github.com/zigordev/trading-bot/issues/78)) ([3aa0589](https://github.com/zigordev/trading-bot/commit/3aa05891b23e397495d8b3bc688742190c190f0c))

## [0.1.2](https://github.com/zigordev/trading-bot/compare/v0.1.1...v0.1.2) (2026-09-07)


### Bug Fixes

* **deps:** let overrides accept patches instead of pinning exact versions ([#73](https://github.com/zigordev/trading-bot/issues/73)) ([c4ff35c](https://github.com/zigordev/trading-bot/commit/c4ff35cb381466975f56f2a94745202700959a9f)), closes [#30](https://github.com/zigordev/trading-bot/issues/30)

## [0.1.1](https://github.com/zigordev/trading-bot/compare/v0.1.0...v0.1.1) (2026-09-07)


### Features

* add dark mode + i18n foundation (nav chrome + Configuration) ([9f603c7](https://github.com/zigordev/trading-bot/commit/9f603c7480df7d412d64ad78da8afaa8088ad0d5))
* add open bao local token scrip ([26dcedd](https://github.com/zigordev/trading-bot/commit/26dceddbef934ed27ff86fe06260ce12db87e2b7))
* add unified favicon with the circular Logo mark ([faa18e4](https://github.com/zigordev/trading-bot/commit/faa18e44e23291ad52381598f4fdaf72f199bb51))
* adopt shared design-system navigation, fix empty topbar ([3b4127f](https://github.com/zigordev/trading-bot/commit/3b4127f2aa7e87a3c4ad4927f3bae7736712349b))
* align backtesting with readiness-driven projections ([7b684ce](https://github.com/zigordev/trading-bot/commit/7b684ce885d1a7f042823371a5d8633c87a5346f))
* backfill improvements and storage trim ([c286feb](https://github.com/zigordev/trading-bot/commit/c286feb8d6d48d6800e173b4fded2c452c2d1294))
* **backtesting:** add legacy multi-strategy replay support ([e568e50](https://github.com/zigordev/trading-bot/commit/e568e5070cd7f6272d31cbd437c447e5c0f6cfec))
* **backtesting:** add timeslot analysis heatmap ([53a5143](https://github.com/zigordev/trading-bot/commit/53a514334e9b57c3746f078726899250391875c6))
* **backtesting:** add timeslot analysis heatmap ([9990bc2](https://github.com/zigordev/trading-bot/commit/9990bc2cce97f26f066d0706b49923fc03473158))
* **backtesting:** make readiness strategy-aware ([10d2bd1](https://github.com/zigordev/trading-bot/commit/10d2bd1fa9409643a204bea32bad5dd51d28f5ed))
* centralized logs generation ([7bcc0e4](https://github.com/zigordev/trading-bot/commit/7bcc0e47e6432f7478420c355a7660190f15f80d))
* **ci:** add release-please ([#69](https://github.com/zigordev/trading-bot/issues/69)) ([b148a8d](https://github.com/zigordev/trading-bot/commit/b148a8d7612517138df86755b6575d577ff9d08d))
* complete full-app i18n translation (Backtesting, Execution, shared/overview/ui) ([1488dc2](https://github.com/zigordev/trading-bot/commit/1488dc221b6d05df19b36356d2cbac92bfc89332))
* **control-plane:** enforce strategy promotion thresholds ([d4ceb8f](https://github.com/zigordev/trading-bot/commit/d4ceb8f1555800057e14ac810fe03dbdd8c84b70))
* **data-table:** render through the shared Table ([b48759f](https://github.com/zigordev/trading-bot/commit/b48759f7a8ccb4608d3d1d9316da31c8319d6cc6))
* ds nav migration ([48845f9](https://github.com/zigordev/trading-bot/commit/48845f94f3e9c3af1d20c0d8135918f2e3c21412))
* **execution:** add runtime and promotion projections ([1e041e1](https://github.com/zigordev/trading-bot/commit/1e041e1511639459a200dd0870bd682a7a9cd5f9))
* harden market-data backfill and backtest execution ([6c4c933](https://github.com/zigordev/trading-bot/commit/6c4c93321c19cdf05180f806be6faa7ce7ed9518))
* improve backfill logging and trim trade schema ([e877fcd](https://github.com/zigordev/trading-bot/commit/e877fcdcd449ecdb50ab1eebcc7500dc9a11d6bf))
* improve market data backfill batching and backtest trade coverage tolerance ([f461bf8](https://github.com/zigordev/trading-bot/commit/f461bf898f4cb1d2f2edac3f6bb8b41b4a2c9548))
* improve market-data ingestion and backtest validation ([65ea74c](https://github.com/zigordev/trading-bot/commit/65ea74c44be750b668b3fa5b3b69b5cf937eb694))
* **observability:** converge on the shared standard across the estate ([b1e4669](https://github.com/zigordev/trading-bot/commit/b1e4669418bbb806af373c037bcbd3ce286ee1d7))
* **operator-console:** add backtest pnl history charts ([0b57c80](https://github.com/zigordev/trading-bot/commit/0b57c807ac4d2643a2ce5d35f19bebdaff6ac8d3))
* **operator-console:** add execution and backtest insights ([3ff317e](https://github.com/zigordev/trading-bot/commit/3ff317ebae40a4c0772a2818c5c4882f5122fc5a))
* **operator-console:** add operator console and kafka-backed ops projections ([fe6d960](https://github.com/zigordev/trading-bot/commit/fe6d96088c8a7038d700b5ee8c9a2b977e37bb32))
* **operator-console:** add responsive ops tables ([7be546e](https://github.com/zigordev/trading-bot/commit/7be546eab94146a3842dfdd8541df1716eb59acb))
* **operator-console:** consume design-system as a package ([#49](https://github.com/zigordev/trading-bot/issues/49)) ([8e30bb8](https://github.com/zigordev/trading-bot/commit/8e30bb83080f71692fce69892a6ee9dd9b74cf0f))
* redesign ([647f304](https://github.com/zigordev/trading-bot/commit/647f304862e1522b88d54f40d1bcd580689f18bf))
* refine operator console backtesting views ([2a75fc3](https://github.com/zigordev/trading-bot/commit/2a75fc38f06e3d22fd865862fac0231ad7744fda))
* **security:** set security headers on the control plane ([fa79900](https://github.com/zigordev/trading-bot/commit/fa7990049052267401aceee714dc09a4193b1ba8))
* **security:** set security headers on the operator console ([054381e](https://github.com/zigordev/trading-bot/commit/054381e84955bf903209dee9c2b84b6199eaa57f))
* target realtime updates and enrich operator console ([57fe263](https://github.com/zigordev/trading-bot/commit/57fe2635f6fe7928b37d5bbb55545f93e1c63b0e))
* tighten readiness metrics and backtest scheduling ([73bbfa2](https://github.com/zigordev/trading-bot/commit/73bbfa2d64b2cbe5afdaaebe82c2cc92b1c9cf06))
* **trading:** improve scoring-driven promotion and execution runtime ([23a5fe7](https://github.com/zigordev/trading-bot/commit/23a5fe77dbc9969612a1e74f86a64fa5dca396b5))
* translate Configuration (complete), and partial Backtesting/ ([1f90788](https://github.com/zigordev/trading-bot/commit/1f90788ef6c004ffdf3ceeadfe2f8e43b0032572))
* **ui:** move the operator console accent from blue to purple ([aa0babd](https://github.com/zigordev/trading-bot/commit/aa0babddbd56c362ca8915997b31f73e362baf5e))
* unify nav/topbar icons through design-system Icon component ([ca5f864](https://github.com/zigordev/trading-bot/commit/ca5f864e7e1a64d38cfc5217b12518d3ef427802))


### Bug Fixes

* **a11y:** raise fg-subtle/fg-faint contrast to WCAG AA ([9a750b4](https://github.com/zigordev/trading-bot/commit/9a750b45bd85d5e8a3f3b2ed7364026762494c43))
* backtesting bugs ([bcf4bbc](https://github.com/zigordev/trading-bot/commit/bcf4bbc5fa5da2be873812b9e5fb8ac2839ca930))
* **backtesting:** coalesce readiness replay batches ([29f5c54](https://github.com/zigordev/trading-bot/commit/29f5c549c39f11d9553e6923af7005b9a5f03cf1))
* **ci:** grant gitleaks the pull-requests:read it needs on Dependabot PRs ([6e0e2a5](https://github.com/zigordev/trading-bot/commit/6e0e2a571b291e3008333c8fffe452ee85d1a07c))
* **ci:** install libcurl for the rust build, fix compose interpolation ([78b5bba](https://github.com/zigordev/trading-bot/commit/78b5bbae9181f24e8139a5ac573a28f8e280d3e9))
* **ci:** merge with a PAT so push-triggered workflows still run ([#50](https://github.com/zigordev/trading-bot/issues/50)) ([ac5467f](https://github.com/zigordev/trading-bot/commit/ac5467f328ce655ebe66d7cc8cfc256117b7a5dd))
* **ci:** raise commitlint header-max-length to fit Dependabot titles ([e4a4650](https://github.com/zigordev/trading-bot/commit/e4a4650cf43b335391efdeac7c781e2cb26339a0))
* **ci:** retry npm audit on transient registry failures ([ddddf66](https://github.com/zigordev/trading-bot/commit/ddddf663c24294ffb1b83c026a0661297abdbeb1))
* **ci:** stop format:check failing on the generated CHANGELOG ([#72](https://github.com/zigordev/trading-bot/issues/72)) ([ac4cc30](https://github.com/zigordev/trading-bot/commit/ac4cc30981d4935e3efd625143cff017fe09f6da))
* clear kafka state during local reset ([9a3c3d4](https://github.com/zigordev/trading-bot/commit/9a3c3d4eec363e01df95b5f8025c45fe2c1c16e0))
* **deps:** restore operator-console's nested postcss@8.5.24 ([f4d5c07](https://github.com/zigordev/trading-bot/commit/f4d5c070620a94a867a486b3491680dee7b962fb))
* **docker:** bind ClickHouse to IPv4 so it listens at all ([e60d5d1](https://github.com/zigordev/trading-bot/commit/e60d5d16beb7fb6e501fb94fd34d1a035949d187))
* **docker:** restore local stack startup ([fb60084](https://github.com/zigordev/trading-bot/commit/fb60084b10b57697833dcbbe4b3d097e8c58e5d3))
* **docker:** stop the husky prepare script breaking the image builds ([186923e](https://github.com/zigordev/trading-bot/commit/186923eca4f13f1b2566d06304c66af3981ec0c4))
* **execution:** import KeyInit for the RustCrypto 0.11/0.13 upgrade ([#64](https://github.com/zigordev/trading-bot/issues/64)) ([540e72a](https://github.com/zigordev/trading-bot/commit/540e72a62176f0ff8827ddac94921366e3784dd6))
* full-height sidebar, remove nav duplication, nest Configuration ([533754d](https://github.com/zigordev/trading-bot/commit/533754df878b1d3817ccc8a594adfe8f394706da))
* increase the backtest trade limit ([50bf2a7](https://github.com/zigordev/trading-bot/commit/50bf2a7a3f14abe80bd29ffa1867b44d442f9505))
* **lint:** simplify a loop-with-let-else to while let ([e7bce2f](https://github.com/zigordev/trading-bot/commit/e7bce2f295ba711af8e6d4f138e58eec5487d178))
* **readiness:** align trade backfill and readiness reporting ([fc63fc4](https://github.com/zigordev/trading-bot/commit/fc63fc4515110cb6299c4178ed3fa116f7195b2b))
* replace forked next/link patch with upstream v0.1.5 generic fix ([eef173d](https://github.com/zigordev/trading-bot/commit/eef173de2067b25a56b90e982b131260e954cce0))
* **security:** strip the bundled npm CLI and patch Alpine at build time ([c020782](https://github.com/zigordev/trading-bot/commit/c0207825c192b149a14047b2d2bc29823b6b39d4))
* **security:** strip the bundled npm/yarn CLI from operator-console's image ([cf9323d](https://github.com/zigordev/trading-bot/commit/cf9323d1019450fff235e171495e0e8ab219ccf5))
* sync Topbar to design-system v0.1.14 (tabs merged into main row) ([6ad978f](https://github.com/zigordev/trading-bot/commit/6ad978fd427208ea99f9e0f09ded2762c305a2ab))
* sync Topbar to design-system v0.1.8 (divider alignment fix) ([069f991](https://github.com/zigordev/trading-bot/commit/069f991c2b3a4ad76c82cb6faf44ef714fe51b89))
* translate sr-only Close labels in dialog/sheet primitives ([e5f7fd6](https://github.com/zigordev/trading-bot/commit/e5f7fd6644879204c8501ed7d1c7f45bb4b9ad88))


### Performance Improvements

* speed up trade retrieval for backtests ([4c0eb75](https://github.com/zigordev/trading-bot/commit/4c0eb75279936d41e9c7263a6256c611288407fe))
