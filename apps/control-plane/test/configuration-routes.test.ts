import assert from "node:assert/strict";
import test from "node:test";

import type {
  ConfigStore,
  ConfigStores,
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
    symbols: createStore(),
    timeframes: createStore(),
    strategies: createStore(),
    riskProfiles: createStore(),
    tradingDefaults: createStore(),
    analysisSettings: createStore(),
    ...overrides,
  }) as ConfigStores;

const createPgError = (code: string): Error =>
  Object.assign(new Error(`postgres ${code}`), { code });

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
        uniqueFieldName: "symbolCode/timeframeCode/strategyName",
        getUniqueFieldValue: () => "BTCUSDT/1m/ema",
      }),
    }),
  );

  const response = await app.inject({
    method: "POST",
    url: "/v1/analysis-settings",
    payload: {
      symbolCode: "BTCUSDT",
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
      active: true,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /periodMs/);
});
