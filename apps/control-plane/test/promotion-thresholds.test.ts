import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasPositivePromotionSelectionValue,
  meetsStrategyPromotionThresholds,
  promoteBacktestRunIfEligible,
  strategyPromotionThresholdsFromParameters,
} from '../src/features/ops.js';

const createBacktestRun = (overrides: Record<string, unknown> = {}) => ({
  backtestId: 'bt-1',
  finishedAt: '2026-04-03T10:00:00.000Z',
  backtestDurationMs: 60_000,
  dataRetrievalDurationMs: 10_000,
  analysisSettingId: 'analysis-1',
  riskProfileName: 'trend-following',
  symbol: 'ETHUSDT',
  timeframeCode: '5m',
  strategyName: 'strategy1',
  requestedStartTime: 1_700_000_000_000,
  requestedEndTime: 1_700_003_900_000,
  replayKlineCount: 18_000,
  replayTradeCount: 2_000,
  signalCount: 250,
  tradeCount: 100,
  stopLossTradeCount: 10,
  takeProfitTradeCount: 20,
  reversalTradeCount: 5,
  windowEndTradeCount: 15,
  nonReversalTradeCount: 95,
  totalPnlPercent: 8,
  equityCurvePnlPercent: 8,
  maxDrawdownPercent: 6,
  reversalRatio: 0.1,
  score: 3,
  sourceEventId: 'event-1',
  sourceOccurredAt: '2026-04-03T10:00:01.000Z',
  ...overrides,
});

const createResolvedAnalysisRow = (
  strategyParameters: Record<string, unknown>
): Record<string, unknown> => {
  const timestamp = '2026-04-03T10:00:00.000Z';

  return {
    analysis_id: 'analysis-1',
    analysis_name: 'Strategy 1 Default',
    analysis_symbol_code: 'ETHUSDT',
    analysis_timeframe_code: '5m',
    analysis_strategy_name: 'strategy1',
    analysis_risk_profile_name: 'trend-following',
    analysis_technical_analysis_settings: '{}',
    analysis_enabled: true,
    analysis_created_at: timestamp,
    analysis_updated_at: timestamp,
    symbol_id: 'symbol-1',
    symbol_entity_code: 'ETHUSDT',
    symbol_active: true,
    symbol_base_asset: 'ETH',
    symbol_destination_asset: 'USDT',
    symbol_created_at: timestamp,
    symbol_updated_at: timestamp,
    timeframe_id: 'tf-1',
    timeframe_entity_code: '5m',
    timeframe_longer_timeframe_code: '15m',
    timeframe_longer_timeframe_multiplier: 3,
    timeframe_period_ms: 300_000,
    timeframe_active: true,
    timeframe_created_at: timestamp,
    timeframe_updated_at: timestamp,
    strategy_id: 'strategy-1',
    strategy_entity_name: 'strategy1',
    strategy_description: 'Strategy 1',
    strategy_activated: true,
    strategy_parameters: strategyParameters,
    strategy_created_at: timestamp,
    strategy_updated_at: timestamp,
    risk_profile_id: 'risk-1',
    risk_profile_entity_name: 'trend-following',
    risk_profile_description: 'Trend following',
    risk_profile_maximum_stop_loss: 5,
    risk_profile_minimum_stop_loss: 1,
    risk_profile_swing_gap: 1,
    risk_profile_rrr: 2,
    risk_profile_enabled: true,
    risk_profile_created_at: timestamp,
    risk_profile_updated_at: timestamp,
  };
};

const createQueryOnlyPool = (
  handler: (sql: string, params: unknown[] | undefined) => { rows?: unknown[]; rowCount?: number }
) =>
  ({
    query: async (sql: string, params?: unknown[]) => {
      const result = handler(sql, params);
      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? result.rows?.length ?? 0,
      };
    },
  }) as Parameters<typeof promoteBacktestRunIfEligible>[0];

test('strategyPromotionThresholdsFromParameters parses configured thresholds', () => {
  assert.deepEqual(
    strategyPromotionThresholdsFromParameters({
      kind: 'emaCross',
      promotionThresholds: {
        minTradeCount: 150,
        minTradesPer1000Candles: 15,
        maxDrawdownPercent: 15,
        maxReversalRatio: 0.35,
      },
    }),
    {
      minTradeCount: 150,
      minTradesPer1000Candles: 15,
      maxDrawdownPercent: 15,
      maxReversalRatio: 0.35,
    }
  );
});

test('meetsStrategyPromotionThresholds applies strategy minimum trade count', () => {
  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 149,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.1,
      },
      {
        promotionThresholds: {
          minTradeCount: 150,
          minTradesPer1000Candles: 15,
          maxDrawdownPercent: 15,
          maxReversalRatio: 0.35,
        },
      }
    ),
    false
  );

  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 150,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.1,
      },
      {
        promotionThresholds: {
          minTradeCount: 150,
          minTradesPer1000Candles: 15,
          maxDrawdownPercent: 15,
          maxReversalRatio: 0.35,
        },
      }
    ),
    true
  );
});

test('meetsStrategyPromotionThresholds rejects strategies without a complete threshold config', () => {
  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 80,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.1,
      },
      {
        kind: 'strategy1',
      }
    ),
    false
  );
});

test('meetsStrategyPromotionThresholds enforces trade density per replay candles', () => {
  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 149,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.1,
      },
      {
        promotionThresholds: {
          minTradeCount: 100,
          minTradesPer1000Candles: 15,
          maxDrawdownPercent: 15,
          maxReversalRatio: 0.35,
        },
      }
    ),
    false
  );

  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 150,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.1,
      },
      {
        promotionThresholds: {
          minTradeCount: 100,
          minTradesPer1000Candles: 15,
          maxDrawdownPercent: 15,
          maxReversalRatio: 0.35,
        },
      }
    ),
    true
  );
});

test('meetsStrategyPromotionThresholds enforces maximum drawdown percent', () => {
  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 150,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 15.01,
        reversalRatio: 0.1,
      },
      {
        promotionThresholds: {
          minTradeCount: 100,
          maxDrawdownPercent: 15,
          minTradesPer1000Candles: 5,
          maxReversalRatio: 0.35,
        },
      }
    ),
    false
  );

  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 150,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 15,
        reversalRatio: 0.1,
      },
      {
        promotionThresholds: {
          minTradeCount: 100,
          maxDrawdownPercent: 15,
          minTradesPer1000Candles: 5,
          maxReversalRatio: 0.35,
        },
      }
    ),
    true
  );
});

test('meetsStrategyPromotionThresholds enforces maximum reversal ratio', () => {
  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 150,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.36,
      },
      {
        promotionThresholds: {
          minTradeCount: 100,
          maxReversalRatio: 0.35,
          minTradesPer1000Candles: 5,
          maxDrawdownPercent: 15,
        },
      }
    ),
    false
  );

  assert.equal(
    meetsStrategyPromotionThresholds(
      {
        tradeCount: 150,
        replayKlineCount: 10_000,
        maxDrawdownPercent: 10,
        reversalRatio: 0.35,
      },
      {
        promotionThresholds: {
          minTradeCount: 100,
          maxReversalRatio: 0.35,
          minTradesPer1000Candles: 5,
          maxDrawdownPercent: 15,
        },
      }
    ),
    true
  );
});

test('hasPositivePromotionSelectionValue requires a strictly positive score', () => {
  assert.equal(
    hasPositivePromotionSelectionValue({
      score: 0,
      equityCurvePnlPercent: 5,
      maxDrawdownPercent: 2,
      reversalRatio: 0.1,
    }),
    false
  );

  assert.equal(
    hasPositivePromotionSelectionValue({
      score: 0.01,
      equityCurvePnlPercent: 5,
      maxDrawdownPercent: 2,
      reversalRatio: 0.1,
    }),
    true
  );
});

test('hasPositivePromotionSelectionValue falls back to the computed formula', () => {
  assert.equal(
    hasPositivePromotionSelectionValue({
      score: Number.NaN,
      equityCurvePnlPercent: 10,
      maxDrawdownPercent: 10,
      reversalRatio: 0.25,
    }),
    false
  );

  assert.equal(
    hasPositivePromotionSelectionValue({
      score: Number.NaN,
      equityCurvePnlPercent: 20,
      maxDrawdownPercent: 10,
      reversalRatio: 0.25,
    }),
    true
  );
});

test('promoteBacktestRunIfEligible supersedes an active promotion when the latest score is not promotable', async () => {
  const queries: string[] = [];
  const pool = createQueryOnlyPool((sql) => {
    queries.push(sql);

    if (sql.includes('FROM execution_settings')) {
      return {
        rows: [
          {
            name: 'paper-default',
            mode: 'paper',
            auto_promote: true,
            max_promotions: 3,
            replace_open_position_policy: 'keep',
          },
        ],
      };
    }

    if (sql.includes('UPDATE ops_execution_promotions')) {
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await promoteBacktestRunIfEligible(
    pool,
    createBacktestRun({
      score: 0,
      equityCurvePnlPercent: 4,
      maxDrawdownPercent: 3,
      reversalRatio: 0.1,
    })
  );

  assert.equal(result.promotion, null);
  assert.equal(result.changed, true);
  assert.equal(
    queries.some((sql) => sql.includes('FROM analysis_settings a')),
    false
  );
});

test('promoteBacktestRunIfEligible supersedes an active promotion when strategy thresholds are no longer met', async () => {
  const pool = createQueryOnlyPool((sql) => {
    if (sql.includes('FROM execution_settings')) {
      return {
        rows: [
          {
            name: 'paper-default',
            mode: 'paper',
            auto_promote: true,
            max_promotions: 3,
            replace_open_position_policy: 'keep',
          },
        ],
      };
    }

    if (sql.includes('FROM analysis_settings a')) {
      return {
        rows: [
          createResolvedAnalysisRow({
            promotionThresholds: {
              minTradeCount: 150,
              minTradesPer1000Candles: 5,
              maxDrawdownPercent: 12,
              maxReversalRatio: 0.2,
            },
          }),
        ],
      };
    }

    if (sql.includes('UPDATE ops_execution_promotions')) {
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await promoteBacktestRunIfEligible(
    pool,
    createBacktestRun({
      tradeCount: 80,
      replayKlineCount: 18_000,
      score: 5,
    })
  );

  assert.equal(result.promotion, null);
  assert.equal(result.changed, true);
});
