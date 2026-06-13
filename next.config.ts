import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ngrok/ngrok is a native (N-API) addon — keep it out of the server bundle so
  // its .node binary is loaded from node_modules at runtime instead of webpack
  // trying (and failing) to bundle it.
  serverExternalPackages: ["@ngrok/ngrok"],
};

export default nextConfig;
