import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@relaxgo/shared'],
  async rewrites() {
    // Dev convenience: the panel calls /api/v1/* on its own origin; production sets NEXT_PUBLIC_API_URL.
    const api = process.env.API_PROXY_TARGET ?? 'http://localhost:4100';
    return [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }];
  },
};

export default nextConfig;
