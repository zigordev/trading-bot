"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  History,
  Settings,
} from "lucide-react";

import { AppShell as DsAppShell } from "@/design-system/components/navigation/AppShell.jsx";
import { Logo } from "@/design-system/components/navigation/Logo.jsx";
import type { AppShellNavItem } from "@/design-system/components/navigation/AppShell";
import { WsStatusDot } from "@/components/shared/ws-status-dot";
import { useTopbarSlot } from "@/components/layout/topbar-slot-context";
import { configResources } from "@/lib/configuration/schemas";

/**
 * Single source of truth for primary navigation — previously byte-duplicated
 * across the old sidebar.tsx and topbar.tsx. `Sidebar` (desktop) and
 * `BottomNav` (mobile, via AppShell's automatic derivation of the first 5
 * items that have an icon) both read from this list. Configuration's
 * resources (Pairs/Timeframes/Strategies/...) are nested here directly
 * rather than living in a separate in-page nav (configuration/layout.tsx),
 * matching Execution's Paper/Live pattern.
 */
export const navItems: AppShellNavItem[] = [
  { href: "/", label: "Overview", icon: <LayoutDashboard className="size-4" aria-hidden /> },
  { href: "/backtesting", label: "Backtesting", icon: <History className="size-4" aria-hidden /> },
  {
    href: "/execution",
    label: "Execution",
    icon: <LineChart className="size-4" aria-hidden />,
    children: [
      { href: "/execution/paper", label: "Paper" },
      { href: "/execution/live", label: "Live" },
    ],
  },
  {
    href: "/configuration",
    label: "Configuration",
    icon: <Settings className="size-4" aria-hidden />,
    children: Object.values(configResources).map((resource) => ({
      href: `/configuration/${resource.key}`,
      label: resource.label,
    })),
  },
];

function Brand() {
  return (
    // size stays at the default "md": Logo only renders `tagline` at
    // size="lg" (documented in Logo.d.ts), but at "lg" the mark grows to
    // 64px against the Sidebar/Topbar's fixed 56px header row and visibly
    // clips (confirmed in-browser: getBoundingClientRect() top -4.5px,
    // cut off by the viewport edge). Keeping the tagline prop here is a
    // no-op today (never renders below "lg") but is left in place in case
    // a future Logo revision or a taller header makes it safe to show.
    <Logo
      mark={<LineChart className="size-4" aria-hidden />}
      wordmark="Trading Bot"
      tagline="Operator Console"
      shape="circle"
      href="/"
      linkComponent={Link}
    />
  );
}

function SidebarFooter() {
  return (
    <div>
      <div className="text-[11px] leading-tight text-[var(--ds-color-fg-subtle)]">
        Control plane
      </div>
      <div className="truncate font-mono text-[11px] text-[var(--ds-color-fg-muted)]">
        {process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ?? "http://localhost:3020"}
      </div>
    </div>
  );
}

function TopbarUtilities() {
  return (
    <div className="flex items-center gap-3">
      <WsStatusDot />
      <div className="hidden items-center gap-2 rounded-[var(--ds-radius-md)] border border-[var(--ds-color-border)] px-2.5 py-1 text-[11px] text-[var(--ds-color-fg-muted)] md:flex">
        <span className="size-1.5 rounded-full bg-[var(--ds-color-success)]" />
        <span>local</span>
      </div>
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

  return (
    <DsAppShell
      brand={<Brand />}
      sidebarItems={navItems}
      activeHref={pathname}
      sidebarFooter={<SidebarFooter />}
      linkComponent={Link}
      topbar={{
        title: slot.title,
        description: slot.description,
        actions: slot.actions,
        meta: slot.meta,
        tabs: slot.tabs,
        utilities: <TopbarUtilities />,
      }}
    >
      {children}
    </DsAppShell>
  );
}
