import path from 'node:path';
import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // design-system ships raw .jsx rather than a build output, so Next has to
  // transpile it like first-party source instead of skipping node_modules.
  transpilePackages: ['design-system'],
  reactStrictMode: true,
  productionBrowserSourceMaps: true,
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.jsdelivr.net',
        pathname: '/gh/spothq/cryptocurrency-icons/**',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
    clientTraceMetadata: ['traceparent'],
  },
  serverExternalPackages: [
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/sdk-node',
  ],
};

export default nextConfig;
