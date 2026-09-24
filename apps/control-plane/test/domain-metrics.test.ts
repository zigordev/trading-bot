import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  CONFIG_CHANGE_OUTCOMES,
  countConfigChange,
  countProjection,
  countPromotion,
  PROJECTION_OUTCOMES,
  PROJECTION_STREAMS,
  PROMOTION_OUTCOMES,
  startDomainMetricsAtZero,
} from '../src/domain-metrics.js';
import { registry } from '../src/observability/index.js';

test('every projection stream and config-change outcome exists at zero, then counts', async () => {
  startDomainMetricsAtZero();
  let text = await registry.metrics();
  for (const stream of PROJECTION_STREAMS) {
    for (const outcome of PROJECTION_OUTCOMES) {
      assert.match(
        text,
        new RegExp(
          `trading_bot_control_plane_projections_total\\{stream="${stream}",outcome="${outcome}"\\} 0`
        )
      );
    }
  }
  for (const outcome of CONFIG_CHANGE_OUTCOMES) {
    assert.match(
      text,
      new RegExp(`trading_bot_control_plane_config_changes_total\\{outcome="${outcome}"\\} 0`)
    );
  }

  for (const outcome of PROMOTION_OUTCOMES) {
    assert.match(
      text,
      new RegExp(`trading_bot_control_plane_promotions_total\\{outcome="${outcome}"\\} 0`)
    );
  }

  countProjection('data_readiness', 'failed');
  countConfigChange('published');
  countPromotion('promoted');
  text = await registry.metrics();
  assert.match(
    text,
    /trading_bot_control_plane_projections_total\{stream="data_readiness",outcome="failed"\} 1/
  );
  assert.match(text, /trading_bot_control_plane_config_changes_total\{outcome="published"\} 1/);
  assert.match(text, /trading_bot_control_plane_promotions_total\{outcome="promoted"\} 1/);
});
