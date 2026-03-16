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
INSERT INTO public.pairs VALUES ('dd5d0311-2902-45ad-a056-8f68d0effb3b', 'ETHUSDT', true, 0.001, 10, '2026-03-16 10:42:15.065+00', '2026-03-16 10:42:15.065+00');
INSERT INTO public.pairs VALUES ('5ed23b6f-3dc2-4fc4-b985-7677bac97f8f', 'SOLUSDT', true, 0.001, 10, '2026-03-16 10:42:15.078+00', '2026-03-16 10:42:15.078+00');


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
INSERT INTO public.analysis_settings VALUES ('a42b2c3c-288c-4bd0-8657-b4d652cce013', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.181+00', '2026-03-16 10:42:15.181+00');
INSERT INTO public.analysis_settings VALUES ('bb447b4f-34de-4226-bf51-79c148c1b31f', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.193+00', '2026-03-16 10:42:15.193+00');
INSERT INTO public.analysis_settings VALUES ('52cf6d42-9f58-4209-9e9d-30da7e0845b1', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.205+00', '2026-03-16 10:42:15.205+00');
INSERT INTO public.analysis_settings VALUES ('f82f24dd-eae6-457f-99ea-4b14ed7b5931', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.217+00', '2026-03-16 10:42:15.217+00');
INSERT INTO public.analysis_settings VALUES ('432efbb9-2175-48f2-9b52-47e9e83dfeac', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.229+00', '2026-03-16 10:42:15.229+00');
INSERT INTO public.analysis_settings VALUES ('82b27871-8d5d-4634-8140-0569acae677b', 'SOLUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.241+00', '2026-03-16 10:42:15.241+00');
INSERT INTO public.analysis_settings VALUES ('698f6cef-e67f-46c7-b2b7-814845e3ee5b', 'SOLUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.252+00', '2026-03-16 10:42:15.252+00');
INSERT INTO public.analysis_settings VALUES ('7f14cff9-af3c-4807-a24e-c5cc59348baa', 'SOLUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 9, "slowPeriod": 21}', true, '2026-03-16 10:42:15.264+00', '2026-03-16 10:42:15.264+00');
INSERT INTO public.analysis_settings VALUES ('d4b017c7-88cb-4a54-b20c-7d3bebb78d81', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.015+00', '2026-03-16 10:45:18.015+00');
INSERT INTO public.analysis_settings VALUES ('a9999998-ca30-414d-b2ae-e18f8e1fe26a', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.051+00', '2026-03-16 10:45:18.051+00');
INSERT INTO public.analysis_settings VALUES ('7f93de85-2179-4e63-a8cb-333005ccddb1', 'BTCUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.083+00', '2026-03-16 10:45:18.083+00');
INSERT INTO public.analysis_settings VALUES ('3d0b62cc-ba13-458d-9215-7f70d7b3e71e', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.147+00', '2026-03-16 10:45:18.147+00');
INSERT INTO public.analysis_settings VALUES ('5a09020c-6d9e-4435-a96b-2a0fad09a2d7', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.178+00', '2026-03-16 10:45:18.178+00');
INSERT INTO public.analysis_settings VALUES ('6dbb97d8-0575-4bfd-aba6-52e8af030a79', 'BTCUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.211+00', '2026-03-16 10:45:18.211+00');
INSERT INTO public.analysis_settings VALUES ('29bd523d-836e-4d6d-819a-bfbe297b2f7b', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.274+00', '2026-03-16 10:45:18.274+00');
INSERT INTO public.analysis_settings VALUES ('62f80875-6c31-4f43-891e-5b1f814c94e6', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.306+00', '2026-03-16 10:45:18.306+00');
INSERT INTO public.analysis_settings VALUES ('0b48fa1b-2eb8-464d-bca9-c3253162bfa7', 'BTCUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.339+00', '2026-03-16 10:45:18.339+00');
INSERT INTO public.analysis_settings VALUES ('1c1ac0be-58b9-4a5d-9cd9-039d308a22bf', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.401+00', '2026-03-16 10:45:18.401+00');
INSERT INTO public.analysis_settings VALUES ('3fbbde9a-fa0e-49cf-bead-2ee09d3d9d76', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.436+00', '2026-03-16 10:45:18.436+00');
INSERT INTO public.analysis_settings VALUES ('d4178472-c1c2-4262-9e98-38c020cc3629', 'ETHUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.469+00', '2026-03-16 10:45:18.469+00');
INSERT INTO public.analysis_settings VALUES ('6317a281-1498-494b-80f1-5b522d125be7', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.531+00', '2026-03-16 10:45:18.531+00');
INSERT INTO public.analysis_settings VALUES ('b1e8adb8-00df-4e8a-95f7-8b8f62f6969f', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.565+00', '2026-03-16 10:45:18.565+00');
INSERT INTO public.analysis_settings VALUES ('bc79de48-e93f-4f17-8907-badeb4823488', 'ETHUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.598+00', '2026-03-16 10:45:18.598+00');
INSERT INTO public.analysis_settings VALUES ('d8204e3d-a394-47a2-b2ca-898531917c9f', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.661+00', '2026-03-16 10:45:18.661+00');
INSERT INTO public.analysis_settings VALUES ('bfd0f3d7-31b0-41c6-bc94-15e65600ec6f', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.695+00', '2026-03-16 10:45:18.695+00');
INSERT INTO public.analysis_settings VALUES ('65ad6661-99ca-498b-b521-28edd33ef8a3', 'ETHUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.732+00', '2026-03-16 10:45:18.732+00');
INSERT INTO public.analysis_settings VALUES ('2964347f-f694-4faa-add2-24f301687b38', 'SOLUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:18.842+00', '2026-03-16 10:45:18.842+00');
INSERT INTO public.analysis_settings VALUES ('7e0cee35-f22c-4dbe-bef2-c52ef0778501', 'SOLUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:18.906+00', '2026-03-16 10:45:18.906+00');
INSERT INTO public.analysis_settings VALUES ('7927a5e6-c3e0-4284-a22b-1f20ee301f6d', 'SOLUSDT', '1m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:18.961+00', '2026-03-16 10:45:18.961+00');
INSERT INTO public.analysis_settings VALUES ('250b1257-cea3-4378-b8f1-521f3d3fac7e', 'SOLUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:19.034+00', '2026-03-16 10:45:19.034+00');
INSERT INTO public.analysis_settings VALUES ('2b09a105-ac5c-4263-9324-cd94070ef301', 'SOLUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:19.066+00', '2026-03-16 10:45:19.066+00');
INSERT INTO public.analysis_settings VALUES ('07964e2e-ace2-4bf9-98ad-e34ebc6388f6', 'SOLUSDT', '3m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:19.099+00', '2026-03-16 10:45:19.099+00');
INSERT INTO public.analysis_settings VALUES ('f1c8881a-54ea-4083-9b92-e2a85bd73c67', 'SOLUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 5, "slowPeriod": 13}', true, '2026-03-16 10:45:19.162+00', '2026-03-16 10:45:19.162+00');
INSERT INTO public.analysis_settings VALUES ('7e97ceab-f2b1-480d-a808-a34f71c24173', 'SOLUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 8, "slowPeriod": 21}', true, '2026-03-16 10:45:19.194+00', '2026-03-16 10:45:19.194+00');
INSERT INTO public.analysis_settings VALUES ('a516afa5-6a5d-4e19-8cce-1c44207abd84', 'SOLUSDT', '5m', 'emaCross', 'default', 'default', '{"fastPeriod": 12, "slowPeriod": 26}', true, '2026-03-16 10:45:19.224+00', '2026-03-16 10:45:19.224+00');


--
-- Data for Name: research_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.research_settings VALUES ('869afa21-2af9-47a5-aea4-59543ce39816', 'default_10k', '10k-replay windows per timeframe', '{"1m": 600000000, "3m": 1800000000, "5m": 3000000000}', '{"1m": 600000000, "3m": 1800000000, "5m": 3000000000}', '{"1m": 2592000000, "3m": 2592000000, "5m": 2592000000}', true, '2026-03-16 10:42:15.276+00', '2026-03-16 10:42:15.276+00');


--
-- PostgreSQL database dump complete
--

\unrestrict tRrFYEsl4EyLe2agNf1Fp8SchH6H57Nhpsi6rnSCFjEXR1iuTunvIdOA1fsgu7r

