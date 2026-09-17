/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  productionBrowserSourceMaps: false,
  typescript: {
    // Railway was crashing after "Compiled successfully" during
    // Next's integrated TypeScript validation near the ~2GB V8 heap limit.
    // Recent releases already run targeted syntax checks before packaging,
    // so do not run the duplicate memory-heavy checker in production build.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
