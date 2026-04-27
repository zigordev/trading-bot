--
-- PostgreSQL database dump
--

\restrict tRrFYEsl4EyLe2agNf1Fp8SchH6H57Nhpsi6rnSCFjEXR1iuTunvIdOA1fsgu7r

-- Dumped from database version 16.12
-- Dumped by pg_dump version 16.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: symbols; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.symbols (
  id,
  code,
  active,
  base_asset,
  destination_asset,
  created_at,
  updated_at
) VALUES
  ('6f686479-a001-4d72-89f3-f8a6a98f894f', 'BTCUSDT', true, 'BTC', 'USDT', '2026-03-16 10:42:15.044+00', '2026-03-16 10:42:15.044+00'),
  ('0d7c2f49-63a0-4f37-9a9d-4cb2c8b4d901', 'ETHUSDT', true, 'ETH', 'USDT', '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00'),
  ('b6d58aab-3c38-4f8b-9c43-09d2a0c2e902', 'BNBUSDT', true, 'BNB', 'USDT', '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00'),
  ('4d5a0805-7560-48c7-b50a-4e4760a1e092', 'USDCUSDT', true, 'USDC', 'USDT', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00'),
  ('e8d5cafc-1eb4-4f1b-9bb6-4063bf83f226', 'SOLUSDT', true, 'SOL', 'USDT', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00'),
  ('4c3e1d6f-2b91-485e-8dc7-d63a466554c9', 'BTCUSDC', true, 'BTC', 'USDC', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00'),
  ('e623aaf1-a8df-461c-9681-a1f48596bd56', 'NIGHTUSDT', true, 'NIGHT', 'USDT', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00'),
  ('3d5eb776-3b27-4d7b-a161-5e6d2b4dac6e', 'ETHUSDC', true, 'ETH', 'USDC', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00'),
  ('a3ab0937-fa50-4774-a565-8ee0aafdc811', 'ETHUSD1', true, 'ETH', 'USD1', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00'),
  ('528618e3-670c-443a-b9f7-738e8e6ea124', 'BTCUSD1', true, 'BTC', 'USD1', '2026-04-03 00:00:00+00', '2026-04-03 00:00:00+00');

--
-- Data for Name: risk_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.risk_profiles VALUES ('7463d67a-b54e-4291-b803-6fff5ceed8e5', 'default', 'Default balanced risk profile', 3, 1, 1, 2, true, '2026-03-16 10:42:15.143+00', '2026-03-16 10:42:15.143+00');
INSERT INTO public.risk_profiles VALUES ('1e1d1a3d-6f97-4c89-9ff0-9f5d7dfd6a01', 'tight-scalp', 'Tighter stop profile for fast mean-reversion or scalp-style entries', 1.2, 0.4, 0.6, 1.5, true, '2026-03-20 16:25:00+00', '2026-03-20 16:25:00+00');
INSERT INTO public.risk_profiles VALUES ('7a2c8f11-b247-4db3-a4f1-1c3d8e8c2d02', 'conservative', 'Conservative profile with tighter capped risk and modest reward target', 2, 0.75, 0.9, 1.8, true, '2026-03-20 16:25:00+00', '2026-03-20 16:25:00+00');
INSERT INTO public.risk_profiles VALUES ('d3a44a66-6d6c-4c7f-b6a9-6d9f0f9b7e03', 'balanced-plus', 'Balanced swing profile with slightly wider stops and stronger reward target', 3.5, 1.25, 1.5, 2.5, true, '2026-03-20 16:25:00+00', '2026-03-20 16:25:00+00');
INSERT INTO public.risk_profiles VALUES ('b4f6c7f2-93c8-4a34-a5c0-7d1c44d27c04', 'trend-following', 'Wider stop profile intended for trend continuation setups', 4.5, 1.5, 2.0, 3, true, '2026-03-20 16:25:00+00', '2026-03-20 16:25:00+00');
INSERT INTO public.risk_profiles VALUES ('e8f5a1b9-2b6e-42e8-8df8-3fd4c0c77f05', 'aggressive', 'Aggressive profile with wider allowable stop and high reward multiple', 6, 2, 2.5, 3.5, true, '2026-03-20 16:25:00+00', '2026-03-20 16:25:00+00');


--
-- Data for Name: strategies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.strategies VALUES ('1e341a7c-e979-4b14-b27e-bc40986e3a13', 'emaCross', 'EMA crossover strategy', true, '{"kind": "emaCross", "promotionThresholds": {"minTradeCount": 135, "minTradesPer1000Candles": 13.5, "maxDrawdownPercent": 15, "maxReversalRatio": 0.35}}', '2026-03-16 10:42:15.13+00', '2026-03-16 10:42:15.13+00');
INSERT INTO public.strategies VALUES ('4f60d488-8cb7-4bdb-93ea-11bf8f9d6d0a', 'strategy1', 'Legacy trend pullback strategy', true, '{"kind": "strategy1", "promotionThresholds": {"minTradeCount": 72, "minTradesPer1000Candles": 4.5, "maxDrawdownPercent": 12, "maxReversalRatio": 0.2}}', '2026-03-16 10:42:15.13+00', '2026-03-16 10:42:15.13+00');
INSERT INTO public.strategies VALUES ('e6cb6e84-04a0-4c41-8dd5-9008bbd31ce3', 'strategy2', 'Legacy momentum confirmation strategy', true, '{"kind": "strategy2", "promotionThresholds": {"minTradeCount": 72, "minTradesPer1000Candles": 4.5, "maxDrawdownPercent": 12, "maxReversalRatio": 0.2}}', '2026-03-16 10:42:15.13+00', '2026-03-16 10:42:15.13+00');


--
-- Data for Name: timeframes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.timeframes VALUES ('aa1a7b0d-ea90-4bb6-bc20-570574826952', '5m', '15m', 3, 300000, true, '2026-03-16 10:42:15.117+00', '2026-03-16 10:42:15.117+00');
INSERT INTO public.timeframes VALUES ('3c0e57f6-2426-4991-ae65-fab3521adf4b', '1m', '5m', 5, 60000, true, '2026-03-16 10:42:15.093+00', '2026-03-16 10:42:15.093+00');
INSERT INTO public.timeframes VALUES ('1fcf3fe9-a8f1-43bb-81fb-af9a22d7f036', '3m', '15m', 5, 180000, true, '2026-03-16 10:42:15.105+00', '2026-03-16 10:42:15.105+00');


--
-- Data for Name: analysis_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.analysis_settings
  (id, name, strategy_name, technical_analysis_settings, enabled, created_at, updated_at)
VALUES
  ('f2b7510d-ff31-4e1e-ad26-9b95e8b37c2d', 'ema-cross-9-21', 'emaCross', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.168+00', '2026-03-16 10:42:15.168+00'),
  ('d4b017c7-88cb-4a54-b20c-7d3bebb78d81', 'ema-cross-5-13', 'emaCross', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.015+00', '2026-03-16 10:45:18.015+00'),
  ('a9999998-ca30-414d-b2ae-e18f8e1fe26a', 'ema-cross-8-21', 'emaCross', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.051+00', '2026-03-16 10:45:18.051+00'),
  ('7f93de85-2179-4e63-a8cb-333005ccddb1', 'ema-cross-12-26', 'emaCross', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.083+00', '2026-03-16 10:45:18.083+00'),
  ('8f6b1b2f-51e9-4b2a-8b4a-b9c07b9a41a1', 'legacy-strategy1-default', 'strategy1', '{"longerTimeframeEmaPeriods": 200, "macdFastPeriods": 12, "macdSlowPeriods": 26, "macdSignalPeriods": 9, "stochasticPeriods": 14, "stochasticSignalPeriods": 3}', true, '2026-03-29 10:00:00+00', '2026-03-29 10:00:00+00'),
  ('2d76cb5c-e7ef-486f-bf1b-9fbc424d91c8', 'legacy-strategy1-fast', 'strategy1', '{"longerTimeframeEmaPeriods": 100, "macdFastPeriods": 8, "macdSlowPeriods": 21, "macdSignalPeriods": 5, "stochasticPeriods": 14, "stochasticSignalPeriods": 3}', true, '2026-03-29 10:05:00+00', '2026-03-29 10:05:00+00'),
  ('5f124473-4b8f-49ef-8f46-494db2d14798', 'legacy-strategy2-default', 'strategy2', '{"longerTimeframeEmaPeriods": 200, "macdFastPeriods": 12, "macdSlowPeriods": 26, "macdSignalPeriods": 9, "stochasticPeriods": 14, "stochasticSignalPeriods": 3, "rsiPeriods": 14}', true, '2026-03-29 10:10:00+00', '2026-03-29 10:10:00+00'),
  ('bd5d9c26-9860-4a6a-86e7-8dd2dc8a31d7', 'legacy-strategy2-fast', 'strategy2', '{"longerTimeframeEmaPeriods": 100, "macdFastPeriods": 8, "macdSlowPeriods": 21, "macdSignalPeriods": 5, "stochasticPeriods": 14, "stochasticSignalPeriods": 3, "rsiPeriods": 10}', true, '2026-03-29 10:15:00+00', '2026-03-29 10:15:00+00');


--
-- Data for Name: execution_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.execution_settings
  (
    id,
    name,
    enabled,
    mode,
    auto_promote,
    selection_metric,
    require_positive_pnl,
    max_promotions,
    replace_open_position_policy,
    created_at,
    updated_at
  )
VALUES
  (
    '4bf44511-8cc5-44f4-9ce6-5ff8d680bc71',
    'paper-default',
    true,
    'paper',
    true,
    'totalPnlPercent',
    true,
    20,
    'flatten',
    '2026-03-29 09:00:00+00',
    '2026-03-29 09:00:00+00'
  );


-- (research_settings intentionally omitted)

--
-- PostgreSQL database dump complete
--
