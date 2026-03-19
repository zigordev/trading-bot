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
-- Data for Name: pairs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pairs VALUES ('6f686479-a001-4d72-89f3-f8a6a98f894f', 'BTCUSDT', true, 0.001, 10, '2026-03-16 10:42:15.044+00', '2026-03-16 10:42:15.044+00');


--
-- Data for Name: risk_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.risk_profiles VALUES ('7463d67a-b54e-4291-b803-6fff5ceed8e5', 'default', 'Default risk profile', 3, 1, 1, 2, true, '2026-03-16 10:42:15.143+00', '2026-03-16 10:42:15.143+00');


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


-- (research_settings intentionally omitted)

--
-- PostgreSQL database dump complete
--

\unrestrict tRrFYEsl4EyLe2agNf1Fp8SchH6H57Nhpsi6rnSCFjEXR1iuTunvIdOA1fsgu7r

