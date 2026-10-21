/**
 * Next.js configuration for the Duggal Badmosh Daily website.
 *
 * Deliberate choices:
 *  - No `next/image` remote optimisation: submitted photos are already resized
 *    to WebP with a generated thumbnail by the API, so `<img>` + explicit
 *    width/height is faster and avoids free-tier image-optimisation cost.
 *  - ESLint/type checks run as their own `npm run` gates (root `npm run verify`),
 *    never silently skipped in `next build` unless you opt in.
 *  - Security headers are applied to every response; the CSP allows inline
 *    scripts/styles because Next injects them without a nonce by default.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  eslint: {
    // Lint is a separate, explicit gate. Do not hide failures behind a build.
    ignoreDuringBuilds: process.env.SKIP_LINT === 'true',
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async rewrites() {
    // Photos are public and immutable. Routing them through this origin lets
    // the Vercel edge cache them once instead of every reader hitting Render.
    const apiBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');
    if (!apiBase) return [];
    return [{ source: '/media/:path*', destination: `${apiBase}/media/:path*` }];
  },
  async headers() {
    // Uploads go straight from the browser to the Render API, which is a
    // different origin. Production is HTTPS; local development talks to
    // http://localhost:8080, so only allow plain HTTP there.
    const devConnect = process.env.NODE_ENV === 'production' ? '' : ' http://localhost:* http://127.0.0.1:*';
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https: http:",
      `connect-src 'self' https:${devConnect}`,
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      {
        // Proxied uploads keep the API's immutable caching, restated here so
        // the edge never revalidates a photo that can never change.
        source: '/media/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // The admin console must never be indexed or cached by a proxy.
        source: '/admin/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;
