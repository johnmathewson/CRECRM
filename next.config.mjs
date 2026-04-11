/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
    serverComponentsExternalPackages: ['pdf-parse', 'xlsx', 'mammoth'],
  },
};

export default nextConfig;
