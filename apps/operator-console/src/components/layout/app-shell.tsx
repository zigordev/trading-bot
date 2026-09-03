'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AppShell as DsAppShell } from '@ds/components/navigation/AppShell.jsx';
import { Icon } from '@ds/components/icons/Icon.jsx';
import { Logo } from '@ds/components/navigation/Logo.jsx';
import type { AppShellNavItem } from '@ds/components/navigation/AppShell';
import { WsStatusDot } from '@/components/shared/ws-status-dot';
import { useTopbarSlot } from '@/components/layout/topbar-slot-context';
import { usePreferences, type Translate } from '@/components/providers/preferences-provider';
import { ThemeButton, LanguageButton } from '@/components/layout/topbar-utilities';
import { configResources } from '@/lib/configuration/schemas';

/**
 * Single source of truth for primary navigation — previously byte-duplicated
 * across the old sidebar.tsx and topbar.tsx. `Sidebar` (desktop) and
 * `BottomNav` (mobile, via AppShell's automatic derivation of the first 5
 * items that have an icon) both read from this list. Configuration's
 * resources (Pairs/Timeframes/Strategies/...) are nested here directly
 * rather than living in a separate in-page nav (configuration/layout.tsx),
 * matching Execution's Paper/Live pattern. Built as a function (not a
 * module-level constant) since labels now come from t() — a plain constant
 * would be evaluated once at import, before PreferencesProvider mounts.
 */
function getNavItems(t: Translate): AppShellNavItem[] {
  return [
    {
      href: '/',
      label: t('nav.overview'),
      icon: <Icon name="layout-dashboard" className="size-4" />,
    },
    {
      href: '/backtesting',
      label: t('nav.backtesting'),
      icon: <Icon name="history" className="size-4" />,
    },
    {
      // Paper/Live is a mode, not two destinations — it lives in the
      // Topbar's `mode` slot (see execution-screen.tsx). Nesting it here
      // duplicated the whole subtree and forced a mobile-only mirror of
      // the same switch, since BottomNav only surfaces top-level items.
      href: '/execution',
      label: t('nav.execution'),
      icon: <Icon name="chart-line" className="size-4" />,
    },
    {
      href: '/configuration',
      label: t('nav.configuration'),
      icon: <Icon name="settings" className="size-4" />,
      children: Object.values(configResources).map((resource) => ({
        href: `/configuration/${resource.key}`,
        label: t(resource.labelKey),
      })),
    },
  ];
}

function Brand() {
  return (
    // size="sm" matches kini/gpool's nav brand exactly (their default "md"
    // was an uncoordinated per-migration choice, not a deliberate size —
    // see design-system's Logo.d.ts SIZES: sm=34px, md=48px, lg=64px).
    // "lg" is out regardless: its mark grows to 64px against the
    // Sidebar/Topbar's fixed 56px header row and visibly clips (confirmed
    // in-browser: getBoundingClientRect() top -4.5px, cut off by the
    // viewport edge). `tagline` is a no-op below "lg" but left in place in
    // case a future Logo revision or taller header makes it safe to show.
    <Logo
      mark={<Icon name="chart-line" className="size-4" />}
      wordmark="Trading Bot"
      tagline="Operator Console"
      shape="circle"
      size="sm"
      href="/"
      linkComponent={Link}
    />
  );
}

function SidebarFooter() {
  const { t } = usePreferences();
  return (
    <div>
      <div className="text-[11px] leading-tight text-[var(--ds-color-fg-subtle)]">
        {t('shell.control_plane')}
      </div>
      <div className="truncate font-mono text-[11px] text-[var(--ds-color-fg-muted)]">
        {process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ?? 'http://localhost:3020'}
      </div>
    </div>
  );
}

function TopbarUtilities() {
  const { t } = usePreferences();
  return (
    <div className="flex items-center gap-3">
      <WsStatusDot />
      <div className="hidden items-center gap-2 rounded-[var(--ds-radius-md)] border border-[var(--ds-color-border)] px-2.5 py-1 text-[11px] text-[var(--ds-color-fg-muted)] md:flex">
        <span className="size-1.5 rounded-full bg-[var(--ds-color-success)]" />
        <span>{t('shell.local')}</span>
      </div>
      <ThemeButton />
      <LanguageButton />
    </div>
  );
}

/**
 * Mounted once in the root layout (app/layout.tsx) so the sticky Sidebar/
 * Topbar persist across client-side navigation instead of remounting per
 * page. Reads the current route's contextual title/description/actions/
 * meta/tabs from TopbarSlotContext and forwards them into DsAppShell's
 * `topbar` prop bag.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { slot } = useTopbarSlot();
  const { t } = usePreferences();

  return (
    <DsAppShell
      brand={<Brand />}
      sidebarItems={getNavItems(t)}
      activeHref={pathname}
      sidebarFooter={<SidebarFooter />}
      linkComponent={Link}
      topbar={{
        title: slot.title,
        description: slot.description,
        actions: slot.actions,
        meta: slot.meta,
        tabs: slot.tabs,
        mode: slot.mode,
        utilities: <TopbarUtilities />,
      }}
    >
      {children}
    </DsAppShell>
  );
}
