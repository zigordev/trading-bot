"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  History,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavChild = {
  href: string;
  label: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  children?: NavChild[];
};

const navItems: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/backtesting", label: "Backtesting", icon: History },
  {
    href: "/execution",
    label: "Execution",
    icon: LineChart,
    children: [
      { href: "/execution/paper", label: "Paper" },
      { href: "/execution/live", label: "Live" },
    ],
  },
  { href: "/configuration", label: "Configuration", icon: Settings },
];

const isActive = (pathname: string, href: string): boolean =>
  href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

const isExactActive = (pathname: string, href: string): boolean =>
  pathname === href;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-5">
        <div className="grid size-7 place-items-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
          <LineChart className="size-4" aria-hidden />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold tracking-tight">
            Trading Bot
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            Operator Console
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const showChildren = active && item.children?.length;
            return (
              <li key={item.href} className="flex flex-col gap-1">
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg)]",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
                {showChildren ? (
                  <ul className="ml-7 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-2">
                    {item.children!.map((child) => {
                      const childActive = isExactActive(pathname, child.href);
                      return (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            className={cn(
                              "block rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] transition-colors",
                              childActive
                                ? "font-medium text-[var(--color-accent)]"
                                : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
                            )}
                          >
                            {child.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-[var(--color-border)] p-4">
        <div className="text-[11px] leading-tight text-[var(--color-fg-subtle)]">
          Control plane
        </div>
        <div className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
          {process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ??
            "http://localhost:3020"}
        </div>
      </div>
    </aside>
  );
}
