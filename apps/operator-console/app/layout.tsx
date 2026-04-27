import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";

import { NuqsAdapter } from "nuqs/adapters/next/app";

import { QueryProvider } from "@/components/providers/query-provider";
import { OpsRealtimeBridge } from "@/components/providers/ops-realtime-bridge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trading Bot · Operator Console",
  description: "Monitor backtests, execution, and configuration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistMono.variable}`}>
        <NuqsAdapter>
          <QueryProvider>
            <TooltipProvider delayDuration={150}>
              <OpsRealtimeBridge>
                {children}
                <Toaster />
              </OpsRealtimeBridge>
            </TooltipProvider>
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
