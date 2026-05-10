import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': [
      './.worktrees/**/*',
      './.fluxaos-worktrees/**/*',
      './website/.next/**/*',
      './website/out/**/*',
      './website/docs-site/build/**/*',
      './website/docs-site/.docusaurus/**/*',
    ],
  },
  allowedDevOrigins: ['192.168.54.101', 'dev-flux.jdp21.com'],
};

export default nextConfig;
