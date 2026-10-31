import { NextResponse } from "next/server";

// The response never changes, so it can also be written out by the static iOS build.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ status: "ok", service: "penny-web", version: "0.1.0" });
}
