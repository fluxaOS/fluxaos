import type { NextConfig } from 'next';
import path from 'path';

const websiteRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: websiteRoot,
  turbopack: {
    root: websiteRoot,
  },
};

export default nextConfig;
