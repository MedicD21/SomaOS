import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@soma/auth', '@soma/validators', '@soma/custom-fields', '@soma/config-core', '@soma/schedule-engine'],
  serverExternalPackages: ['postgres'],
  // Uploads go through server actions; the app enforces 25 MB per file.
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
};

export default config;
