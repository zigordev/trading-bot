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
  origin_asset_needed_funds,
  destination_asset_needed_funds,
  created_at,
  updated_at
) VALUES
  ('6f686479-a001-4d72-89f3-f8a6a98f894f', 'BTCUSDT', true, 'BTC', 'USDT', 0.001, 10, '2026-03-16 10:42:15.044+00', '2026-03-16 10:42:15.044+00'),
  ('0d7c2f49-63a0-4f37-9a9d-4cb2c8b4d901', 'ETHUSDT', true, 'ETH', 'USDT', 0.001, 10, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00'),
  ('b6d58aab-3c38-4f8b-9c43-09d2a0c2e902', 'BNBUSDT', true, 'BNB', 'USDT', 0.001, 10, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');


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

INSERT INTO public.strategies VALUES ('1e341a7c-e979-4b14-b27e-bc40986e3a13', 'emaCross', 'EMA crossover strategy', true, '{"kind": "emaCross"}', '2026-03-16 10:42:15.13+00', '2026-03-16 10:42:15.13+00');


--
-- Data for Name: timeframes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.timeframes VALUES ('aa1a7b0d-ea90-4bb6-bc20-570574826952', '5m', '15m', 3, 300000, true, '2026-03-16 10:42:15.117+00', '2026-03-16 10:42:15.117+00');
INSERT INTO public.timeframes VALUES ('3c0e57f6-2426-4991-ae65-fab3521adf4b', '1m', '5m', 5, 60000, true, '2026-03-16 10:42:15.093+00', '2026-03-16 10:42:15.093+00');
INSERT INTO public.timeframes VALUES ('1fcf3fe9-a8f1-43bb-81fb-af9a22d7f036', '3m', '15m', 5, 180000, true, '2026-03-16 10:42:15.105+00', '2026-03-16 10:42:15.105+00');


--
-- Data for Name: trading_defaults; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.trading_defaults VALUES ('493b4ac7-57ce-4a1f-8bce-6b454a2173a4', 'default', 'Default trading defaults', 100, true, '2026-03-16 10:42:15.155+00', '2026-03-16 10:42:15.155+00');


--
-- Data for Name: analysis_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.analysis_settings VALUES ('f2b7510d-ff31-4e1e-ad26-9b95e8b37c2d', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.168+00', '2026-03-16 10:42:15.168+00');
INSERT INTO public.analysis_settings VALUES ('d4b017c7-88cb-4a54-b20c-7d3bebb78d81', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.015+00', '2026-03-16 10:45:18.015+00');
INSERT INTO public.analysis_settings VALUES ('a9999998-ca30-414d-b2ae-e18f8e1fe26a', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.051+00', '2026-03-16 10:45:18.051+00');
INSERT INTO public.analysis_settings VALUES ('7f93de85-2179-4e63-a8cb-333005ccddb1', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.083+00', '2026-03-16 10:45:18.083+00');
INSERT INTO public.analysis_settings VALUES ('a42b2c3c-288c-4bd0-8657-b4d652cce013', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.181+00', '2026-03-16 10:42:15.181+00');
INSERT INTO public.analysis_settings VALUES ('3d0b62cc-ba13-458d-9215-7f70d7b3e71e', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.147+00', '2026-03-16 10:45:18.147+00');
INSERT INTO public.analysis_settings VALUES ('5a09020c-6d9e-4435-a96b-2a0fad09a2d7', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.178+00', '2026-03-16 10:45:18.178+00');
INSERT INTO public.analysis_settings VALUES ('6dbb97d8-0575-4bfd-aba6-52e8af030a79', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.211+00', '2026-03-16 10:45:18.211+00');
INSERT INTO public.analysis_settings VALUES ('bb447b4f-34de-4226-bf51-79c148c1b31f', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.193+00', '2026-03-16 10:42:15.193+00');
INSERT INTO public.analysis_settings VALUES ('29bd523d-836e-4d6d-819a-bfbe297b2f7b', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.274+00', '2026-03-16 10:45:18.274+00');
INSERT INTO public.analysis_settings VALUES ('62f80875-6c31-4f43-891e-5b1f814c94e6', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.306+00', '2026-03-16 10:45:18.306+00');
INSERT INTO public.analysis_settings VALUES ('0b48fa1b-2eb8-464d-bca9-c3253162bfa7', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.339+00', '2026-03-16 10:45:18.339+00');
INSERT INTO public.analysis_settings VALUES ('91c0ec72-91f8-4f3e-bb70-a8bcd7e84501', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('6b5d4a0d-d9e2-4695-a7f1-36ce2f8ac502', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('f15731df-a6f6-42fe-8187-11e155919503', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('58f7fc56-9d0e-4a0f-b08a-bd44459b4504', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('fce03f29-0a9b-40a4-853c-e37eb6f22505', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('6db4e84f-60fe-403d-b5dc-b2a56ff7b506', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('6123f7d0-b110-4d23-a186-190320bf6a07', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('c7f77102-a94d-4b7d-b02d-35b624341708', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('e4d5bf86-765e-49d6-9f1f-7696c102d709', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('bcd56816-2f33-4104-bd8b-52ea087f2a10', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('5f59ac4d-8f4b-4a2f-a423-d9adef6bb611', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('eb9e25f9-5185-44a7-a9b0-0a52eac0bc12', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('8c868364-cdcc-42dc-a28b-47f1fdb3cf13', 'BNBUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('2ecb3e83-bd49-4b81-a6cb-842be6efc914', 'BNBUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('354fd4a4-6c25-4f16-99a7-0b0ea9034315', 'BNBUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('dc5f4d78-f6c5-4f15-8d9f-2ed6dc807416', 'BNBUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('26ebe2fe-eb9f-4612-b2b8-3de2e1597f17', 'BNBUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('f06769b9-be9a-4d56-a5e0-055d876f6318', 'BNBUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('66c61131-36c2-4f8c-bdc0-c5e5f17d1719', 'BNBUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('b77ea2f3-9ab8-4cf6-bf61-5166b8622e20', 'BNBUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('9cd3f708-2452-4f82-932d-8507e3ea1021', 'BNBUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('f737c0b1-2a16-4938-bfe8-58ea7c4af422', 'BNBUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('cc4e9c7d-df56-4f08-8ef3-f1c563d8b723', 'BNBUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');
INSERT INTO public.analysis_settings VALUES ('6f98f9c7-7238-4b30-af45-26178c329124', 'BNBUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-20 16:32:00+00', '2026-03-20 16:32:00+00');


-- (research_settings intentionally omitted)

--
-- PostgreSQL database dump complete
--

\unrestrict tRrFYEsl4EyLe2agNf1Fp8SchH6H57Nhpsi6rnSCFjEXR1iuTunvIdOA1fsgu7r
