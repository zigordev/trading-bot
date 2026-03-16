import assert from "node:assert/strict";
import test from "node:test";

import type {
  ConfigStore,
  ConfigStores,
  ResearchSettingsInput,
  ResearchSettingsRecord,
} from "../src/features/config-resources.js";
import { registerConfigurationRoutes } from "../src/routes/configuration.js";
import { createAppWithErrorHandler } from "./helpers.ts";

const createStore = <TInput, TRecord>(
  overrides: Partial<ConfigStore<TInput, TRecord>> = {},
): ConfigStore<TInput, TRecord> => ({
  list: async () => [],
  getById: async () => null,
  create: async () => {
    throw new Error("Unexpected create call");
  },
  update: async () => null,
  delete: async () => false,
  uniqueFieldName: "id",
  getUniqueFieldValue: () => "value",
  ...overrides,
});

const createStores = (
  overrides: Partial<ConfigStores> = {},
): ConfigStores =>
  ({
    pairs: createStore(),
    timeframes: createStore(),
    strategies: createStore(),
    riskProfiles: createStore(),
    tradingDefaults: createStore(),
    researchSettings: createStore(),
    analysisSettings: createStore(),
    ...overrides,
  }) as ConfigStores;

const createPgError = (code: string): Error =>
  Object.assign(new Error(`postgres ${code}`), { code });

const researchSettingsBody: ResearchSettingsInput = {
  name: "smoke",
  description: "smoke test",
  backtestingTimerange: { "1m": 60, "3m": 180, "5m": 300 },
  favorableTimeslotsBacktestingTimerange: { "1m": 30, "3m": 90, "5m": 150 },
  optimizationValidityPeriod: { "1m": 15, "3m": 45, "5m": 75 },
  enabled: true,
};

const researchSettingsRecord: ResearchSettingsRecord = {
  id: "research-1",
  ...researchSettingsBody,
  createdAt: "2026-03-12T16:00:00.000Z",
  updatedAt: "2026-03-12T16:00:00.000Z",
};

test("POST /v1/research-settings returns created record", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(
    app,
    createStores({
      researchSettings: createStore({
        create: async () => researchSettingsRecord,
        uniqueFieldName: "name",
        getUniqueFieldValue: (input) =>
          (input as ResearchSettingsInput).name,
      }),
    }),
  );

  const response = await app.inject({
    method: "POST",
    url: "/v1/research-settings",
    payload: researchSettingsBody,
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), researchSettingsRecord);
});

test("POST /v1/research-settings maps unique violations to 409", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(
    app,
    createStores({
      researchSettings: createStore({
        create: async () => {
          throw createPgError("23505");
        },
        uniqueFieldName: "name",
        getUniqueFieldValue: (input) =>
          (input as ResearchSettingsInput).name,
      }),
    }),
  );

  const response = await app.inject({
    method: "POST",
    url: "/v1/research-settings",
    payload: researchSettingsBody,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    response.json().message,
    'research settings profile with name "smoke" already exists',
  );
});

test("POST /v1/analysis-settings maps foreign-key violations to 409", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(
    app,
    createStores({
      analysisSettings: createStore({
        create: async () => {
          throw createPgError("23503");
        },
        uniqueFieldName: "pairCode/timeframeCode/strategyName",
        getUniqueFieldValue: () => "BTCUSDT/1m/ema",
      }),
    }),
  );

  const response = await app.inject({
    method: "POST",
    url: "/v1/analysis-settings",
    payload: {
      pairCode: "BTCUSDT",
      timeframeCode: "1m",
      strategyName: "ema",
      riskProfileName: "default",
      tradingDefaultsName: "binance-default",
      technicalAnalysisSettings: { period: 20 },
      enabled: true,
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    response.json().message,
    "analysis setting references configuration entries that do not exist",
  );
});

test("DELETE /v1/trading-defaults/:id maps reference violations to 409", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(
    app,
    createStores({
      tradingDefaults: createStore({
        delete: async () => {
          throw createPgError("23503");
        },
      }),
    }),
  );

  const response = await app.inject({
    method: "DELETE",
    url: "/v1/trading-defaults/default",
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    response.json().message,
    "trading defaults profile default is still referenced by another configuration resource",
  );
});

test("POST /v1/timeframes rejects bodies without periodMs", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(app, createStores());

  const response = await app.inject({
    method: "POST",
    url: "/v1/timeframes",
    payload: {
      code: "1m",
      longerTimeframeCode: "5m",
      longerTimeframeMultiplier: 5,
      operable: true,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /periodMs/);
});
