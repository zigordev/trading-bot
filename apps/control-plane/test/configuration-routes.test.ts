import assert from "node:assert/strict";
import test from "node:test";

import type {
  ConfigStore,
  ConfigStores,
} from "../src/features/config-resources.js";
import { registerConfigurationRoutes } from "../src/routes/configuration.js";
import { createAppWithErrorHandler, testConfig } from "./helpers.ts";

const createStore = <TInput, TRecord>(
  overrides: Partial<ConfigStore<TInput, TRecord>> = {},
): ConfigStore<TInput, TRecord> => ({
  list: async () => [],
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
    symbols: createStore(),
    timeframes: createStore(),
    strategies: createStore(),
    riskProfiles: createStore(),
    analysisSettings: createStore(),
    executionSettings: createStore(),
    ...overrides,
  }) as ConfigStores;

const createPgError = (code: string): Error =>
  Object.assign(new Error(`postgres ${code}`), { code });

test("POST /v1/analysis-settings maps foreign-key violations to 409", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(
    app,
    testConfig,
    createStores({
      analysisSettings: createStore({
        create: async () => {
          throw createPgError("23503");
        },
        uniqueFieldName: "symbolCode/timeframeCode/strategyName",
        getUniqueFieldValue: () => "BTCUSDT/1m/ema",
      }),
    }),
  );

  const response = await app.inject({
    method: "POST",
    url: "/v1/analysis-settings",
    payload: {
      name: "ema-cross-20",
      strategyName: "ema",
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

test("POST /v1/timeframes rejects bodies without periodMs", async (t) => {
  const app = createAppWithErrorHandler();
  t.after(() => app.close());

  registerConfigurationRoutes(app, testConfig, createStores());

  const response = await app.inject({
    method: "POST",
    url: "/v1/timeframes",
    payload: {
      code: "1m",
      longerTimeframeCode: "5m",
      longerTimeframeMultiplier: 5,
      active: true,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /periodMs/);
});
