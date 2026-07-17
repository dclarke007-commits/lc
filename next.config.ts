import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Operator surfaces stay dynamic (AD-7/AD-13); no `use cache` anywhere in v1.
  // `pg` is a Node-only driver — keep it external to the server bundle.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
