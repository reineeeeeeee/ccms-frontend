// The browser only ever talks to this app. Everything under /api is forwarded to the API gateway
// (a separate Vercel project), which checks the token and routes to Identity, Core and Logs.
// Because the browser sees ONE address, the sign-in cookies (refresh token and the signed-in marker)
// are first-party cookies and need no cross-site settings.
const gatewayUrl = (process.env.API_GATEWAY_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${gatewayUrl}/api/:path*` }];
  },
};

export default nextConfig;
