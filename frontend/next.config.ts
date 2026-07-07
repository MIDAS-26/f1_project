import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbo: {
    alias: {
      '@/*': './*',
      '@app/*': './app/*'
    }
  },
};

export default nextConfig;