import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [
      // Guild War was renamed to Siege. Keep old bookmarks and shared links
      // working instead of dropping people on a 404.
      { source: "/guild-war", destination: "/siege", permanent: true },
    ];
  },
  experimental: {
    // Keep `next upgrade` focused on security patches for this app.
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
