import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Postgres driver and the Prisma client are Node-only: bundling them
  // would pull `pg`'s `util/types` require into the browser build and fail.
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "@prisma/client", "bcryptjs"],
  typedRoutes: false,
  // Next's dev server rejects asset requests whose origin it doesn't recognise
  // with a 403, which shows up as a page that renders but never hydrates.
  // Listing both loopback spellings avoids an afternoon of confusion.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
