import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['192.168.54.101', 'dev-flux.jdp21.com'],
};

export default nextConfig;
