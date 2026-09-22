import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, Geist_Mono } from 'next/font/google';

import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { QueryProvider } from '@/components/providers/query-provider';
import { OpsRealtimeBridge } from '@/components/providers/ops-realtime-bridge';
import { PreferencesProvider } from '@/components/providers/preferences-provider';
import { I18nProvider } from '@/i18n/client';
import { getLocale, getMessages } from '@/i18n/server';
import { nonceFrom } from '@/lib/csp';
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages(locale);
  const nonce = nonceFrom((await headers()).get('content-security-policy-report-only'));

  return (
    <html data-theme="operator-console" lang={locale}>
      <body className={`${inter.variable} ${geistMono.variable}`}>
        <RumProvider />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <I18nProvider locale={locale} messages={messages}>
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
        </I18nProvider>
      </body>
    </html>
  );
}
