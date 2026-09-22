import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Testing on a real phone means loading the dev server by its address on the
   * local network rather than localhost, which Next treats as cross-origin: it
   * warns on every `/_next/*` request today and will refuse them outright in a
   * future major version.
   *
   * Listing origins here opts in early — but it also switches Next from
   * warning to blocking, so the list has to cover every address a router can
   * actually hand out or the app goes blank on somebody's network. These are
   * the three private ranges in full (RFC 1918), plus the `.local` name macOS
   * and Linux advertise over mDNS. Development only; ignored in a production
   * build.
   */
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    // 172.16.0.0/12, one pattern per octet the range permits.
    ...Array.from({ length: 16 }, (_, index) => `172.${16 + index}.*.*`),
    '*.local',
  ],
  experimental: {
    // Server Actions are the primary mutation transport (ADR-001).
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
