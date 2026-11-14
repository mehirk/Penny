import type { NextConfig } from "next";

// `npm run ios:build` sets this to bundle the UI as static files inside the iOS app (Capacitor).
const nativeBuild = process.env.PENNY_NATIVE_BUILD === "1";
// The iOS Simulator shares the Mac's network, so `npm run ios:build:sim` may keep localhost.
const simulatorBuild = process.env.PENNY_IOS_SIMULATOR === "1";

if (
  nativeBuild &&
  !simulatorBuild &&
  /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.NEXT_PUBLIC_API_BASE_URL ?? "localhost")
) {
  // On a phone, localhost is the phone itself, so every API call would fail.
  throw new Error(
    "Set NEXT_PUBLIC_API_BASE_URL to an address your iPhone can reach, e.g. http://<your-mac-ip>:8000 (see README, iPhone app).",
  );
}

/** Where the browser may connect: Penny's API and Supabase (sign-in, including its websocket). */
function connectSources(): string {
  const origins = new Set(["'self'"]);
  for (const url of [process.env.NEXT_PUBLIC_API_BASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    if (!url) continue;
    try {
      const { origin, host, protocol } = new URL(url);
      origins.add(origin);
      origins.add(`${protocol === "https:" ? "wss" : "ws"}://${host}`);
    } catch {
      /* not a URL: left out */
    }
  }
  return [...origins].join(" ");
}

/**
 * Security headers for the website (the iOS app bundles static files, so they don't apply there).
 * Scripts and styles allow inline code: Next.js and the theme boot script use it. Everything
 * else is locked to this site, the API, and Supabase, and no one can frame Penny.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSources()}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(nativeBuild
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : { headers: async () => [{ source: "/:path*", headers: securityHeaders }] }),
};

export default nextConfig;
