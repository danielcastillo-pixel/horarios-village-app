/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;

import("@opennextjs/cloudflare").then((module) => module.initOpenNextCloudflareForDev());
