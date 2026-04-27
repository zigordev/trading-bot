"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  History,
  LayoutDashboard,
  LineChart,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { WsStatusDot } from "@/components/shared/ws-status-dot";

type NavItem = { href: string; label: string; icon: LucideIcon };

const navItems: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/backtesting", label: "Backtesting", icon: History },
  { href: "/execution", label: "Execution", icon: LineChart },
  { href: "/configuration", label: "Configuration", icon: Settings },
];

const labelForPath = (pathname: string): string => {
  const match = navItems.find((item) =>
    item.href === "/"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.label ?? "Operator Console";
};

export function Topbar() {
  const pathname = usePathname();
  const activeLabel = labelForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-6">
        <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)] lg:hidden">
          <span className="font-semibold text-[var(--color-fg)]">
            Trading Bot
          </span>
          <span aria-hidden className="text-[var(--color-fg-faint)]">
            /
          </span>
          <span>{activeLabel}</span>
        </div>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto lg:hidden">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === item.href
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-[12px] font-medium",
                  active
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <WsStatusDot />
          <div className="hidden items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-fg-muted)] md:flex">
            <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
            <span>local</span>
          </div>
        </div>
      </div>
    </header>
  );
}
