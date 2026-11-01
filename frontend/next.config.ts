import type { NextConfig } from "next";

// `npm run ios:build` sets this to bundle the UI as static files inside the iOS app (Capacitor).
const nativeBuild = process.env.PENNY_NATIVE_BUILD === "1";
// The iOS Simulator shares the Mac's network, so `npm run ios:build:sim` may keep localhost.
const simulatorBuild = process.env.PENNY_IOS_SIMULATOR === "1";

if (nativeBuild && !simulatorBuild && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.NEXT_PUBLIC_API_BASE_URL ?? "localhost")) {
  // On a phone, localhost is the phone itself, so every API call would fail.
  throw new Error("Set NEXT_PUBLIC_API_BASE_URL to an address your iPhone can reach, e.g. http://<your-mac-ip>:8000 (see README, iPhone app).");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(nativeBuild && { output: "export", trailingSlash: true, images: { unoptimized: true } }),
};

export default nextConfig;
