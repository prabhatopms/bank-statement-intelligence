const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse'],
  },
  transpilePackages: ['@uipath/apollo-wind', '@uipath/apollo-core'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Ensure a single React instance on the client when transpiling apollo-wind
      config.resolve.alias = {
        ...config.resolve.alias,
        react: path.resolve('./node_modules/react'),
        'react-dom': path.resolve('./node_modules/react-dom'),
      };
    }
    return config;
  },
}

module.exports = nextConfig
