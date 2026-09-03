import type { Metadata } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';

import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { QueryProvider } from '@/components/providers/query-provider';
import { OpsRealtimeBridge } from '@/components/providers/ops-realtime-bridge';
import { PreferencesProvider } from '@/components/providers/preferences-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AppShell } from '@/components/layout/app-shell';
import { TopbarSlotProvider } from '@/components/layout/topbar-slot-context';

// Runs before hydration so dark mode doesn't flash light-then-dark on load —
// PreferencesProvider's own effect only runs after first paint. Mirrors
// gpool's own inline-script pattern, minus the `.dark` class (this app uses
// a single data-mode attribute, matching kini's simpler mechanism).
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('operator-console-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.setAttribute('data-mode','dark');}}catch(e){}`;

import './globals.css';
import { RumProvider } from '@/observability/RumProvider';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Trading Bot · Operator Console',
  description: 'Monitor backtests, execution, and configuration.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-theme="operator-console">
      <body className={`${inter.variable} ${geistMono.variable}`}>
        <RumProvider />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <PreferencesProvider>
          <NuqsAdapter>
            <QueryProvider>
              <TooltipProvider delayDuration={150}>
                <OpsRealtimeBridge>
                  <TopbarSlotProvider>
                    <AppShell>{children}</AppShell>
                  </TopbarSlotProvider>
                  <Toaster />
                </OpsRealtimeBridge>
              </TooltipProvider>
            </QueryProvider>
          </NuqsAdapter>
        </PreferencesProvider>
      </body>
    </html>
  );
}
