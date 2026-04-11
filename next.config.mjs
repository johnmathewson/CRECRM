/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth'],
  },
};

export default nextConfig;
