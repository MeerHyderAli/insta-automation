/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `pg` is only used in server code when DATABASE_URL is set.
  serverExternalPackages: ['pg'],
  // Allows the app to be previewed through sandbox / tunnel domains in dev.
  // This has no effect on production builds.
  allowedDevOrigins: ['*.e2b.app', '*.ngrok-free.app', '*.trycloudflare.com'],
};

export default nextConfig;
