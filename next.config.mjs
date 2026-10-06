/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // identifies this release, so open tabs can notice a newer one
    NEXT_PUBLIC_ACE_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
};

export default nextConfig;
