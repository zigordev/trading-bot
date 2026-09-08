import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { StrategyName } from './strategy-name';

const strategies = vi.hoisted(() => ({ data: [] as Record<string, unknown>[] }));

vi.mock('@/lib/hooks/use-strategies', () => ({
  useStrategies: () => strategies,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div role="tooltip">{children}</div>,
}));

afterEach(cleanup);

describe('StrategyName', () => {
  it('attaches the strategy description as a tooltip', () => {
    strategies.data = [{ name: 'emaCross', description: '  EMA crossover strategy  ' }];

    render(<StrategyName name="emaCross" />);

    expect(screen.getByText('emaCross')).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tooltip')).toHaveTextContent('EMA crossover strategy');
  });

  it('renders plain text when the strategy has no description', () => {
    strategies.data = [{ name: 'strategy1', description: '   ' }];

    render(<StrategyName name="strategy1" />);

    expect(screen.getByText('strategy1')).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders plain text when the strategy is unknown', () => {
    strategies.data = [];

    render(<StrategyName name="mystery" />);

    expect(screen.getByText('mystery')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
