'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { configResources } from '@/lib/configuration/schemas';
import { usePreferences } from '@/components/providers/preferences-provider';

/**
 * Resource switching lives in Sidebar's Configuration > [resources] nesting
 * (see components/layout/app-shell.tsx) on desktop. The `nav` below is a
 * mobile-only fallback (`ds-hide-desktop`) — Sidebar is hidden below the
 * lg breakpoint and BottomNav only surfaces top-level destinations, so this
 * is the only way to switch resources on a small screen. Mirrors the same
 * pattern used for Execution's Paper/Live switch.
 */
export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = usePreferences();

  return (
    <div className="flex flex-col gap-4">
      <nav className="ds-hide-desktop flex flex-wrap gap-1">
        {Object.values(configResources).map((resource) => {
          const href = `/configuration/${resource.key}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={resource.key}
              href={href}
              className={cn(
                'rounded-[var(--radius-md)] px-3 py-1.5 text-[12px] font-medium transition-colors',
                active
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]'
              )}
            >
              {t(resource.labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
