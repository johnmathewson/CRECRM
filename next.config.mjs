/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
    // Heavy native/CJS modules used by the OM-extract route. They must NOT be
    // bundled by webpack — Next/Netlify needs to import them as commonjs at
    // runtime. Missing any one causes a silent function crash on Netlify.
    serverComponentsExternalPackages: ['pdf-parse-fork', 'mammoth'],
  },
};

export default nextConfig;
