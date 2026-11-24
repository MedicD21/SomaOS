import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@soma/auth', '@soma/validators', '@soma/custom-fields', '@soma/config-core'],
  serverExternalPackages: ['postgres'],
};

export default config;
