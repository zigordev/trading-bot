import { Counter } from 'prom-client';
import { registry, startAtZero } from './observability/index.js';

export const PROJECTION_STREAMS = [
  'backtest_progress',
  'backtest_completed',
  'data_readiness',
] as const;
export type ProjectionStream = (typeof PROJECTION_STREAMS)[number];

export const PROJECTION_OUTCOMES = ['projected', 'failed'] as const;
export type ProjectionOutcome = (typeof PROJECTION_OUTCOMES)[number];

export const CONFIG_CHANGE_OUTCOMES = ['published', 'failed', 'skipped'] as const;
export type ConfigChangeOutcome = (typeof CONFIG_CHANGE_OUTCOMES)[number];

export const PROMOTION_OUTCOMES = [
  'promoted',
  'auto_promote_disabled',
  'selection_value_not_positive',
  'analysis_not_eligible',
  'thresholds_not_met',
  'already_promoted',
  'outscored_by_active',
] as const;
export type PromotionOutcome = (typeof PROMOTION_OUTCOMES)[number];

const projections = new Counter({
  name: 'trading_bot_control_plane_projections_total',
  help: 'Events projected into the control plane from each stream, by outcome',
  labelNames: ['stream', 'outcome'] as const,
  registers: [registry],
});

const configChanges = new Counter({
  name: 'trading_bot_control_plane_config_changes_total',
  help: 'Configuration changes published to the services, by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

const promotions = new Counter({
  name: 'trading_bot_control_plane_promotions_total',
  help: 'Backtested configurations considered for live execution, by what the decision concluded',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export function startDomainMetricsAtZero(): void {
  startAtZero(
    projections,
    PROJECTION_STREAMS.flatMap((stream) =>
      PROJECTION_OUTCOMES.map((outcome) => ({ stream, outcome }))
    )
  );
  startAtZero(
    configChanges,
    CONFIG_CHANGE_OUTCOMES.map((outcome) => ({ outcome }))
  );
  startAtZero(
    promotions,
    PROMOTION_OUTCOMES.map((outcome) => ({ outcome }))
  );
}

export function countProjection(stream: ProjectionStream, outcome: ProjectionOutcome): void {
  projections.inc({ stream, outcome });
}

export function countConfigChange(outcome: ConfigChangeOutcome): void {
  configChanges.inc({ outcome });
}

export function countPromotion(outcome: PromotionOutcome): void {
  promotions.inc({ outcome });
}
